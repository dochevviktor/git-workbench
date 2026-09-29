import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  RepositoryLfsFile,
  RepositoryLfsPointer,
  RepositoryLfsSaveResult,
  RepositoryOperationProgress,
} from '../../common/ipc/contracts';
import { repositoryLfsFileSchema, repositoryLfsSaveResultSchema } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError } from '../git/runner';
import { resolveLfsRemote, runLfsTransfer } from './lfs-management';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

const lfsReadTimeoutMs = 20_000;
const lfsPointerLimit = 1_024;
const lfsChunkSize = 256 * 1024;
const objectIdPattern = /^sha256:[0-9a-f]{64}$/u;
const objectIdHexPattern = /^[0-9a-f]{64}$/u;
const pointerVersion = 'https://git-lfs.github.com/spec/v1';

export interface LfsRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export function withLfsSignal(runner: LfsRunner, signal: AbortSignal): LfsRunner {
  return {
    run: (args, options) =>
      runner.run(args, {
        ...options,
        signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
      }),
  };
}

export interface ReadLfsFileInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly commitId: string;
  readonly path: string;
}

export interface LfsSaveInput extends ReadLfsFileInput {
  readonly remote?: string;
}

export interface LfsProgressHandle {
  readonly signal: AbortSignal;
  setProgress(progress: RepositoryOperationProgress | null): void;
}

export class LfsRevisionNotFoundError extends Error {
  constructor() {
    super('The selected revision is not available in this repository.');
    this.name = 'LfsRevisionNotFoundError';
  }
}

export class LfsPathError extends Error {
  constructor(message = 'The selected historical path is not available.') {
    super(message);
    this.name = 'LfsPathError';
  }
}

export class LfsPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LfsPayloadError';
  }
}

/** Reads pointer metadata and local object availability without changing the checkout. */
export async function readLfsFile(runner: LfsRunner, input: ReadLfsFileInput): Promise<RepositoryLfsFile> {
  runner = withLfsSignal(runner, AbortSignal.timeout(10_000));
  validatePath(input.path);
  await ensureCommit(runner, input);

  const [history, tracked, worktree, gitLfs] = await Promise.all([
    readHistoricalState(runner, input),
    readTrackedAttribute(runner, input),
    readWorktreeState(input),
    probeGitLfs(runner, input.cwd),
  ]);

  const response = {
    repositoryId: input.repositoryId,
    commitId: input.commitId,
    path: input.path,
    tracked,
    history,
    worktree,
    gitLfs,
  } satisfies RepositoryLfsFile;
  return repositoryLfsFileSchema.parse(response);
}

/** Retrieves exactly one historical object; smudge output is drained, never written to the checkout. */
export async function saveLfsPayload(
  runner: LfsRunner,
  input: LfsSaveInput,
  destination: string,
  handle: LfsProgressHandle,
): Promise<RepositoryLfsSaveResult> {
  runner = withLfsSignal(runner, handle.signal);
  if (!isAbsolute(destination) || destination.includes('\0') || destination.length > 32_768) {
    throw new LfsPayloadError('Choose a valid absolute destination for the LFS payload.');
  }
  destination = await validateDestination(runner, input.cwd, input.worktreePath, destination);
  if (handle.signal.aborted) throw new GitCancelledError();
  let metadata = await readLfsFile(runner, input);
  if (metadata.history.kind !== 'lfs') {
    throw new LfsPayloadError('The selected historical file is not a Git LFS pointer.');
  }
  if (metadata.history.payloadState === 'missing') {
    if (!metadata.gitLfs.available) throw new LfsPayloadError('Install Git LFS to retrieve this payload.');
    const remote = await resolveLfsRemote(runner, input.cwd, input.remote);
    const pointer = metadata.history.pointer;
    await runLfsTransfer(
      runner,
      input.cwd,
      [
        '-c',
        `remote.lfsdefault=${remote}`,
        '-c',
        'lfs.remote.autodetect=false',
        '-c',
        'lfs.remote.searchall=false',
        '-c',
        'lfs.fetchinclude=',
        '-c',
        'lfs.fetchexclude=',
        '-c',
        'lfs.skipdownloaderrors=false',
        'lfs',
        'smudge',
        '--',
        input.path,
      ],
      handle,
      {
        discardStdout: true,
        env: { GIT_LFS_SKIP_SMUDGE: '0' },
        stdin: `version ${pointer.version}\noid ${pointer.oid}\nsize ${pointer.size}\n`,
      },
    );
    metadata = await readLfsFile(runner, input);
  }
  if (metadata.history.kind !== 'lfs' || metadata.history.payloadState !== 'available')
    throw new LfsPayloadError('The local LFS object is missing or does not match the pointer size.');

  const source = await locatePayload(runner, input.cwd, metadata.history.pointer);
  if (!source) throw new LfsPayloadError('The LFS payload is no longer available in the local object cache.');
  const destinationInfo = await lstat(destination).catch(() => undefined);
  if (destinationInfo?.isDirectory()) throw new LfsPayloadError('The selected destination is a directory.');
  if (destinationInfo?.isSymbolicLink())
    throw new LfsPayloadError('The selected destination is a symbolic link.');

  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.git-workbench-${randomBytes(8).toString('hex')}.tmp`,
  );
  const expectedHash = metadata.history.pointer.oid.slice('sha256:'.length);
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  let completed = false;
  try {
    sourceHandle = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const sourceInfo = await sourceHandle.stat();
    if (!sourceInfo.isFile() || sourceInfo.size !== metadata.history.pointer.size)
      throw new LfsPayloadError('The local LFS object changed. Retry after checking the cache.');
    destinationHandle = await open(temporary, 'wx', 0o600);
    handle.setProgress({ phase: 'Retrieving LFS payload', percent: 0 });

    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(lfsChunkSize);
    let offset = 0;
    while (offset < source.byteLength) {
      if (handle.signal.aborted) throw new GitCancelledError();
      const remaining = source.byteLength - offset;
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, remaining),
        offset,
      );
      if (bytesRead <= 0) throw new LfsPayloadError('The local LFS object ended before the expected size.');
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(chunk, written, bytesRead - written, offset + written);
        if (result.bytesWritten === 0) throw new LfsPayloadError('The destination could not be written.');
        written += result.bytesWritten;
      }
      offset += bytesRead;
      handle.setProgress({
        phase: 'Retrieving LFS payload',
        percent: source.byteLength === 0 ? 100 : Math.floor((offset / source.byteLength) * 100),
      });
    }
    if (source.byteLength === 0) handle.setProgress({ phase: 'Retrieving LFS payload', percent: 100 });
    await destinationHandle.sync();
    const sha256 = digest.digest('hex');
    if (sha256 !== expectedHash) throw new LfsPayloadError('The local LFS object failed its SHA-256 check.');
    if (handle.signal.aborted) throw new GitCancelledError();
    if ((await validateDestination(runner, input.cwd, input.worktreePath, destination)) !== destination)
      throw new LfsPayloadError('The destination directory changed during retrieval.');
    completed = true;
    return repositoryLfsSaveResultSchema.parse({
      path: destination,
      byteLength: source.byteLength,
      sha256,
    });
  } finally {
    await destinationHandle?.close().catch(() => undefined);
    await sourceHandle?.close().catch(() => undefined);
    if (completed) {
      await rename(temporary, destination).catch(async (error: unknown) => {
        await unlink(temporary).catch(() => undefined);
        throw error;
      });
    } else {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export function parseLfsPointer(content: string): RepositoryLfsPointer | null {
  if (Buffer.byteLength(content, 'utf8') > lfsPointerLimit) return null;
  const lines = content.split('\n');
  if (lines.at(-1) !== '') return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(0, -1)) {
    const separator = line.indexOf(' ');
    if (separator <= 0 || line.indexOf(' ', separator + 1) >= 0) return null;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[a-z0-9.-]+$/u.test(key) || value.includes('\r') || fields.has(key)) return null;
    fields.set(key, value);
  }
  if (fields.get('version') !== pointerVersion) return null;
  const oid = fields.get('oid');
  const sizeText = fields.get('size');
  if (!oid || !objectIdPattern.test(oid) || !sizeText || !/^\d+$/u.test(sizeText)) return null;
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > 1_000_000_000_000) return null;
  return { version: pointerVersion, oid, size };
}

async function readHistoricalState(
  runner: LfsRunner,
  input: ReadLfsFileInput,
): Promise<RepositoryLfsFile['history']> {
  const object = `${input.commitId}:${input.path}`;
  let type: string;
  try {
    type = (await runner.run(['cat-file', '-t', object], readOptions(input.cwd, 1_024))).stdout.trim();
  } catch (error) {
    if (error instanceof GitCommandError) return { kind: 'missing' };
    throw error;
  }
  if (type !== 'blob') throw new LfsPathError('The selected historical path is not a file.');

  const byteLength = parseSize(
    (await runner.run(['cat-file', '-s', object], readOptions(input.cwd, 1_024))).stdout.trim(),
  );
  if (byteLength > lfsPointerLimit) return { kind: 'regular', byteLength };
  const content = (await runner.run(['cat-file', 'blob', object], readOptions(input.cwd, lfsPointerLimit)))
    .stdout;
  const pointer = parseLfsPointer(content);
  if (!pointer) return { kind: 'regular', byteLength };
  const payload = await locatePayload(runner, input.cwd, pointer);
  return {
    kind: 'lfs',
    pointer,
    pointerByteLength: Buffer.byteLength(content, 'utf8'),
    payloadState: !payload ? 'missing' : payload.byteLength === pointer.size ? 'available' : 'invalid',
    payloadByteLength: payload?.byteLength ?? null,
  };
}

async function readTrackedAttribute(runner: LfsRunner, input: ReadLfsFileInput): Promise<boolean> {
  try {
    const output = (
      await runner.run(['check-attr', '-z', 'filter', '--', input.path], readOptions(input.cwd, 4_096))
    ).stdout;
    const fields = output.split('\0');
    return fields.at(-2) === 'lfs';
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

async function readWorktreeState(input: ReadLfsFileInput): Promise<RepositoryLfsFile['worktree']> {
  if (!input.worktreePath) return { state: 'unavailable', byteLength: null };
  const path = join(input.worktreePath, ...input.path.split('/'));
  const root = await realpath(input.worktreePath);
  const canonical = await realpath(path).catch(() => undefined);
  if (!canonical || !inside(root, canonical)) return { state: 'unavailable', byteLength: null };
  const details = await lstat(path).catch(() => undefined);
  if (!details || !details.isFile()) return { state: 'missing', byteLength: null };
  if (details.size > lfsPointerLimit) return { state: 'materialized', byteLength: details.size };
  const content = await readFile(path, 'utf8').catch(() => undefined);
  if (content !== undefined && parseLfsPointer(content))
    return { state: 'pointer', byteLength: details.size };
  return { state: 'materialized', byteLength: details.size };
}

export async function probeGitLfs(runner: LfsRunner, cwd: string): Promise<RepositoryLfsFile['gitLfs']> {
  try {
    const result = await runner.run(['lfs', 'version'], readOptions(cwd, 4_096));
    const version =
      `${result.stdout}\n${result.stderr}`.match(/git-lfs\/([^\s]+)/u)?.[1] ?? result.stdout.trim();
    return { available: true, version: version.slice(0, 256) || null };
  } catch (error) {
    if (error instanceof GitCommandError) return { available: false, version: null };
    return { available: false, version: null };
  }
}

export async function locatePayload(
  runner: LfsRunner,
  cwd: string,
  pointer: RepositoryLfsPointer,
): Promise<{ readonly path: string; readonly byteLength: number } | null> {
  const storage = await resolveStorage(runner, cwd);
  if (!storage) return null;
  const hex = pointer.oid.slice('sha256:'.length);
  if (!objectIdHexPattern.test(hex)) return null;
  const storageRoot = resolve(storage);
  const objectPath = resolve(storageRoot, hex.slice(0, 2), hex.slice(2, 4), hex);
  if (objectPath !== storageRoot && !objectPath.startsWith(`${storageRoot}${sep}`)) return null;
  const canonical = await realpath(objectPath).catch(() => undefined);
  const canonicalStorage = await realpath(storageRoot).catch(() => undefined);
  if (!canonical || !canonicalStorage || !inside(canonicalStorage, canonical)) return null;
  const details = await lstat(objectPath).catch(() => undefined);
  if (!details?.isFile()) return null;
  return { path: objectPath, byteLength: details.size };
}

async function resolveStorage(runner: LfsRunner, cwd: string): Promise<string | null> {
  for (const args of [
    ['config', '--path', '--get', 'lfs.storage'],
    ['rev-parse', '--git-path', 'lfs/objects'],
  ]) {
    try {
      const raw = (await runner.run(args, readOptions(cwd, 4_096))).stdout.trim();
      if (raw) {
        const root = isAbsolute(raw) ? raw : resolve(cwd, raw);
        return args[0] === 'config' ? join(root, 'objects') : root;
      }
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
    }
  }
  return null;
}

async function ensureCommit(runner: LfsRunner, input: ReadLfsFileInput): Promise<void> {
  try {
    await runner.run(['cat-file', '-e', `${input.commitId}^{commit}`], readOptions(input.cwd, 1_024));
  } catch (error) {
    if (error instanceof GitCommandError) throw new LfsRevisionNotFoundError();
    throw error;
  }
}

function readOptions(cwd: string, maxOutputBytes: number): GitRunOptions {
  return { cwd, timeoutMs: lfsReadTimeoutMs, maxOutputBytes, env: { GIT_NO_LAZY_FETCH: '1' } };
}

function inside(root: string, path: string) {
  const local = relative(root, path);
  return !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`);
}

async function validateDestination(
  runner: LfsRunner,
  cwd: string,
  worktree: string | null,
  destination: string,
) {
  const parent = await realpath(dirname(destination));
  const target = join(parent, basename(destination));
  const common = (await runner.run(['rev-parse', '--git-common-dir'], readOptions(cwd, 32768))).stdout.trim();
  for (const root of [worktree, resolve(cwd, common)]) {
    if (root && inside(await realpath(root), target))
      throw new LfsPayloadError('Save the historical payload outside the working tree and Git directory.');
  }
  const info = await lstat(target).catch(() => undefined);
  if (info && (!info.isFile() || info.nlink > 1))
    throw new LfsPayloadError('Choose a regular destination without symbolic or hard links.');
  return target;
}

function parseSize(value: string): number {
  if (!/^\d+$/u.test(value)) throw new LfsPathError('Git returned an invalid LFS file size.');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0 || size > 1_000_000_000_000)
    throw new LfsPathError('Git returned an unsupported LFS file size.');
  return size;
}

function validatePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new LfsPathError('The LFS path is not a normalized repository-relative file.');
  }
}
