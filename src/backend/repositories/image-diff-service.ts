import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { RepositoryImageSide } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitOutputLimitError } from '../git/runner';
import type { DiffRunner, ReadRepositoryDiffInput } from './diff-service';

export const imageByteLimit = 4 * 1024 * 1024;
const pixelLimit = 4_194_304;

/** Inspect before decoding. Only static PNG and JPEG bytes ever reach a raster decoder. */
export function imageFromBytes(bytes: Buffer): RepositoryImageSide {
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
  } else return { state: 'unsupported' };
  if (!width || !height) return { state: 'unavailable' };
  if (width > 8192 || height > 8192 || width * height > pixelLimit) return { state: 'too-large' };
  return { state: 'ready', mime, width, height, base64: bytes.toString('base64') };
}

export async function readDiffImages(
  runner: DiffRunner,
  input: ReadRepositoryDiffInput,
  content: string,
): Promise<{ before: RepositoryImageSide; after: RepositoryImageSide }> {
  const indexes = [...content.matchAll(/^index ([a-f0-9]+)\.\.([a-f0-9]+)/gmu)];
  // Multi-parent/multi-patch diffs must not present an arbitrary pair as the whole diff.
  if (indexes.length !== 1 || (content.match(/^diff --git /gmu)?.length ?? 0) !== 1)
    return { before: { state: 'unavailable' }, after: { state: 'unavailable' } };
  const index = indexes[0]!;
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
      return imageFromBytes(Buffer.from(result.stdout, 'base64'));
    } catch (error) {
      if (error instanceof GitOutputLimitError) return { state: 'too-large' };
      if (error instanceof GitCommandError) return { state: 'unavailable' };
      throw error;
    }
  };
  const before = await blob(index[1]!);
  const after =
    input.target.kind === 'working' && input.target.area !== 'staged'
      ? await workingImage(input)
      : await blob(index[2]!);
  if (input.signal?.aborted) throw new GitCancelledError();
  return { before, after };
}

async function workingImage(input: ReadRepositoryDiffInput): Promise<RepositoryImageSide> {
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
      return imageFromBytes(buffer.subarray(0, count));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof GitCancelledError) throw error;
    return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}
