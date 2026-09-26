import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  RepositoryHead,
  RepositoryInteractiveRebaseCommit,
  RepositoryInteractiveRebaseCommand,
  RepositoryInteractiveRebasePlan,
  RepositoryInteractiveRebasePlanRequest,
  RepositoryInteractiveRebaseRequest,
  RepositoryHistoryPerson,
} from '../../common/ipc/contracts';
import { repositoryInteractiveRebasePlanSchema } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitTimeoutError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import { displayOutput } from './network-service';
import { detectPendingOperation } from './commit-service';
import { previewLocalChanges, withLocalChanges } from './recovery-service';
import {
  cleanupInteractiveRebaseArtifacts,
  createInteractiveRebaseArtifacts,
  readRebaseBackups,
  rebaseBackupRef,
} from './interactive-rebase-artifacts';

const planReadTimeoutMs = 15_000;
const planReadOutputLimit = 16 * 1024 * 1024;
const rebaseTimeoutMs = 15 * 60 * 1000;
const rebaseOutputLimit = 8 * 1024 * 1024;
const maxPlanCommits = 500;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface InteractiveRebaseRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface InteractiveRebaseContext {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
}

export interface InteractiveRebaseInput extends InteractiveRebaseContext {
  readonly request: RepositoryInteractiveRebaseRequest;
  readonly signal: AbortSignal;
  readonly handle: OperationHandle;
}

export class InteractiveRebaseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveRebaseRequestError';
  }
}

export class StaleInteractiveRebasePlanError extends Error {
  constructor() {
    super('The repository changed after the rebase plan was read. Review the plan again.');
    this.name = 'StaleInteractiveRebasePlanError';
  }
}

class InteractiveRebaseRecoveryError extends Error {
  readonly output: string;
  readonly failureReason: 'cancelled' | 'timeout' | 'conflict' | 'other';

  constructor(
    message: string,
    output: string,
    failureReason: 'cancelled' | 'timeout' | 'conflict' | 'other',
  ) {
    super(message);
    this.name = 'InteractiveRebaseRecoveryError';
    this.output = output;
    this.failureReason = failureReason;
  }
}

interface RawCommit {
  readonly commitId: string;
  readonly parents: readonly string[];
}

interface BranchHead extends RepositoryHead {
  readonly state: 'branch';
  readonly name: string;
  readonly commit: string;
}

interface PlanRow {
  readonly commitId: string;
  readonly parents: string[];
  readonly subject: string;
  readonly body: string;
  readonly author: RepositoryHistoryPerson;
  readonly committer: RepositoryHistoryPerson;
  readonly action: RepositoryInteractiveRebaseCommand;
  readonly combinedMessage?: string | undefined;
}

interface MutablePlanRow extends PlanRow {
  action: RepositoryInteractiveRebaseCommand;
}

/** Reads a bounded, newest-first interactive plan without changing the repository. */
export async function readInteractiveRebasePlan(
  runner: InteractiveRebaseRunner,
  context: InteractiveRebaseContext,
  request: RepositoryInteractiveRebasePlanRequest,
): Promise<RepositoryInteractiveRebasePlan> {
  const pending = await detectPendingOperation(context.gitDir);
  if (pending) {
    throw new InteractiveRebaseRequestError(
      `Finish or abort the ${pending} before opening an interactive rebase plan.`,
    );
  }
  if ((await readRebaseBackups(context.gitDir)).length >= 100) {
    throw new InteractiveRebaseRequestError(
      'Review and dismiss older rebase backups in Recovery before starting another rebase.',
    );
  }
  const head = await readBranchHead(runner, context.cwd);
  let ontoCommitId = request.ontoCommitId;
  if (request.quickAction) {
    const parents =
      (await optionalOutput(runner, context.cwd, ['show', '-s', '--format=%P', request.quickAction.commitId]))
        ?.split(' ')
        .filter(Boolean) ?? [];
    ontoCommitId = parents[0] ?? null;
    if (['squash', 'fixup'].includes(request.quickAction.action)) {
      if (!ontoCommitId)
        throw new InteractiveRebaseRequestError('The root commit has no parent to combine with.');
      ontoCommitId =
        (await optionalOutput(runner, context.cwd, ['show', '-s', '--format=%P', ontoCommitId]))?.split(
          ' ',
        )[0] || null;
    }
  }
  const rawCommits = await readPlanCommits(runner, context.cwd, head.commit, ontoCommitId);
  const metadata = await readCommitMetadata(
    runner,
    context.cwd,
    rawCommits.map((commit) => commit.commitId),
  );
  const rows = rawCommits.map((commit) => {
    const item = metadata.get(commit.commitId);
    if (!item) throw new Error('Git did not return metadata for every rebase commit.');
    return {
      ...item,
      parents: [...commit.parents],
      action: 'pick' as const,
    } satisfies RepositoryInteractiveRebaseCommit;
  });
  const newestFirst = [...rows].reverse();
  const workingChanges = await previewLocalChanges(runner, {
    id: context.repositoryId,
    cwd: context.cwd,
    gitDir: context.gitDir,
    head,
  });
  const mergeCommitCount = rawCommits.filter((commit) => commit.parents.length > 1).length;
  const ontoSubject = ontoCommitId
    ? await optionalOutput(runner, context.cwd, ['show', '-s', '--format=%s', ontoCommitId])
    : null;
  const references = (
    await runner.run(
      [
        'for-each-ref',
        '--count=10001',
        '--format=%(refname)%00%(objectname)%00%(if)%(worktreepath)%(then)checked-out%(end)%00%(upstream)',
        'refs/heads',
        'refs/remotes',
      ],
      {
        cwd: context.cwd,
        timeoutMs: planReadTimeoutMs,
        maxOutputBytes: planReadOutputLimit,
      },
    )
  ).stdout.trim();
  const referenceRows = references ? references.split('\n').map((line) => line.split('\0')) : [];
  if (referenceRows.length > 10_000)
    throw new InteractiveRebaseRequestError('There are too many references to review safely.');
  const commitIds = new Set(rows.map((row) => row.commitId));
  const dependentBranches = referenceRows
    .filter(
      ([name, commit]) =>
        name?.startsWith('refs/heads/') && name !== `refs/heads/${head.name}` && commitIds.has(commit!),
    )
    .map(([name, commitId, worktree]) => ({
      name: name!.slice('refs/heads/'.length),
      fullName: name!,
      commitId: commitId!,
      checkedOut: Boolean(worktree),
    }));
  const unpublished = new Set(
    (
      await runner.run(
        [
          'rev-list',
          '--max-count=501',
          ontoCommitId ? `${ontoCommitId}..${head.commit}` : head.commit,
          '--not',
          '--remotes',
        ],
        {
          cwd: context.cwd,
          timeoutMs: planReadTimeoutMs,
          maxOutputBytes: planReadOutputLimit,
        },
      )
    ).stdout
      .trim()
      .split('\n'),
  );
  const snapshot = createHash('sha256')
    .update(
      JSON.stringify({
        head,
        ontoCommitId,
        rows: newestFirst,
        references,
      }),
    )
    .digest('hex');
  let proposed: MutablePlanRow[] = rows;
  if (request.actions) {
    if (request.snapshot !== snapshot) throw new StaleInteractiveRebasePlanError();
    const seen = new Set(request.actions.map((row) => row.commitId));
    if (
      seen.size !== rows.length ||
      request.actions.length !== rows.length ||
      [...seen].some((id) => !commitIds.has(id))
    )
      throw new InteractiveRebaseRequestError('The plan must contain each reviewed commit once.');
    proposed = [...request.actions]
      .reverse()
      .map((row) => ({ ...rows.find((original) => original.commitId === row.commitId)!, ...row }));
  }
  if (request.quickAction) {
    if (!commitIds.has(request.quickAction.commitId))
      throw new InteractiveRebaseRequestError('The selected commit is not in this branch history.');
    proposed = proposed.map((row) =>
      row.commitId === request.quickAction!.commitId ? { ...row, action: request.quickAction!.action } : row,
    );
  }
  if (request.autosquash) {
    if (mergeCommitCount)
      throw new InteractiveRebaseRequestError(
        'Autosquash is available for linear plans. Merge plans preserve their topology.',
      );
    proposed = applyAutosquash(proposed, rows);
  }
  return repositoryInteractiveRebasePlanSchema.parse({
    repositoryId: context.repositoryId,
    branchName: head.name,
    headCommit: head.commit,
    ontoCommitId,
    ontoSubject,
    root: ontoCommitId === null,
    commits: [...proposed].reverse(),
    workingChanges,
    mergeCommitCount,
    dependentBranches,
    publishedCommitCount: rows.filter((row) => !unpublished.has(row.commitId)).length,
    snapshot,
  } satisfies RepositoryInteractiveRebasePlan);
}

/** Runs a reviewed plan through Git's sequencer with an application-owned sequence editor. */
export async function runInteractiveRebase(
  runner: InteractiveRebaseRunner,
  input: InteractiveRebaseInput,
): Promise<OperationOutcome> {
  const currentPlan = await readInteractiveRebasePlan(runner, input, {
    id: input.repositoryId,
    ontoCommitId: input.request.ontoCommitId,
  });
  if (currentPlan.snapshot !== input.request.snapshot) throw new StaleInteractiveRebasePlanError();
  if (input.signal.aborted) throw new GitCancelledError();
  if (currentPlan.publishedCommitCount && !input.request.acknowledgePublished) {
    throw new InteractiveRebaseRequestError(
      'This plan contains published commits. Acknowledge the history rewrite after reviewing the warning.',
    );
  }
  const hasLocalChanges =
    currentPlan.workingChanges.paths.length + currentPlan.workingChanges.untrackedPaths.length > 0;
  if (hasLocalChanges && !input.request.autostash) {
    return {
      status: 'failed',
      failureReason: 'local-changes',
      message: 'Local changes would be overwritten. Choose Stash and reapply, or commit them first.',
      output: '',
    };
  }

  const rows = validateRows(currentPlan, input.request);
  if (currentPlan.mergeCommitCount) validateMergePlan(currentPlan, rows, input.request.autosquash);
  const orderedRows = input.request.autosquash ? applyAutosquash(rows, currentPlan.commits) : rows;
  validateActions(orderedRows);
  const title = `Interactive rebase '${currentPlan.branchName}'${
    currentPlan.root ? ' from root' : ` to ${currentPlan.ontoCommitId?.slice(0, 7) ?? 'the selected commit'}`
  }`;
  const artifactId = randomUUID();
  const backupRef = rebaseBackupRef(artifactId);
  const backupBranch = input.request.backupBranch
    ? `rebase-backup/${currentPlan.branchName}-${artifactId.slice(0, 8)}`
    : null;
  const backupOptions: GitRunOptions = {
    cwd: input.cwd,
    timeoutMs: planReadTimeoutMs,
    maxOutputBytes: 64 * 1024,
  };
  let artifacts: Awaited<ReturnType<typeof createInteractiveRebaseArtifacts>> | undefined;
  try {
    const messageContents = collectMessageContents(orderedRows);
    artifacts = await createInteractiveRebaseArtifacts(
      input.gitDir,
      {
        id: artifactId,
        commitId: currentPlan.headCommit,
        branchName: currentPlan.branchName,
        backupBranch,
        createdAt: new Date().toISOString(),
      },
      messageContents,
    );
    await runner.run(['update-ref', backupRef, currentPlan.headCommit, ''], backupOptions);
    if (backupBranch) await runner.run(['branch', '--', backupBranch, currentPlan.headCommit], backupOptions);
    const { todo, replacements } = buildTodo(
      orderedRows,
      artifacts.messageFiles,
      currentPlan,
      Boolean(input.request.updateRefs),
      artifacts.messageEditor,
    );
    await writeFile(
      join(artifacts.directory, 'plan.json'),
      JSON.stringify({
        version: 1,
        todo,
        ...(currentPlan.mergeCommitCount
          ? {
              replacements,
              updateRefs: input.request.updateRefs
                ? currentPlan.dependentBranches
                    .filter(
                      (branch) =>
                        !branch.checkedOut &&
                        rows.some((row) => row.commitId === branch.commitId && row.action !== 'drop'),
                    )
                    .map((branch) => branch.fullName)
                : [],
            }
          : {}),
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    const args = buildRebaseArgs(currentPlan, Boolean(input.request.updateRefs));
    input.handle.setCommand?.(['git', ...args.map((argument) => JSON.stringify(argument))].join(' '));
    const run = async (): Promise<OperationOutcome> => {
      try {
        const result = await runner.run(args, {
          cwd: input.cwd,
          timeoutMs: rebaseTimeoutMs,
          maxOutputBytes: rebaseOutputLimit,
          signal: input.signal,
          env: {
            GIT_SEQUENCE_EDITOR: artifacts!.sequenceEditor,
          },
        });
        return rebaseOutcome(input.gitDir, result.stdout, result.stderr);
      } catch (error) {
        return rebaseFailure(input.gitDir, error);
      }
    };

    let outcome: OperationOutcome;
    try {
      outcome = await withLocalChanges(
        runner,
        { id: input.repositoryId, cwd: input.cwd, gitDir: input.gitDir, head: branchHead(currentPlan) },
        input.request.autostash ? 'stash' : 'keep',
        input.request.changesSnapshot,
        title,
        async () => {
          const value = await run();
          if (input.request.autostash && value.status !== 'succeeded') {
            throw new InteractiveRebaseRecoveryError(
              `${value.message} The saved changes are available in Recovery.`,
              value.output,
              value.failureReason === 'cancelled' ||
                value.failureReason === 'timeout' ||
                value.failureReason === 'conflict'
                ? value.failureReason
                : 'other',
            );
          }
          return value;
        },
        input.signal,
      );
    } catch (error) {
      if (error instanceof InteractiveRebaseRecoveryError) {
        outcome = {
          status: 'failed',
          failureReason: error.failureReason,
          message: error.message,
          output: error.output,
        };
      } else throw error;
    }

    if (outcome.status === 'succeeded' && !(await detectPendingOperation(input.gitDir))) {
      try {
        await cleanupInteractiveRebaseArtifacts(runner, input.cwd, input.gitDir);
      } catch {
        return {
          ...outcome,
          message: `${outcome.message} Recovery files were retained because they could not be cleaned up.`,
        };
      }
    }
    return outcome;
  } catch (error) {
    if (artifacts === undefined) {
      await runner.run(['update-ref', '-d', backupRef], backupOptions).catch(() => undefined);
    } else if (!(await detectPendingOperation(input.gitDir))) {
      await cleanupInteractiveRebaseArtifacts(runner, input.cwd, input.gitDir).catch(() => undefined);
    }
    throw error;
  }
}

function branchHead(plan: RepositoryInteractiveRebasePlan): RepositoryHead {
  return { state: 'branch', name: plan.branchName, commit: plan.headCommit };
}

async function readBranchHead(runner: InteractiveRebaseRunner, cwd: string): Promise<BranchHead> {
  const name = await optionalOutput(runner, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const commit = await optionalOutput(runner, cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!name || !commit || !objectIdPattern.test(commit)) {
    throw new InteractiveRebaseRequestError('Check out a named branch with a commit before rebasing it.');
  }
  return { state: 'branch', name, commit };
}

async function readPlanCommits(
  runner: InteractiveRebaseRunner,
  cwd: string,
  head: string,
  onto: string | null,
): Promise<RawCommit[]> {
  if (onto) {
    if (!objectIdPattern.test(onto))
      throw new InteractiveRebaseRequestError('The rebase base is not a valid commit.');
    try {
      await runner.run(['merge-base', '--is-ancestor', onto, head], {
        cwd,
        timeoutMs: planReadTimeoutMs,
        maxOutputBytes: 64 * 1024,
      });
    } catch (error) {
      if (error instanceof GitCommandError)
        throw new InteractiveRebaseRequestError(
          'The selected commit is not an ancestor of the current branch.',
        );
      throw error;
    }
  }
  const range = onto ? `${onto}..${head}` : head;
  const result = await runner.run(
    ['rev-list', '--reverse', '--topo-order', '--parents', '--max-count=501', range],
    { cwd, timeoutMs: planReadTimeoutMs, maxOutputBytes: planReadOutputLimit },
  );
  const commits = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(/\s+/u);
      const commitId = fields[0] ?? '';
      if (!objectIdPattern.test(commitId) || fields.slice(1).some((parent) => !objectIdPattern.test(parent)))
        throw new Error('Git returned invalid interactive rebase commit metadata.');
      return { commitId, parents: fields.slice(1) } satisfies RawCommit;
    });
  if (commits.length === 0)
    throw new InteractiveRebaseRequestError('There are no commits after the selected base.');
  if (commits.length > maxPlanCommits)
    throw new InteractiveRebaseRequestError(
      `This interactive rebase contains more than ${maxPlanCommits} commits; narrow the selected range first.`,
    );
  return commits;
}

async function readCommitMetadata(
  runner: InteractiveRebaseRunner,
  cwd: string,
  commitIds: readonly string[],
): Promise<ReadonlyMap<string, PlanRow>> {
  const format = '%H%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x1e';
  const result = await runner.run(
    ['log', '--no-walk=unsorted', '--no-decorate', '--no-color', `--format=${format}`, ...commitIds],
    { cwd, timeoutMs: planReadTimeoutMs, maxOutputBytes: planReadOutputLimit },
  );
  const metadata = new Map<string, PlanRow>();
  for (const raw of result.stdout.split('\x1e')) {
    const fields = raw.replace(/^\n/u, '').split('\0');
    const [
      commitId,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      subject,
      body,
    ] = fields;
    if (!commitId) continue;
    if (
      !objectIdPattern.test(commitId) ||
      !authorDate ||
      !committerDate ||
      !isDate(authorDate) ||
      !isDate(committerDate)
    ) {
      throw new Error('Git returned invalid interactive rebase commit metadata.');
    }
    metadata.set(commitId, {
      commitId,
      parents: [],
      subject: subject ?? '',
      body: (body ?? '').replace(/\n+$/u, ''),
      author: { name: authorName ?? '', email: authorEmail ?? '', date: authorDate },
      committer: { name: committerName ?? '', email: committerEmail ?? '', date: committerDate },
      action: 'pick',
    });
  }
  return metadata;
}

function validateRows(
  plan: RepositoryInteractiveRebasePlan,
  request: RepositoryInteractiveRebaseRequest,
): MutablePlanRow[] {
  if (request.id !== plan.repositoryId || request.ontoCommitId !== plan.ontoCommitId)
    throw new InteractiveRebaseRequestError('The interactive rebase target changed. Review the plan again.');
  const original = new Map(plan.commits.map((row) => [row.commitId, row] as const));
  const seen = new Set<string>();
  for (const row of request.actions) {
    if (seen.has(row.commitId) || !original.has(row.commitId))
      throw new InteractiveRebaseRequestError('The rebase plan contains an unknown or duplicate commit.');
    seen.add(row.commitId);
  }
  if (seen.size !== original.size)
    throw new InteractiveRebaseRequestError(
      'The rebase plan must retain every reviewed commit as pick or drop.',
    );
  return [...request.actions].reverse().map((row) => ({
    ...row,
    author: original.get(row.commitId)!.author,
    committer: original.get(row.commitId)!.committer,
    parents: original.get(row.commitId)!.parents,
  }));
}

function applyAutosquash(rows: readonly MutablePlanRow[], originals: readonly PlanRow[]): MutablePlanRow[] {
  const next = rows.map((row) => ({ ...row }));
  const originalSubjects = new Map(originals.map((row) => [row.commitId, row.subject]));
  for (let index = 0; index < next.length; index += 1) {
    const row = next[index]!;
    if (row.action !== 'pick') continue;
    const match = /^(fixup|squash)!\s+(.+)$/u.exec(row.subject.trim());
    if (!match?.[1] || !match[2]) continue;
    let targetIndex = next.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex < index &&
        candidate.action !== 'drop' &&
        (candidate.commitId.startsWith(match[2]!) ||
          candidate.subject === match[2] ||
          originalSubjects.get(candidate.commitId) === match[2]),
    );
    if (targetIndex < 0)
      targetIndex = next.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex < index &&
          candidate.action !== 'drop' &&
          (candidate.subject.startsWith(match[2]!) ||
            originalSubjects.get(candidate.commitId)?.startsWith(match[2]!)),
      );
    if (targetIndex < 0) continue;
    const [moved] = next.splice(index, 1);
    if (!moved) continue;
    const adjustedTarget = targetIndex > index ? targetIndex - 1 : targetIndex;
    let insertion = adjustedTarget + 1;
    while (insertion < next.length && ['squash', 'fixup'].includes(next[insertion]!.action)) insertion += 1;
    moved.action = match[1] as 'fixup' | 'squash';
    next.splice(insertion, 0, moved);
    index = Math.max(-1, insertion - 1);
  }
  return next;
}

function validateActions(rows: readonly MutablePlanRow[]): void {
  const first = rows.find((row) => row.action !== 'drop');
  if (!first) throw new InteractiveRebaseRequestError('Keep at least one commit in the rebase plan.');
  if (first.action === 'squash' || first.action === 'fixup')
    throw new InteractiveRebaseRequestError('The first retained commit must be Pick, Reword, or Edit.');
}

function validateMergePlan(
  plan: RepositoryInteractiveRebasePlan,
  rows: readonly MutablePlanRow[],
  autosquash: boolean,
): void {
  if (
    autosquash ||
    rows.some(
      (row, index) =>
        row.commitId !== plan.commits[plan.commits.length - 1 - index]?.commitId ||
        ['squash', 'fixup'].includes(row.action),
    )
  )
    throw new InteractiveRebaseRequestError(
      'Merge plans preserve their topology: use Pick, Reword, Edit or Drop without reordering or combining commits.',
    );
  if (rows.some((row) => row.parents.length > 1 && !['pick', 'reword'].includes(row.action)))
    throw new InteractiveRebaseRequestError(
      'A merge node must be kept. Its message can be reworded; edit or drop individual commits on its branches.',
    );
}

function collectMessageContents(rows: readonly MutablePlanRow[]): string[] {
  return messageGroups(rows)
    .filter(needsMessage)
    .map((group) =>
      appendToAmendment(group)
        ? group
            .filter((row) => row.action === 'squash')
            .map(commitMessage)
            .map((value) => value.trimEnd())
            .join('\n\n')
        : combinedMessage(group),
    );
}

function appendToAmendment(group: readonly MutablePlanRow[]): boolean {
  return (
    group[0]?.action === 'edit' &&
    group[0].combinedMessage === undefined &&
    group.some((row) => row.action === 'squash')
  );
}

function needsMessage(group: readonly MutablePlanRow[]): boolean {
  return group[0]?.action === 'reword' || group.some((row) => row.action === 'squash');
}

function buildTodo(
  rows: readonly MutablePlanRow[],
  messageFiles: readonly string[],
  plan: RepositoryInteractiveRebasePlan,
  updateRefs: boolean,
  messageEditor: string,
): { readonly todo: string; readonly replacements: { commitId: string; lines: string[] }[] } {
  const paths = new Map<string, string>();
  const appendMessages = new Set<string>();
  const refTargets = new Map<string, string[]>();
  let pathIndex = 0;
  for (const group of messageGroups(rows)) {
    const last = group.at(-1)!;
    if (needsMessage(group)) paths.set(last.commitId, messageFiles[pathIndex++]!);
    if (appendToAmendment(group)) appendMessages.add(last.commitId);
    if (updateRefs) {
      const ids = new Set(group.map((row) => row.commitId));
      refTargets.set(
        last.commitId,
        plan.dependentBranches
          .filter((branch) => !branch.checkedOut && ids.has(branch.commitId))
          .map((branch) => branch.fullName),
      );
    }
  }
  const lines = ['# Git Workbench writes this reviewed plan.'];
  const replacements: { commitId: string; lines: string[] }[] = [];
  for (const row of rows) {
    const action = row.action === 'reword' ? 'pick' : row.action === 'squash' ? 'fixup' : row.action;
    const fragment = [
      row.parents.length > 1 ? '$MERGE' : `${action} ${row.commitId} ${singleLine(row.subject)}`,
    ];
    const messagePath = paths.get(row.commitId);
    if (messagePath)
      fragment.push(
        appendMessages.has(row.commitId)
          ? `exec ${messageEditor} ${todoShellQuote(messagePath)}`
          : `exec git commit --amend --allow-empty --allow-empty-message --cleanup=verbatim --no-verify --file ${todoShellQuote(messagePath)}`,
      );
    replacements.push({ commitId: row.commitId, lines: fragment });
    lines.push(...fragment);
    for (const ref of refTargets.get(row.commitId) ?? []) lines.push(`update-ref ${ref}`);
  }
  return { todo: `${lines.join('\n')}\n`, replacements };
}

function messageGroups(rows: readonly MutablePlanRow[]): MutablePlanRow[][] {
  const groups: MutablePlanRow[][] = [];
  for (const row of rows) {
    if (row.action === 'drop') continue;
    if (row.action === 'squash' || row.action === 'fixup') {
      const group = groups[groups.length - 1];
      if (!group)
        throw new InteractiveRebaseRequestError('A squash or fixup needs an earlier retained commit.');
      group.push(row);
    } else groups.push([row]);
  }
  return groups;
}

function commitMessage(row: Pick<PlanRow, 'subject' | 'body'>): string {
  const subject = row.subject.replace(/\r\n?/gu, '\n').split('\n')[0]?.trim() ?? '';
  const body = row.body.replace(/\r\n?/gu, '\n').replace(/^\n+/u, '').trimEnd();
  if (!subject) return body ? `${body}\n` : '';
  return body ? `${subject}\n\n${body}\n` : `${subject}\n`;
}

function combinedMessage(group: readonly MutablePlanRow[]): string {
  const first = group[0];
  if (!first) return '';
  if (first.combinedMessage !== undefined && group.some((row) => row.action === 'squash'))
    return `${first.combinedMessage.trimEnd()}\n`;
  const parts = [commitMessage(first).trimEnd()];
  for (const row of group.slice(1)) if (row.action === 'squash') parts.push(commitMessage(row).trimEnd());
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

function buildRebaseArgs(plan: RepositoryInteractiveRebasePlan, updateRefs: boolean): string[] {
  return [
    '-c',
    'rebase.abbreviateCommands=false',
    '-c',
    'rebase.instructionFormat=%s',
    'rebase',
    '--interactive',
    '--empty=keep',
    '--keep-empty',
    '--reapply-cherry-picks',
    '--no-autostash',
    '--no-autosquash',
    '--no-fork-point',
    '--reschedule-failed-exec',
    plan.mergeCommitCount ? '--rebase-merges=no-rebase-cousins' : '--no-rebase-merges',
    updateRefs ? '--update-refs' : '--no-update-refs',
    ...(plan.root ? ['--root'] : ['--onto', plan.ontoCommitId!, plan.ontoCommitId!]),
    plan.branchName,
  ];
}

async function rebaseOutcome(gitDir: string, stdout: string, stderr: string): Promise<OperationOutcome> {
  const output = displayOutput(stdout, stderr);
  const pending = (await detectPendingOperation(gitDir)) === 'rebase';
  if (pending)
    return {
      status: 'failed',
      failureReason: outputConflict(output) ? 'conflict' : 'other',
      message: outputConflict(output)
        ? 'Interactive rebase stopped with conflicts. Resolve and stage the files, then continue or abort from Recovery.'
        : 'Interactive rebase paused. Review the repository state and continue or abort from Recovery.',
      output,
    };
  return { status: 'succeeded', message: 'Interactive rebase completed.', output };
}

async function rebaseFailure(gitDir: string, error: unknown): Promise<OperationOutcome> {
  if (error instanceof GitCancelledError)
    return {
      status: 'failed',
      failureReason: 'cancelled',
      message:
        'Interactive rebase was cancelled. Refresh the repository and inspect Recovery before retrying.',
      output: '',
    };
  if (error instanceof GitTimeoutError)
    return {
      status: 'failed',
      failureReason: 'timeout',
      message: 'Git stopped responding during interactive rebase. Inspect Recovery before retrying.',
      output: '',
    };
  if (!(error instanceof GitCommandError)) throw error;
  const output = displayOutput(error.stdout, error.stderr);
  const pending = (await detectPendingOperation(gitDir)) === 'rebase';
  if (pending)
    return {
      status: 'failed',
      failureReason: outputConflict(output) ? 'conflict' : 'other',
      message: outputConflict(output)
        ? 'Interactive rebase stopped with conflicts. Resolve and stage the files, then continue or abort from Recovery.'
        : 'Interactive rebase paused. Review the repository state and continue or abort from Recovery.',
      output,
    };
  return {
    status: 'failed',
    failureReason: 'other',
    message: 'Git could not complete the interactive rebase. Its output is shown below.',
    output,
  };
}

function outputConflict(output: string): boolean {
  return /\bCONFLICT\b|could not apply|fix conflicts|resolve all conflicts/iu.test(output);
}

async function optionalOutput(
  runner: InteractiveRebaseRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const output = (
      await runner.run(args, { cwd, timeoutMs: planReadTimeoutMs, maxOutputBytes: planReadOutputLimit })
    ).stdout.trim();
    return output || null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

function isDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function todoShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
