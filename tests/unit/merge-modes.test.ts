import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { RepositoryMergeRebaseAction, RepositoryOperation } from '../../src/common/ipc/contracts';

const directories: string[] = [];
const services: RepositoryService[] = [];
async function fixture(divergent = false) {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-merge-modes-'));
  directories.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Merge Fixture');
  await run('config', 'user.email', 'merge@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'base.txt'), 'base\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'base');
  await run('checkout', '--quiet', '-b', 'feature');
  await writeFile(join(cwd, 'feature.txt'), 'feature\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'feature addition');
  const source = await run('rev-parse', 'HEAD');
  await run('checkout', '--quiet', 'main');
  if (divergent) {
    await writeFile(join(cwd, 'main.txt'), 'main\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'main addition');
  }
  const before = await run('rev-parse', 'HEAD');
  const storagePath = join(root, 'recent.json');
  const service = new RepositoryService({ storagePath, runner: git });
  services.push(service);
  const { id } = await service.open(1, cwd);
  await service.setTrust(1, id, true);
  return { root, cwd, run, git, service, id, before, source, storagePath };
}
async function terminal(service: RepositoryService, operation: RepositoryOperation) {
  const current = service.listOperations(1).find((item) => item.id === operation.id);
  if (current && current.status !== 'running') return current;
  return new Promise<RepositoryOperation>((resolve) => {
    const stop = service.subscribeOperations((_owner, item) => {
      if (item.id === operation.id && item.status !== 'running') {
        stop();
        resolve(item);
      }
    });
  });
}
async function merge(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: Extract<RepositoryMergeRebaseAction, { kind: 'merge' }>['mode'],
  autostash = false,
) {
  return terminal(
    f.service,
    f.service.startMergeRebase(1, {
      id: f.id,
      action: {
        kind: 'merge',
        mode,
        sourceFullName: 'refs/heads/feature',
        autostash,
        snapshot: (await f.service.getReferenceContext(1, f.id)).snapshot,
        changesSnapshot: (await f.service.previewLocalChanges(1, f.id)).snapshot,
      },
    }),
  );
}
async function recover(f: Awaited<ReturnType<typeof fixture>>, action: 'continue' | 'abort') {
  return terminal(
    f.service,
    f.service.startRecovery(1, {
      id: f.id,
      action,
      snapshot: (await f.service.getRecovery(1, f.id)).snapshot,
    }),
  );
}
afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('P1-006 catalogue merge modes', () => {
  it('fast-forwards by default even with repository merge.ff=false and no-commit still fast-forwards', async () => {
    for (const mode of ['default', 'no-commit'] as const) {
      const f = await fixture();
      await f.run('config', 'merge.ff', 'false');
      expect(await merge(f, mode)).toMatchObject({ status: 'succeeded' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(f.source);
      expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
    }
  });

  it('creates both ordered parents for No Fast-Forward on an otherwise linear history', async () => {
    const f = await fixture();
    expect(await merge(f, 'no-ff')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', '-s', '--format=%P', 'HEAD')).toBe(`${f.before} ${f.source}`);
    expect(await f.run('status', '--porcelain')).toBe('');
  });

  it('pauses a divergent no-commit merge and completes through the ordinary composer', async () => {
    const f = await fixture(true);
    expect(await merge(f, 'no-commit')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.before);
    expect(await f.run('rev-parse', 'MERGE_HEAD')).toBe(f.source);
    const context = await f.service.getCommitContext(1, f.id);
    expect(context).toMatchObject({
      pendingOperation: 'merge',
      stagedCount: 1,
      pendingMessage: expect.stringContaining("Merge branch 'feature'"),
    });
    expect(
      await terminal(
        f.service,
        f.service.startCommit(1, {
          id: f.id,
          subject: "Merge branch 'feature'",
          body: '',
          amend: false,
          skipHooks: false,
          snapshot: context.snapshot,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', '-s', '--format=%P', 'HEAD')).toBe(`${f.before} ${f.source}`);
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
  });

  it('persists a squash pause across a fresh service and completes as a single-parent commit', async () => {
    const f = await fixture();
    expect(await merge(f, 'squash')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.before);
    expect(await f.run('rev-parse', '--verify', '--quiet', 'MERGE_HEAD').catch(() => '')).toBe('');
    f.service.dispose();
    const reopened = new RepositoryService({ storagePath: f.storagePath, runner: f.git });
    services.push(reopened);
    await reopened.open(1, f.cwd);
    const context = await reopened.getCommitContext(1, f.id);
    expect(context.pendingOperation).toBe('squash');
    expect(context.pendingMessage).toContain('feature addition');
    expect(
      await terminal(
        reopened,
        reopened.startCommit(1, {
          id: f.id,
          subject: 'Squashed feature',
          body: '',
          amend: false,
          skipHooks: false,
          snapshot: context.snapshot,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', '-s', '--format=%P', 'HEAD')).toBe(f.before);
    expect((await reopened.getRecovery(1, f.id)).pendingOperation).toBeNull();
  });

  it('aborts a squash, preserving a later unrelated unstaged edit', async () => {
    const f = await fixture();
    expect(await merge(f, 'squash')).toMatchObject({ status: 'succeeded' });
    await writeFile(join(f.cwd, 'base.txt'), 'unrelated later edit\n');
    expect(await recover(f, 'abort')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.before);
    expect(await f.run('diff', '--cached', '--name-only')).toBe('');
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('unrelated later edit\n');
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
  });

  it('defers saved local changes until squash continuation finishes', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'base.txt'), 'saved edit\n');
    expect(await merge(f, 'squash', true)).toMatchObject({ status: 'succeeded' });
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('base\n');
    expect((await f.service.getRecovery(1, f.id)).copies[0]?.pending).toBe(true);
    expect(await recover(f, 'continue')).toMatchObject({ status: 'succeeded' });
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('saved edit\n');
    expect((await f.service.getRecovery(1, f.id)).copies[0]?.pending).toBe(false);
  });
});
