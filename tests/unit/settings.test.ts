import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { GitRunner } from '../../src/backend/git/runner';
import { GitSettingsService, globalConfigPath } from '../../src/backend/repositories/settings-service';
import { saveGitSettingsSchema, issueRuleSchema } from '../../src/common/ipc/settings';
import type { GitSettings } from '../../src/common/ipc/settings';
import { canInvokeCommitInspector } from '../../src/backend/electron/commit-inspector-policy';
import { requests } from '../../src/common/ipc/contracts';
import { GitInstanceStore } from '../../src/backend/git/instance-store';

vi.mock('node:fs/promises', { spy: true });

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.rename).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).rename);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f34-'));
  roots.push(root);
  const global = join(root, 'global');
  await writeFile(
    global,
    '[user]\n name = Global Author\n email = global@example.test\n[alias]\n retained = status\n',
  );
  const runner = new GitRunner();
  const env = {
    GIT_CONFIG_GLOBAL: global,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: undefined,
    GIT_AUTHOR_EMAIL: undefined,
    GIT_COMMITTER_NAME: undefined,
    GIT_COMMITTER_EMAIL: undefined,
  };
  const isolated = {
    run: (args: readonly string[], options: Parameters<GitRunner['run']>[1]) =>
      runner.run(args, { ...options, env }),
  };
  const service = new GitSettingsService(isolated);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const run = async (...args: string[]) => (await isolated.run(args, { cwd })).stdout.trimEnd();
  await run('init', '-q', '-b', 'main');
  const path = join(cwd, '.git', 'config');
  const read = () => service.read('repo', cwd, path);
  return { root, global, cwd, path, run, service, read, isolated };
}
const input = (value: GitSettings) => ({
  id: value.id,
  snapshot: value.snapshot,
  name: value.name,
  email: value.email,
  issueRule: value.issueRule,
});

describe('F34 scoped settings', () => {
  it('atomically saves global signing/template defaults and repository overrides while retaining unrelated values', async () => {
    const f = await fixture();
    const template = join(f.root, 'message template.txt');
    await writeFile(template, 'Reviewed subject\n\nBody\n');
    const global = await f.service.read(null, f.cwd, f.global);
    await f.service.save(f.cwd, f.global, {
      ...input(global),
      options: [
        { key: 'user.signingkey', value: 'A'.repeat(40) },
        { key: 'commit.gpgsign', value: 'true' },
        { key: 'tag.gpgsign', value: 'false' },
        { key: 'commit.template', value: template },
      ],
    });
    expect(await f.run('config', '--bool', 'commit.gpgsign')).toBe('true');
    expect(await f.run('config', 'commit.template')).toBe(template);
    expect(await f.run('config', 'alias.retained')).toBe('status');
    const local = await f.read();
    expect(local.options?.find((entry) => entry.key === 'user.signingkey')?.effective).toMatchObject({
      value: 'A'.repeat(40),
      scope: 'global',
    });
    await f.service.save(f.cwd, f.path, {
      ...input(local),
      options: [{ key: 'commit.gpgsign', value: 'false' }],
    });
    expect(await f.run('config', '--bool', 'commit.gpgsign')).toBe('false');
    await f.service.save(f.cwd, f.path, {
      ...input(await f.read()),
      options: [{ key: 'commit.gpgsign', value: null }],
    });
    expect(await f.run('config', '--bool', 'commit.gpgsign')).toBe('true');
    const before = await readFile(f.global);
    const noOp = await f.service.read(null, f.cwd, f.global);
    await f.service.save(f.cwd, f.global, input(noOp));
    expect(await readFile(f.global)).toEqual(before);
    await f.run('config', '--global', 'tag.gpgsign', 'yes');
    await expect(
      f.service.save(f.cwd, f.global, { ...input(noOp), options: [{ key: 'commit.template', value: null }] }),
    ).rejects.toThrow('changed outside');
  });
  it('does not remove a new writer lock acquired immediately after publishing', async () => {
    const f = await fixture();
    const { rename } = await vi.importActual<typeof fs>('node:fs/promises');
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      await rename(source, destination);
      if (destination === f.path) await writeFile(`${f.path}.lock`, 'next writer');
    });
    await f.service.save(f.cwd, f.path, { ...input(await f.read()), name: 'Published' });
    expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('next writer');
  });
  it('validates and persists Git selection; rejects missing executables, stale saves and damaged files', async () => {
    const f = await fixture();
    const path = join(f.root, 'instance.json');
    const store = new GitInstanceStore(path);
    const initial = await store.read();
    expect(initial.executable).toBe(null);
    await expect(store.save({ ...initial, executable: join(f.root, 'missing-git') })).rejects.toMatchObject({
      code: 'GIT_UNAVAILABLE',
    });
    await expect(store.save({ ...initial, executable: 'relative-git' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const executable = (await new GitRunner().version()).executable;
    const saved = await store.save({ ...initial, executable });
    expect(await new GitInstanceStore(path).read()).toEqual(saved);
    await expect(store.save({ ...initial, executable: null })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
    });
    await store.save({ ...saved, executable: null });
    await writeFile(path, 'damaged');
    await expect(store.read()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await readFile(path, 'utf8')).toBe('damaged');
  });
  it('reads without mutation and atomically saves identity, preserving unrelated configuration', async () => {
    const f = await fixture();
    const bytes = await readFile(f.path);
    const before = await f.read();
    expect(before.effectiveName).toMatchObject({ value: 'Global Author', scope: 'global' });
    expect(await readFile(f.path)).toEqual(bytes);
    await f.service.save(f.cwd, f.path, input(before));
    expect(await readFile(f.path)).toEqual(bytes);
    const saved = await f.service.save(f.cwd, f.path, {
      ...input(before),
      name: 'Local Café',
      email: 'local@example.test',
    });
    expect(saved.effectiveName).toMatchObject({ value: 'Local Café', scope: 'local' });
    expect(await f.run('config', '--get', 'core.repositoryformatversion')).toBe('0');
    expect(await f.run('var', 'GIT_AUTHOR_IDENT')).toContain('Local Café <local@example.test>');
    const removed = await f.service.save(f.cwd, f.path, { ...input(saved), name: null, email: null });
    expect(removed.effectiveName.value).toBe('Global Author');
    expect(await readFile(f.global, 'utf8')).toContain('retained = status');
  });
  it('global edits affect inheritance across repositories; local values remain isolated', async () => {
    const f = await fixture();
    const second = join(f.root, 'second');
    await mkdir(second);
    await f.isolated.run(['init', '-q'], { cwd: second });
    await f.service.save(f.cwd, f.path, { ...input(await f.read()), name: 'Local', email: null });
    const global = await f.service.read(null, f.root, f.global);
    await f.service.save(f.root, f.global, {
      ...input(global),
      name: 'Changed global',
      email: 'new@example.test',
    });
    expect((await f.read()).effectiveName.value).toBe('Local');
    const other = await f.service.read('second', second, join(second, '.git/config'));
    expect(other.effectiveName.value).toBe('Changed global');
    expect(other.effectiveEmail.value).toBe('new@example.test');
    expect(await f.run('config', '--global', 'alias.retained')).toBe('status');
  });
  it('shares repository configuration with linked worktrees without erasing worktree overrides', async () => {
    const f = await fixture();
    await f.run(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'Initial',
    );
    const linked = join(f.root, 'linked');
    await f.run('worktree', 'add', '-qb', 'linked', linked);
    const before = await f.read();
    await f.service.save(f.cwd, f.path, { ...input(before), name: 'Shared', email: 'shared@example.test' });
    expect((await f.service.read('linked', linked, f.path)).effectiveName.value).toBe('Shared');
    await f.run('config', 'extensions.worktreeConfig', 'true');
    await f.isolated.run(['config', '--worktree', 'user.name', 'Worktree'], { cwd: linked });
    const settings = await f.service.read('linked', linked, f.path);
    expect(settings.effectiveName.scope).toBe('worktree');
    const result = await f.service.save(linked, f.path, { ...input(settings), name: null, email: null });
    expect(result.effectiveName.value).toBe('Worktree');
    expect((await f.read()).effectiveName.value).toBe('Global Author');
  });
  it('rejects stale writes, locks and invalid fields without losing either identity field', async () => {
    const f = await fixture();
    const before = await f.read();
    await f.run('config', 'alias.external', 'status');
    await expect(f.service.save(f.cwd, f.path, { ...input(before), name: 'Stale' })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
    });
    const current = await f.read();
    await writeFile(`${f.path}.lock`, 'external lock');
    await expect(f.service.save(f.cwd, f.path, { ...input(current), name: 'Locked' })).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
    expect(await readFile(`${f.path}.lock`, 'utf8')).toBe('external lock');
    expect((await f.read()).name).toBe(null);
    expect(saveGitSettingsSchema.safeParse({ ...input(current), name: 'Bad\nName' }).success).toBe(false);
    expect(saveGitSettingsSchema.safeParse({ ...input(current), email: 'invalid' }).success).toBe(false);
  });
  it('tracks inherited include changes and edits only the explicit destination', async () => {
    const f = await fixture();
    const included = join(f.root, 'identity');
    await writeFile(included, '[user]\n name = Included\n');
    await writeFile(f.global, `[include]\n path = ${included}\n`);
    const before = await f.read();
    expect(before.effectiveName.origin).toBe(`file:${included}`);
    await writeFile(included, '[user]\n name = Externally changed\n');
    await expect(f.service.save(f.cwd, f.path, { ...input(before), name: 'Local' })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
    });
    expect(await readFile(included, 'utf8')).toContain('Externally changed');
  });

  it('does not partially publish identity when preparing the second field fails', async () => {
    const f = await fixture();
    const original = await readFile(f.path);
    const service = new GitSettingsService({
      run: (args, options) => {
        if (args.includes('--replace-all') && args.includes('user.email'))
          throw new Error('Injected preparation failure');
        return f.isolated.run(args, options);
      },
    });
    await expect(
      service.save(f.cwd, f.path, { ...input(await f.read()), name: 'First', email: 'second@example.test' }),
    ).rejects.toThrow('Injected');
    expect(await readFile(f.path)).toEqual(original);
    await expect(readFile(`${f.path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('persists issue rules and rejects unsafe destinations and inspector writes', async () => {
    const f = await fixture();
    const issueRule = { prefix: 'BUG-', url: 'https://example.test/issues/{id}' };
    await f.service.save(f.cwd, f.path, { ...input(await f.read()), issueRule });
    expect((await new GitSettingsService(f.isolated).read('repo', f.cwd, f.path)).issueRule).toEqual(
      issueRule,
    );
    for (const url of [
      'javascript:alert(1)',
      'https://user:secret@example.test/{id}',
      'https://{id}.test/',
      'https://example.test/',
    ])
      expect(issueRuleSchema.safeParse({ ...issueRule, url }).success).toBe(false);
    expect(canInvokeCommitInspector(requests.saveGitSettings.channel, { id: 'repo' })).toBe(false);
    expect(canInvokeCommitInspector(requests.getGitSettings.channel, { id: null })).toBe(false);
  });
  it('resolves global write scope and preserves symlink destinations', async () => {
    const f = await fixture();
    const home = join(f.root, 'home');
    await mkdir(join(home, '.config/git'), { recursive: true });
    const xdg = join(home, '.config/git/config');
    await writeFile(xdg, '');
    expect(await globalConfigPath({ HOME: home })).toBe(xdg);
    const link = join(home, '.gitconfig');
    await symlink(f.global, link);
    expect(await globalConfigPath({ HOME: home })).toBe(link);
    const settings = await f.service.read(null, f.root, link);
    await f.service.save(f.root, link, { ...input(settings), name: 'Through link' });
    expect(await readFile(f.global, 'utf8')).toContain('Through link');
  });
});
