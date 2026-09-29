import type {
  RepositoryCommitChange,
  RepositoryCommitChanges,
  RepositoryRevisionBlob,
  RepositoryRevisionTree,
  RepositoryRevisionTreeEntry,
} from '../../common/ipc/contracts';
import {
  repositoryCommitChangesSchema,
  repositoryRevisionBlobSchema,
  repositoryRevisionTreeSchema,
} from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import { imageByteLimit, imageFromBytes } from './image-diff-service';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

const revisionReadTimeoutMs = 15_000;
const revisionReadOutputLimit = 8 * 1024 * 1024;
const revisionTreeEntryLimit = 5_000;
const revisionBlobPreviewLimit = 1_048_576;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const zeroObjectIdPattern = /^(?:0{40}|0{64})$/u;
const modePattern = /^\d{6}$/u;

export interface RevisionRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReadRevisionInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly commitId: string;
}

export interface ReadRevisionTreeInput extends ReadRevisionInput {
  /** Empty means the root tree. Git paths use forward slashes. */
  readonly path: string;
  readonly offset?: number | undefined;
}

export interface ReadRevisionBlobInput extends ReadRevisionInput {
  readonly path: string;
}

export class RevisionNotFoundError extends Error {
  constructor() {
    super('The selected revision is not available in this repository.');
    this.name = 'RevisionNotFoundError';
  }
}

export class RevisionPathError extends Error {
  constructor(message = 'The selected revision path is not available.') {
    super(message);
    this.name = 'RevisionPathError';
  }
}

/** Reads committed changes against the first parent (or empty tree), matching the commit diff view. */
export async function readCommitChanges(
  runner: RevisionRunner,
  input: ReadRevisionInput,
): Promise<RepositoryCommitChanges> {
  await ensureCommit(runner, input);
  const result = await runner.run(
    [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--no-ext-diff',
      '--no-textconv',
      '--raw',
      '-r',
      '-M',
      '-C',
      '--diff-merges=first-parent',
      '-z',
      input.commitId,
      '--',
    ],
    readOptions(input.cwd, revisionReadOutputLimit),
  );
  const parsed = parseRawChanges(result.stdout);
  const unique = new Map<string, RepositoryCommitChange>();
  for (const change of parsed) {
    const key = `${change.previousPath ?? ''}\0${change.path}`;
    if (!unique.has(key)) unique.set(key, change);
  }

  const changes = [...unique.values()];
  const response = {
    repositoryId: input.repositoryId,
    commitId: input.commitId,
    changes: changes.slice(0, 10_000),
    truncated: changes.length > 10_000,
  } satisfies RepositoryCommitChanges;
  return repositoryCommitChangesSchema.parse(response);
}

export interface AmendBase {
  readonly commitId: string;
  /** `null` for a root commit, where the comparison uses the repository's empty tree. */
  readonly parentId: string | null;
  /** The tree-ish an amended commit is compared against. */
  readonly base: string;
}

/**
 * Resolves what an amended commit would be compared against: HEAD's first parent, or the empty tree
 * for a root commit. Returns `null` when HEAD has no commit to amend.
 */
export async function resolveAmendBase(runner: RevisionRunner, cwd: string): Promise<AmendBase | null> {
  const commitId = await optionalRevision(runner, cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!commitId) return null;
  const parentId = await optionalRevision(runner, cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^']);
  if (parentId) return { commitId, parentId, base: parentId };

  // `hash-object` without `-w` only computes the empty tree's ID for this repository's hash algorithm.
  const emptyTree = await runner.run(['hash-object', '-t', 'tree', '--stdin'], {
    ...readOptions(cwd, 1_024),
    stdin: '',
  });
  const base = emptyTree.stdout.trim();
  if (!objectIdPattern.test(base)) throw new RevisionNotFoundError();
  return { commitId, parentId: null, base };
}

async function optionalRevision(
  runner: RevisionRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await runner.run(args, readOptions(cwd, 1_024));
    const value = result.stdout.trim();
    return objectIdPattern.test(value) ? value : null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

/** Reads one directory of a committed tree. The renderer can request children lazily. */
export async function readRevisionTree(
  runner: RevisionRunner,
  input: ReadRevisionTreeInput,
): Promise<RepositoryRevisionTree> {
  await ensureCommit(runner, input);
  const path = normalizeRevisionPath(input.path, true);
  if (path) await ensureTree(runner, input, path);

  const args = ['ls-tree', '-z', '--long'];
  if (!path) args.push('--full-tree');
  args.push(input.commitId, '--');
  if (path) args.push(`${path}/`);
  const result = await runner.run(args, readOptions(input.cwd, revisionReadOutputLimit));
  const parsed = parseTreeEntries(result.stdout);
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
    throw new RevisionPathError('The revision tree offset is not valid.');
  const nextOffset = offset + revisionTreeEntryLimit;
  const response = {
    repositoryId: input.repositoryId,
    commitId: input.commitId,
    path,
    entries: parsed.slice(offset, nextOffset),
    truncated: parsed.length > nextOffset,
    nextOffset: parsed.length > nextOffset && nextOffset <= 100_000 ? nextOffset : null,
  } satisfies RepositoryRevisionTree;
  return repositoryRevisionTreeSchema.parse(response);
}

/** Returns a bounded text preview for a committed blob; binary and oversized data stay opaque. */
export async function readRevisionBlob(
  runner: RevisionRunner,
  input: ReadRevisionBlobInput,
): Promise<RepositoryRevisionBlob> {
  await ensureCommit(runner, input);
  const path = normalizeRevisionPath(input.path, false);
  const object = `${input.commitId}:${path}`;
  const typeResult = await runner.run(['cat-file', '-t', object], readOptions(input.cwd, 1_024));
  const type = typeResult.stdout.trim();
  if (type !== 'blob') throw new RevisionPathError('The selected revision path is not a file.');

  const sizeResult = await runner.run(['cat-file', '-s', object], readOptions(input.cwd, 1_024));
  const byteLength = parseBlobSize(sizeResult.stdout.trim());
  if (/\.(?:png|jpe?g|gif|webp|bmp|tga|svg)$/iu.test(path) && byteLength <= imageByteLimit) {
    const raw = await runner.run(['cat-file', 'blob', object], {
      ...readOptions(input.cwd, imageByteLimit),
      stdoutEncoding: 'base64',
      env: { GIT_NO_LAZY_FETCH: '1' },
    });
    const bytes = Buffer.from(raw.stdout, 'base64');
    const image = imageFromBytes(bytes, path);
    if (image.state !== 'unsupported' || bytes.includes(0))
      return repositoryRevisionBlobSchema.parse({
        repositoryId: input.repositoryId,
        commitId: input.commitId,
        path,
        state: 'binary',
        content: '',
        byteLength,
        image,
      });
  }
  if (byteLength > revisionBlobPreviewLimit) {
    return repositoryRevisionBlobSchema.parse({
      repositoryId: input.repositoryId,
      commitId: input.commitId,
      path,
      state: 'too-large',
      content: '',
      byteLength,
    });
  }

  const result = await runner.run(
    ['cat-file', 'blob', object],
    readOptions(input.cwd, revisionBlobPreviewLimit),
  );
  const content = result.stdout;
  const binary = content.includes('\0');
  return repositoryRevisionBlobSchema.parse({
    repositoryId: input.repositoryId,
    commitId: input.commitId,
    path,
    state: binary ? 'binary' : 'text',
    content: binary ? '' : content,
    byteLength,
  });
}

export function parseRawChanges(output: string): RepositoryCommitChange[] {
  const records = output.split('\0');
  const changes: RepositoryCommitChange[] = [];
  let cursor = 0;
  while (cursor < records.length) {
    const rawHeader = records[cursor++] ?? '';
    const header = rawHeader.replace(/^\r?\n/u, '');
    if (header.length === 0) continue;
    if (!header.startsWith(':')) throw new Error('Git returned an invalid changed-file record.');
    const fields = header.slice(1).split(/\s+/u);
    if (fields.length !== 5) throw new Error('Git returned an incomplete changed-file record.');
    const [oldMode, newMode, oldObjectId, newObjectId, statusToken] = fields;
    if (
      !oldMode ||
      !newMode ||
      !oldObjectId ||
      !newObjectId ||
      !statusToken ||
      !modePattern.test(oldMode) ||
      !modePattern.test(newMode) ||
      (!zeroObjectIdPattern.test(oldObjectId) && !objectIdPattern.test(oldObjectId)) ||
      (!zeroObjectIdPattern.test(newObjectId) && !objectIdPattern.test(newObjectId))
    ) {
      throw new Error('Git returned invalid changed-file metadata.');
    }

    const code = statusToken[0];
    if (!code) throw new Error('Git returned an invalid changed-file status.');
    const renameOrCopy = code === 'R' || code === 'C';
    const previousPath = renameOrCopy ? records[cursor++] : undefined;
    const path = renameOrCopy ? records[cursor++] : records[cursor++];
    if (!path || (renameOrCopy && !previousPath)) {
      throw new Error('Git returned an incomplete changed-file path.');
    }

    changes.push({
      status: changeStatus(code),
      path,
      previousPath: previousPath ?? null,
      similarity: renameOrCopy ? parseSimilarity(statusToken) : null,
      oldMode: zeroObjectIdPattern.test(oldObjectId) ? null : oldMode,
      newMode: zeroObjectIdPattern.test(newObjectId) ? null : newMode,
      oldObjectId: zeroObjectIdPattern.test(oldObjectId) ? null : oldObjectId,
      newObjectId: zeroObjectIdPattern.test(newObjectId) ? null : newObjectId,
    });
  }
  return changes;
}

export function parseTreeEntries(output: string): RepositoryRevisionTreeEntry[] {
  const entries: RepositoryRevisionTreeEntry[] = [];
  for (const record of output.split('\0')) {
    if (record.length === 0) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) throw new Error('Git returned an invalid revision-tree record.');
    const fields = record.slice(0, separator).split(/\s+/u);
    const path = record.slice(separator + 1);
    const [mode, type, objectId, sizeText] = fields;
    if (
      !mode ||
      !type ||
      !objectId ||
      !sizeText ||
      !modePattern.test(mode) ||
      !objectIdPattern.test(objectId) ||
      !isRevisionPath(path)
    ) {
      throw new Error('Git returned invalid revision-tree metadata.');
    }
    entries.push({
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      type: type === 'blob' || type === 'tree' || type === 'commit' ? type : 'unknown',
      mode,
      objectId,
      size: sizeText === '-' ? null : parseBlobSize(sizeText),
    });
  }
  return entries;
}

async function ensureCommit(runner: RevisionRunner, input: ReadRevisionInput): Promise<void> {
  try {
    await runner.run(['cat-file', '-e', `${input.commitId}^{commit}`], readOptions(input.cwd, 1_024));
  } catch (error) {
    if (error instanceof GitCommandError) throw new RevisionNotFoundError();
    throw error;
  }
}

async function ensureTree(runner: RevisionRunner, input: ReadRevisionInput, path: string): Promise<void> {
  try {
    const result = await runner.run(
      ['cat-file', '-t', `${input.commitId}:${path}`],
      readOptions(input.cwd, 1_024),
    );
    if (result.stdout.trim() !== 'tree')
      throw new RevisionPathError('The selected revision path is not a folder.');
  } catch (error) {
    if (error instanceof GitCommandError) throw new RevisionPathError();
    throw error;
  }
}

function readOptions(cwd: string, maxOutputBytes: number): GitRunOptions {
  return { cwd, timeoutMs: revisionReadTimeoutMs, maxOutputBytes };
}

function normalizeRevisionPath(path: string, allowRoot: boolean): string {
  if (path.length === 0 && allowRoot) return '';
  if (path.length === 0 || !isRevisionPath(path)) {
    throw new RevisionPathError('The revision path is not valid.');
  }
  return path;
}

function isRevisionPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.endsWith('/') &&
    !path.includes('//') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => part === '.' || part === '..')
  );
}

function changeStatus(code: string): RepositoryCommitChange['status'] {
  switch (code) {
    case 'A':
      return 'added';
    case 'C':
      return 'copied';
    case 'D':
      return 'deleted';
    case 'M':
      return 'modified';
    case 'R':
      return 'renamed';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    default:
      return 'unknown';
  }
}

function parseSimilarity(status: string): number | null {
  const match = /^[RC](\d{1,3})$/u.exec(status);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function parseBlobSize(value: string): number {
  if (!/^\d+$/u.test(value)) throw new Error('Git returned an invalid blob size.');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0 || size > 1_000_000_000_000) {
    throw new Error('Git returned an unsupported blob size.');
  }
  return size;
}
