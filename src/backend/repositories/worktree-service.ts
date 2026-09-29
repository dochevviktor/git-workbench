import { createHash } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  RepositoryWorktree,
  RepositoryWorktreeAction,
  RepositoryWorktreeActionResult,
  RepositoryWorktreeContext,
  RepositoryWorktreeFailureReason,
  RepositoryWorkingTree,
} from '../../common/ipc/contracts';
import {
  repositoryWorktreeActionResultSchema,
  repositoryWorktreeContextSchema,
} from '../../common/ipc/contracts';
import { GitCommandError, GitTimeoutError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { displayOutput } from './network-service';
import { parseWorkingTreeStatus } from './working-tree-service';
import { hasUnrelatedRepository, topologyPathFingerprint } from './topology-paths';

const readTimeoutMs = 15_000;
const readOutputLimit = 8 * 1024 * 1024;
const writeTimeoutMs = 120_000;
const writeOutputLimit = 1024 * 1024;
const worktreeLimit = 1_000;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface WorktreeRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface WorktreeContextInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly commonDir: string;
  readonly currentWorktreePath: string | null;
}

export interface WorktreeActionInput extends WorktreeContextInput {
  readonly action: RepositoryWorktreeAction;
  readonly snapshot: string;
  readonly signal?: AbortSignal | undefined;
  readonly onCommand?: ((args: readonly string[]) => void) | undefined;
}

export class StaleWorktreeSnapshotError extends Error {
  constructor() {
    super('The worktree layout changed after it was read. Refresh and try again.');
    this.name = 'StaleWorktreeSnapshotError';
  }
}

interface RawWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branchFullName: string | null;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly prunable: boolean;
  readonly pruneReason: string | null;
}

/** Reads Git's worktree registrations and a bounded status summary for each path. */
export async function readWorktreeContext(
  runner: WorktreeRunner,
  input: WorktreeContextInput,
): Promise<RepositoryWorktreeContext> {
  const raw = await readRawWorktrees(runner, input.cwd);
  const currentPath = input.currentWorktreePath ? await canonicalOrOriginal(input.currentWorktreePath) : null;
  const worktrees: RepositoryWorktree[] = [];
  const fingerprints: string[] = [];
  for (const [index, item] of raw.slice(0, worktreeLimit).entries()) {
    const canonicalPath = await canonicalOrOriginal(item.path);
    const exists = await directoryExists(item.path);
    const isCurrent = currentPath !== null && canonicalPath === currentPath;
    const workingTree = item.bare
      ? unavailableWorkingTree()
      : await inspectWorkingTree(runner, item.path, exists, (value) => fingerprints.push(value));
    worktrees.push({
      id: worktreeId(input.commonDir, item.path),
      path: item.path,
      branchName: item.branchFullName?.slice('refs/heads/'.length) ?? null,
      branchFullName: item.branchFullName,
      head: item.head,
      isCurrent,
      isMain: index === 0,
      exists,
      locked: item.locked,
      lockReason: item.lockReason,
      prunable: item.prunable,
      pruneReason: item.pruneReason,
      workingTree,
    });
  }

  return repositoryWorktreeContextSchema.parse({
    repositoryId: input.repositoryId,
    worktrees,
    snapshot: createHash('sha256')
      .update(worktreeSnapshot(worktrees))
      .update(JSON.stringify(fingerprints))
      .digest('hex'),
  } satisfies RepositoryWorktreeContext);
}

/** Applies one explicitly named lifecycle action after re-reading the registration layout. */
export async function applyWorktreeAction(
  runner: WorktreeRunner,
  input: WorktreeActionInput,
): Promise<RepositoryWorktreeActionResult> {
  const context = await readWorktreeContext(runner, input);
  if (context.snapshot !== input.snapshot) throw new StaleWorktreeSnapshotError();

  const refusal = await refuseAction(input.action);
  if (refusal)
    return blocked(
      input.repositoryId,
      input.action.kind,
      refusal.reason,
      refusal.message,
      refusal.worktreeId,
    );

  const plan = await planAction(runner, input.cwd, input.commonDir, context, input.action);
  if ('reason' in plan)
    return blocked(input.repositoryId, input.action.kind, plan.reason, plan.message, plan.worktreeId);

  input.onCommand?.(plan.args);
  try {
    const result = await runner.run(plan.args, {
      cwd: input.cwd,
      timeoutMs: writeTimeoutMs,
      maxOutputBytes: writeOutputLimit,
      signal: input.signal,
    });
    return repositoryWorktreeActionResultSchema.parse({
      status: 'applied',
      repositoryId: input.repositoryId,
      kind: input.action.kind,
      message: plan.message,
      output: displayOutput(result.stdout, result.stderr),
      worktreeId: plan.worktreeId,
      path: plan.path,
    } satisfies RepositoryWorktreeActionResult);
  } catch (error) {
    if (error instanceof GitTimeoutError) {
      return blocked(
        input.repositoryId,
        input.action.kind,
        'other',
        'Git was stopped before it reported the result. Refresh the worktree list before retrying.',
        plan.worktreeId,
      );
    }
    if (!(error instanceof GitCommandError)) throw error;
    const output = displayOutput(error.stdout, error.stderr);
    const failure = classifyFailure(input.action, output);
    return repositoryWorktreeActionResultSchema.parse({
      status: 'blocked',
      repositoryId: input.repositoryId,
      kind: input.action.kind,
      reason: failure.reason,
      message: failure.message,
      output,
      worktreeId: plan.worktreeId,
      paths: blockedPaths(output),
    } satisfies RepositoryWorktreeActionResult);
  }
}

interface ActionPlan {
  readonly args: readonly string[];
  readonly message: string;
  readonly worktreeId: string | null;
  readonly path: string | null;
}

interface ActionRefusal {
  readonly reason: RepositoryWorktreeFailureReason;
  readonly message: string;
  readonly worktreeId: string | null;
}

async function planAction(
  runner: WorktreeRunner,
  cwd: string,
  commonDir: string,
  context: RepositoryWorktreeContext,
  action: RepositoryWorktreeAction,
): Promise<ActionPlan | ActionRefusal> {
  switch (action.kind) {
    case 'create':
    case 'create-detached': {
      const destination = resolve(action.path);
      const parent = dirname(destination);
      if (!isAbsolute(action.path) || action.path.includes('\0') || !isAbsolute(destination)) {
        return {
          reason: 'invalid-path',
          message: 'Choose an absolute worktree destination.',
          worktreeId: null,
        };
      }
      if (!(await directoryExists(parent))) {
        return {
          reason: 'invalid-path',
          message: 'The worktree destination parent folder does not exist.',
          worktreeId: null,
        };
      }
      if (await pathExists(destination)) {
        return {
          reason: 'exists',
          message: 'The worktree destination already exists. Choose an empty path.',
          worktreeId: null,
        };
      }

      const canonicalDestination = resolve(await realpath(parent), destination.slice(parent.length + 1));
      if (
        context.worktrees.some((tree) => contains(tree.path, canonicalDestination)) ||
        contains(commonDir, canonicalDestination)
      )
        return {
          reason: 'invalid-path',
          message: 'Choose a location outside the existing worktrees and Git metadata.',
          worktreeId: null,
        };
      if (action.kind === 'create-detached') {
        try {
          await runner.run(['cat-file', '-e', `${action.commitId}^{commit}`], readOptions(cwd));
        } catch (error) {
          if (!(error instanceof GitCommandError)) throw error;
          return {
            reason: 'not-found',
            message: 'The selected commit is no longer available.',
            worktreeId: null,
          };
        }
        return {
          args: ['worktree', 'add', '--quiet', '--detach', destination, action.commitId],
          message: 'Created a worktree at a detached HEAD.',
          worktreeId: worktreeId(commonDir, destination),
          path: destination,
        };
      }
      const references = await readBranchReferences(runner, cwd);
      if (!references.has(action.sourceFullName)) {
        return { reason: 'not-found', message: 'That branch is no longer available.', worktreeId: null };
      }
      const existingAssignment = context.worktrees.find(
        (worktree) => worktree.branchFullName === action.sourceFullName,
      );
      if (existingAssignment) {
        return {
          reason: 'checked-out',
          message: `That branch is already checked out in the worktree at ${existingAssignment.path}.`,
          worktreeId: existingAssignment.id,
        };
      }

      const remote = action.sourceFullName.startsWith('refs/remotes/');
      if (!remote && action.branchName !== undefined) {
        return {
          reason: 'other',
          message: 'A new local branch name is only used for a remote-tracking source.',
          worktreeId: null,
        };
      }
      let args: string[];
      let message: string;
      if (remote) {
        const branchName = action.branchName;
        if (!branchName) {
          return {
            reason: 'invalid-path',
            message: 'Choose a local branch name for the remote worktree.',
            worktreeId: null,
          };
        }
        if (!(await validBranchName(runner, cwd, branchName))) {
          return {
            reason: 'invalid-path',
            message: `Git does not accept '${branchName}' as a branch name.`,
            worktreeId: null,
          };
        }
        if (references.has(`refs/heads/${branchName}`)) {
          return {
            reason: 'exists',
            message: `A local branch named '${branchName}' already exists.`,
            worktreeId: null,
          };
        }
        args = [
          'worktree',
          'add',
          '--quiet',
          '-b',
          branchName,
          '--track',
          destination,
          action.sourceFullName,
        ];
        message = `Created worktree '${branchName}'.`;
      } else {
        args = ['worktree', 'add', '--quiet', destination, action.sourceFullName.slice('refs/heads/'.length)];
        message = `Created worktree '${action.sourceFullName.slice('refs/heads/'.length)}'.`;
      }
      return {
        args,
        message,
        worktreeId: worktreeId(commonDir, destination),
        path: destination,
      };
    }
    case 'lock':
    case 'unlock': {
      const worktree = context.worktrees.find((item) => item.id === action.worktreeId);
      if (!worktree)
        return {
          reason: 'not-found',
          message: 'That worktree is no longer registered.',
          worktreeId: action.worktreeId,
        };
      if (worktree.isMain)
        return { reason: 'main', message: 'The main worktree cannot be locked.', worktreeId: worktree.id };
      if (worktree.locked === (action.kind === 'lock'))
        return {
          reason: 'stale',
          message: `The worktree is already ${worktree.locked ? 'locked' : 'unlocked'}. Refresh its state.`,
          worktreeId: worktree.id,
        };
      return {
        args: [
          'worktree',
          action.kind,
          ...(action.kind === 'lock' && action.reason ? ['--reason', action.reason] : []),
          worktree.path,
        ],
        message: `${action.kind === 'lock' ? 'Locked' : 'Unlocked'} worktree.`,
        worktreeId: worktree.id,
        path: worktree.path,
      };
    }
    case 'remove': {
      const worktree = context.worktrees.find((candidate) => candidate.id === action.worktreeId);
      if (!worktree)
        return {
          reason: 'not-found',
          message: 'That worktree is no longer registered.',
          worktreeId: action.worktreeId,
        };
      if (worktree.isCurrent)
        return {
          reason: 'current',
          message: 'The current worktree cannot be removed.',
          worktreeId: worktree.id,
        };
      if (worktree.isMain)
        return { reason: 'main', message: 'The main worktree cannot be removed.', worktreeId: worktree.id };
      if (worktree.locked && !action.force) {
        return {
          reason: 'locked',
          message: worktree.lockReason
            ? `The worktree is locked: ${worktree.lockReason}`
            : 'The worktree is locked.',
          worktreeId: worktree.id,
        };
      }
      if (worktree.workingTree.state === 'dirty' && !action.force) {
        return {
          reason: 'dirty',
          message:
            'The worktree has uncommitted changes. Choose force removal only if they can be discarded.',
          worktreeId: worktree.id,
        };
      }
      if (!worktree.exists) {
        return {
          reason: 'not-found',
          message: 'The worktree directory is missing. Prune its stale registration instead.',
          worktreeId: worktree.id,
        };
      }
      if (
        !(await lstat(worktree.path)).isDirectory() ||
        context.worktrees.some((other) => other.id !== worktree.id && contains(worktree.path, other.path)) ||
        (await hasUnrelatedRepository(worktree.path))
      )
        return {
          reason: 'invalid-path',
          message:
            'This path contains another repository or no longer identifies a worktree directory. Remove nested repositories separately.',
          worktreeId: worktree.id,
        };
      const actualCommon = (
        await runner.run(
          ['rev-parse', '--path-format=absolute', '--git-common-dir'],
          readOptions(worktree.path),
        )
      ).stdout.trimEnd();
      if ((await canonicalOrOriginal(actualCommon)) !== (await canonicalOrOriginal(commonDir)))
        return {
          reason: 'invalid-path',
          message: 'The worktree path now belongs to a different repository.',
          worktreeId: worktree.id,
        };
      if (worktree.workingTree.state === 'unknown' || worktree.workingTree.state === 'unavailable')
        return {
          reason: 'other',
          message: 'The worktree could not be inspected. Refresh before removing it.',
          worktreeId: worktree.id,
        };
      const forceCount = action.force && worktree.locked ? 2 : action.force ? 1 : 0;
      return {
        args: ['worktree', 'remove', ...Array.from({ length: forceCount }, () => '--force'), worktree.path],
        message: `Removed worktree '${worktree.path}'.`,
        worktreeId: worktree.id,
        path: worktree.path,
      };
    }
    case 'prune':
      return {
        args: ['worktree', 'prune', '--verbose', '--expire', 'now'],
        message: 'Pruned stale worktree registrations.',
        worktreeId: null,
        path: null,
      };
  }
}

async function refuseAction(action: RepositoryWorktreeAction): Promise<ActionRefusal | undefined> {
  if (action.kind !== 'create' && action.kind !== 'create-detached') return undefined;
  if (!isAbsolute(action.path) || action.path.startsWith('-')) {
    return { reason: 'invalid-path', message: 'Choose an absolute worktree destination.', worktreeId: null };
  }
  return undefined;
}

function blocked(
  repositoryId: string,
  kind: RepositoryWorktreeAction['kind'],
  reason: ActionRefusal['reason'],
  message: string,
  worktreeId: string | null,
): RepositoryWorktreeActionResult {
  return repositoryWorktreeActionResultSchema.parse({
    status: 'blocked',
    repositoryId,
    kind,
    reason,
    message: message.slice(0, 512),
    output: '',
    worktreeId,
    paths: [],
  } satisfies RepositoryWorktreeActionResult);
}

async function readRawWorktrees(runner: WorktreeRunner, cwd: string): Promise<RawWorktree[]> {
  const result = await runner.run(['worktree', 'list', '--porcelain', '-z'], readOptions(cwd));
  const records: RawWorktree[] = [];
  let current:
    | {
        path?: string;
        head: string | null;
        branchFullName: string | null;
        bare: boolean;
        locked: boolean;
        lockReason: string | null;
        prunable: boolean;
        pruneReason: string | null;
      }
    | undefined;
  const finish = () => {
    if (!current?.path) return;
    records.push({
      path: current.path,
      head: current.head && objectIdPattern.test(current.head) ? current.head : null,
      branchFullName: current.branchFullName,
      bare: current.bare,
      locked: current.locked,
      lockReason: current.lockReason,
      prunable: current.prunable,
      pruneReason: current.pruneReason,
    });
    current = undefined;
  };
  for (const field of result.stdout.split('\0')) {
    if (!field) {
      finish();
      continue;
    }
    const separator = field.indexOf(' ');
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? '' : field.slice(separator + 1);
    if (key === 'worktree') {
      finish();
      current = {
        path: value,
        head: null,
        branchFullName: null,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        pruneReason: null,
      };
    } else if (current) {
      if (key === 'HEAD') current.head = value;
      else if (key === 'branch') current.branchFullName = value.startsWith('refs/heads/') ? value : null;
      else if (key === 'bare') current.bare = true;
      else if (key === 'locked') {
        current.locked = true;
        current.lockReason = value.slice(0, 512) || null;
      } else if (key === 'prunable') {
        current.prunable = true;
        current.pruneReason = value.slice(0, 512) || null;
      }
    }
  }
  finish();
  return records;
}

async function readBranchReferences(runner: WorktreeRunner, cwd: string): Promise<ReadonlySet<string>> {
  const result = await runner.run(
    ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'],
    readOptions(cwd),
  );
  const refs = new Set<string>();
  for (const line of result.stdout.split('\n')) {
    const [name, symbolicTarget] = line.split('\0');
    if (name && !symbolicTarget?.trim()) refs.add(name);
  }
  return refs;
}

async function validBranchName(runner: WorktreeRunner, cwd: string, name: string): Promise<boolean> {
  try {
    await runner.run(['check-ref-format', `refs/heads/${name}`], {
      cwd,
      timeoutMs: readTimeoutMs,
      maxOutputBytes: 4_096,
    });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

async function inspectWorkingTree(
  runner: WorktreeRunner,
  cwd: string,
  exists: boolean,
  fingerprint: (value: string) => void,
): Promise<RepositoryWorkingTree> {
  if (!exists) return { state: 'unavailable', changedFileCount: null };
  try {
    const result = await runner.run(
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '--no-optional-locks',
        'status',
        '--porcelain=v2',
        '--untracked-files=all',
        '--ignored=matching',
        '-z',
        '--',
      ],
      readOptions(cwd),
    );
    const records = parseWorkingTreeStatus(result.stdout);
    const changedFileCount = records.length;
    fingerprint(
      createHash('sha256')
        .update(result.stdout)
        .update(
          await topologyPathFingerprint(
            cwd,
            records.map((record) => record.path),
          ),
        )
        .digest('hex'),
    );
    return { state: changedFileCount === 0 ? 'clean' : 'dirty', changedFileCount };
  } catch {
    return { state: 'unknown', changedFileCount: null };
  }
}

function unavailableWorkingTree(): RepositoryWorkingTree {
  return { state: 'unavailable', changedFileCount: null };
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function canonicalOrOriginal(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function worktreeId(commonDir: string, path: string): string {
  return `worktree-${createHash('sha256').update(`${commonDir}\0${path}`, 'utf8').digest('hex')}`;
}

function worktreeSnapshot(worktrees: readonly RepositoryWorktree[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        worktrees.map((worktree) => ({
          id: worktree.id,
          path: worktree.path,
          branchFullName: worktree.branchFullName,
          head: worktree.head,
          isCurrent: worktree.isCurrent,
          isMain: worktree.isMain,
          exists: worktree.exists,
          locked: worktree.locked,
          lockReason: worktree.lockReason,
          prunable: worktree.prunable,
          pruneReason: worktree.pruneReason,
          workingTree: worktree.workingTree,
        })),
      ),
      'utf8',
    )
    .digest('hex');
}

function readOptions(cwd: string): GitRunOptions {
  return { cwd, timeoutMs: readTimeoutMs, maxOutputBytes: readOutputLimit };
}

function classifyFailure(
  action: RepositoryWorktreeAction,
  output: string,
): { readonly reason: ActionRefusal['reason']; readonly message: string } {
  if (/already exists|destination path .* already exists|already checked out/iu.test(output)) {
    return {
      reason: 'exists',
      message: 'Git refused the worktree because the destination or branch already exists.',
    };
  }
  if (/already used by worktree|is already checked out|used by worktree at/iu.test(output)) {
    return { reason: 'checked-out', message: 'That branch is already checked out in another worktree.' };
  }
  if (/is locked|locked/iu.test(output) && action.kind === 'remove') {
    return { reason: 'locked', message: 'Git refused to remove the locked worktree.' };
  }
  if (/contains modified or untracked files|working tree .* dirty|local changes/iu.test(output)) {
    return { reason: 'dirty', message: 'Git refused to remove the dirty worktree.' };
  }
  if (/not a valid path|no such file or directory|invalid path/iu.test(output)) {
    return { reason: 'invalid-path', message: 'Git rejected the worktree path.' };
  }
  if (/not a valid object name|does not exist|no such branch/iu.test(output)) {
    return { reason: 'not-found', message: 'The selected branch is no longer available.' };
  }
  return { reason: 'other', message: `Git could not ${actionDescription(action)}.` };
}

function actionDescription(action: RepositoryWorktreeAction): string {
  switch (action.kind) {
    case 'create':
    case 'create-detached':
      return 'create the worktree';
    case 'lock':
    case 'unlock':
      return `${action.kind} the worktree`;
    case 'remove':
      return 'remove the worktree';
    case 'prune':
      return 'prune stale worktrees';
  }
}

function blockedPaths(output: string): string[] {
  return output
    .split('\n')
    .map((line) => /^\s+(.+)$/u.exec(line)?.[1])
    .filter((path): path is string => path !== undefined)
    .slice(0, 200);
}
