import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { imageFromBytes } from '../../src/backend/repositories/image-diff-service';
import { readRepositoryDiff } from '../../src/backend/repositories/diff-service';
import { readRevisionBlob } from '../../src/backend/repositories/revision-service';
import { GitRunner } from '../../src/backend/git/runner';
import { bmpFixture, gifFixture, pngFixture, svgFixture, tgaFixture } from '../helpers/image-fixture';
import { lfsPointer } from '../helpers/lfs-fixture';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe('P10 additional image formats and local LFS pixels', () => {
  it('bounds BMP, GIF, TGA and SVG and normalizes TGA origins/RLE with identical pixels', () => {
    expect(imageFromBytes(bmpFixture())).toMatchObject({
      state: 'ready',
      mime: 'image/bmp',
      width: 32,
      height: 24,
    });
    expect(imageFromBytes(gifFixture())).toMatchObject({
      state: 'ready',
      mime: 'image/gif',
      width: 1,
      height: 1,
    });
    expect(imageFromBytes(svgFixture())).toMatchObject({
      state: 'ready',
      mime: 'image/svg+xml',
      width: 160,
      height: 120,
    });
    expect(imageFromBytes(tgaFixture(), 'sample.tga')).toEqual(
      imageFromBytes(tgaFixture(true), 'sample.tga'),
    );
    const bomb = bmpFixture();
    bomb.writeInt32LE(8192, 18);
    bomb.writeInt32LE(8192, 22);
    expect(imageFromBytes(bomb).state).toBe('too-large');
    const gif = gifFixture();
    gif.writeUInt16LE(65535, 6);
    expect(imageFromBytes(gif).state).toBe('too-large');
    expect(imageFromBytes(tgaFixture().subarray(0, 20), 'sample.tga').state).toBe('unavailable');
    for (const svg of [
      '<svg width="20" height="20" onload="alert(1)"/>',
      '<svg width="20" height="20"><image href="file:///private"/></svg>',
      '<svg width="20" height="20"><foreignObject/></svg>',
      '<svg width="20" height="20"><use href="#cycle" id="cycle"/></svg>',
    ])
      expect(imageFromBytes(Buffer.from(svg)).state).toBe('unsupported');
  });
  it('strips WebP metadata, bounds declared frames, rejects animation and mismatched frame dimensions', () => {
    const riff = (chunks: Buffer[]) => {
      const header = Buffer.from('RIFF0000WEBP');
      header.writeUInt32LE(4 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4);
      return Buffer.concat([header, ...chunks]);
    };
    const chunk = (name: string, data: Buffer) => {
      const header = Buffer.alloc(8);
      header.write(name);
      header.writeUInt32LE(data.length, 4);
      return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.from([0])] : [])]);
    };
    const pixels = chunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0]));
    const clean = riff([pixels]);
    expect(imageFromBytes(riff([pixels, chunk('EXIF', Buffer.from('metadata'))]))).toEqual(
      imageFromBytes(clean),
    );
    expect(imageFromBytes(clean)).toMatchObject({ state: 'ready', width: 1, height: 1, mime: 'image/webp' });
    expect(imageFromBytes(riff([chunk('ANIM', Buffer.alloc(6)), pixels])).state).toBe('unsupported');
    const dimensions = Buffer.alloc(10);
    dimensions.writeUIntLE(100, 4, 3);
    expect(imageFromBytes(riff([chunk('VP8X', dimensions), pixels])).state).toBe('unavailable');
    expect(imageFromBytes(clean.subarray(0, -1)).state).toBe('unavailable');
  });
  it('compares exact cached historical LFS images and preserves missing payloads without executing LFS or downloading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-p10-image-'));
    roots.push(root);
    const runner = new GitRunner();
    const commands: string[][] = [];
    const git = {
      run: (args: readonly string[], options: Parameters<typeof runner.run>[1]) => {
        commands.push([...args]);
        return runner.run(args, options);
      },
    };
    const run = (args: string[]) => git.run(args, { cwd: root });
    const repositoryId = `repo-${'a'.repeat(64)}`;
    await run(['init', '-q']);
    await run(['config', 'user.name', 'Image']);
    await run(['config', 'user.email', 'images@example.invalid']);
    const old = pngFixture(),
      next = pngFixture(160, 120, true);
    const cache = async (bytes: Buffer) => {
      const oid = createHash('sha256').update(bytes).digest('hex');
      const dir = join(root, '.git/lfs/objects', oid.slice(0, 2), oid.slice(2, 4));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, oid), bytes);
      return join(dir, oid);
    };
    await cache(old);
    const nextCache = await cache(next);
    await writeFile(join(root, 'image.png'), lfsPointer(old));
    await writeFile(join(root, 'shape.svg'), svgFixture());
    await run(['add', '.']);
    await run(['commit', '-qm', 'old']);
    await writeFile(join(root, 'image.png'), lfsPointer(next));
    await run(['add', '.']);
    await run(['commit', '-qm', 'new']);
    const head = (await run(['rev-parse', 'HEAD'])).stdout.trim();
    const request = {
      repositoryId,
      cwd: root,
      target: { kind: 'commit' as const, commitId: head, path: 'image.png', previousPath: null },
      whitespace: 'normal' as const,
      options: { includeImages: true },
    };
    expect((await readRepositoryDiff(git, request)).images).toEqual({
      before: { ...imageFromBytes(old), byteLength: old.length },
      after: { ...imageFromBytes(next), byteLength: next.length },
    });
    await rm(nextCache);
    expect((await readRepositoryDiff(git, request)).images?.after).toEqual({ state: 'unavailable' });
    expect(commands.some((args) => args[0] === 'lfs')).toBe(false);
    expect(await readFile(join(root, 'image.png'), 'utf8')).toBe(lfsPointer(next));
    expect(
      (await readRevisionBlob(git, { repositoryId, cwd: root, commitId: head, path: 'shape.svg' })).image,
    ).toMatchObject({ state: 'ready', mime: 'image/svg+xml' });
    expect((await run(['status', '--porcelain'])).stdout).toBe('');
    await run(['mv', 'shape.svg', 'renamed.svg']);
    const renamed = await readRepositoryDiff(git, {
      ...request,
      target: { kind: 'working', area: 'staged', path: 'renamed.svg', previousPath: 'shape.svg' },
    });
    expect(renamed.images).toEqual({
      before: imageFromBytes(svgFixture()),
      after: imageFromBytes(svgFixture()),
    });
    expect(renamed.binaryMetadata).toEqual({
      beforeBytes: svgFixture().length,
      afterBytes: svgFixture().length,
    });
  });
});
