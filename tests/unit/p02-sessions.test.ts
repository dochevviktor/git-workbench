import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  clearRepositorySession,
  repositorySessionMap,
  restoreRepositorySession,
} from '../../src/frontend/react/lib/repository-session';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { RepositoryManagerStore } from '../../src/backend/repositories/repository-manager-store';
import { RecentRepositoryStore } from '../../src/backend/repositories/recent-store';
import { DirectoryWatcher } from '../../src/backend/repositories/directory-watcher';
import type { RepositoryInvalidation } from '../../src/common/ipc/contracts';
import { repositoryManagerActionSchema, repositoryManagerScanSchema } from '../../src/common/ipc/contracts';

const roots: string[] = [];
const services: RepositoryService[] = [];
const watches: DirectoryWatcher[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.dispose();
    await service.settled();
  }
  for (const watcher of watches.splice(0)) watcher.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-'));
  roots.push(root);
  const service = new RepositoryService({ storagePath: join(root, 'settings', 'recent.json') });
  services.push(service);
  const repository = join(root, 'project');
  await mkdir(repository);
  const summary = await service.initialize(1, repository, false);
  return { root, service, repository, summary };
}

it('persists logical folders, aliases and defaults without changing repository paths or Git state', async () => {
  const { root, service, repository, summary } = await fixture();
  const git = new GitRunner();
  const before = (await git.run(['status', '--porcelain=v2'], { cwd: repository })).stdout;
  await service.editManager(1, { kind: 'add-group', name: 'Work', parentId: null });
  let manager = await service.listManager(1);
  const group = manager.groups[0]!;
  await service.editManager(1, { kind: 'add-group', name: 'Clients', parentId: group.id });
  manager = await service.listManager(1);
  const child = manager.groups[1]!;
  await service.editManager(1, {
    kind: 'edit-repository',
    location: { kind: 'recent', id: summary.id },
    name: 'Workbench',
    groupId: child.id,
  });
  await expect(
    service.editManager(1, { kind: 'move-group', id: group.id, parentId: child.id }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await service.editManager(1, { kind: 'rename-group', id: child.id, name: 'Projects' });
  await service.editManager(1, { kind: 'add-source', path: root });
  manager = await service.listManager(1);
  expect(manager.defaultSourceId).toBe(manager.sourceDirectories[0]!.id);
  expect(manager.repositories.find((entry) => entry.path === repository)).toMatchObject({
    name: 'Workbench',
    groupId: child.id,
  });
  expect((await service.listOpen(1))[0]!.name).toBe('Workbench');
  service.dispose();
  const restored = new RepositoryService({ storagePath: join(root, 'settings', 'recent.json') });
  services.push(restored);
  expect((await restored.listOpen(2))[0]!.name).toBe('Workbench');
  expect((await restored.listManager(2)).groups[1]!.name).toBe('Projects');
  await restored.editManager(2, { kind: 'remove-group', id: child.id });
  expect(
    (await restored.listManager(2)).repositories.find((entry) => entry.path === repository)?.groupId,
  ).toBe(group.id);
  expect((await git.run(['status', '--porcelain=v2'], { cwd: repository })).stdout).toBe(before);
  expect(await readdir(root)).toContain('project');
});

it('migrates source settings and serializes concurrent recent writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-store-'));
  roots.push(root);
  const path = join(root, 'manager.json');
  const source = { id: `source-${'a'.repeat(64)}`, path: root };
  await writeFile(path, JSON.stringify({ version: 1, sourceDirectories: [source] }));
  const manager = new RepositoryManagerStore({ filePath: path });
  expect(await manager.list()).toEqual([source]);
  await manager.edit({ kind: 'add-group', name: 'Work', parentId: null });
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 2, sourceDirectories: [source] });
  const recents = new RecentRepositoryStore({ filePath: join(root, 'recent.json') });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      recents.add({
        id: `repo-${i.toString(16).padStart(64, '0')}`,
        path: join(root, String(i)),
        name: String(i),
        lastOpenedAt: new Date().toISOString(),
      }),
    ),
  );
  expect(await recents.list()).toHaveLength(10);
  expect(await new RecentRepositoryStore({ filePath: join(root, 'recent.json') }).list()).toHaveLength(10);
});

it('retains missing tabs through restart and relocates or forgets the exact saved entry', async () => {
  const { root, service, repository, summary } = await fixture();
  const moved = join(root, 'moved');
  service.dispose();
  await rename(repository, moved);
  const restored = new RepositoryService({ storagePath: join(root, 'settings', 'recent.json') });
  services.push(restored);
  expect(await restored.listOpen(2)).toEqual([]);
  expect((await restored.getWorkspaceRecovery(2)).tabs).toMatchObject([{ id: summary.id, path: repository }]);
  const recovered = await restored.recoverTab(2, { id: summary.id, path: moved });
  expect(recovered?.path).toBe(moved);
  expect((await restored.getWorkspaceRecovery(2)).tabs).toEqual([]);
  expect((await restored.listRecent(2)).map((entry) => entry.path)).toEqual([moved]);
  restored.dispose();
  await rename(moved, repository);
  const last = new RepositoryService({ storagePath: join(root, 'settings', 'recent.json') });
  services.push(last);
  await last.recoverTab(3, { id: recovered!.id, path: null });
  expect((await last.getWorkspaceRecovery(3)).tabs).toEqual([]);
  expect(await readFile(join(repository, '.git', 'HEAD'), 'utf8')).toContain('refs/heads/');
});

it('reports quarantined settings with recoverable originals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-corrupt-'));
  roots.push(root);
  const storagePath = join(root, 'recent.json');
  for (const path of [storagePath, `${storagePath}.manager`, `${storagePath}.workspace`])
    await writeFile(path, '{broken');
  const service = new RepositoryService({ storagePath });
  services.push(service);
  const recovery = await service.getWorkspaceRecovery(1);
  expect(recovery.settings).toHaveLength(3);
  for (const entry of recovery.settings) expect(await readFile(entry.path, 'utf8')).toBe('{broken');
  expect((await service.listManager(1)).groups).toEqual([]);
});

it('replaces a missing saved tab at capacity without losing its position or display name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-capacity-'));
  roots.push(root);
  const path = join(root, 'original');
  await mkdir(path);
  const options = { storagePath: join(root, 'recent.json'), maxOpenTabs: 1 };
  const first = new RepositoryService(options);
  services.push(first);
  const repository = await first.initialize(1, path, false);
  await first.editManager(1, {
    kind: 'edit-repository',
    location: { kind: 'recent', id: repository.id },
    name: 'Display name',
    groupId: null,
  });
  first.dispose();
  const moved = join(root, 'moved');
  await rename(path, moved);
  const second = new RepositoryService(options);
  services.push(second);
  const recovered = await second.recoverTab(2, { id: repository.id, path: moved });
  expect(recovered).toMatchObject({ name: 'Display name', path: moved });
  expect((await second.listOpen(2)).map((entry) => entry.id)).toEqual([recovered!.id]);
  expect((await second.getWorkspaceRecovery(2)).tabs).toEqual([]);
});

it('returns scan jobs immediately, cancels without replacing the last snapshot, and isolates window ownership', async () => {
  const { service, root } = await fixture();
  await service.editManager(1, { kind: 'add-source', path: root });
  const accepted = service.startManagerScan(1);
  expect(repositoryManagerScanSchema.parse(accepted).state).toBe('scanning');
  expect(service.getManagerScan(2).state).toBe('idle');
  service.cancelManagerScan(1);
  await expect.poll(() => service.getManagerScan(1).state).toBe('cancelled');
  service.startManagerScan(1);
  await expect.poll(() => service.getManagerScan(1).state).toBe('complete');
  const snapshot = service.getManagerScan(1).snapshot;
  service.startManagerScan(1);
  service.cancelManagerScan(1);
  expect(service.getManagerScan(1).snapshot).toEqual(snapshot);
  service.startManagerScan(1);
  service.disposeWindow(1);
  expect(service.getManagerScan(1).state).toBe('idle');
  await expect(
    service.resolveLocation(2, { kind: 'manager-repository', id: snapshot!.repositories[0]!.id }),
  ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
});

it('watches replacement directories and ordinary worktree lock files without following moved handles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-replaced-watch-'));
  roots.push(root);
  const nested = join(root, 'nested');
  await mkdir(nested);
  let count = 0;
  const watcher = new DirectoryWatcher([{ path: root, kind: 'worktree' }], () => {
    count++;
  });
  watches.push(watcher);
  await watcher.ready;
  await rename(nested, join(root, 'previous'));
  await mkdir(nested);
  await expect.poll(() => count, { timeout: 2000 }).toBeGreaterThan(0);
  // Wait for the debounced topology reconciliation, then require a notification from inside the
  // replacement directory. The parent does not receive nested content changes.
  await new Promise((resolve) => setTimeout(resolve, 400));
  count = 0;
  await writeFile(join(nested, 'Cargo.lock'), 'changed\n');
  await expect.poll(() => count, { timeout: 2000 }).toBeGreaterThan(0);
});

it('invalidates external nested edits, atomic replacement, refs and linked worktrees and releases closed owners', async () => {
  const { root, service, repository, summary } = await fixture();
  const git = new GitRunner();
  await mkdir(join(repository, 'nested'));
  const file = join(repository, 'nested', '✓.txt');
  await writeFile(file, 'one\n');
  await git.run(['add', '.'], { cwd: repository });
  await git.run(
    [
      '-c',
      'user.name=A',
      '-c',
      'user.email=a@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Initial',
    ],
    { cwd: repository },
  );
  const linked = join(root, 'linked');
  await git.run(['worktree', 'add', '-b', 'linked', linked], { cwd: repository });
  const second = await service.open(2, linked);
  const events: { owner: number; event: RepositoryInvalidation }[] = [];
  const release = service.subscribeInvalidations((owner, event) => events.push({ owner, event }));
  await writeFile(file, 'two\n');
  await expect
    .poll(
      () =>
        events.some(
          ({ owner, event }) => owner === 1 && event.kind === 'repository' && event.id === summary.id,
        ),
      { timeout: 3000 },
    )
    .toBe(true);
  events.length = 0;
  await writeFile(join(repository, 'nested', 'replacement'), 'three\n');
  await rename(join(repository, 'nested', 'replacement'), file);
  await expect.poll(() => events.length, { timeout: 3000 }).toBeGreaterThan(0);
  events.length = 0;
  await git.run(['branch', 'external'], { cwd: repository });
  await expect
    .poll(
      () =>
        events.some(
          ({ owner, event }) => owner === 2 && event.kind === 'repository' && event.id === second.id,
        ),
      { timeout: 3000 },
    )
    .toBe(true);
  service.disposeWindow(1);
  service.disposeWindow(2);
  events.length = 0;
  await writeFile(file, 'four\n');
  // Wait beyond the debounce interval to prove no late native event escapes disposal.
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(events).toEqual([]);
  release();
});

it('does not follow directory symlinks and reports fallback when a watcher bound is reached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-watch-'));
  roots.push(root);
  const source = join(root, 'source');
  const outside = join(root, 'outside');
  await mkdir(join(source, 'deep'), { recursive: true });
  await mkdir(outside);
  if (process.platform !== 'win32') await symlink(outside, join(source, 'link'));
  const events: string[] = [];
  const watcher = new DirectoryWatcher([{ path: source, kind: 'worktree' }], (mode) => events.push(mode), 2);
  watches.push(watcher);
  await watcher.ready;
  await writeFile(join(source, 'file'), 'one');
  await expect.poll(() => events.includes('fallback'), { timeout: 2000 }).toBe(true);
  events.length = 0;
  await writeFile(join(outside, 'external'), 'two');
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(events).toEqual([]);
});

it('validates named manager mutations and prevents path/command injection fields', () => {
  expect(repositoryManagerActionSchema.safeParse({ kind: 'remove-group', id: '../../etc' }).success).toBe(
    false,
  );
  expect(
    repositoryManagerActionSchema.safeParse({
      kind: 'add-group',
      name: 'Work',
      parentId: null,
      command: 'git init',
    }).success,
  ).toBe(false);
});

it('clears committed and working diff positions on close and ignores late unmount writes', () => {
  vi.stubGlobal('window', new EventTarget());
  try {
    const id = `repo-${'a'.repeat(64)}`;
    const other = `repo-${'b'.repeat(64)}`;
    const positions = repositorySessionMap<number>();
    positions.set(`${id}:working:main`, 80);
    positions.set(`commit:${id}:oid:path`, 120);
    positions.set(`${other}:working`, 40);
    clearRepositorySession(id);
    expect([...positions.values()]).toEqual([40]);
    positions.set(`commit:${id}:oid:path`, 120);
    expect(positions.has(`commit:${id}:oid:path`)).toBe(false);
    restoreRepositorySession(id);
    positions.set(`commit:${id}:oid:path`, 0);
    expect(positions.get(`commit:${id}:oid:path`)).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('never resurrects a closed repository when a delayed topology/head read completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-stale-'));
  roots.push(root);
  const cwd = join(root, 'repository');
  await mkdir(cwd);
  const git = new GitRunner();
  let delay = false;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const service = new RepositoryService({
    storagePath: join(root, 'recent.json'),
    runner: {
      executable: git.executable,
      version: () => git.version(),
      run: async (args, options) => {
        if (delay && args.includes('symbolic-ref')) {
          delay = false;
          entered();
          await gate;
        }
        return git.run(args, options);
      },
    },
  });
  services.push(service);
  const repository = await service.initialize(1, cwd, false);
  delay = true;
  const pending = service.getHistory(1, repository.id, 0, 100);
  const refused = expect(pending).rejects.toMatchObject({ code: 'REPOSITORY_NOT_OPEN' });
  await started;
  await service.close(1, repository.id);
  const reopened = await service.open(1, cwd);
  release();
  await refused;
  expect((await service.listOpen(1)).map((entry) => entry.id)).toEqual([reopened.id]);
});
