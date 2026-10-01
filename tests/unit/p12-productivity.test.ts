import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { NamedWorkspaces } from '../../src/backend/repositories/named-workspaces';
import { ExternalToolStore, expandToolArguments } from '../../src/backend/tools/external-tool-store';
import { CustomCommandStore } from '../../src/backend/commands/custom-command-store';
import { expandCommand } from '../../src/backend/commands/custom-command-service';
import { requests } from '../../src/common/ipc/contracts';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';
import { validShortcutOverrides } from '../../src/frontend/react/lib/shortcut-preferences';
import { GitRunner } from '../../src/backend/git/runner';

const roots: string[] = [];
const services: RepositoryService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.dispose();
    await service.settled();
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'workbench-p12-'));
  roots.push(path);
  return path;
}
function service(path: string) {
  const result = new RepositoryService({ storagePath: join(path, 'recent.json') });
  services.push(result);
  return result;
}

it('isolates tabs, active selection, colors and list visibility between workspace windows and restores them', async () => {
  const path = await root();
  const first = service(path);
  first.bindWorkspace(1, 'default');
  await mkdir(join(path, 'A'));
  await mkdir(join(path, 'B'));
  const a = await first.initialize(1, join(path, 'A'), false);
  const b = await first.initialize(1, join(path, 'B'), false);
  const named = await first.editWorkspace(1, { kind: 'create', name: 'Home', revision: 0 });
  const home = named.entries[1]!;
  first.bindWorkspace(2, home.id);
  expect(await first.listOpen(2)).toEqual([]);
  await first.open(2, a.path);
  await first.setTabOrientation('vertical', 2);
  await first.editWorkspace(2, {
    kind: 'color',
    repositoryId: a.id,
    color: 'blue',
    revision: named.revision,
  });
  await first.selectTab(1, b.id);
  expect((await first.getTabPreferences(1)).repositoryListVisible).toBe(false);
  expect((await first.getTabPreferences(1)).activeRepositoryId).toBe(b.id);
  expect((await first.getTabPreferences(2)).activeRepositoryId).toBe(a.id);
  expect((await first.getWorkspaces(1)).entries[0]!.tabColors).toEqual({});
  await first.close(2, a.id);
  expect((await first.listOpen(1)).map((item) => item.id)).toEqual([a.id, b.id]);
  await first.open(2, a.path);
  await first.namedWorkspaces.activate(home.id);
  first.disposeWindow(2);
  await expect(first.setTabOrientation('horizontal', 2)).rejects.toMatchObject({
    code: 'REPOSITORY_NOT_OPEN',
  });
  first.dispose();
  await first.settled();
  const restored = service(path);
  restored.bindWorkspace(3, home.id);
  restored.bindWorkspace(4, 'default');
  expect((await restored.namedWorkspaces.read()).lastActiveId).toBe(home.id);
  expect((await restored.listOpen(3)).map((item) => item.id)).toEqual([a.id]);
  expect((await restored.listOpen(4)).map((item) => item.id)).toEqual([a.id, b.id]);
  expect((await restored.getTabPreferences(3)).repositoryListVisible).toBe(true);
  expect((await restored.getWorkspaces(3)).entries[1]!.tabColors[a.id]).toBe('blue');
});

it('migrates the original workspace unchanged and rejects stale edits, duplicate names and open removal', async () => {
  const path = await root();
  const first = service(path);
  first.bindWorkspace(1, 'default');
  await mkdir(join(path, 'repo'));
  const repo = await first.initialize(1, join(path, 'repo'), false);
  first.dispose();
  await first.settled();
  await writeFile(
    join(path, 'recent.json.workspace'),
    JSON.stringify({
      version: 1,
      tabOrientation: 'vertical',
      activeRepositoryId: repo.id,
      tabs: [{ id: repo.id, path: repo.path }],
    }),
  );
  const restored = service(path);
  restored.bindWorkspace(2, 'default');
  expect((await restored.listOpen(2))[0]?.id).toBe(repo.id);
  expect((await restored.getTabPreferences(2)).repositoryListVisible).toBe(true);
  const named = await restored.editWorkspace(2, { kind: 'create', name: 'Review', revision: 0 });
  await expect(restored.editWorkspace(2, { kind: 'create', name: 'Stale', revision: 0 })).rejects.toThrow(
    'changed',
  );
  await expect(
    restored.editWorkspace(2, { kind: 'create', name: 'review', revision: named.revision }),
  ).rejects.toThrow('name');
  const id = named.entries[1]!.id;
  restored.bindWorkspace(3, id);
  await expect(restored.editWorkspace(2, { kind: 'remove', id, revision: named.revision })).rejects.toThrow(
    'Close',
  );
  restored.disposeWindow(3);
  await restored.editWorkspace(2, { kind: 'remove', id, revision: named.revision });
  expect(await readdir(path)).toContain('repo');
  expect((await restored.listOpen(2))[0]?.id).toBe(repo.id);
});

it('retains corrupt workspace metadata and preserves the previous save after a failed write', async () => {
  const path = await root();
  const file = join(path, 'names');
  await writeFile(file, '{broken');
  const store = new NamedWorkspaces(file);
  expect((await store.read()).entries[0]!.name).toBe('Work');
  const backup = (await readdir(path)).find((name) => name.startsWith('names.corrupt-'))!;
  expect(await readFile(join(path, backup), 'utf8')).toBe('{broken');
  await mkdir(file);
  await expect(
    store.edit({ kind: 'create', revision: 0, name: 'Cannot write' }, 'default', new Set()),
  ).rejects.toBeDefined();
  expect((await store.read()).entries).toHaveLength(1);
});

it('validates workspace capabilities and keeps every inspector outside workspace mutations', () => {
  expect(requests.openWorkspace.input.safeParse({ id: '../arbitrary', newWindow: true }).success).toBe(false);
  expect(requests.editWorkspace.input.safeParse({ kind: 'create', name: '', revision: 0 }).success).toBe(
    false,
  );
  for (const kind of ['commit-details', 'file-history', 'blame'] as const)
    for (const channel of ['workspace:list', 'workspace:edit', 'workspace:open'])
      expect(canInvokeInspector(kind, channel, {})).toBe(false);
  expect(validShortcutOverrides({ 'Mod+P': 'Mod+Alt+K' })).toBe(true);
  expect(validShortcutOverrides({ 'Mod+P': 'Mod+C' })).toBe(false);
  expect(validShortcutOverrides({ 'Mod+P': 'Mod+Alt+K', 'Mod+O': 'Mod+Alt+K' })).toBe(false);
  expect(validShortcutOverrides({ 'Mod+P': 'Mod+Alt+T' })).toBe(false);
});

it('persists tool defaults and background command options without enabling imported definitions', async () => {
  const path = await root();
  const tools = new ExternalToolStore(join(path, 'tools'));
  const definition = {
    kind: 'diff' as const,
    executable: process.execPath,
    args: ['$REMOTE', '$LOCAL'],
    isDefault: true,
  };
  const a = (await tools.save({ definition: { ...definition, name: 'First' } }))[0]!;
  const next = await tools.save({ definition: { ...definition, name: 'Second' } });
  expect(next.map((tool) => tool.isDefault)).toEqual([false, true]);
  expect(() => tools.match(next, { id: a.id, revision: a.revision })).toThrow('changed');
  const commands = new CustomCommandStore(join(path, 'commands'));
  const [command] = await commands.save({
    enabled: true,
    definition: {
      name: 'Background',
      target: 'repository',
      action: { kind: 'process', executable: process.execPath, args: [] },
      fields: [],
      waitForExit: false,
      showOutput: 'on-error',
    },
  });
  const shared = await commands.export({ id: command!.id, revision: command!.revision });
  const other = new CustomCommandStore(join(path, 'imported'));
  const imported = await other.import(JSON.parse(shared));
  expect(imported[0]).toMatchObject({ enabled: false, waitForExit: false, showOutput: 'on-error' });
});

it('fuzzes command/tool substitutions as literal single-pass data including shell punctuation and Unicode', () => {
  const fragments = [
    ' ',
    "'",
    '"',
    '\n',
    '$HOME',
    '$(false)',
    '`false`',
    '${input:1}',
    'Café 日本',
    '\\',
    ';',
    '--option',
  ];
  for (let i = 0; i < 240; i++) {
    const value = `${fragments[i % fragments.length]}${fragments[(i * 7 + 3) % fragments.length]}-${i}`;
    expect(
      expandCommand({ kind: 'process', executable: '/tool', args: ['${input:1}'] }, { 'input:1': value }),
    ).toMatchObject({ args: [value] });
    expect(
      expandToolArguments({ kind: 'editor', args: ['$LOCAL', '--line=$LINE'] }, { LOCAL: value, LINE: '4' }),
    ).toEqual([value, '--line=4']);
  }
});

it('orders history by Git date-order across pages without changing the repository', async () => {
  const path = await root();
  const git = new GitRunner();
  const s = service(path);
  await mkdir(join(path, 'repo'));
  const repo = await s.initialize(1, join(path, 'repo'), false);
  const run = async (...args: string[]) => (await git.run(args, { cwd: repo.path })).stdout.trim();
  await run('config', 'user.name', 'P12');
  await run('config', 'user.email', 'p12@example.test');
  await run('commit', '--allow-empty', '-qm', 'Root');
  await run('branch', '-M', 'main');
  await run('branch', 'topic');
  await run('commit', '--allow-empty', '-qm', 'Main');
  await run('checkout', 'topic');
  await run('commit', '--allow-empty', '-qm', 'Topic');
  await run('checkout', 'main');
  const expected = (await run('log', '--all', '--date-order', '--format=%H')).split('\n');
  const ids: string[] = [];
  for (let offset = 0; offset < expected.length; offset++)
    ids.push(
      ...(
        await s.getHistory(1, repo.id, offset, 1, undefined, undefined, undefined, undefined, 'date')
      ).commits.map((commit) => commit.id),
    );
  expect(ids).toEqual(expected);
  expect(await run('status', '--porcelain')).toBe('');
});

it('applies checkout submodule preferences safely, preserves dirty children and records verbose operation commands', async () => {
  const path = await root();
  const git = new GitRunner();
  const s = service(path);
  const child = join(path, 'child');
  const parent = join(path, 'parent');
  await mkdir(child);
  await mkdir(parent);
  const run = async (cwd: string, ...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  for (const cwd of [child, parent]) {
    await run(cwd, 'init', '-q', '-b', 'main');
    await run(cwd, 'config', 'user.name', 'P12');
    await run(cwd, 'config', 'user.email', 'p12@example.test');
  }
  await writeFile(join(child, 'value'), 'one\n');
  await run(child, 'add', '.');
  await run(child, 'commit', '-qm', 'One');
  const old = await run(child, 'rev-parse', 'HEAD');
  await run(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'lib');
  await run(parent, 'commit', '-qam', 'Old pointer');
  await run(parent, 'branch', 'old');
  await writeFile(join(child, 'value'), 'two\n');
  await run(child, 'commit', '-qam', 'Two');
  await run(join(parent, 'lib'), 'fetch');
  await run(join(parent, 'lib'), 'checkout', 'origin/main');
  await run(parent, 'commit', '-qam', 'New pointer');
  const repo = await s.open(1, parent);
  await s.setTrust(1, repo.id, true);
  const settings = await s.getProductivityPreferences();
  const next = await s.setProductivityPreferences({
    ...settings,
    updateSubmodulesOnCheckout: true,
    verboseGitOutput: true,
    fetchAllTags: false,
  });
  await expect(s.setProductivityPreferences(settings)).rejects.toThrow('another window');
  const context = await s.getReferenceContext(1, repo.id);
  const operation = s.startReferenceAction(1, {
    id: repo.id,
    snapshot: context.snapshot,
    action: { kind: 'checkout-branch', fullName: 'refs/heads/old' },
  });
  await expect
    .poll(() => s.listOperations(1).find((entry) => entry.id === operation.id)?.status)
    .toBe('succeeded');
  expect(s.listOperations(1).find((entry) => entry.id === operation.id)?.output).toContain('$ git');
  expect(await run(join(parent, 'lib'), 'rev-parse', 'HEAD')).toBe(old);
  expect(await run(parent, 'status', '--porcelain')).toBe('');
  await writeFile(join(parent, 'lib', 'value'), 'local edit\n');
  const dirty = await s.getReferenceContext(1, repo.id);
  const result = await s.applyReferenceAction(1, {
    id: repo.id,
    snapshot: dirty.snapshot,
    action: { kind: 'checkout-branch', fullName: 'refs/heads/main' },
  });
  expect(result.status).toBe('applied');
  expect(result.message).toContain('Submodule update stopped');
  expect(await readFile(join(parent, 'lib', 'value'), 'utf8')).toBe('local edit\n');
  expect(await run(parent, 'branch', '--show-current')).toBe('main');
  s.dispose();
  await s.settled();
  expect(await service(path).getProductivityPreferences()).toEqual(next);
});
