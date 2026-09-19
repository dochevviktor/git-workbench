import type {
  RepositoryHead,
  RepositoryMergeRebaseAction,
  RepositoryOperationFailureReason,
  RepositoryReferenceContext,
} from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitTimeoutError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import { displayOutput } from './network-service';
import { readReferenceContext, StaleReferenceSnapshotError } from './reference-service';
import { withLocalChanges } from './recovery-service';
import { readWorkingChanges } from './working-tree-service';

const mergeRebaseTimeoutMs = 10 * 60 * 1000;
const mergeRebaseOutputLimit = 8 * 1024 * 1024;
const readTimeoutMs = 15_000;
const readOutputLimit = 8 * 1024 * 1024;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface MergeRebaseRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface MergeRebaseInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
  readonly worktreePath: string;
  readonly head: RepositoryHead;
  readonly action: RepositoryMergeRebaseAction;
  readonly signal: AbortSignal;
  readonly handle: OperationHandle;
}

export class MergeRebaseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeRebaseRequestError';
  }
}

export class MergeRebaseConflictError extends Error {
  readonly output: string;
  readonly failureReason: RepositoryOperationFailureReason;

  constructor(message: string, output: string, failureReason: RepositoryOperationFailureReason) {
    super(message);
    this.name = 'MergeRebaseConflictError';
    this.output = output;
    this.failureReason = failureReason;
  }
}

interface MergeRebasePlan {
  readonly args: readonly string[];
  readonly sourceLabel: string;
  readonly currentLabel: string;
  readonly title: string;
  readonly command: string;
}

/**
 * Revalidates the selected source and current branch, then runs one ordinary merge or rebase. A
 * conflict is deliberately returned as a failed operation while Git's sequencer remains visible to
 * Recovery; it is never treated as a completed mutation.
 */
export async function runMergeRebase(
  runner: MergeRebaseRunner,
  input: MergeRebaseInput,
): Promise<OperationOutcome> {
  const context = await readReferenceContext(runner, {
    repositoryId: input.repositoryId,
    cwd: input.cwd,
    gitDir: input.gitDir,
    worktreePath: input.worktreePath,
    head: input.head,
  });
  if (context.snapshot !== input.action.snapshot) throw new StaleReferenceSnapshotError();
  if (context.pendingOperation) {
    throw new MergeRebaseRequestError(
      `Finish or abort the ${context.pendingOperation} before starting another operation.`,
    );
  }
  if (context.head.state !== 'branch' || !context.head.name || !context.head.commit) {
    throw new MergeRebaseRequestError('Check out a branch with a commit before merging or rebasing.');
  }

  const sourceCommit = await resolveSourceCommit(runner, input.cwd, context, input.action.sourceFullName);
  const sourceLabel = displayReference(input.action.sourceFullName);
  const currentLabel = context.head.name;
  if (input.action.sourceFullName === `refs/heads/${context.head.name}`) {
    throw new MergeRebaseRequestError(`'${sourceLabel}' is already the current branch.`);
  }
  if (input.action.kind === 'rebase' && sourceCommit === context.head.commit) {
    throw new MergeRebaseRequestError(`'${sourceLabel}' already contains '${currentLabel}'.`);
  }

  const plan = createPlan(input.action, sourceCommit, sourceLabel, currentLabel);
  const changes = await readWorkingChanges(runner, {
    repositoryId: input.repositoryId,
    cwd: input.cwd,
    includeUntracked: true,
    includeIgnored: false,
  });
  const hasChanges = changes.counts.staged + changes.counts.unstaged + changes.counts.untracked > 0;
  if (changes.counts.conflicted > 0) {
    return {
      status: 'failed',
      failureReason: 'conflict',
      message: 'Resolve the existing conflicted files before merging or rebasing.',
      output: '',
    };
  }
  if (hasChanges && !input.action.autostash) {
    return {
      status: 'failed',
      failureReason: 'local-changes',
      message: 'Local changes would be overwritten. Choose Stash and reapply, or commit them first.',
      output: '',
    };
  }

  const run = async (): Promise<OperationOutcome> => {
    input.handle.setCommand?.(plan.command);
    try {
      const result = await runner.run(plan.args, {
        cwd: input.cwd,
        timeoutMs: mergeRebaseTimeoutMs,
        maxOutputBytes: mergeRebaseOutputLimit,
        signal: input.signal,
        // Merge uses --no-edit and rebase must not open an arbitrary editor while the job is owned by
        // the application. The runner also applies this policy to all Git work.
        env: { GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
      });
      return {
        status: 'succeeded',
        message:
          input.action.kind === 'merge'
            ? `Merged '${sourceLabel}' into '${currentLabel}'.`
            : `Rebased '${currentLabel}' on '${sourceLabel}'.`,
        output: displayOutput(result.stdout, result.stderr),
      };
    } catch (error) {
      return commandFailure(input.action.kind, error);
    }
  };

  try {
    return await withLocalChanges(
      runner,
      { id: input.repositoryId, cwd: input.cwd, gitDir: input.gitDir, head: input.head },
      input.action.autostash ? 'stash' : 'keep',
      input.action.changesSnapshot,
      plan.title,
      async () => {
        const outcome = await run();
        if (input.action.autostash && hasChanges && outcome.status !== 'succeeded') {
          throw new MergeRebaseConflictError(
            `${outcome.message} The saved changes are available in Recovery.`,
            outcome.output,
            outcome.failureReason ?? 'other',
          );
        }
        return outcome;
      },
      input.signal,
    );
  } catch (error) {
    if (error instanceof MergeRebaseConflictError) {
      return {
        status: 'failed',
        failureReason: error.failureReason,
        message: error.message,
        output: error.output,
      };
    }
    throw error;
  }
}

function createPlan(
  action: RepositoryMergeRebaseAction,
  sourceCommit: string,
  sourceLabel: string,
  currentLabel: string,
): MergeRebasePlan {
  const args =
    action.kind === 'merge' ? ['merge', '--no-edit', '--', sourceCommit] : ['rebase', sourceCommit];
  const title =
    action.kind === 'merge'
      ? `Merge '${sourceLabel}' into '${currentLabel}'`
      : `Rebase '${currentLabel}' on '${sourceLabel}'`;
  return {
    args,
    sourceLabel,
    currentLabel,
    title,
    command: ['git', ...args.map((argument) => JSON.stringify(argument))].join(' '),
  };
}

async function resolveSourceCommit(
  runner: MergeRebaseRunner,
  cwd: string,
  context: RepositoryReferenceContext,
  sourceFullName: string,
): Promise<string> {
  const local = [...context.branches, ...context.tags].find(
    (reference) => reference.fullName === sourceFullName,
  );
  if (local) return local.target;
  const remoteName = sourceFullName.startsWith('refs/remotes/')
    ? sourceFullName.slice('refs/remotes/'.length)
    : null;
  if (!remoteName || !context.remoteBranches.includes(remoteName)) {
    throw new MergeRebaseRequestError('That source branch is no longer in the refreshed reference list.');
  }
  try {
    const result = await runner.run(['rev-parse', '--verify', `${sourceFullName}^{commit}`], {
      cwd,
      timeoutMs: readTimeoutMs,
      maxOutputBytes: readOutputLimit,
    });
    const commit = result.stdout.trim();
    if (!objectIdPattern.test(commit)) throw new Error('Git returned an invalid source commit.');
    return commit;
  } catch (error) {
    if (error instanceof GitCommandError)
      throw new MergeRebaseRequestError('That source branch no longer resolves to a commit.');
    throw error;
  }
}

function commandFailure(kind: 'merge' | 'rebase', error: unknown): OperationOutcome {
  if (error instanceof GitCancelledError) {
    return {
      status: 'failed',
      failureReason: 'cancelled',
      message: 'The merge or rebase was cancelled. Refresh the repository to see what Git changed.',
      output: '',
    };
  }
  if (error instanceof GitTimeoutError) {
    return {
      status: 'failed',
      failureReason: 'timeout',
      message: 'Git stopped responding. Refresh the repository to see what it had already changed.',
      output: '',
    };
  }
  if (!(error instanceof GitCommandError)) throw error;
  const output = displayOutput(error.stdout, error.stderr);
  if (/\bCONFLICT\b|fix conflicts|resolve all conflicts|could not apply/iu.test(output)) {
    return {
      status: 'failed',
      failureReason: 'conflict',
      message:
        kind === 'merge'
          ? 'Merge stopped with conflicts. Resolve and stage the files, then continue or abort from Recovery.'
          : 'Rebase stopped with conflicts. Resolve and stage the files, then continue, skip, or abort from Recovery.',
      output,
    };
  }
  return {
    status: 'failed',
    failureReason: 'other',
    message: 'Git could not complete the merge or rebase. Its output is shown below.',
    output,
  };
}

function displayReference(fullName: string): string {
  return fullName.replace(/^refs\/(heads|remotes|tags)\//u, '');
}
