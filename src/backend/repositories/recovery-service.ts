import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  RepositoryHead,
  RepositoryLocalChangesPolicy,
  RepositoryLocalChangesPreview,
  RepositoryRecoveryCopy,
  RepositoryRecoveryRequest,
  RepositoryRecoveryState,
} from '../../common/ipc/contracts';
import { repositoryRecoveryCopySchema } from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { GitCancelledError, GitCommandError } from '../git/runner';
import { detectPendingOperation, readRebaseEditState, readSingleNoCommitOperation } from './commit-service';
import { displayOutput } from './network-service';
import { readWorkingChanges } from './working-tree-service';
import { createWorkingSnapshot } from './working-snapshot';
import {
  cleanupInteractiveRebaseArtifacts,
  dismissRebaseBackup,
  readRebaseBackups,
} from './interactive-rebase-artifacts';
import {
  abortStashApplication,
  beginStashApplication,
  finishStashApplication,
  readStashApplication,
} from './stash-application';
import { readOperationInfo } from './conflict-service';

interface RecoveryRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

interface Context {
  readonly id: string;
  readonly cwd: string;
  readonly gitDir: string;
  readonly head: RepositoryHead;
}
const storeSchema = z.strictObject({
  version: z.literal(1),
  copies: z.array(repositoryRecoveryCopySchema).max(100),
});
const recoveryRef = (id: string) => `refs/git-workbench/recovery/${id}`;
const options = (cwd: string): GitRunOptions => ({ cwd, timeoutMs: 120000, maxOutputBytes: 4 * 1024 * 1024 });

async function load(runner: RecoveryRunner, context: Context): Promise<RepositoryRecoveryCopy[]> {
  let copies: RepositoryRecoveryCopy[];
  try {
    const path = join(context.gitDir, 'git-workbench-recovery.json');
    if ((await lstat(path)).size > 1024 * 1024) throw new Error('Recovery metadata is too large.');
    copies = storeSchema.parse(JSON.parse(await readFile(path, 'utf8'))).copies;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Recovery metadata could not be read. Saved changes remain in Git stashes and refs/git-workbench/recovery.',
    );
  }
  // If the app stopped after stash push, its journal entry still identifies the exact saved stash.
  if (copies.some((copy) => !copy.commitId)) {
    const stashes = (
      await runner.run(['stash', 'list', '--format=%H%x00%gs'], options(context.cwd))
    ).stdout.split('\n');
    copies = copies.map((copy) => {
      if (copy.commitId) return copy;
      const record = stashes.find((line) => line.includes(`Git Workbench recovery ${copy.id}:`));
      const commitId = record?.split('\0')[0];
      return commitId && /^[a-f0-9]{40,64}$/u.test(commitId) ? { ...copy, commitId } : copy;
    });
  }
  return copies;
}

async function save(context: Context, copies: readonly RepositoryRecoveryCopy[]): Promise<void> {
  const path = join(context.gitDir, 'git-workbench-recovery.json');
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, copies })}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readRecovery(
  runner: RecoveryRunner,
  context: Context,
): Promise<RepositoryRecoveryState> {
  const [copies, pendingOperation, changes, rebaseEdit, rebaseBackups] = await Promise.all([
    load(runner, context),
    detectPendingOperation(context.gitDir),
    readWorkingChanges(runner, {
      repositoryId: context.id,
      cwd: context.cwd,
      includeUntracked: false,
      includeIgnored: false,
    }),
    readRebaseEditState(runner, context.cwd, context.gitDir, context.head.commit),
    readRebaseBackups(context.gitDir),
  ]);
  const anchors = await Promise.all(
    [
      'HEAD',
      'ORIG_HEAD',
      'MERGE_HEAD',
      'SQUASH_MSG',
      'REBASE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge/head-name',
      'rebase-merge/onto',
      'rebase-merge/orig-head',
      'rebase-merge/msgnum',
      'rebase-merge/git-rebase-todo',
      'rebase-merge/done',
      'rebase-merge/update-refs',
      'rebase-apply/head-name',
      'rebase-apply/onto',
      'rebase-apply/orig-head',
      'rebase-apply/next',
      'sequencer/todo',
      'sequencer/opts',
      'sequencer/head',
      'git-workbench-stash-apply.json',
    ].map(async (name) => {
      const path = join(context.gitDir, name);
      try {
        if ((await lstat(path)).size > 8 * 1024 * 1024) throw new Error('Recovery anchor is too large.');
        return createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'Git recovery state could not be inspected safely.',
        );
      }
    }),
  );
  const fingerprints: string[] = [];
  if (pendingOperation) {
    let hashedBytes = 0;
    for (const change of [...changes.staged, ...changes.unstaged]) {
      const files = await Promise.all(
        [change.path, ...(change.previousPath ? [change.previousPath] : [])].map(async (path) => {
          const details = await lstat(join(context.cwd, path)).catch(() => undefined);
          return {
            path,
            mode: details?.mode,
            size: details?.size ?? 0,
            modified: details?.mtimeMs,
            changed: details?.ctimeMs,
          };
        }),
      );
      const size = files.reduce((total, file) => total + file.size, 0);
      // Ordinary idle polling must not hash the entire working tree. Active recovery fingerprints
      // are bounded; very large files retain their status, size, mode and change-time guards.
      if (size <= 8 * 1024 * 1024 && hashedBytes + size <= 64 * 1024 * 1024) {
        hashedBytes += size;
        fingerprints.push(await createWorkingSnapshot(context.cwd, change, change));
      } else fingerprints.push(JSON.stringify([change, files]));
    }
  }
  const operation =
    pendingOperation || changes.counts.conflicted
      ? await readOperationInfo(runner, {
          repositoryId: context.id,
          cwd: context.cwd,
          gitDir: context.gitDir,
        })
      : { operationLabel: 'No operation in progress' };
  return {
    copies,
    rebaseBackups,
    operationLabel: operation.operationLabel,
    pendingOperation,
    conflictedCount: changes.counts.conflicted,
    rebaseEdit,
    snapshot: createHash('sha256')
      .update(
        JSON.stringify([
          context.head,
          copies,
          rebaseBackups,
          pendingOperation,
          rebaseEdit,
          anchors,
          fingerprints,
        ]),
      )
      .digest('hex'),
  };
}

export async function previewLocalChanges(
  runner: RecoveryRunner,
  context: Context,
): Promise<RepositoryLocalChangesPreview> {
  const changes = await readWorkingChanges(runner, {
    repositoryId: context.id,
    cwd: context.cwd,
    includeIgnored: false,
    includeUntracked: true,
  });
  if (changes.truncated)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'There are too many changes to preview safely. Commit or stash them with Git first.',
    );
  const selected = [...changes.staged, ...changes.unstaged, ...changes.untracked];
  if (selected.some((change) => change.oldMode === '160000' || change.newMode === '160000')) {
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Save submodule changes separately before stashing or discarding local changes.',
    );
  }
  const fingerprints: string[] = [];
  let bytes = 0;
  for (const change of selected) {
    const details = await lstat(join(context.cwd, change.path)).catch(() => undefined);
    if (details?.isDirectory())
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Save nested repository changes separately before stashing or discarding them.',
      );
    bytes += details?.size ?? 0;
    if (bytes > 256 * 1024 * 1024)
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Local changes exceed the safe preview size. Save them with Git first.',
      );
    fingerprints.push(await createWorkingSnapshot(context.cwd, change, change));
  }
  const pendingOperation = await detectPendingOperation(context.gitDir);
  return {
    snapshot: createHash('sha256')
      .update(JSON.stringify([context.head, fingerprints, pendingOperation]))
      .digest('hex'),
    paths: [
      ...new Set(
        [...changes.staged, ...changes.unstaged].flatMap((change) => [
          change.path,
          ...(change.previousPath ? [change.previousPath] : []),
        ]),
      ),
    ],
    untrackedPaths: changes.untracked.map((change) => change.path),
    pendingOperation,
  };
}

/** Runs inside the common-repository mutation queue. Saved data is retained even after a successful apply. */
export async function withLocalChanges<T>(
  runner: RecoveryRunner,
  context: Context,
  policy: RepositoryLocalChangesPolicy,
  expected: string | undefined,
  title: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new GitCancelledError();
  if (policy === 'keep') return work();
  const preview = await previewLocalChanges(runner, context);
  if (!expected || preview.snapshot !== expected)
    throw new ExpectedBackendError(
      'STALE_SNAPSHOT',
      'Local changes changed after the preview. Review them again.',
    );
  if (preview.pendingOperation)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      `Finish or abort the ${preview.pendingOperation} first.`,
    );
  if (preview.paths.length + preview.untrackedPaths.length === 0) return work();
  const copies = await load(runner, context);
  if (copies.some((copy) => copy.pending))
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Resolve the pending saved changes in Recovery first.',
    );
  if (copies.length >= 100)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Dismiss old recovery entries before saving more changes.',
    );
  const copy: RepositoryRecoveryCopy = {
    id: randomUUID(),
    commitId: null,
    title,
    createdAt: new Date().toISOString(),
    pending: true,
  };
  copies.push(copy);
  await save(context, copies);
  // Do not interrupt the saving step. Cancellation after it leaves a named, recoverable stash.
  await runner.run(
    ['stash', 'push', '--include-untracked', '--message', `Git Workbench recovery ${copy.id}: ${title}`],
    options(context.cwd),
  );
  const commitId = (
    await runner.run(['rev-parse', '--verify', 'refs/stash'], options(context.cwd))
  ).stdout.trim();
  const saved = repositoryRecoveryCopySchema.parse({ ...copy, commitId });
  copies[copies.length - 1] = saved;
  await runner.run(['update-ref', recoveryRef(copy.id), commitId], options(context.cwd));
  await save(context, copies);
  if (signal?.aborted) throw new GitCancelledError();
  const result = await work();
  if (signal?.aborted) throw new GitCancelledError();
  // A no-commit/squash merge deliberately pauses. Reapply only after Commit/Continue/Abort.
  if (policy === 'stash' && !(await detectPendingOperation(context.gitDir))) {
    const remaining = await readWorkingChanges(runner, {
      repositoryId: context.id,
      cwd: context.cwd,
      includeUntracked: false,
      includeIgnored: false,
    });
    // No-commit operations leave intentional staged changes. Keep the saved copy pending until
    // those changes have been reviewed and committed, instead of applying over their index.
    if (remaining.counts.staged + remaining.counts.unstaged === 0) await reapply(runner, context, saved);
  } else if (policy === 'stash') return result;
  else
    await save(
      context,
      copies.map((item) => (item.id === copy.id ? { ...item, pending: false } : item)),
    );
  return result;
}

/** Preserve tracked work without moving HEAD, index entries, or working files before a discard. */
export async function saveDiscardRecovery(
  runner: RecoveryRunner,
  context: Context,
  title: string,
): Promise<void> {
  const copies = await load(runner, context);
  if (copies.length >= 100)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Dismiss old recovery entries before discarding more changes.',
    );
  const id = randomUUID();
  const commitId = (
    await runner.run(['stash', 'create', `Git Workbench recovery ${id}: ${title}`], options(context.cwd))
  ).stdout.trim();
  if (!/^[a-f0-9]{40,64}$/u.test(commitId))
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Git could not save a recovery copy; no changes were discarded.',
    );
  await runner.run(['update-ref', recoveryRef(id), commitId], options(context.cwd));
  copies.push({ id, commitId, title, createdAt: new Date().toISOString(), pending: false });
  await save(context, copies);
}

async function reapply(
  runner: RecoveryRunner,
  context: Context,
  copy: RepositoryRecoveryCopy,
): Promise<void> {
  if (!copy.commitId)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'No completed stash was found for this entry. Inspect Git stashes before dismissing it.',
    );
  try {
    await beginStashApplication(runner, context.cwd, context.gitDir, copy.commitId);
    await runner.run(['stash', 'apply', '--index', copy.commitId], options(context.cwd));
    await finishStashApplication(context.gitDir);
  } catch (error) {
    const detail =
      error instanceof GitCommandError ? displayOutput(error.stdout, error.stderr).slice(0, 240) : '';
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      `Saved changes need attention in Recovery. The recovery copy is retained. ${detail}`,
    );
  }
  await save(
    context,
    (await load(runner, context)).map((item) => (item.id === copy.id ? { ...item, pending: false } : item)),
  );
}

export async function recover(
  runner: RecoveryRunner,
  context: Context,
  request: RepositoryRecoveryRequest,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new GitCancelledError();
  const state = await readRecovery(runner, context);
  if (state.snapshot !== request.snapshot)
    throw new ExpectedBackendError(
      'STALE_SNAPSHOT',
      'The recovery state changed. Review it again before continuing.',
    );
  const copy = state.copies.find((item) => item.id === request.copyId);
  if (request.action === 'dismiss-rebase-backup') {
    if (state.pendingOperation || !request.copyId)
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Finish or abort the operation before dismissing a history backup.',
      );
    await dismissRebaseBackup(runner, context.cwd, context.gitDir, request.copyId);
    return;
  }
  if (request.action === 'continue' || request.action === 'skip' || request.action === 'abort') {
    if (!state.pendingOperation)
      throw new ExpectedBackendError('OPERATION_FAILED', 'No Git operation is waiting for recovery.');
    if (request.action === 'skip' && !['rebase', 'cherry-pick', 'revert'].includes(state.pendingOperation))
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        `Git does not support skipping a ${state.pendingOperation} from Recovery.`,
      );
    if (request.action === 'continue' && (state.conflictedCount ?? 0) > 0)
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Resolve and stage all conflicted files before continuing.',
      );
    if (request.action === 'continue' && state.rebaseEdit === 'needs-amend')
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Amend the paused interactive-rebase commit in Local Changes before continuing.',
      );
    if (state.pendingOperation === 'rebase' && request.action !== 'abort') {
      const path = join(context.gitDir, 'rebase-merge/update-refs');
      const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (details) {
        if (!details.isFile() || details.size > 8 * 1024 * 1024)
          throw new ExpectedBackendError(
            'OPERATION_FAILED',
            'The dependent branch state could not be read safely.',
          );
        const lines = (await readFile(path, 'utf8')).trim().split('\n');
        const refs = new Map<string, string>();
        for (let index = 0; index < lines.length; index += 3) {
          const ref = lines[index];
          const old = lines[index + 1];
          if (ref?.startsWith('refs/heads/') && old) refs.set(ref, old);
        }
        if (refs.size) {
          const current = await runner.run(
            [
              'for-each-ref',
              '--format=%(refname)%00%(objectname)%00%(if)%(worktreepath)%(then)checked-out%(end)',
              ...refs.keys(),
            ],
            options(context.cwd),
          );
          const found = new Set<string>();
          for (const line of current.stdout.trim().split('\n')) {
            const [ref, commit, checkedOut] = line.split('\0');
            if (!ref || !refs.has(ref)) continue;
            found.add(ref);
            if (checkedOut || commit !== refs.get(ref))
              throw new ExpectedBackendError(
                'STALE_SNAPSHOT',
                `Dependent branch '${ref.slice(11)}' changed or was checked out in another worktree. Restore its reviewed state or abort this rebase.`,
              );
          }
          if (found.size !== refs.size)
            throw new ExpectedBackendError(
              'STALE_SNAPSHOT',
              'A dependent branch was removed. Restore it or abort this rebase.',
            );
        }
      }
    }
    if (state.pendingOperation === 'stash') {
      const application = await readStashApplication(context.gitDir);
      if (request.action === 'abort') await abortStashApplication(runner, context.cwd, context.gitDir);
      else await finishStashApplication(context.gitDir);
      // Do not reapply the recovery copy which was just resolved or aborted.
      await save(
        context,
        state.copies.map((item) =>
          item.commitId === application?.source ? { ...item, pending: false } : item,
        ),
      );
      return;
    }
    // Git's single --no-commit conflict can retain a todo without CHERRY_PICK_HEAD. Replaying
    // --continue would try the same change again over the user's staged resolution.
    const noCommitResolved =
      request.action === 'continue' &&
      (await readSingleNoCommitOperation(context.gitDir)) === state.pendingOperation;
    const args = noCommitResolved
      ? [state.pendingOperation, '--quit']
      : state.pendingOperation === 'squash'
        ? request.action === 'abort'
          ? ['reset', '--no-recurse-submodules', '--merge', 'HEAD']
          : ['commit', '--no-edit']
        : [state.pendingOperation, `--${request.action}`];
    await runner.run(args, {
      ...options(context.cwd),
      signal,
      env: { GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
    });
    if (state.pendingOperation === 'squash' && request.action === 'abort')
      await unlink(join(context.gitDir, 'SQUASH_MSG')).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    if (!(await detectPendingOperation(context.gitDir))) {
      const pending = state.copies.find((item) => item.pending);
      if (pending && !noCommitResolved) await reapply(runner, context, pending);
      await cleanupInteractiveRebaseArtifacts(runner, context.cwd, context.gitDir);
    }
    return;
  }
  if (!copy)
    throw new ExpectedBackendError('OPERATION_FAILED', 'That saved recovery entry no longer exists.');
  if (
    request.action === 'finish' &&
    state.pendingOperation === 'stash' &&
    !state.conflictedCount &&
    (await readStashApplication(context.gitDir))?.source === copy.commitId
  ) {
    await finishStashApplication(context.gitDir);
    await save(
      context,
      state.copies.map((item) => (item.id === copy.id ? { ...item, pending: false } : item)),
    );
    return;
  }
  if (state.pendingOperation)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Finish or abort the Git operation before handling saved changes.',
    );
  if (request.action === 'apply') {
    const changes = await readWorkingChanges(runner, {
      repositoryId: context.id,
      cwd: context.cwd,
      includeUntracked: true,
      includeIgnored: false,
    });
    if (changes.counts.conflicted > 0)
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Resolve and stage conflicted files, then mark the saved changes resolved.',
      );
    if (changes.counts.staged + changes.counts.unstaged + changes.counts.untracked > 0)
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Commit or save current changes before applying a recovery copy.',
      );
    await save(
      context,
      state.copies.map((item) => (item.id === copy.id ? { ...item, pending: true } : item)),
    );
    return reapply(runner, context, copy);
  }
  if (request.action === 'finish') {
    const changes = await readWorkingChanges(runner, {
      repositoryId: context.id,
      cwd: context.cwd,
      includeUntracked: true,
      includeIgnored: false,
    });
    if (changes.counts.conflicted > 0)
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Resolve and stage the remaining conflicted files first.',
      );
    await save(
      context,
      state.copies.map((item) => (item.id === copy.id ? { ...item, pending: false } : item)),
    );
    return;
  }
  if (copy.pending)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Handle the pending saved changes before dismissing their entry.',
    );
  // Dismissing the application entry never drops a potentially user-reordered Git stash.
  if (copy.commitId)
    await runner.run(['update-ref', '-d', recoveryRef(copy.id), copy.commitId], options(context.cwd));
  await save(
    context,
    state.copies.filter((item) => item.id !== copy.id),
  );
}
