import { access, chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAuthenticationPolicy } from '../../src/backend/git/authentication-policy';
import { GitCommandError, GitRunner } from '../../src/backend/git/runner';
import { runNetworkOperation } from '../../src/backend/repositories/network-service';
import type { GitRunOptions } from '../../src/backend/git/runner';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('external authentication policy', () => {
  it('suppresses askpass and credential-manager prompts while retaining agent and display state', () => {
    const environment = {
      GIT_ASKPASS: '/installed/askpass',
      SSH_ASKPASS: '/installed/ssh-askpass',
      SSH_AUTH_SOCK: '/agent/socket',
      WAYLAND_DISPLAY: 'wayland-test',
      DISPLAY: ':99',
      GCM_INTERACTIVE: 'always',
    };
    const silent = applyAuthenticationPolicy(environment, 'silent');
    expect(silent).toMatchObject({
      GIT_ASKPASS: 'false',
      SSH_ASKPASS: 'false',
      SSH_ASKPASS_REQUIRE: 'never',
      GCM_INTERACTIVE: 'never',
      GIT_TERMINAL_PROMPT: '0',
      SSH_AUTH_SOCK: '/agent/socket',
      WAYLAND_DISPLAY: 'wayland-test',
      DISPLAY: ':99',
      GIT_CONFIG_KEY_0: 'credential.interactive',
      GIT_CONFIG_VALUE_0: 'false',
    });
    expect(environment.GIT_ASKPASS).toBe('/installed/askpass');
    expect(Object.values(silent)).not.toContain('credential.helper');
    expect(applyAuthenticationPolicy(environment, 'prompt')).toMatchObject({
      GIT_ASKPASS: '/installed/askpass',
      SSH_ASKPASS: '/installed/ssh-askpass',
      SSH_ASKPASS_REQUIRE: 'force',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('prevents inherited and core.askPass execution in silent mode and allows explicit prompt mode', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'git-workbench-askpass-'));
    directories.push(cwd);
    const marker = join(cwd, 'invoked');
    const runner = new GitRunner();
    const helper = join(cwd, 'askpass.ts');
    await copyFile(resolve('tests/fixtures/native-askpass.ts'), helper);
    await chmod(helper, 0o700);
    const args = ['-c', 'credential.helper=', '-c', `core.askPass=${helper}`, 'credential', 'fill'];
    const options = {
      cwd,
      stdin: 'protocol=https\nhost=synthetic.invalid\n\n',
      env: { GIT_ASKPASS: helper, SSH_ASKPASS: helper, GIT_WORKBENCH_ASKPASS_TEST_MARKER: marker },
    };
    await expect(runner.run(args, options)).rejects.toBeInstanceOf(GitCommandError);
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    const result = await runner
      .run(args, { ...options, authentication: 'prompt' })
      .catch((error: unknown) => {
        if (error instanceof GitCommandError) throw new Error(error.stderr, { cause: error });
        throw error;
      });
    expect(result.stdout).toContain('username=fixture-user');
    expect(result.stdout).toContain('password=fixture-password');
    await expect(access(marker)).resolves.toBeUndefined();
  });

  it('carries a silent policy through background network execution and prompt through explicit work', async () => {
    const seen: GitRunOptions[] = [];
    const runner = {
      run: async (_args: readonly string[], options: GitRunOptions) => {
        seen.push(options);
        return { stdout: '', stderr: '', exitCode: 0, signal: null };
      },
    };
    const handle = {
      signal: new AbortController().signal,
      setProgress: () => undefined,
      appendOutput: () => undefined,
    };
    const plan = { kind: 'fetch' as const, args: ['fetch'], title: 'Fetch', command: 'git fetch' };
    await runNetworkOperation(runner, plan, '/synthetic', handle, 'silent');
    await runNetworkOperation(runner, plan, '/synthetic', handle);
    expect(seen.map((options) => options.authentication)).toEqual(['silent', 'prompt']);
  });
});
