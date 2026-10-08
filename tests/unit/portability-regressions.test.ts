import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveGitExecutable } from '../../src/backend/git/executable';
import { GitRunner } from '../../src/backend/git/runner';
import { readConflictState, resolveConflict } from '../../src/backend/repositories/conflict-service';
import { gitEnvironment } from '../../src/backend/git/environment';
import { applyAuthenticationPolicy } from '../../src/backend/git/authentication-policy';
import { testPlatform } from '../platform';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-portability-'));
  roots.push(root);
  return root;
}

it('merges environment names using native case semantics and keeps prompt policy effective', () => {
  const source = {
    GW_TEST: 'original',
    gw_test: 'separate',
    ssh_askpass: 'fixture-helper',
    http_proxy: 'http://proxy.invalid',
    npm_config_fixture: 'preserved',
  };
  const merged = gitEnvironment(source, { GW_TEST: 'override' });
  expect(merged.GW_TEST).toBe('override');
  expect(merged.gw_test).toBe(testPlatform.windows ? undefined : 'separate');
  expect(merged.http_proxy).toBe(source.http_proxy);
  expect(merged.npm_config_fixture).toBe('preserved');
  if (testPlatform.windows) {
    expect(applyAuthenticationPolicy(merged, 'prompt')).toMatchObject({
      SSH_ASKPASS: 'fixture-helper',
      SSH_ASKPASS_REQUIRE: 'force',
    });
    expect(applyAuthenticationPolicy(merged, 'silent')).toMatchObject({
      SSH_ASKPASS: 'false',
      SSH_ASKPASS_REQUIRE: 'never',
    });
  }
  expect(source.GW_TEST).toBe('original');
});

it.skipIf(!testPlatform.windows)(
  'filters mixed-case Windows Git environment variables before spawning',
  async () => {
    const cwd = await directory();
    const git = new GitRunner();
    const foreign = join(cwd, 'foreign');
    await mkdir(foreign);
    await git.run(['init', '-q', '-b', 'main'], { cwd });
    await git.run(['init', '-q', '--bare'], { cwd: foreign });
    const result = await git.run(['rev-parse', '--show-toplevel'], {
      cwd,
      env: { git_dir: foreign, Git_Work_Tree: foreign },
    });
    expect(resolve(result.stdout.trim())).toBe(cwd);

    const names = ['GIT_DIR', 'GIT_TRACE', 'GCM_TRACE', 'GIT_CONFIG_KEY_7', 'GIT_CONFIG_VALUE_7', 'GW_TEST'];
    const probe = new GitRunner({ executable: process.execPath });
    const environment = JSON.parse(
      (
        await probe.run([resolve('tests/fixtures/operation-process.ts'), 'environment', ...names], {
          cwd,
          env: {
            git_dir: foreign,
            Git_Trace: join(cwd, 'trace'),
            Gcm_Trace: '1',
            git_config_key_7: 'user.name',
            git_config_value_7: 'injected',
            GW_TEST: 'old',
            gw_test: 'override',
          },
        })
      ).stdout,
    );
    expect(environment).toEqual(
      Object.fromEntries(names.map((name) => [name, name === 'GW_TEST' ? 'override' : null])),
    );
  },
);

it('resolves configured executables written with forward-slash relative paths', async () => {
  const requested = relative(process.cwd(), process.execPath).replaceAll('\\', '/');
  // Explicit paths must not depend on unrelated PATH entries accidentally resolving the same file.
  vi.stubEnv('PATH', await directory());
  expect(await resolveGitExecutable(requested)).toBe(await realpath(process.execPath));
});

it.each([false, true])(
  'resolves text-backed symlinks with core.symlinks=false (index locked: %s)',
  async (locked) => {
    const cwd = await directory();
    const git = new GitRunner();
    await git.run(['init', '-q', '-b', 'main'], { cwd });
    await git.run(['config', 'core.symlinks', 'false'], { cwd });
    const versions = [Buffer.from('base'), Buffer.from('ours'), Buffer.from('target with spaces')];
    const ids: string[] = [];
    for (const bytes of versions)
      ids.push((await git.run(['hash-object', '-w', '--stdin'], { cwd, stdin: bytes })).stdout.trim());
    await git.run(['update-index', '-z', '--index-info'], {
      cwd,
      stdin: ids.map((id, index) => `120000 ${id} ${index + 1}\tlink\0`).join(''),
    });
    await writeFile(join(cwd, 'link'), versions[1]!);
    const context = { repositoryId: `repo-${'a'.repeat(64)}`, cwd, gitDir: join(cwd, '.git') };
    const before = await readConflictState(git, context, { id: context.repositoryId, path: 'link' });
    expect(before.selected?.shape).toBe('symlink');
    if (locked) await writeFile(join(context.gitDir, 'index.lock'), 'external lock');
    const pending = resolveConflict(git, context, {
      id: context.repositoryId,
      path: 'link',
      snapshot: before.snapshot,
      choice: 'theirs',
    });
    if (locked) {
      await expect(pending).rejects.toThrow();
      expect(await readFile(join(cwd, 'link'))).toEqual(versions[1]);
      expect(await readFile(join(context.gitDir, 'index.lock'), 'utf8')).toBe('external lock');
      expect((await git.run(['ls-files', '--unmerged'], { cwd })).stdout).toContain(`120000 ${ids[2]} 3`);
    } else {
      expect((await pending).conflictedCount).toBe(0);
      expect((await lstat(join(cwd, 'link'))).isFile()).toBe(true);
      expect(await readFile(join(cwd, 'link'))).toEqual(versions[2]);
      expect((await git.run(['ls-files', '--stage'], { cwd })).stdout).toContain(`120000 ${ids[2]} 0`);
      expect((await git.run(['diff', '--name-only'], { cwd })).stdout).toBe('');
    }
  },
);
