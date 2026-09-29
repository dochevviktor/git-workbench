import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitCancelledError, GitRunner } from '../../src/backend/git/runner';
import {
  imageFromBytes,
  readDiffImages,
  imageByteLimit,
} from '../../src/backend/repositories/image-diff-service';
import { readRepositoryDiff } from '../../src/backend/repositories/diff-service';
import { repositoryImageSideSchema } from '../../src/common/ipc/contracts';
import type { RepositoryDiffTarget } from '../../src/common/ipc/contracts';
import { compareImagePixels } from '../../src/frontend/react/lib/image-comparison';
import { pngChunk, pngFixture } from '../helpers/image-fixture';

const roots: string[] = [];
const repositoryId = `repo-${'a'.repeat(64)}`;
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-images-'));
  roots.push(root);
  const git = new GitRunner();
  const run = (args: string[]) => git.run(args, { cwd: root });
  await run(['init', '-q']);
  await run(['config', 'user.name', 'Image Test']);
  await run(['config', 'user.email', 'images@test.invalid']);
  const diff = (target: RepositoryDiffTarget) =>
    readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { includeImages: true },
    });
  return { root, git, run, diff };
}
const working = (
  area: 'unstaged' | 'staged' | 'untracked' | 'ignored',
  path = 'image.png',
  previousPath: string | null = null,
): RepositoryDiffTarget => ({ kind: 'working', area, path, previousPath });

describe('F27 image diff', () => {
  it('reads the correct immutable/index/worktree bytes, root additions, amendments and deletions without writing Git', async () => {
    const { root, run, diff } = await fixture();
    const old = pngFixture();
    const staged = pngFixture(160, 120, true);
    const local = pngFixture(80, 90, true);
    await writeFile(join(root, 'image.png'), old);
    await run(['add', '.']);
    await run(['commit', '-qm', 'root']);
    const rootId = (await run(['rev-parse', 'HEAD'])).stdout.trim();
    const added = await diff({ kind: 'commit', commitId: rootId, path: 'image.png', previousPath: null });
    expect(added.images).toEqual({ before: { state: 'missing' }, after: imageFromBytes(old) });
    await writeFile(join(root, 'image.png'), staged);
    await run(['add', '.']);
    await writeFile(join(root, 'image.png'), local);
    const status = (await run(['status', '--porcelain=v2'])).stdout;
    const index = (await run(['ls-files', '--stage'])).stdout;
    expect((await diff(working('staged'))).images).toEqual({
      before: imageFromBytes(old),
      after: imageFromBytes(staged),
    });
    const unstaged = await diff(working('unstaged'));
    expect(unstaged.images).toEqual({ before: imageFromBytes(staged), after: imageFromBytes(local) });
    expect(unstaged.binaryMetadata).toEqual({ beforeBytes: staged.length, afterBytes: local.length });
    expect((await diff({ kind: 'amend', path: 'image.png', previousPath: null })).images).toEqual({
      before: { state: 'missing' },
      after: imageFromBytes(staged),
    });
    expect((await run(['status', '--porcelain=v2'])).stdout).toBe(status);
    expect((await run(['ls-files', '--stage'])).stdout).toBe(index);
    await run(['commit', '-qm', 'second']);
    const id = (await run(['rev-parse', 'HEAD'])).stdout.trim();
    expect(
      (await diff({ kind: 'commit', commitId: id, path: 'image.png', previousPath: null })).images,
    ).toEqual({ before: imageFromBytes(old), after: imageFromBytes(staged) });
    await unlink(join(root, 'image.png'));
    expect((await diff(working('unstaged'))).images).toEqual({
      before: imageFromBytes(staged),
      after: { state: 'missing' },
    });
    await run(['add', '-u']);
    expect((await diff(working('staged'))).images?.after).toEqual({ state: 'missing' });
  });

  it('handles untracked, ignored, unusual paths, and a changed rename', async () => {
    const { root, run, diff } = await fixture();
    const path = '-snow ☃\n.png';
    const png = pngFixture();
    await writeFile(join(root, path), png);
    expect((await diff(working('untracked', path))).images).toEqual({
      before: { state: 'missing' },
      after: imageFromBytes(png),
    });
    await writeFile(join(root, '.gitignore'), '*.ignored\n');
    await writeFile(join(root, 'sample.ignored'), png);
    expect((await diff(working('ignored', 'sample.ignored'))).images?.after).toEqual(imageFromBytes(png));
    await run(['add', '--', path]);
    await run(['commit', '-qm', 'base']);
    await rename(join(root, path), join(root, 'image.png'));
    // Add ancillary metadata to retain rename similarity while changing raw content.
    await writeFile(
      join(root, 'image.png'),
      Buffer.concat([
        png.subarray(0, -12),
        pngChunk('tEXt', Buffer.from('note\0changed')),
        png.subarray(-12),
      ]),
    );
    await run(['add', '-A']);
    const renamed = await diff(working('staged', 'image.png', path));
    expect(renamed.images).toEqual({ before: imageFromBytes(png), after: imageFromBytes(png) });
  });

  it('bounds byte and pixel reads and preserves unsupported content as metadata', async () => {
    const { root, diff } = await fixture();
    await writeFile(join(root, 'image.png'), Buffer.alloc(imageByteLimit + 1));
    expect((await diff(working('untracked'))).images?.after).toEqual({ state: 'too-large' });
    const huge = pngFixture();
    huge.writeUInt32BE(9000, 16);
    expect(imageFromBytes(huge)).toEqual({ state: 'too-large' });
    huge.writeUInt32BE(3000, 16);
    huge.writeUInt32BE(3000, 20);
    expect(imageFromBytes(huge)).toEqual({ state: 'too-large' });
    expect(imageFromBytes(Buffer.from('<svg onload="alert(1)"></svg>'))).toEqual({ state: 'unsupported' });
    expect(imageFromBytes(pngFixture().subarray(0, 40))).toEqual({ state: 'unavailable' });
    const png = pngFixture();
    expect(
      imageFromBytes(
        Buffer.concat([png.subarray(0, 33), pngChunk('acTL', Buffer.alloc(8)), png.subarray(33)]),
      ),
    ).toEqual({ state: 'unsupported' });
    await writeFile(join(root, 'image.png'), Buffer.from([0, 1, 2, 3]));
    expect((await diff(working('untracked'))).images?.after).toEqual({ state: 'unsupported' });
  });

  it('refuses symlink content, escaped parent directories and ambiguous multiple patches', async () => {
    const { root, git } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'git-workbench-image-outside-'));
    roots.push(outside);
    await writeFile(join(outside, 'image.png'), pngFixture());
    await symlink(join(outside, 'image.png'), join(root, 'image.png'));
    const patch = `diff --git a/image.png b/image.png\nindex ${'0'.repeat(40)}..${'0'.repeat(40)}\n`;
    const input = { repositoryId, cwd: root, target: working('untracked'), whitespace: 'normal' as const };
    expect((await readDiffImages(git, input, patch)).after.state).toBe('unavailable');
    await symlink(outside, join(root, 'linked'));
    expect(
      (await readDiffImages(git, { ...input, target: working('untracked', 'linked/image.png') }, patch)).after
        .state,
    ).toBe('unavailable');
    expect((await readDiffImages(git, input, patch + patch)).before.state).toBe('unavailable');
    await mkdir(join(root, 'directory'));
    expect(
      (await readDiffImages(git, { ...input, target: working('untracked', 'directory') }, patch)).after.state,
    ).toBe('unsupported');
  });

  it('propagates cancellation of a blob read and rejects unbounded or executable image DTOs', async () => {
    const runner = { run: vi.fn().mockRejectedValue(new GitCancelledError()) };
    await expect(
      readDiffImages(
        runner,
        {
          repositoryId,
          cwd: '/unused',
          target: { kind: 'commit', commitId: 'a'.repeat(40), path: 'image.png', previousPath: null },
          whitespace: 'normal',
        },
        `diff --git a/image.png b/image.png\nindex ${'a'.repeat(40)}..${'b'.repeat(40)}\n`,
      ),
    ).rejects.toBeInstanceOf(GitCancelledError);
    const ready = imageFromBytes(pngFixture());
    expect(repositoryImageSideSchema.safeParse({ ...ready, mime: 'text/html' }).success).toBe(false);
    expect(repositoryImageSideSchema.safeParse({ ...ready, width: 8192, height: 8192 }).success).toBe(false);
    expect(repositoryImageSideSchema.safeParse({ ...ready, base64: 'file:///etc/passwd' }).success).toBe(
      false,
    );
  });

  it('compares alpha and dimension changes without silently stretching either side', () => {
    const before = { width: 1, height: 1, data: new Uint8ClampedArray([20, 30, 40, 255]) };
    expect(compareImagePixels(before, before).changed).toBe(0);
    expect(
      compareImagePixels(before, { ...before, data: new Uint8ClampedArray([20, 30, 40, 128]) }).changed,
    ).toBe(1);
    expect(
      compareImagePixels(before, {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([20, 30, 40, 255, 0, 0, 0, 0]),
      }).changed,
    ).toBe(1);
    expect(() =>
      compareImagePixels(
        { width: 8192, height: 1, data: new Uint8ClampedArray() },
        { width: 1, height: 8192, data: new Uint8ClampedArray() },
      ),
    ).toThrow('4 megapixels');
  });

  it('checks JPEG frames across scans and strips metadata before sandboxed decoding', () => {
    const segment = (marker: number, contents: number[]) => {
      const result = Buffer.alloc(contents.length + 4);
      result[0] = 0xff;
      result[1] = marker;
      result.writeUInt16BE(contents.length + 2, 2);
      result.set(contents, 4);
      return result;
    };
    // Header-level fixture; real JPEG decoding is exercised in the Electron scenario.
    const start = Buffer.from([0xff, 0xd8]);
    const frame = segment(0xc2, [8, 0, 10, 0, 20, 1, 1, 0x11, 0]);
    const scan = segment(0xda, [1, 1, 0, 0, 63, 0]);
    const end = Buffer.from([0xff, 0xd9]);
    const body = Buffer.from([23, 0xff, 0, 17, 0xff, 0xd0, 42]);
    const clean = Buffer.concat([start, frame, scan, body, scan, body, end]);
    const metadata = segment(0xe1, [69, 88, 73, 70, 0]);
    const tagged = Buffer.concat([start, metadata, frame, scan, body, metadata, scan, body, end]);
    expect(imageFromBytes(tagged)).toEqual({
      state: 'ready',
      mime: 'image/jpeg',
      width: 20,
      height: 10,
      base64: clean.toString('base64'),
    });
    expect(imageFromBytes(Buffer.concat([start, frame, scan, body, frame, end]))).toEqual({
      state: 'unavailable',
    });
    expect(imageFromBytes(Buffer.concat([start, frame, scan, body, segment(0xdc, [20, 20]), end]))).toEqual({
      state: 'unsupported',
    });
    expect(imageFromBytes(clean.subarray(0, -2))).toEqual({ state: 'unavailable' });
  });
});
