import { testPlatform } from '../platform';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { patchFixture } from '../patch-fixture';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { checkedPatch, readPatchFile } from '../../src/backend/repositories/patch-service';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';
import { requests, repositoryPatchApplyRequestSchema } from '../../src/common/ipc/contracts';
import type { RepositoryOperation } from '../../src/common/ipc/contracts';

const cleanups: (() => Promise<void>)[] = [];
async function fixture() {
  const f = await patchFixture();
  const service = new RepositoryService({ storagePath: join(f.root, 'recent.json'), runner: f.git });
  cleanups.push(async () => {
    service.dispose();
    await f.cleanup();
  });
  const { id } = await service.open(1, f.cwd);
  await service.setTrust(1, id, true);
  const preview = (bytes: Buffer = f.bytes) => service.previewPatch(1, id, bytes, f.path);
  const apply = async (token: string) => {
    const accepted = service.applyPatch(1, { id, token });
    let result: RepositoryOperation = accepted;
    await expect
      .poll(() => {
        result = service.listOperations(1).find((entry) => entry.id === accepted.id)!;
        return result.status;
      })
      .not.toBe('running');
    return result;
  };
  return { ...f, service, id, preview, apply };
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('F36 patch import and export', () => {
  it('preflights and cancels without changing Git, then stages exact mixed add/edit/rename bytes', async () => {
    const f = await fixture();
    const before = await f.snapshot();
    const first = await f.preview(await readPatchFile(f.path));
    expect(first.state).toBe('clean');
    expect(await f.snapshot()).toEqual(before);
    f.service.releasePatch(1, { id: f.id, token: first.token });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.apply(first.token)).toMatchObject({ status: 'failed' });
    const preview = await f.preview();
    // Application uses the bytes already reviewed, even if the original file changes.
    await writeFile(f.path, 'not a patch');
    expect(await f.apply(preview.token)).toMatchObject({ status: 'succeeded' });
    expect(await f.run('ls-files', '--stage')).toBe(f.index);
    const staged = Buffer.from(
      (
        await f.git.run(['diff', '--cached', '--binary', '--full-index'], {
          cwd: f.cwd,
          stdoutEncoding: 'base64',
        })
      ).stdout,
      'base64',
    );
    expect(staged.equals(f.bytes)).toBe(true);
    expect(await readFile(join(f.cwd, 'change.txt'), 'utf8')).toBe('after\r\n');
    expect(await f.run('diff')).toBe('');
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect((await f.snapshot()).slice(1, 3)).toEqual(before.slice(1, 3));
    expect(await f.apply(preview.token)).toMatchObject({ status: 'failed' });
  });

  it('rejects changed checkout, cross-owner tokens, malformed and unsafe paths without mutation', async () => {
    const f = await fixture();
    const preview = await f.preview();
    await f.service.open(2, f.cwd);
    const wrong = f.service.applyPatch(2, { id: f.id, token: preview.token });
    await expect
      .poll(() => f.service.listOperations(2).find((entry) => entry.id === wrong.id)?.status)
      .toBe('failed');
    await writeFile(join(f.cwd, 'change.txt'), 'external edit\n');
    const before = await f.snapshot();
    expect(await f.apply(preview.token)).toMatchObject({ status: 'failed' });
    for (const bytes of [
      Buffer.from('malformed'),
      Buffer.from('--- /tmp/escape\n+++ /tmp/escape\n@@ -0,0 +1 @@\n+bad\n'),
      Buffer.from('--- /dev/null\n+++ b/../escape\n@@ -0,0 +1 @@\n+bad\n'),
      Buffer.from('--- /dev/null\n+++ b/.git/config\n@@ -0,0 +1 @@\n+bad\n'),
    ]) {
      const invalid = await f.preview(bytes);
      expect(invalid.state).toBe('invalid');
      expect(await f.apply(invalid.token)).toMatchObject({ status: 'failed' });
    }
    expect(await f.snapshot()).toEqual(before);
  });

  it('reports a warning on repeat and preserves the staged result through a three-way application', async () => {
    const f = await fixture();
    expect(await f.apply((await f.preview()).token)).toMatchObject({ status: 'succeeded' });
    const before = await f.snapshot();
    const repeat = await f.preview();
    expect(repeat.state).toBe('warning');
    await f.apply(repeat.token);
    expect(await f.snapshot()).toEqual(before);
  });

  it('leaves real three-way conflicts visible for resolution and does not create commits', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'change.txt'), 'different\r\n');
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Diverged');
    const head = await f.run('rev-parse', 'HEAD');
    const preview = await f.preview();
    expect(preview.state).toBe('warning');
    expect(await f.apply(preview.token)).toMatchObject({ status: 'failed' });
    expect(await f.run('ls-files', '--unmerged')).toContain('change.txt');
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    await expect(f.preview()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('bounds files, refuses symlink traversal and malformed mailboxes, and cleans up on tab close', async () => {
    const f = await fixture();
    expect(() => checkedPatch(Buffer.alloc(0))).toThrow();
    expect(() => checkedPatch(Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow();
    await expect(readPatchFile(f.cwd)).rejects.toThrow();
    if (testPlatform.symlinks) {
      await symlink(f.root, join(f.cwd, 'link'), 'junction');
      const unsafe = await f.preview(Buffer.from('--- /dev/null\n+++ b/link/escape\n@@ -0,0 +1 @@\n+bad\n'));
      expect(unsafe.state).toBe('invalid');
    }
    const mailbox = await f.preview(
      Buffer.from(
        `From ${f.head} Mon Sep 17 00:00:00 2001\n${f.bytes.toString()}From ${f.head} Mon Sep 17 00:00:00 2001\n${f.bytes.toString()}`,
      ),
    );
    expect(mailbox.state).toBe('invalid');
    const valid = await f.preview();
    await f.service.close(1, f.id);
    await f.service.open(1, f.cwd);
    expect(await f.apply(valid.token)).toMatchObject({ status: 'failed' });
  });

  it('preserves non-UTF-8 file export bytes and refuses lossy clipboard conversion', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'change.txt'), Buffer.from([0xff, 0x0a]));
    const target = { kind: 'working' as const, paths: ['change.txt'], includeUntracked: false };
    const destination = join(f.root, 'raw.patch');
    await f.service.savePatch(1, { id: f.id, target }, destination);
    expect((await readFile(destination)).includes(Buffer.from([0xff]))).toBe(true);
    await expect(f.service.patchExportContent(1, { id: f.id, target })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await f.run('reset', '--hard', 'HEAD');
    expect(await f.apply((await f.preview(await readFile(destination))).token)).toMatchObject({
      status: 'succeeded',
    });
    expect(await readFile(join(f.cwd, 'change.txt'))).toEqual(Buffer.from([0xff, 0x0a]));
  });

  it('keeps patch capabilities out of inspectors and rejects renderer-supplied content or flags', () => {
    for (const kind of ['commit-details', 'file-history', 'blame'] as const)
      for (const request of [
        requests.copyRepositoryPatch,
        requests.previewRepositoryPatch,
        requests.applyRepositoryPatch,
        requests.releaseRepositoryPatch,
      ])
        expect(canInvokeInspector(kind, request.channel, {})).toBe(false);
    expect(
      repositoryPatchApplyRequestSchema.safeParse({
        id: 'repo',
        token: 'token',
        content: 'patch',
        args: ['--unsafe-paths'],
      }).success,
    ).toBe(false);
  });

  it('exports the exact root and selected merge parent, refusing an ambiguous or invalid parent', async () => {
    const f = await fixture();
    const root = await f.service.patchExportContent(1, {
      id: f.id,
      target: { kind: 'commit', commitId: f.head },
    });
    expect(root).toContain('Subject: [PATCH] Baseline');
    expect(root).toContain('new file mode');
    await f.run('checkout', '-qb', 'side');
    await writeFile(join(f.cwd, 'side.txt'), 'side\n');
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Side');
    await f.run('checkout', 'main');
    await f.run('merge', '--no-ff', '-m', 'Merge side', 'side');
    await expect(
      f.service.patchExportContent(1, {
        id: f.id,
        target: { kind: 'commit', commitId: await f.run('rev-parse', 'HEAD') },
      }),
    ).rejects.toThrow(/parent/u);
    const commitId = await f.run('rev-parse', 'HEAD');
    for (const parent of [1, 2]) {
      const result = await f.service.patchExportContent(1, {
        id: f.id,
        target: { kind: 'commit', commitId, parent },
      });
      const expected = (
        await f.git.run(
          [
            'diff',
            '--no-ext-diff',
            '--binary',
            '--full-index',
            '--find-renames',
            `${commitId}^${parent}`,
            commitId,
            '--',
          ],
          { cwd: f.cwd },
        )
      ).stdout;
      expect(result).toBe(expected);
    }
    await expect(
      f.service.patchExportContent(1, { id: f.id, target: { kind: 'commit', commitId, parent: 3 } }),
    ).rejects.toThrow(/parent/u);
  });

  it('preflights a mailbox using a temporary index, preserves Cancel, and stages its net result without commits', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'change.txt'), 'first change\r\n');
    await f.run('add', '.');
    await f.run('commit', '-qm', 'First mailed change');
    await writeFile(join(f.cwd, 'change.txt'), 'second change\r\n');
    await writeFile(join(f.cwd, 'mail.txt'), 'mail content\n');
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Second mailed change');
    const expected = await f.run('ls-files', '--stage');
    const bytes = Buffer.from(
      (
        await f.git.run(['format-patch', '--stdout', '--binary', '-2'], {
          cwd: f.cwd,
          stdoutEncoding: 'base64',
        })
      ).stdout,
      'base64',
    );
    await f.run('reset', '--hard', f.head);
    const before = await f.snapshot();
    const cancelled = await f.preview(bytes);
    expect(cancelled).toMatchObject({ state: 'clean', message: expect.stringContaining('2 patches') });
    expect(await f.snapshot()).toEqual(before);
    f.service.releasePatch(1, { id: f.id, token: cancelled.token });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.apply((await f.preview(bytes)).token)).toMatchObject({ status: 'succeeded' });
    expect(await f.run('ls-files', '--stage')).toBe(expected);
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.run('diff')).toBe('');
    expect(await readFile(join(f.cwd, 'change.txt'), 'utf8')).toBe('second change\r\n');
  });

  it.skipIf(!testPlatform.posix)(
    'round-trips quoted tab, newline, backslash and leading-dash paths on Linux',
    async () => {
      const f = await fixture();
      const paths = ['line\nbreak.txt', 'tab\tname.txt', 'back\\slash.txt', '-option café.txt'];
      for (const path of paths) await writeFile(join(f.cwd, path), Buffer.from([255, 13, 10, 97]));
      await f.run('add', '--', ...paths);
      const expected = await f.run('ls-files', '--stage');
      const destination = join(f.root, 'paths.patch');
      await f.service.savePatch(
        1,
        { id: f.id, target: { kind: 'working', paths, includeUntracked: true } },
        destination,
      );
      await f.run('reset', '--hard', 'HEAD');
      const preview = await f.preview(await readFile(destination));
      expect(preview.state).toBe('clean');
      expect(await f.apply(preview.token)).toMatchObject({ status: 'succeeded' });
      expect(await f.run('ls-files', '--stage')).toBe(expected);
      for (const path of paths)
        expect(await readFile(join(f.cwd, path))).toEqual(Buffer.from([255, 13, 10, 97]));
    },
  );

  it('round-trips binary additions, deletions and header-like hunk text without rewriting bytes', async () => {
    const f = await fixture();
    const binary = Buffer.from([0, 1, 255, 128, 13, 10]);
    await writeFile(join(f.cwd, 'binary.bin'), binary);
    await writeFile(join(f.cwd, 'change.txt'), '++ /etc/not-a-patch-path\n-- /etc/not-a-patch-path\n');
    await f.run('rm', 'old name.txt');
    await f.run('add', '.');
    const destination = join(f.root, 'binary.patch');
    await f.service.savePatch(
      1,
      {
        id: f.id,
        target: {
          kind: 'working',
          paths: ['binary.bin', 'change.txt', 'old name.txt'],
          includeUntracked: true,
        },
      },
      destination,
    );
    const index = await f.run('ls-files', '--stage');
    await f.run('reset', '--hard', 'HEAD');
    const preview = await f.preview(await readFile(destination));
    expect(preview.state).toBe('clean');
    expect(await f.apply(preview.token)).toMatchObject({ status: 'succeeded' });
    expect(await f.run('ls-files', '--stage')).toBe(index);
    expect(await readFile(join(f.cwd, 'binary.bin'))).toEqual(binary);
    expect(await f.run('diff')).toBe('');
  });
});
