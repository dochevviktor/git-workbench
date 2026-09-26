import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepositoryPatchPreview } from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import { GitCommandError, redactUrlCredentials } from '../git/runner';
import type { GitRunner } from '../git/runner';

const limit = 8 * 1024 * 1024;

/** A format-patch mailbox becomes one staged delta; it never creates commits or advances HEAD. */
async function mailboxDelta(
  runner: Pick<GitRunner, 'run'>,
  cwd: string,
  bytes: Buffer,
): Promise<{ bytes: Buffer; count: number }> {
  const boundaries = [
    ...bytes.toString('latin1').matchAll(/^From (?:[0-9a-f]{40}|[0-9a-f]{64}) Mon Sep 17 .+$/gmu),
  ].map((match) => match.index);
  if (boundaries.length < 2) return { bytes, count: 1 };
  if (bytes.subarray(0, boundaries[0]).toString('utf8').trim())
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      'The mailbox has content before its first commit patch.',
    );
  if (boundaries.length > 100)
    throw new ExpectedBackendError('INVALID_REQUEST', 'Import at most 100 patches in a mailbox.');
  const parts = boundaries.map((start, index) =>
    bytes.subarray(start, boundaries[index + 1] ?? bytes.length),
  );
  for (const part of parts) await validatePatch(runner, cwd, part);
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-patch-series-'));
  const indexFile = join(directory, 'index');
  const options = { cwd, indexFile, timeoutMs: 10_000, maxOutputBytes: limit };
  try {
    await runner.run(['read-tree', '--empty'], options);
    const entries = await runner.run(['ls-files', '--stage', '-z'], {
      cwd,
      maxOutputBytes: limit,
      stdoutEncoding: 'base64',
    });
    await runner.run(['update-index', '-z', '--index-info'], {
      ...options,
      stdin: Buffer.from(entries.stdout, 'base64'),
    });
    const base = (await runner.run(['write-tree'], options)).stdout.trim();
    for (const [index, part] of parts.entries()) {
      try {
        await runner.run(['apply', '--cached', '--3way', '--whitespace=nowarn', '-'], {
          ...options,
          stdin: part,
        });
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error;
        throw new ExpectedBackendError(
          'INVALID_REQUEST',
          `Mailbox patch ${index + 1} of ${parts.length} could not be applied. Import and resolve it separately. The index and working files are unchanged.\n${error.stderr}`,
        );
      }
    }
    const tree = (await runner.run(['write-tree'], options)).stdout.trim();
    const patch = await runner.run(
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--binary',
        '--full-index',
        '--find-renames',
        '--no-color',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        base,
        tree,
        '--',
      ],
      { ...options, stdoutEncoding: 'base64' },
    );
    const delta = Buffer.from(patch.stdout, 'base64');
    if (!delta.length)
      throw new ExpectedBackendError('INVALID_REQUEST', 'This mailbox has no net changes to apply.');
    return { bytes: checkedPatch(delta), count: parts.length };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function readPatchFile(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile())
      throw new ExpectedBackendError('INVALID_REQUEST', 'Choose a regular patch file.');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    return checkedPatch(Buffer.from(bytes.subarray(0, size)));
  } finally {
    await file.close();
  }
}

export function checkedPatch(bytes: Buffer): Buffer {
  if (!bytes.length || bytes.length > limit)
    throw new ExpectedBackendError('INVALID_REQUEST', 'Choose a nonempty patch no larger than 8 MiB.');
  return bytes;
}

function safePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-z]:/iu.test(path) ||
    (process.platform === 'win32' && /[\\\r\n]/u.test(path)) ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '..' || part === '.' || part.toLowerCase() === '.git')
  )
    throw new ExpectedBackendError('INVALID_REQUEST', 'The patch contains an unsafe or unsupported path.');
}

function headerPath(value: string): string {
  if (!value.startsWith('"')) return value.split('\t')[0]!;
  // Git quotes paths as C strings, including UTF-8 octal bytes.
  const bytes: number[] = [];
  const quoted = /^"((?:[^"\\]|\\.)*)"/u.exec(value)?.[1];
  if (quoted === undefined) throw new ExpectedBackendError('INVALID_REQUEST', 'Invalid quoted patch path.');
  for (let i = 0; i < quoted.length; i++) {
    if (quoted[i] !== '\\') {
      const point = quoted.codePointAt(i)!;
      bytes.push(...Buffer.from(String.fromCodePoint(point)));
      if (point > 0xffff) i++;
      continue;
    }
    const octal = /^[0-7]{1,3}/u.exec(quoted.slice(i + 1))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8));
      i += octal.length;
    } else {
      const char = quoted[++i]!;
      bytes.push(...Buffer.from(({ t: '\t', n: '\n', r: '\r' } as Record<string, string>)[char] ?? char));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Checks Git's parsed paths as well as original headers before allowing Git to strip prefixes. */
export async function validatePatch(
  runner: Pick<GitRunner, 'run'>,
  cwd: string,
  bytes: Buffer,
): Promise<void> {
  const text = bytes.toString('utf8');
  if (/^(?:old mode|new mode|new file mode|deleted file mode|index .*) (?:120000|160000)$/mu.test(text))
    throw new ExpectedBackendError('INVALID_REQUEST', 'Symlink and submodule patches are not supported.');
  let oldRemaining = 0;
  let newRemaining = 0;
  const headerPaths = new Set<string>();
  for (const line of text.split('\n')) {
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith(' ') || line.startsWith('-')) oldRemaining--;
      if (line.startsWith(' ') || line.startsWith('+')) newRemaining--;
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u.exec(line);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      continue;
    }
    if (line.startsWith('diff --git ') && !/^diff --git (?:"a\/|a\/).+ (?:"b\/|b\/)/u.test(line))
      throw new ExpectedBackendError(
        'INVALID_REQUEST',
        'Use a Git patch with relative a/ and b/ path prefixes.',
      );
    if (/^(?:--- |\+\+\+ |rename from |rename to |copy from |copy to )/u.test(line)) {
      const value = headerPath(
        line.replace(/^(?:--- |\+\+\+ |rename from |rename to |copy from |copy to )/u, ''),
      );
      if (value !== '/dev/null') {
        safePath(value);
        headerPaths.add(/^(?:--- |\+\+\+ )/u.test(line) ? value.replace(/^[ab]\//u, '') : value);
      }
    }
  }
  const result = await runner.run(['apply', '--numstat', '-z', '-'], {
    cwd,
    stdin: bytes,
    maxOutputBytes: 1024 * 1024,
    timeoutMs: 10000,
  });
  const paths = result.stdout
    .split('\0')
    .filter(Boolean)
    .map((line) => line.replace(/^[^\t]*\t[^\t]*\t/u, ''));
  if (!paths.length || paths.length > 1000)
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      'The patch must contain between 1 and 1,000 file changes.',
    );
  for (const path of new Set([...paths, ...headerPaths])) {
    safePath(path);
    let current = cwd;
    for (const part of path.split('/')) {
      current = join(current, part);
      const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (info?.isSymbolicLink())
        throw new ExpectedBackendError('INVALID_REQUEST', 'Patch paths must not follow symbolic links.');
    }
  }
}

interface Entry {
  readonly owner: number;
  readonly id: string;
  readonly bytes: Buffer;
  readonly snapshot: string;
  readonly expires: number;
  readonly preview: RepositoryPatchPreview;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class PatchPreviews {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<{
    owner: number;
    id: string;
    cancelled: boolean;
    controller: AbortController;
  }>();
  async prepare(
    runner: Pick<GitRunner, 'run'>,
    owner: number,
    id: string,
    cwd: string,
    bytes: Buffer,
    location: string,
    snapshot: string,
  ): Promise<RepositoryPatchPreview> {
    checkedPatch(bytes);
    this.prune();
    if (this.entries.size + this.pending.size >= 16)
      throw new ExpectedBackendError('UNAVAILABLE', 'Close an existing patch preview first.');
    const pending = { owner, id, cancelled: false, controller: new AbortController() };
    this.pending.add(pending);
    const originalRunner = runner;
    runner = {
      run: (args, options) => originalRunner.run(args, { ...options, signal: pending.controller.signal }),
    };
    const deadline = setTimeout(() => pending.controller.abort(), 20_000);
    try {
      let state: RepositoryPatchPreview['state'] = 'clean';
      let message = 'Patch can be applied without conflicts';
      const sourceByteLength = bytes.length;
      try {
        const mailbox = await mailboxDelta(runner, cwd, bytes);
        bytes = mailbox.bytes;
        if (mailbox.count > 1)
          message = `${mailbox.count} patches can be applied and staged together without creating commits`;
        await validatePatch(runner, cwd, bytes);
      } catch (error) {
        if (!(error instanceof ExpectedBackendError || error instanceof GitCommandError)) throw error;
        state = 'invalid';
        message = error instanceof GitCommandError ? error.stderr || 'No valid patch found.' : error.message;
      }
      if (state !== 'invalid') {
        try {
          await runner.run(['apply', '--check', '--index', '--whitespace=nowarn', '-'], {
            cwd,
            stdin: bytes,
            timeoutMs: 10000,
          });
        } catch (error) {
          if (!(error instanceof GitCommandError)) throw error;
          state = 'warning';
          message = 'Patch may conflict. Apply will attempt a three-way merge.\n' + error.stderr;
        }
      }
      const preview = {
        token: randomUUID(),
        location,
        state,
        message: redactUrlCredentials(message).slice(0, 4096),
        byteLength: sourceByteLength,
      };
      if (pending.cancelled)
        throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The patch preview was closed.');
      const timer = setTimeout(() => this.entries.delete(preview.token), 10 * 60_000);
      timer.unref();
      this.entries.set(preview.token, {
        owner,
        id,
        bytes,
        snapshot,
        preview,
        timer,
        expires: Date.now() + 10 * 60_000,
      });
      return preview;
    } finally {
      clearTimeout(deadline);
      this.pending.delete(pending);
    }
  }
  take(owner: number, id: string, token: string): Entry {
    this.prune();
    const entry = this.entries.get(token);
    if (!entry || entry.owner !== owner || entry.id !== id)
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'The patch preview expired. Select the patch again.');
    this.entries.delete(token);
    clearTimeout(entry.timer);
    if (entry.preview.state === 'invalid')
      throw new ExpectedBackendError('INVALID_REQUEST', entry.preview.message);
    return entry;
  }
  release(owner: number, id?: string, token?: string): void {
    if (!token)
      for (const pending of this.pending)
        if (pending.owner === owner && (!id || pending.id === id)) {
          pending.cancelled = true;
          pending.controller.abort();
        }
    for (const [key, entry] of this.entries)
      if (entry.owner === owner && (!id || entry.id === id) && (!token || key === token)) {
        clearTimeout(entry.timer);
        this.entries.delete(key);
      }
  }
  clear(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    for (const pending of this.pending) {
      pending.cancelled = true;
      pending.controller.abort();
    }
    this.entries.clear();
  }
  private prune(): void {
    for (const [key, entry] of this.entries)
      if (entry.expires < Date.now()) {
        clearTimeout(entry.timer);
        this.entries.delete(key);
      }
  }
}
