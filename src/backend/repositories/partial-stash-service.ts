import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepositoryStashAction } from '../../common/ipc/contracts';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { GitCancelledError } from '../git/runner';
import { ExpectedBackendError } from '../errors';
import { detectPendingOperation } from './commit-service';
import { readRepositoryDiff } from './diff-service';
import { selectPatch, StaleWorkingSnapshotError, WorkingChangeActionError } from './staging-service';

interface Runner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

/** Git's path-limited stash also saves unrelated staged entries unless its input index is scoped. */
export async function saveSelectedFileStash(
  runner: Runner,
  input: {
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly newPaths: readonly string[];
    readonly message: string;
    readonly includeUntracked: boolean;
    readonly signal: AbortSignal;
  },
) {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-selected-stash-'));
  const indexFile = join(directory, 'index');
  const options = { cwd: input.cwd, timeoutMs: 120_000, maxOutputBytes: 8 * 1024 * 1024 };
  try {
    await runner.run(['read-tree', 'HEAD'], { ...options, indexFile });
    for (let offset = 0; offset < input.paths.length; offset += 100)
      await runner.run(['update-index', '--force-remove', '--', ...input.paths.slice(offset, offset + 100)], {
        ...options,
        indexFile,
      });
    const selected = new Set(input.paths);
    const entries = (await runner.run(['ls-files', '--stage', '-z'], options)).stdout
      .split('\0')
      .filter((record) => selected.has(record.slice(record.indexOf('\t') + 1)));
    await runner.run(['update-index', '-z', '--index-info'], {
      ...options,
      indexFile,
      stdin: entries.length ? `${entries.join('\0')}\0` : '',
    });
    for (let offset = 0; offset < input.newPaths.length; offset += 100)
      await runner.run(['add', '--', ...input.newPaths.slice(offset, offset + 100)], {
        ...options,
        indexFile,
        signal: input.signal,
      });
    if (input.signal.aborted) throw new GitCancelledError();
    await runner.run(
      [
        'stash',
        'push',
        ...(input.message.trim() ? [`--message=${input.message.trim()}`] : []),
        ...(input.includeUntracked ? ['--include-untracked'] : []),
        '--pathspec-from-file=-',
        '--pathspec-file-nul',
      ],
      {
        ...options,
        indexFile,
        signal: input.signal,
        stdin: input.paths.map((path) => `:(literal)${path}\0`).join(''),
      },
    );
    // Stash reset only its temporary index. Restore just the selected entries in the real index.
    // Once the save succeeds this short cleanup is not interrupted; the saved object is retained.
    await runner.run(['reset', '--quiet', 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      ...options,
      stdin: `${input.paths.join('\0')}\0`,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Store an ordinary two-parent stash, then remove only the reviewed selection. HEAD never moves. */
export async function savePartialStash(
  runner: Runner,
  context: { readonly id: string; readonly cwd: string; readonly gitDir: string },
  action: Extract<RepositoryStashAction, { kind: 'save-selection' }>,
  signal: AbortSignal,
) {
  if (!['staged', 'unstaged', 'untracked'].includes(action.target.area))
    throw new WorkingChangeActionError('Select changed text in the staged or unstaged diff.');
  if (await detectPendingOperation(context.gitDir))
    throw new WorkingChangeActionError('Finish the current Git operation before saving selected changes.');
  const read = () =>
    readRepositoryDiff(runner, {
      repositoryId: context.id,
      cwd: context.cwd,
      target: { kind: 'working', ...action.target },
      whitespace: 'normal',
      options: {
        contextLines: action.selection.contextLines,
        entireFile: action.selection.entireFile,
        loadLarge: true,
      },
    });
  const diff = await read();
  if (diff.snapshot !== action.snapshot) throw new StaleWorkingSnapshotError();
  if (diff.state !== 'text')
    throw new WorkingChangeActionError('Only bounded text changes support hunk or line stashes.');
  const forward = selectPatch(diff.content, action.selection, false);
  const reverse = selectPatch(diff.content, action.selection, true);
  if (!forward || !reverse) throw new WorkingChangeActionError('Select at least one changed line.');
  const options = { cwd: context.cwd, timeoutMs: 30_000, maxOutputBytes: 8 * 1024 * 1024 };
  const run = async (args: string[], extra: Partial<GitRunOptions> = {}) =>
    (await runner.run(args, { ...options, ...extra })).stdout.trim();
  const head = await run(['rev-parse', '--verify', 'HEAD']);
  const branch = await run(['branch', '--show-current']);
  const staged = action.target.area === 'staged';
  const temporary = await mkdtemp(join(tmpdir(), 'git-workbench-partial-stash-'));
  const indexFile = join(temporary, 'index');
  const zeroContext =
    action.selection.contextLines === 0 && !action.selection.entireFile ? ['--unidiff-zero'] : [];
  try {
    await run(['read-tree', head], { indexFile });
    if (!staged && action.target.area !== 'untracked') {
      // An unstaged selection is relative to the index. A synthetic base preserves this context
      // without adding the user's other staged changes to the stash's change set.
      const entry = await runner.run(
        ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', action.target.path],
        options,
      );
      await run(['update-index', '-z', '--index-info'], { indexFile, stdin: entry.stdout });
      if (action.target.previousPath)
        await run(['update-index', '--force-remove', '--', action.target.previousPath], { indexFile });
    }
    const baseTree = await run(['write-tree'], { indexFile });
    const headTree = await run(['rev-parse', `${head}^{tree}`]);
    const base =
      baseTree === headTree
        ? head
        : await run(['commit-tree', baseTree, '-p', head], {
            stdin: `Partial stash base for ${action.target.path}\n`,
          });
    await run(['apply', '--cached', '--whitespace=nowarn', ...zeroContext, '-'], {
      indexFile,
      stdin: forward,
    });
    const selectedTree = await run(['write-tree'], { indexFile });
    const indexCommit = await run(['commit-tree', staged ? selectedTree : baseTree, '-p', base], {
      stdin: `index on ${branch || 'detached HEAD'}: selected changes\n`,
    });
    const message = `On ${branch || 'detached HEAD'}: ${action.message.trim() || `Selected changes in ${action.target.path}`}`;
    const stash = await run(['commit-tree', selectedTree, '-p', base, '-p', indexCommit], {
      stdin: `${message}\n`,
    });
    await run(['apply', '--reverse', '--check', ...zeroContext, '-'], { stdin: reverse });
    if (staged)
      await run(['apply', '--cached', '--reverse', '--check', ...zeroContext, '-'], { stdin: reverse });
    if ((await read()).snapshot !== action.snapshot) throw new StaleWorkingSnapshotError();
    if (signal.aborted) throw new GitCancelledError();
    // Publish before changing files. A failure after this point always leaves the selected bytes saved.
    await run(['stash', 'store', '--message', message, stash]);
    try {
      if (staged)
        await run(['apply', '--cached', '--reverse', '--whitespace=nowarn', ...zeroContext, '-'], {
          stdin: reverse,
        });
      await run(['apply', '--reverse', '--whitespace=nowarn', ...zeroContext, '-'], { stdin: reverse });
    } catch {
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'The selection was saved, but Git could not remove all of it from the working tree. Review the retained stash and remaining changes before applying it.',
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
