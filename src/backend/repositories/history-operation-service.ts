import { createHash } from 'node:crypto';
import type {
  RepositoryHead,
  RepositoryHistoryOperationAction,
  RepositoryHistoryOperationChanges,
  RepositoryHistoryOperationKind,
  RepositoryHistoryOperationPreview,
  RepositoryHistoryOperationPreviewRequest,
} from '../../common/ipc/contracts';
import { repositoryHistoryOperationPreviewSchema } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitTimeoutError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import { displayOutput } from './network-service';
import { readReferenceContext } from './reference-service';
import { previewLocalChanges, saveDiscardRecovery, withLocalChanges } from './recovery-service';
import type { RepositoryReferenceContext } from '../../common/ipc/contracts';
import { previewIntegration } from './integration-preview';

const historyOperationTimeoutMs = 10 * 60 * 1000;
const historyOperationOutputLimit = 8 * 1024 * 1024;
const historyReadTimeoutMs = 15_000;
const historyReadOutputLimit = 8 * 1024 * 1024;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface HistoryOperationRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface HistoryOperationContext {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
  readonly worktreePath: string;
  readonly head: RepositoryHead;
}

export interface HistoryOperationInput extends HistoryOperationContext {
  readonly action: RepositoryHistoryOperationAction;
  readonly signal: AbortSignal;
  readonly handle: OperationHandle;
}

export class HistoryOperationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryOperationRequestError';
  }
}

export class StaleHistoryOperationError extends Error {
  constructor() {
    super('The repository changed after the history operation was reviewed. Refresh and try again.');
    this.name = 'StaleHistoryOperationError';
  }
}

interface TargetCommit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

interface ReviewedState {
  readonly context: RepositoryReferenceContext;
  readonly target: TargetCommit;
  readonly changes: Awaited<ReturnType<typeof previewLocalChanges>>;
  readonly snapshot: string;
}

/** Reads a safe target and a compare-and-swap token without changing repository state. */
export async function readHistoryOperationPreview(
  runner: HistoryOperationRunner,
  input: RepositoryHistoryOperationPreviewRequest,
  context: HistoryOperationContext,
): Promise<RepositoryHistoryOperationPreview> {
  const reference = await readReferenceContext(runner, context);
  const changes = await previewLocalChanges(runner, recoveryContext(context));
  const targetId = input.kind === 'reset' ? input.targetCommitId : input.commitId;
  const target = await readTargetCommit(runner, context.cwd, targetId);
  const mode = input.kind === 'reset' ? input.mode : null;
  const snapshot = operationSnapshot(reference, changes.snapshot, input.kind, target.id, mode);
  const message = previewMessage(input.kind, reference, changes, target, context.head);
  const obstacles = mode === 'hard' ? await hardResetObstacles(runner, context.cwd, target.id) : [];
  const integration =
    input.kind !== 'reset' && reference.head.commit && !reference.pendingOperation
      ? await previewIntegration(runner, context.cwd, {
          kind: input.kind,
          head: reference.head.commit,
          target: target.id,
          parent: target.parents[(input.mainlineParent ?? 1) - 1],
        })
      : undefined;

  return repositoryHistoryOperationPreviewSchema.parse({
    repositoryId: input.id,
    ...(integration ? { integration } : {}),
    kind: input.kind,
    currentHead: reference.head,
    currentBranch: reference.head.state === 'branch' ? reference.head.name : null,
    targetCommitId: target.id,
    targetSubject: target.subject,
    targetParents: [...target.parents],
    mode,
    workingChanges: changesDto(changes, reference.conflictedCount),
    snapshot,
    canStart: canStart(input.kind, reference, target, context.head) && obstacles.length === 0,
    message: obstacles.length
      ? `Hard reset would overwrite untracked or ignored files: ${obstacles.slice(0, 3).join(', ')}. Move or save them first.`.slice(
          0,
          512,
        )
      : message,
  } satisfies RepositoryHistoryOperationPreview);
}

/** Executes one reviewed cherry-pick, revert, or reset inside the repository mutation queue. */
export async function runHistoryOperation(
  runner: HistoryOperationRunner,
  input: HistoryOperationInput,
): Promise<OperationOutcome> {
  const action = input.action;
  const reviewed = await readReviewedState(runner, input);
  if (reviewed.snapshot !== action.snapshot) throw new StaleHistoryOperationError();
  ensureRunnable(action.kind, reviewed.context, reviewed.target, input.head);

  if (action.kind === 'reset') return runReset(runner, input, reviewed);

  if (action.mainlineParent !== undefined) {
    if (reviewed.target.parents.length < 2)
      throw new HistoryOperationRequestError('Mainline parent selection is only valid for a merge commit.');
    if (action.mainlineParent > reviewed.target.parents.length)
      throw new HistoryOperationRequestError('Choose an existing parent of the selected merge commit.');
  } else if (reviewed.target.parents.length > 1) {
    throw new HistoryOperationRequestError(
      'The selected commit is a merge. Choose which parent is the mainline before continuing.',
    );
  }

  const hasChanges = reviewed.changes.paths.length + reviewed.changes.untrackedPaths.length > 0;
  if (hasChanges && !action.autostash) {
    return {
      status: 'failed',
      failureReason: 'local-changes',
      message: 'Local changes would be overwritten. Choose Stash and reapply, or commit them first.',
      output: '',
    };
  }
  if (action.autostash && action.changesSnapshot !== reviewed.changes.snapshot)
    throw new StaleHistoryOperationError();

  const title = `${action.kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} '${reviewed.target.subject || reviewed.target.id.slice(0, 7)}'`;
  return withLocalChanges(
    runner,
    { id: input.repositoryId, cwd: input.cwd, gitDir: input.gitDir, head: input.head },
    action.autostash ? 'stash' : 'keep',
    action.changesSnapshot,
    title,
    async () => runCherryOrRevert(runner, input, action, reviewed.target),
    input.signal,
  );
}

async function readReviewedState(
  runner: HistoryOperationRunner,
  input: HistoryOperationInput,
): Promise<ReviewedState> {
  const reference = await readReferenceContext(runner, input);
  const changes = await previewLocalChanges(runner, recoveryContext(input));
  const targetId = input.action.kind === 'reset' ? input.action.targetCommitId : input.action.commitId;
  const target = await readTargetCommit(runner, input.cwd, targetId);
  const mode = input.action.kind === 'reset' ? input.action.mode : null;
  return {
    context: reference,
    target,
    changes,
    snapshot: operationSnapshot(reference, changes.snapshot, input.action.kind, target.id, mode),
  };
}

async function runCherryOrRevert(
  runner: HistoryOperationRunner,
  input: HistoryOperationInput,
  action: Extract<RepositoryHistoryOperationAction, { kind: 'cherry-pick' | 'revert' }>,
  target: TargetCommit,
): Promise<OperationOutcome> {
  if (action.kind === 'cherry-pick' && target.id === input.head.commit) {
    return {
      status: 'failed',
      failureReason: 'other',
      message: 'The current commit cannot be cherry-picked onto itself.',
      output: '',
    };
  }

  const args = [action.kind, action.commitChanges ? '--no-edit' : '--no-commit'];
  if (action.kind === 'cherry-pick' && action.appendOrigin) args.push('-x');
  if (action.mainlineParent !== undefined) args.push('-m', String(action.mainlineParent));
  // Revision-set form keeps Git's sequencer/opts for interrupted --no-commit operations.
  args.push(action.commitChanges ? target.id : `${target.id}^!`);
  input.handle.setCommand?.(displayCommand(args));

  try {
    const result = await runner.run(args, {
      cwd: input.cwd,
      timeoutMs: historyOperationTimeoutMs,
      maxOutputBytes: historyOperationOutputLimit,
      signal: input.signal,
      env: { GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
    });
    const operationName = action.kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert';
    return {
      status: 'succeeded',
      message: action.commitChanges
        ? `${operationName}ed '${target.subject || target.id.slice(0, 7)}'.`
        : `${operationName} changes are staged. Review them in Local Changes, then commit.`,
      output: displayOutput(result.stdout, result.stderr),
    };
  } catch (error) {
    return historyCommandFailure(action.kind, error);
  }
}

async function runReset(
  runner: HistoryOperationRunner,
  input: HistoryOperationInput,
  reviewed: ReviewedState,
): Promise<OperationOutcome> {
  const action = input.action;
  if (action.kind !== 'reset') throw new Error('Expected a reset action.');
  if (action.changesSnapshot !== undefined && action.changesSnapshot !== reviewed.changes.snapshot)
    throw new StaleHistoryOperationError();

  const trackedChanges = reviewed.changes.paths.length > 0;
  if (action.mode === 'hard' && (await hardResetObstacles(runner, input.cwd, reviewed.target.id)).length)
    throw new HistoryOperationRequestError(
      'Hard reset would overwrite untracked or ignored files. Move or save them before resetting.',
    );
  if (action.mode === 'hard' && trackedChanges && !action.confirmDiscard) {
    return {
      status: 'failed',
      failureReason: 'local-changes',
      message: 'Confirm Hard reset to save a Recovery copy and discard tracked local changes.',
      output: '',
    };
  }

  let recoverySaved = false;
  if (action.mode === 'hard' && trackedChanges) {
    await saveDiscardRecovery(
      runner,
      { id: input.repositoryId, cwd: input.cwd, gitDir: input.gitDir, head: input.head },
      `Before hard reset to ${reviewed.target.id.slice(0, 7)}`,
    );
    recoverySaved = true;
  }

  const args = ['reset', '--no-recurse-submodules', `--${action.mode}`, reviewed.target.id];
  input.handle.setCommand?.(displayCommand(args));
  try {
    const result = await runner.run(args, {
      cwd: input.cwd,
      timeoutMs: historyOperationTimeoutMs,
      maxOutputBytes: historyOperationOutputLimit,
      signal: input.signal,
    });
    return {
      status: 'succeeded',
      message: recoverySaved
        ? `Reset '${input.head.name ?? 'HEAD'}' (${action.mode}) to '${reviewed.target.subject || reviewed.target.id.slice(0, 7)}'. A Recovery copy preserves the discarded tracked changes.`
        : `Reset '${input.head.name ?? 'HEAD'}' (${action.mode}) to '${reviewed.target.subject || reviewed.target.id.slice(0, 7)}'.`,
      output: displayOutput(result.stdout, result.stderr),
    };
  } catch (error) {
    return resetFailure(error);
  }
}

async function hardResetObstacles(
  runner: HistoryOperationRunner,
  cwd: string,
  target: string,
): Promise<string[]> {
  const options = { cwd, timeoutMs: historyReadTimeoutMs, maxOutputBytes: historyReadOutputLimit };
  const [untracked, tree] = await Promise.all([
    runner.run(['ls-files', '--others', '-z', '--'], options),
    runner.run(['ls-tree', '-r', '--name-only', '-z', target], options),
  ]);
  const destinations = new Set(tree.stdout.split('\0').filter(Boolean));
  const directories = new Set<string>();
  for (const path of destinations) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
  }
  return untracked.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => {
      const normalized = path.replace(/\/$/u, '');
      if (destinations.has(normalized) || directories.has(normalized)) return true;
      const parts = normalized.split('/');
      return parts.some((_part, i) => destinations.has(parts.slice(0, i + 1).join('/')));
    });
}

async function readTargetCommit(
  runner: HistoryOperationRunner,
  cwd: string,
  commitId: string,
): Promise<TargetCommit> {
  try {
    const resolved = (
      await runner.run(['rev-parse', '--verify', '--quiet', `${commitId}^{commit}`], {
        cwd,
        timeoutMs: historyReadTimeoutMs,
        maxOutputBytes: 256,
      })
    ).stdout.trim();
    if (!objectIdPattern.test(resolved)) throw new Error('Git returned an invalid commit ID.');
    const raw = (
      await runner.run(['show', '-s', '--no-decorate', '--no-color', '--format=%H%x00%P%x00%s', resolved], {
        cwd,
        timeoutMs: historyReadTimeoutMs,
        maxOutputBytes: historyReadOutputLimit,
      })
    ).stdout.replace(/\r?\n$/u, '');
    const [id, parents, subject] = raw.split('\0');
    if (!id || !objectIdPattern.test(id)) throw new Error('Git returned incomplete commit metadata.');
    const parentIds = (parents ?? '').split(' ').filter(Boolean);
    if (parentIds.some((parent) => !objectIdPattern.test(parent)))
      throw new Error('Git returned invalid commit parents.');
    return { id, parents: parentIds, subject: subject ?? '' };
  } catch (error) {
    if (error instanceof GitCommandError)
      throw new HistoryOperationRequestError('That commit is no longer available in this repository.');
    throw error;
  }
}

function changesDto(
  changes: Awaited<ReturnType<typeof previewLocalChanges>>,
  conflictedCount: number,
): RepositoryHistoryOperationChanges {
  return {
    snapshot: changes.snapshot,
    paths: changes.paths,
    untrackedPaths: changes.untrackedPaths,
    pendingOperation: changes.pendingOperation,
    conflictedCount,
  };
}

function recoveryContext(context: HistoryOperationContext) {
  return {
    id: context.repositoryId,
    cwd: context.cwd,
    gitDir: context.gitDir,
    head: context.head,
  };
}

function operationSnapshot(
  reference: RepositoryReferenceContext,
  changesSnapshot: string,
  kind: RepositoryHistoryOperationKind,
  targetCommitId: string,
  mode: 'soft' | 'mixed' | 'hard' | null,
): string {
  return createHash('sha256')
    .update(JSON.stringify([reference.snapshot, changesSnapshot, kind, targetCommitId, mode]))
    .digest('hex');
}

function canStart(
  kind: RepositoryHistoryOperationKind,
  reference: RepositoryReferenceContext,
  target: TargetCommit,
  head: RepositoryHead,
): boolean {
  if (reference.pendingOperation || reference.conflictedCount > 0) return false;
  if (head.state !== 'branch' || !head.name || !head.commit) return false;
  if (kind === 'cherry-pick' && target.id === head.commit) return false;
  return true;
}

function previewMessage(
  kind: RepositoryHistoryOperationKind,
  reference: RepositoryReferenceContext,
  changes: Awaited<ReturnType<typeof previewLocalChanges>>,
  target: TargetCommit,
  head: RepositoryHead,
): string {
  if (reference.pendingOperation)
    return `Finish or abort the ${reference.pendingOperation} in progress before starting this operation.`;
  if (reference.conflictedCount > 0) return 'Resolve and stage the existing conflicted files first.';
  if (head.state !== 'branch' || !head.name || !head.commit)
    return 'Check out a branch with a commit before changing its history.';
  if (kind === 'cherry-pick' && target.id === head.commit)
    return 'The current commit cannot be cherry-picked onto itself.';
  return changes.paths.length + changes.untrackedPaths.length > 0
    ? 'Local changes are present. Choose Stash and reapply, or review the reset mode carefully.'
    : 'Ready to review and start.';
}

function ensureRunnable(
  kind: RepositoryHistoryOperationKind,
  reference: RepositoryReferenceContext,
  target: TargetCommit,
  head: RepositoryHead,
): void {
  if (reference.pendingOperation)
    throw new HistoryOperationRequestError(
      `Finish or abort the ${reference.pendingOperation} in progress before starting this operation.`,
    );
  if (reference.conflictedCount > 0)
    throw new HistoryOperationRequestError('Resolve and stage the existing conflicted files first.');
  if (head.state !== 'branch' || !head.name || !head.commit)
    throw new HistoryOperationRequestError('Check out a branch with a commit before changing its history.');
  if (kind === 'cherry-pick' && target.id === head.commit)
    throw new HistoryOperationRequestError('The current commit cannot be cherry-picked onto itself.');
}

function historyCommandFailure(kind: 'cherry-pick' | 'revert', error: unknown): OperationOutcome {
  if (error instanceof GitCancelledError)
    return {
      status: 'failed',
      failureReason: 'cancelled',
      message: `The ${kind} was cancelled. Refresh the repository to see what Git changed.`,
      output: '',
    };
  if (error instanceof GitTimeoutError)
    return {
      status: 'failed',
      failureReason: 'timeout',
      message: `Git stopped responding during ${kind}. Refresh the repository to see what it changed.`,
      output: '',
    };
  if (!(error instanceof GitCommandError)) throw error;
  const output = displayOutput(error.stdout, error.stderr);
  if (/\bCONFLICT\b|fix conflicts|resolve all conflicts|could not (?:apply|revert)/iu.test(output))
    return {
      status: 'failed',
      failureReason: 'conflict',
      message: `${kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} stopped with conflicts. Resolve and stage the files, then continue or abort from Recovery.`,
      output,
    };
  if (/local changes|would be overwritten|please commit your changes/iu.test(output))
    return {
      status: 'failed',
      failureReason: 'local-changes',
      message: 'Local changes would be overwritten. Commit, stage, or stash them first.',
      output,
    };
  return {
    status: 'failed',
    failureReason: 'other',
    message: `Git could not complete the ${kind}. Its output is shown below.`,
    output,
  };
}

function resetFailure(error: unknown): OperationOutcome {
  if (error instanceof GitCancelledError)
    return {
      status: 'failed',
      failureReason: 'cancelled',
      message: 'The reset was cancelled. Refresh the repository to see what Git changed.',
      output: '',
    };
  if (error instanceof GitTimeoutError)
    return {
      status: 'failed',
      failureReason: 'timeout',
      message: 'Git stopped responding during reset. Refresh the repository to see what it changed.',
      output: '',
    };
  if (!(error instanceof GitCommandError)) throw error;
  const output = displayOutput(error.stdout, error.stderr);
  return {
    status: 'failed',
    failureReason: /local changes|would be overwritten|unmerged/iu.test(output) ? 'local-changes' : 'other',
    message: 'Git could not complete the reset. Its output is shown below.',
    output,
  };
}

function displayCommand(args: readonly string[]): string {
  return ['git', ...args.map((argument) => JSON.stringify(argument))].join(' ');
}
