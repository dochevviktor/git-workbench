import { devNull } from 'node:os';
import { ExpectedBackendError } from '../errors';
import type {
  RepositoryPatchTarget,
  RepositoryStashDetails,
  RepositoryStashEntry,
} from '../../common/ipc/contracts';
import { repositoryStashDetailsSchema, repositoryStashEntrySchema } from '../../common/ipc/contracts';
import { GitCommandError, GitOutputLimitError } from '../git/runner';
import type { GitRunOptions, GitCommandResult } from '../git/runner';
import { readWorkingChanges } from './working-tree-service';

const stashReadTimeoutMs = 15_000;
const stashReadOutputLimit = 4 * 1024 * 1024;
const patchOutputLimit = 8 * 1024 * 1024;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface StashRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export class StashNotFoundError extends Error {
  constructor() {
    super('That stash is no longer available. Refresh the stash list and try again.');
    this.name = 'StashNotFoundError';
  }
}

export interface ReadStashDetailsInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly stashId: string;
}

function readOptions(cwd: string, maxOutputBytes = stashReadOutputLimit): GitRunOptions {
  return { cwd, timeoutMs: stashReadTimeoutMs, maxOutputBytes };
}

/** Reads the reflog-backed stash list while exposing commit IDs, never stash expressions, to callers. */
export async function readStashes(runner: StashRunner, cwd: string): Promise<RepositoryStashEntry[]> {
  const result = await runner.run(
    ['stash', 'list', '--max-count=100', '--format=%gd%x00%H%x00%P%x00%ct%x00%gs'],
    readOptions(cwd),
  );
  const entries = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line, index) => parseStashLine(line, index));
  return entries.map((entry) => repositoryStashEntrySchema.parse(entry));
}

function parseStashLine(line: string, index: number): RepositoryStashEntry {
  const [selector, commitId, parents, timestamp, subject, ...remainder] = line.split('\0');
  if (
    remainder.length > 0 ||
    !selector ||
    !/^stash@\{\d+\}$/u.test(selector) ||
    !commitId ||
    !objectIdPattern.test(commitId) ||
    !timestamp ||
    !/^\d+$/u.test(timestamp) ||
    !subject
  ) {
    throw new Error(`Git returned an invalid stash record at index ${index}.`);
  }
  const seconds = Number(timestamp);
  const createdAt = new Date(seconds * 1000);
  if (!Number.isSafeInteger(seconds) || Number.isNaN(createdAt.getTime())) {
    throw new Error('Git returned an invalid stash timestamp.');
  }
  const parsedSubject = parseSubject(subject);
  return {
    selector,
    commitId,
    message: parsedSubject.message,
    branch: parsedSubject.branch,
    createdAt: createdAt.toISOString(),
    includesUntracked: (parents?.trim().split(/\s+/u).filter(Boolean).length ?? 0) >= 3,
  };
}

function parseSubject(subject: string): { readonly branch: string | null; readonly message: string } {
  const match = /^(?:On|WIP on|index on) (.+?):\s*(.*)$/u.exec(subject);
  if (!match) return { branch: null, message: subject };
  return { branch: match[1] ?? null, message: match[2] ?? '' };
}

async function findStash(runner: StashRunner, cwd: string, stashId: string): Promise<RepositoryStashEntry> {
  if (!objectIdPattern.test(stashId)) throw new StashNotFoundError();
  const entry = (await readStashes(runner, cwd)).find((candidate) => candidate.commitId === stashId);
  if (!entry) throw new StashNotFoundError();
  return entry;
}

/** Reads a stash as an inert, bounded patch for the inspect and export surfaces. */
export async function readStashDetails(
  runner: StashRunner,
  input: ReadStashDetailsInput,
): Promise<RepositoryStashDetails> {
  const entry = await findStash(runner, input.cwd, input.stashId);
  try {
    const result = await runner.run(
      [
        'stash',
        'show',
        '--patch',
        '--binary',
        '--include-untracked',
        '--no-color',
        '--format=',
        entry.selector,
      ],
      readOptions(input.cwd, patchOutputLimit),
    );
    const content = result.stdout;
    return repositoryStashDetailsSchema.parse({
      repositoryId: input.repositoryId,
      stashId: input.stashId,
      entry,
      state: 'text',
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      message: content.length === 0 ? 'This stash has no displayable file changes.' : null,
    });
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      return repositoryStashDetailsSchema.parse({
        repositoryId: input.repositoryId,
        stashId: input.stashId,
        entry,
        state: 'too-large',
        content: '',
        byteLength: null,
        message: 'This stash is too large to display inline.',
      });
    }
    throw error;
  }
}

export interface ReadPatchInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly target: RepositoryPatchTarget;
}

/** Creates a bounded patch for a commit, stash, or selected working-tree paths. */
export async function readPatch(runner: StashRunner, input: ReadPatchInput): Promise<Buffer> {
  switch (input.target.kind) {
    case 'commit': {
      await ensureCommit(runner, input.cwd, input.target.commitId);
      const parents = await runner.run(
        ['show', '-s', '--format=%P', input.target.commitId],
        readOptions(input.cwd),
      );
      if (parents.stdout.trim().split(/\s+/u).filter(Boolean).length > 1)
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          'Merge commit patch export requires choosing a parent and is not supported.',
        );
      return runPatch(runner, input.cwd, [
        'format-patch',
        '--root',
        '--stdout',
        '--no-ext-diff',
        '--no-textconv',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--binary',
        '--no-signature',
        '--no-stat',
        '--max-count=1',
        input.target.commitId,
        '--',
      ]);
    }
    case 'stash': {
      const entry = await findStash(runner, input.cwd, input.target.stashId);
      return runPatch(runner, input.cwd, [
        'stash',
        'show',
        '--no-ext-diff',
        '--no-textconv',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--patch',
        '--binary',
        '--include-untracked',
        '--no-color',
        '--format=',
        entry.selector,
      ]);
    }
    case 'working':
      return readWorkingPatch(runner, input.cwd, input.target.paths, input.target.includeUntracked);
  }
}

async function ensureCommit(runner: StashRunner, cwd: string, commitId: string): Promise<void> {
  if (!objectIdPattern.test(commitId)) throw new StashNotFoundError();
  try {
    await runner.run(['cat-file', '-e', `${commitId}^{commit}`], readOptions(cwd, 1_024));
  } catch (error) {
    if (error instanceof GitCommandError) throw new StashNotFoundError();
    throw error;
  }
}

async function runPatch(runner: StashRunner, cwd: string, args: readonly string[]): Promise<Buffer> {
  try {
    const result = await runner.run(args, {
      ...readOptions(cwd, patchOutputLimit),
      stdoutEncoding: 'base64',
    });
    const bytes = Buffer.from(result.stdout, 'base64');
    if (bytes.length > patchOutputLimit) throw new GitOutputLimitError('stdout');
    return bytes;
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      throw new Error('The patch is too large to save safely.', { cause: error });
    }
    throw error;
  }
}

async function readWorkingPatch(
  runner: StashRunner,
  cwd: string,
  paths: readonly string[],
  includeUntracked: boolean,
): Promise<Buffer> {
  const changes = await readWorkingChanges(runner, {
    repositoryId: 'repo-0000000000000000000000000000000000000000000000000000000000000000',
    cwd,
    includeUntracked: true,
    includeIgnored: false,
  });
  const selected = new Set(paths);
  const allChanges = [...changes.staged, ...changes.unstaged, ...changes.untracked];
  const known = new Set(allChanges.flatMap((change) => [change.path, change.previousPath].filter(Boolean)));
  if ([...selected].some((path) => !known.has(path)))
    throw new Error('A selected working-tree path is no longer changed. Refresh and try again.');
  const untracked = new Set(changes.untracked.map((change) => change.path));
  if (!includeUntracked && [...selected].some((path) => untracked.has(path))) {
    throw new Error('The selected patch includes untracked files, but untracked files were excluded.');
  }
  const trackedPaths = [...selected].filter((path) => !untracked.has(path));
  const pieces: Buffer[] = [];
  let totalBytes = 0;
  const append = (bytes: Buffer) => {
    totalBytes += bytes.length;
    if (totalBytes > patchOutputLimit)
      throw new ExpectedBackendError('UNAVAILABLE', 'The patch exceeds the 8 MiB export limit.');
    pieces.push(bytes);
  };
  if (trackedPaths.length > 0) {
    const hasHead = await hasHeadCommit(runner, cwd);
    const args = [
      'diff',
      '--no-ext-diff',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--no-textconv',
      '--no-color',
      '--full-index',
      '--binary',
      '--patch',
      '--unified=3',
      '-M',
      '-C',
      ...(hasHead ? ['HEAD'] : ['--cached']),
      '--',
      ...trackedPaths,
    ];
    append(await runPatch(runner, cwd, args));
  }
  if (includeUntracked) {
    for (const path of [...selected].filter((candidate) => untracked.has(candidate))) {
      let result: GitCommandResult;
      try {
        result = await runner.run(
          [
            'diff',
            '--no-ext-diff',
            '--src-prefix=a/',
            '--dst-prefix=b/',
            '--no-color',
            '--full-index',
            '--binary',
            '--no-index',
            '--',
            devNull,
            path,
          ],
          { ...readOptions(cwd, patchOutputLimit), stdoutEncoding: 'base64' },
        );
      } catch (error) {
        if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
        result = {
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: 1,
          signal: error.signal,
        };
      }
      append(Buffer.from(result.stdout, 'base64'));
    }
  }
  const patch = Buffer.concat(pieces);
  if (patch.length > patchOutputLimit) throw new Error('The patch is too large to save safely.');
  return patch;
}

async function hasHeadCommit(runner: StashRunner, cwd: string): Promise<boolean> {
  try {
    await runner.run(['rev-parse', '--verify', 'HEAD^{commit}'], readOptions(cwd, 1_024));
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}
