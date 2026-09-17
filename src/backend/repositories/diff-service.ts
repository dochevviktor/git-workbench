import { devNull } from 'node:os';
import type {
  RepositoryDiff,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
} from '../../common/ipc/contracts';
import { repositoryDiffSchema } from '../../common/ipc/contracts';
import { GitCommandError, GitOutputLimitError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { readWorkingChanges } from './working-tree-service';
import { RevisionNotFoundError, RevisionPathError } from './revision-service';

const diffReadTimeoutMs = 15_000;
const diffReadOutputLimit = 8 * 1024 * 1024;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface DiffRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReadRepositoryDiffInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly target: RepositoryDiffTarget;
  readonly whitespace: RepositoryDiffWhitespace;
}

/** Reads one bounded text diff while keeping all Git argument construction in the backend. */
export async function readRepositoryDiff(
  runner: DiffRunner,
  input: ReadRepositoryDiffInput,
): Promise<RepositoryDiff> {
  if (input.target.kind === 'commit') await ensureCommit(runner, input.cwd, input.target.commitId);
  else {
    const conflict = await ensureWorkingTarget(runner, input);
    if (conflict) return unavailable(input, 'Conflict diffs are not available yet.');
  }

  let result: GitCommandResult;
  try {
    result = await runner.run(diffArguments(input.target, input.whitespace), {
      cwd: input.cwd,
      timeoutMs: diffReadTimeoutMs,
      maxOutputBytes: diffReadOutputLimit,
    });
  } catch (error) {
    if (error instanceof GitOutputLimitError) return tooLarge(input);
    if (
      input.target.kind === 'working' &&
      (input.target.area === 'untracked' || input.target.area === 'ignored') &&
      error instanceof GitCommandError &&
      error.exitCode === 1
    ) {
      // `git diff --no-index` deliberately exits with 1 when the two files differ.
      result = {
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: 1,
        signal: error.signal,
      };
    } else {
      throw error;
    }
  }

  const content = result.stdout;
  const binary = isBinaryDiff(content);
  return repositoryDiffSchema.parse({
    repositoryId: input.repositoryId,
    target: input.target,
    state: binary ? 'binary' : 'text',
    content: binary ? '' : content,
    byteLength: Buffer.byteLength(content, 'utf8'),
    message: binary ? 'Binary changes do not have an inline text diff.' : null,
  });
}

function diffArguments(target: RepositoryDiffTarget, whitespace: RepositoryDiffWhitespace): string[] {
  if (target.kind === 'commit') {
    const args = [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--full-index',
      '--patch',
      '--unified=3',
      '-M',
      '-C',
      '-m',
    ];
    const whitespaceFlag = whitespaceArgument(whitespace);
    if (whitespaceFlag) args.push(whitespaceFlag);
    args.push(target.commitId, '--');
    return args.concat(pathsForTarget(target));
  }

  const args = [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--full-index',
    '--patch',
    '--unified=3',
  ];
  const whitespaceFlag = whitespaceArgument(whitespace);
  if (whitespaceFlag) args.push(whitespaceFlag);
  if (target.area === 'staged') args.push('--cached');
  if (target.area === 'untracked' || target.area === 'ignored') {
    return args.concat(['--no-index', '--', devNull, target.path]);
  }
  return args.concat(['--', ...pathsForTarget(target)]);
}

function pathsForTarget(target: { readonly path: string; readonly previousPath: string | null }): string[] {
  return target.previousPath && target.previousPath !== target.path
    ? [target.previousPath, target.path]
    : [target.path];
}

function whitespaceArgument(whitespace: RepositoryDiffWhitespace): string | undefined {
  switch (whitespace) {
    case 'normal':
      return undefined;
    case 'ignore-all':
      return '--ignore-all-space';
    case 'ignore-space-change':
      return '--ignore-space-change';
    case 'ignore-space-at-eol':
      return '--ignore-space-at-eol';
  }
}

async function ensureCommit(runner: DiffRunner, cwd: string, commitId: string): Promise<void> {
  if (!objectIdPattern.test(commitId)) throw new RevisionNotFoundError();
  try {
    await runner.run(['cat-file', '-e', `${commitId}^{commit}`], {
      cwd,
      timeoutMs: diffReadTimeoutMs,
      maxOutputBytes: 1_024,
    });
  } catch (error) {
    if (error instanceof GitCommandError) throw new RevisionNotFoundError();
    throw error;
  }
}

async function ensureWorkingTarget(runner: DiffRunner, input: ReadRepositoryDiffInput): Promise<boolean> {
  if (input.target.kind !== 'working') return false;
  const changes = await readWorkingChanges(runner, {
    repositoryId: input.repositoryId,
    cwd: input.cwd,
    includeUntracked: true,
    includeIgnored: true,
  });
  const found = changes[input.target.area].some(
    (change) => change.path === input.target.path && change.previousPath === input.target.previousPath,
  );
  if (!found) {
    throw new RevisionPathError(
      'That file is no longer in the selected working-tree changes. Refresh and try again.',
    );
  }
  return changes[input.target.area].some(
    (change) =>
      change.path === input.target.path &&
      change.previousPath === input.target.previousPath &&
      change.status === 'unmerged',
  );
}

function isBinaryDiff(content: string): boolean {
  return /(?:^|\n)(?:Binary files .* differ|GIT binary patch|Subproject commit )/u.test(content);
}

function tooLarge(input: ReadRepositoryDiffInput): RepositoryDiff {
  return repositoryDiffSchema.parse({
    repositoryId: input.repositoryId,
    target: input.target,
    state: 'too-large',
    content: '',
    byteLength: null,
    message: 'This diff is too large to display inline.',
  });
}

function unavailable(input: ReadRepositoryDiffInput, message: string): RepositoryDiff {
  return repositoryDiffSchema.parse({
    repositoryId: input.repositoryId,
    target: input.target,
    state: 'unavailable',
    content: '',
    byteLength: null,
    message,
  });
}
