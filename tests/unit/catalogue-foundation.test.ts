import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { RepositoryTabStore } from '../../src/backend/repositories/repository-tab-store';
import { RemoteFetchPreferenceStore } from '../../src/backend/repositories/remote-fetch-preference-store';
import { isAllowedRemoteUrl, isStandaloneRepositoryUrl } from '../../src/backend/repositories/remote-service';
import { OperationRegistry } from '../../src/backend/operations/operation-registry';
import type { OperationOutcome } from '../../src/backend/operations/operation-registry';
import type { RepositoryOperation } from '../../src/common/ipc/contracts';

const roots: string[] = [];
const services: RepositoryService[] = [];
const git = new GitRunner();
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-catalogue-'));
  roots.push(root);
  return root;
}
function service(root: string) {
  const value = new RepositoryService({ storagePath: join(root, 'settings', 'recent.json') });
  services.push(value);
  return value;
}
async function finished(
  value: RepositoryService,
  accepted: RepositoryOperation,
): Promise<RepositoryOperation> {
  await expect
    .poll(() => value.listOperations(1).find((operation) => operation.id === accepted.id)?.status)
    .not.toBe('running');
  return value.listOperations(1).find((operation) => operation.id === accepted.id)!;
}
afterEach(async () => {
  for (const value of services.splice(0)) value.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('catalogue repository/session corrections', () => {
  it('preserves UTF-8 bytes across bounded multi-chunk process output', async () => {
    const root = await fixture();
    const runner = new GitRunner({ executable: process.execPath });
    const result = await runner.run(
      [
        '--input-type=module-typescript',
        '-e',
        'const text: string = "λ🚀".repeat(200000); const data = Buffer.from(text); for (let offset = 0; offset < data.length; offset += 8191) process.stdout.write(data.subarray(offset, offset + 8191)); process.stderr.write("done");',
      ],
      { cwd: root, maxOutputBytes: 2 * 1024 * 1024 },
    );
    expect(result.stdout).toBe('λ🚀'.repeat(200000));
    expect(result.stderr).toBe('done');
  });

  it('migrates exclusive vertical tabs into an additive list without losing order or selection (P0-005)', async () => {
    const root = await fixture();
    const path = join(root, 'tabs.json');
    const first = { id: `repo-${'1'.repeat(64)}`, path: join(root, 'one') };
    const second = { id: `repo-${'2'.repeat(64)}`, path: join(root, 'two') };
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        tabOrientation: 'vertical',
        activeRepositoryId: first.id,
        tabs: [first, second],
      }),
    );
    const store = new RepositoryTabStore({ filePath: path });
    expect(await store.getPreferences()).toMatchObject({
      repositoryListVisible: true,
      activeRepositoryId: first.id,
    });
    expect(await store.listTabs()).toEqual([first, second]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      version: 2,
      repositoryListVisible: true,
    });
    await store.reorder([second.id, first.id]);
    await store.removeTab(first.id);
    const restarted = new RepositoryTabStore({ filePath: path });
    expect(await restarted.listTabs()).toEqual([second]);
    expect((await restarted.getPreferences()).recentlyClosed).toEqual([{ ...first, name: 'one' }]);
    await restarted.addTab(first);
    expect((await restarted.getPreferences()).recentlyClosed).toEqual([]);
    expect(await restarted.listTabs()).toEqual([second, first]);
  });

  it('refuses foreign/stale reorder requests and selects the preceding tab on close (P0-004)', async () => {
    const root = await fixture();
    const value = service(root);
    const repositories = [];
    for (const name of ['one', 'two', 'three']) {
      const path = join(root, name);
      await mkdir(path);
      repositories.push(await value.initialize(1, path, false));
    }
    const ids = repositories.map((repository) => repository.id);
    expect(
      (await value.reorderTabs(1, [ids[2]!, ids[0]!, ids[1]!])).map((repository) => repository.id),
    ).toEqual([ids[2], ids[0], ids[1]]);
    await expect(value.reorderTabs(1, [ids[0]!, ids[0]!])).rejects.toThrow('tab order');
    await value.selectTab(1, ids[1]!);
    await value.close(1, ids[1]!);
    expect(await value.getTabPreferences(1)).toMatchObject({ activeRepositoryId: ids[0] });
  });

  it('tests a local remote and clones into a new tab without changing source refs (P1-012)', async () => {
    const root = await fixture();
    const source = join(root, 'source');
    await mkdir(source);
    await git.run(['init', '--initial-branch=main'], { cwd: source });
    await writeFile(join(source, 'café.txt'), 'fixture\n');
    await git.run(['add', '--', 'café.txt'], { cwd: source });
    await git.run(
      ['-c', 'user.name=Capture', '-c', 'user.email=capture@example.invalid', 'commit', '-m', 'Baseline'],
      { cwd: source },
    );
    const before = (await git.run(['show-ref'], { cwd: source })).stdout;
    const value = service(root);
    const check = await finished(value, await value.testConnection(1, { kind: 'url', url: source }));
    expect(check).toMatchObject({ status: 'succeeded', message: 'Connection succeeded.' });
    const cloned = await finished(
      value,
      await value.clone(1, { url: source, parentPath: root, name: 'copied repo' }),
    );
    expect(cloned.status).toBe('succeeded');
    expect(cloned.result?.kind).toBe('clone');
    expect(await readFile(join(root, 'copied repo', 'café.txt'), 'utf8')).toBe('fixture\n');
    expect((await git.run(['status', '--porcelain'], { cwd: join(root, 'copied repo') })).stdout).toBe('');
    expect(
      (
        await git.run(['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: join(root, 'copied repo') })
      ).stdout.trim(),
    ).toBe('origin/main');
    expect((await git.run(['show-ref'], { cwd: source })).stdout).toBe(before);
    expect((await value.listOpen(1)).map((repository) => repository.path)).toContain(
      join(root, 'copied repo'),
    );
    const refused = await finished(
      value,
      await value.clone(1, { url: source, parentPath: root, name: 'copied repo' }),
    );
    expect(refused.status).toBe('failed');
    expect(await readFile(join(root, 'copied repo', 'café.txt'), 'utf8')).toBe('fixture\n');
    await expect(value.clone(1, { url: source, parentPath: root, name: '../escape' })).rejects.toThrow();
  });

  it('persists global fetch preference independently of per-remote opt-outs', async () => {
    const root = await fixture();
    const path = join(root, 'fetch.json');
    const id = `repo-${'a'.repeat(64)}`;
    await writeFile(
      path,
      JSON.stringify({ version: 1, entries: [{ repositoryId: id, remotes: ['private'] }] }),
    );
    const store = new RemoteFetchPreferenceStore(path);
    expect(await store.isGloballyEnabled()).toBe(true);
    await store.setGloballyEnabled(false);
    const restarted = new RemoteFetchPreferenceStore(path);
    expect(await restarted.isGloballyEnabled()).toBe(false);
    expect(await restarted.disabledRemotes(id)).toEqual(['private']);
    await restarted.setGloballyEnabled(true);
    expect(await restarted.isDisabled(id, 'private')).toBe(true);
    expect(await restarted.isDisabled(id, 'origin')).toBe(false);
  });

  it('keeps a cancel request running until work has actually settled (P1-011)', async () => {
    const registry = new OperationRegistry();
    let finish!: (outcome: OperationOutcome) => void;
    const operation = registry.start(
      {
        ownerId: 1,
        repositoryId: `repo-${'b'.repeat(64)}`,
        kind: 'fetch',
        title: 'Fetch',
        command: 'git fetch origin',
      },
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(registry.cancel(1, operation.id)).toMatchObject({
      status: 'running',
      cancelRequested: true,
      finishedAt: null,
    });
    finish({ status: 'succeeded', message: 'Transport settled.', output: 'Partial output' });
    await expect.poll(() => registry.get(operation.id)?.status).toBe('cancelled');
    expect(registry.get(operation.id)?.output).toBe('Partial output');
    registry.dispose();
  });

  it('rejects arbitrary remote helpers and embedded secrets while allowing local and SSH URLs', () => {
    expect(isStandaloneRepositoryUrl('../source')).toBe(false);
    expect(isStandaloneRepositoryUrl('source')).toBe(false);
    expect(isStandaloneRepositoryUrl('/tmp/source')).toBe(true);
    for (const url of [
      'ext::sh command',
      'custom::payload',
      'https://user:secret@example.invalid/repo',
      '-u',
      'file:///tmp/a\nb',
    ])
      expect(isAllowedRemoteUrl(url)).toBe(false);
    for (const url of [
      '/tmp/a repo',
      'file:///tmp/repo',
      'git@example.invalid:team/repo.git',
      'ssh://git@example.invalid/repo',
      'https://example.invalid/repo',
    ])
      expect(isAllowedRemoteUrl(url)).toBe(true);
  });
});
