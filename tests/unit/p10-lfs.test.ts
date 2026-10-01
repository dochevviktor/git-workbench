import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasGitLfs, lfsFixture } from '../helpers/lfs-fixture';
import { testPlatform } from '../platform';
import { saveLfsPayload } from '../../src/backend/repositories/lfs-service';
import type { LfsAction } from '../../src/common/ipc/lfs';
import type { RepositoryOperation } from '../../src/common/ipc/contracts';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
async function fixture() {
  const f = await lfsFixture();
  cleanup.push(f.cleanup);
  const wait = async (accepted: RepositoryOperation) => {
    await expect
      .poll(() => f.service.listOperations(1).find((op) => op.id === accepted.id)?.status, {
        timeout: 20_000,
      })
      .not.toBe('running');
    return f.service.listOperations(1).find((op) => op.id === accepted.id)!;
  };
  const act = async (action: LfsAction) =>
    wait(
      f.service.startLfsOperation(1, {
        id: f.repository.id,
        snapshot: (await f.service.getLfsContext(1, f.repository.id)).snapshot,
        action,
      }),
    );
  return { ...f, wait, act };
}
describe.skipIf(!hasGitLfs())('P10 real authenticated Git LFS', () => {
  it('retrieves one missing historical payload, verifies it and preserves pointers, refs, hooks and index', async () => {
    const f = await fixture();
    const before = await f.git('status', '--porcelain=v2');
    const hooks = await readdir(join(f.cwd, '.git/hooks'));
    const metadata = await f.service.getLfsFile(1, f.repository.id, f.head, 'sample.bin');
    expect(metadata.history).toMatchObject({ kind: 'lfs', payloadState: 'missing' });
    expect(f.requests).toEqual([]);
    const destination = join(f.root, 'saved.bin');
    const result = await f.wait(
      f.service.startLfsPayloadSave(
        1,
        { id: f.repository.id, commitId: f.head, path: 'sample.bin' },
        destination,
      ),
    );
    expect(result, result.message).toMatchObject({
      status: 'succeeded',
      result: { kind: 'lfs', value: { sha256: f.oid } },
    });
    expect(await readFile(destination)).toEqual(f.payload);
    expect(await readFile(join(f.cwd, 'sample.bin'), 'utf8')).toBe(f.pointer);
    expect(await f.git('status', '--porcelain=v2')).toBe(before);
    expect(await f.git('rev-parse', 'HEAD')).toBe(f.head);
    expect(await readdir(join(f.cwd, '.git/hooks'))).toEqual(hooks);
    expect(f.credentialsUsed()).toBeGreaterThan(0);
    expect(JSON.stringify(result) + f.logs.join('')).not.toContain(f.token);
    await expect(
      saveLfsPayload(
        f.runner,
        {
          repositoryId: f.repository.id,
          cwd: f.cwd,
          worktreePath: f.cwd,
          commitId: f.head,
          path: 'sample.bin',
        },
        join(f.cwd, 'sample.bin'),
        { signal: new AbortController().signal, setProgress() {} },
      ),
    ).rejects.toThrow('outside');
  });
  it(
    'tracks patterns with a stale guard, transfers objects and verifies lock ownership before unlocking',
    async () => {
      const f = await fixture();
      const context = await f.service.getLfsContext(1, f.repository.id);
      expect(context.patterns).toContainEqual({
        pattern: '*.bin',
        source: '.gitattributes',
        lockable: false,
      });
      expect(f.requests).toEqual([]);
      expect(context.remotes[0]).toMatchObject({
        endpoint: `${f.origin}/org/repo.git/info/lfs`,
        pushUrl: `${f.origin}/org/repo.git/info/lfs`,
      });
      expect(await f.wait(f.service.startLfsInitialization(1, { id: f.repository.id }))).toMatchObject({
        status: 'succeeded',
      });
      expect(await readFile(join(f.cwd, '.git/hooks/pre-push'), 'utf8')).toContain('git lfs pre-push');
      expect(await f.act({ kind: 'track', pattern: '*.psd', lockable: true })).toMatchObject({
        status: 'succeeded',
      });
      const stale = await f.wait(
        f.service.startLfsOperation(1, {
          id: f.repository.id,
          snapshot: context.snapshot,
          action: { kind: 'untrack', pattern: '*.bin' },
        }),
      );
      expect(stale.status).toBe('failed');
      expect(stale.message).toContain('changed');
      expect(await f.act({ kind: 'untrack', pattern: '*.psd' })).toMatchObject({ status: 'succeeded' });
      expect(await f.act({ kind: 'fetch', remote: 'origin' })).toMatchObject({ status: 'succeeded' });
      const cached = join(f.cwd, '.git/lfs/objects', f.oid.slice(0, 2), f.oid.slice(2, 4), f.oid);
      await writeFile(cached, Buffer.alloc(f.payload.length, 1));
      const canRefetch = (await f.service.getLfsContext(1, f.repository.id)).supportsRefetch;
      const requestsBeforeRefetch = f.requests.length;
      const refetched = await f.act({ kind: 'fetch', remote: 'origin', refetch: true });
      if (canRefetch) {
        expect(refetched).toMatchObject({ status: 'succeeded' });
        expect(await readFile(cached)).toEqual(f.payload);
      } else {
        expect(refetched).toMatchObject({ status: 'failed' });
        expect(refetched.message).toContain('does not support');
        expect(f.requests).toHaveLength(requestsBeforeRefetch);
        expect(await readFile(cached)).toEqual(Buffer.alloc(f.payload.length, 1));
        // Restore only the disposable fixture cache before testing the unrelated push/lock workflow.
        await writeFile(cached, f.payload);
      }
      f.objects.clear();
      expect(await f.act({ kind: 'push', remote: 'origin' })).toMatchObject({ status: 'succeeded' });
      expect(f.objects.get(f.oid)).toEqual(f.payload);
      expect(await f.act({ kind: 'lock', remote: 'origin', path: 'sample.bin' })).toMatchObject({
        status: 'succeeded',
      });
      const lock = [...f.locks.values()][0]!;
      expect(lock.path).toBe('sample.bin');
      const result = await f.act({ kind: 'locks', remote: 'origin' });
      expect(result).toMatchObject({
        status: 'succeeded',
        result: { kind: 'lfs-locks', value: { locks: [{ ours: true, path: 'sample.bin' }] } },
      });
      lock.owner.name = 'bob';
      expect(
        await f.act({ kind: 'unlock', remote: 'origin', path: lock.path, lockId: lock.id }),
      ).toMatchObject({ status: 'failed' });
      expect(f.locks.size).toBe(1);
      lock.owner.name = 'alice';
      expect(
        await f.act({ kind: 'unlock', remote: 'origin', path: lock.path, lockId: lock.id }),
      ).toMatchObject({ status: 'succeeded' });
      expect(f.locks.size).toBe(0);
      expect(await f.git('rev-parse', 'HEAD')).toBe(f.head);
      expect(await readFile(join(f.cwd, 'sample.bin'), 'utf8')).toBe(f.pointer);
    },
    testPlatform.windows ? 60000 : 20000,
  );
  it('handles authentication, missing and corrupt objects and cancellation without a partial destination', async () => {
    const f = await fixture();
    f.setRejectAuth(true);
    const configBeforeRead = await f.git('config', '--local', '--list');
    const firstRead = await f.service.getLfsContext(1, f.repository.id);
    const configAfterRead = await f.git('config', '--local', '--list');
    expect(configAfterRead).toBe(configBeforeRead);
    expect(await f.service.getLfsContext(1, f.repository.id)).toEqual(firstRead);
    const rejectedLocks = await f.act({ kind: 'locks', remote: 'origin' });
    expect(rejectedLocks, JSON.stringify(rejectedLocks)).toMatchObject({
      status: 'failed',
      failureReason: 'authentication',
    });
    expect(f.credentialsUsed()).toBeLessThanOrEqual(2);
    const denied = await f.act({ kind: 'fetch', remote: 'origin' });
    expect(denied.status).toBe('failed');
    expect(JSON.stringify(denied)).not.toContain(f.token);
    f.setRejectAuth(false);
    f.objects.clear();
    expect(await f.act({ kind: 'fetch', remote: 'origin' })).toMatchObject({ status: 'failed' });
    f.objects.set(f.oid, f.payload);
    f.setCorrupt(true);
    const destination = join(f.root, 'save.bin');
    const save = () =>
      f.service.startLfsPayloadSave(
        1,
        { id: f.repository.id, commitId: f.head, path: 'sample.bin' },
        destination,
      );
    expect(await f.wait(save())).toMatchObject({ status: 'failed' });
    await expect(readFile(destination)).rejects.toThrow();
    f.setCorrupt(false);
    f.setSlow(true);
    const requests = f.requests.length;
    const accepted = save();
    await expect
      .poll(() => f.requests.slice(requests).some((request) => request.startsWith('GET /objects/')), {
        timeout: 10_000,
      })
      .toBe(true);
    f.service.cancelOperation(1, accepted.id);
    expect(await f.wait(accepted)).toMatchObject({ status: 'cancelled' });
    await expect(readFile(destination)).rejects.toThrow();
    expect(await readFile(join(f.cwd, 'sample.bin'), 'utf8')).toBe(f.pointer);
  });
  it('honors custom storage and refuses attributes symlinks and externally retargeted remotes', async () => {
    const f = await fixture();
    const storage = join(f.root, 'cache');
    const directory = join(storage, 'objects', f.oid.slice(0, 2), f.oid.slice(2, 4));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, f.oid), f.payload);
    await f.git('config', 'lfs.storage', storage);
    expect((await f.service.getLfsFile(1, f.repository.id, f.head, 'sample.bin')).history).toMatchObject({
      payloadState: 'available',
    });
    const context = await f.service.getLfsContext(1, f.repository.id);
    await f.git('remote', 'set-url', 'origin', `${f.origin}/org/other.git`);
    expect(
      await f.wait(
        f.service.startLfsOperation(1, {
          id: f.repository.id,
          snapshot: context.snapshot,
          action: { kind: 'fetch', remote: 'origin' },
        }),
      ),
    ).toMatchObject({ status: 'failed' });
    expect(f.requests).toEqual([]);
    if (!testPlatform.symlinks) return; // Storage and remote guards above run on every platform.
    const external = join(f.root, 'attributes');
    await writeFile(external, 'retained\n');
    await rm(join(f.cwd, '.gitattributes'));
    await symlink(external, join(f.cwd, '.gitattributes'));
    await expect(f.service.getLfsContext(1, f.repository.id)).rejects.toThrow('regular file');
    expect(await readFile(external, 'utf8')).toBe('retained\n');
  });
  it('reads nested, global and info tracking rules without changing config or hooks', async () => {
    const f = await fixture();
    await mkdir(join(f.cwd, 'assets'));
    await writeFile(join(f.cwd, 'assets/.gitattributes'), '*.wav filter=lfs diff=lfs merge=lfs -text\n');
    await writeFile(join(f.cwd, '.git/info/attributes'), '*.raw filter=lfs -text\n');
    const globalAttributes = join(f.root, 'global-attributes');
    await writeFile(globalAttributes, '*.global filter=lfs -text\n');
    await f.git('config', 'core.attributesFile', globalAttributes);
    const before = await f.git('config', '--local', '--list');
    const hooks = await readdir(join(f.cwd, '.git/hooks'));
    const context = await f.service.getLfsContext(1, f.repository.id);
    expect(context.patterns.map((entry) => entry.pattern)).toEqual(
      expect.arrayContaining(['*.bin', 'assets/*.wav', '*.raw', '*.global']),
    );
    expect(await f.service.getLfsContext(1, f.repository.id)).toEqual(context);
    expect(await f.git('config', '--local', '--list')).toBe(before);
    expect(await readdir(join(f.cwd, '.git/hooks'))).toEqual(hooks);
    expect(f.requests).toEqual([]);
  });
});
