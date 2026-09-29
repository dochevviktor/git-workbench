import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { RepositoryImageSide } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitOutputLimitError } from '../git/runner';
import type { DiffRunner, ReadRepositoryDiffInput } from './diff-service';
import { additionalImage } from './additional-image-formats';
import { locatePayload, parseLfsPointer } from './lfs-service';
import { createHash } from 'node:crypto';

export const imageByteLimit = 4 * 1024 * 1024;
const pixelLimit = 4_194_304;

/** Inspect before decoding. Additional formats normalize or use the restricted image-only path. */
export function imageFromBytes(bytes: Buffer, path = ''): RepositoryImageSide {
  if (bytes.length > imageByteLimit) return { state: 'too-large' };
  let width = 0;
  let height = 0;
  let mime: 'image/png' | 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = 'image/png';
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')
      return { state: 'unavailable' };
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    // Strip metadata and reject animation/duplicate headers. Keep only raster-bearing chunks;
    // no compressed text/ICC metadata is passed to Chromium's decoder.
    const chunks = [bytes.subarray(0, 8)];
    let ended = false;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) return { state: 'unavailable' };
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      const end = offset + 12 + length;
      if (end > bytes.length || (type === 'IHDR' && offset !== 8)) return { state: 'unavailable' };
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return { state: 'unsupported' };
      if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.subarray(offset, end));
      else if (type[0] === type[0]?.toUpperCase()) return { state: 'unsupported' };
      offset = end;
      if (type === 'IEND') {
        ended = length === 0 && offset === bytes.length;
        break;
      }
    }
    if (!ended) return { state: 'unavailable' };
    bytes = Buffer.concat(chunks);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg';
    // Baseline/progressive JPEG only. Ignore orientation/ICC/EXIF metadata, preserving an
    // unrotated pixel coordinate system and bounding decoding by the SOF dimensions.
    const chunks = [bytes.subarray(0, 2)];
    let scanned = false;
    let ended = false;
    for (let offset = 2; offset < bytes.length;) {
      const start = offset;
      if (bytes[offset++] !== 0xff) return { state: 'unavailable' };
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        ended = offset === bytes.length;
        chunks.push(bytes.subarray(start, offset));
        break;
      }
      if (marker === undefined || offset + 2 > bytes.length) return { state: 'unavailable' };
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return { state: 'unavailable' };
      if (marker === 0xc0 || marker === 0xc2) {
        if (width || length < 8 || bytes[offset + 2] !== 8) return { state: 'unavailable' };
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
      } else if (![0xc4, 0xdb, 0xdd, 0xda, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) {
        return { state: 'unsupported' };
      }
      if (marker === 0xda) {
        if (!width || !height) return { state: 'unavailable' };
        scanned = true;
      }
      if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe)
        chunks.push(bytes.subarray(start, offset + length));
      offset += length;
      if (marker === 0xda) {
        const entropyStart = offset;
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xff) {
            offset++;
            continue;
          }
          const next = bytes[offset + 1];
          if (next === 0 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
            offset += 2;
            continue;
          }
          break;
        }
        chunks.push(bytes.subarray(entropyStart, offset));
      }
    }
    if (!scanned || !ended) return { state: 'unavailable' };
    bytes = Buffer.concat(chunks);
  } else return additionalImage(bytes, path);
  if (!width || !height) return { state: 'unavailable' };
  if (width > 8192 || height > 8192 || width * height > pixelLimit) return { state: 'too-large' };
  return { state: 'ready', mime, width, height, base64: bytes.toString('base64') };
}

export async function readDiffImages(
  runner: DiffRunner,
  input: ReadRepositoryDiffInput,
  content: string,
): Promise<{ before: RepositoryImageSide; after: RepositoryImageSide }> {
  const ids = await readDiffBlobIds(runner, input, content);
  if (!ids) return { before: { state: 'unavailable' }, after: { state: 'unavailable' } };
  const blob = async (id: string): Promise<RepositoryImageSide> => {
    if (/^0+$/u.test(id)) return { state: 'missing' };
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(id)) return { state: 'unavailable' };
    try {
      const result = await runner.run(['cat-file', 'blob', id], {
        cwd: input.cwd,
        signal: input.signal,
        timeoutMs: 10_000,
        maxOutputBytes: imageByteLimit,
        stdoutEncoding: 'base64',
        env: { GIT_NO_LAZY_FETCH: '1' },
      });
      return resolveLfsImage(runner, input, Buffer.from(result.stdout, 'base64'));
    } catch (error) {
      if (error instanceof GitOutputLimitError) return { state: 'too-large' };
      if (error instanceof GitCommandError) return { state: 'unavailable' };
      throw error;
    }
  };
  const before = await blob(ids.before);
  const after =
    input.target.kind === 'working' && input.target.area !== 'staged'
      ? await workingImage(runner, input)
      : await blob(ids.after);
  if (input.signal?.aborted) throw new GitCancelledError();
  return { before, after };
}

export async function readDiffBlobIds(
  runner: DiffRunner,
  input: ReadRepositoryDiffInput,
  content: string,
): Promise<{ before: string; after: string } | undefined> {
  // Multi-parent/multi-patch diffs must not present an arbitrary pair as the whole diff.
  if ((content.match(/^diff --git /gmu)?.length ?? 0) !== 1) return undefined;
  const indexes = [...content.matchAll(/^index ([a-f0-9]+)\.\.([a-f0-9]+)/gmu)];
  if (indexes.length === 1) return { before: indexes[0]![1]!, after: indexes[0]![2]! };
  if (indexes.length || !/^similarity index 100%$/mu.test(content) || !input.target.previousPath)
    return undefined;
  // Rename-only patches omit their index line. Both sides are the exact new-path blob in this case.
  const object = `${input.target.kind === 'commit' ? input.target.commitId : ''}:${input.target.path}`;
  try {
    const id = (
      await runner.run(['rev-parse', '--verify', '--end-of-options', object], {
        cwd: input.cwd,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
        signal: input.signal,
        env: { GIT_NO_LAZY_FETCH: '1' },
      })
    ).stdout.trim();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(id) ? { before: id, after: id } : undefined;
  } catch (error) {
    if (error instanceof GitCommandError) return undefined;
    throw error;
  }
}

async function workingImage(
  runner: DiffRunner,
  input: ReadRepositoryDiffInput,
): Promise<RepositoryImageSide> {
  const path = resolve(input.cwd, input.target.path);
  try {
    const root = await realpath(input.cwd);
    const canonical = await realpath(path);
    const local = relative(root, canonical);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) return { state: 'unavailable' };
    const info = await lstat(path);
    if (!info.isFile()) return { state: 'unsupported' };
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      // On Linux verify the opened descriptor itself, closing the parent-symlink race.
      const openedPath =
        process.platform === 'linux' ? await realpath(`/proc/self/fd/${handle.fd}`) : await realpath(path);
      const openedLocal = relative(root, openedPath);
      if (isAbsolute(openedLocal) || openedLocal === '..' || openedLocal.startsWith(`..${sep}`))
        return { state: 'unavailable' };
      const details = await handle.stat();
      if (!details.isFile() || details.dev !== info.dev || details.ino !== info.ino)
        return { state: 'unavailable' };
      if (details.size > imageByteLimit) return { state: 'too-large' };
      const buffer = Buffer.alloc(Math.min(details.size + 1, imageByteLimit + 1));
      let count = 0;
      while (count < buffer.length) {
        if (input.signal?.aborted) throw new GitCancelledError();
        const read = await handle.read(buffer, count, buffer.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      const after = await handle.stat();
      if (count !== details.size || after.mtimeMs !== details.mtimeMs || after.size !== details.size)
        return { state: 'unavailable' };
      return resolveLfsImage(runner, input, buffer.subarray(0, count));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof GitCancelledError) throw error;
    return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}

async function resolveLfsImage(
  runner: DiffRunner,
  input: ReadRepositoryDiffInput,
  bytes: Buffer,
): Promise<RepositoryImageSide> {
  const pointer = bytes.length <= 1024 ? parseLfsPointer(bytes.toString('utf8')) : null;
  if (!pointer) return imageFromBytes(bytes, input.target.path);
  if (pointer.size > imageByteLimit) return { state: 'too-large' };
  const payload = await locatePayload(runner, input.cwd, pointer);
  if (!payload || payload.byteLength !== pointer.size) return { state: 'unavailable' };
  const file = await open(payload.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== pointer.size) return { state: 'unavailable' };
    const content = Buffer.alloc(pointer.size + 1);
    let count = 0;
    while (count < content.length) {
      if (input.signal?.aborted) throw new GitCancelledError();
      const result = await file.read(content, count, content.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    const value = content.subarray(0, count);
    if (count !== pointer.size || createHash('sha256').update(value).digest('hex') !== pointer.oid.slice(7))
      return { state: 'unavailable' };
    const image = imageFromBytes(value, input.target.path);
    return image.state === 'ready' ? { ...image, byteLength: pointer.size } : image;
  } finally {
    await file.close();
  }
}
