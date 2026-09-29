import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitRunner } from '../src/backend/git/runner';
import type { GitRunOptions } from '../src/backend/git/runner';

const execute = promisify(execFile);
export async function signingFixture(options: { protected?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-signing-'));
  const cwd = join(root, 'repo');
  const gnupg = join(root, 'gnupg');
  const env = {
    ...process.env,
    GNUPGHOME: gnupg,
    GIT_CONFIG_GLOBAL: join(root, 'global-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const runner = new GitRunner();
  const git = {
    run: (args: readonly string[], options: GitRunOptions) =>
      runner.run(args, { ...options, env: { ...env, ...options.env } }),
  };
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const cleanup = async () => {
    await execute('gpgconf', ['--homedir', gnupg, '--kill', 'gpg-agent']).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  };
  try {
    await mkdir(cwd);
    await mkdir(gnupg, { mode: 0o700 });
    if (options.protected) {
      const program = join(gnupg, 'pinentry.ts');
      await copyFile(resolve('tests/helpers/pinentry-fixture.ts'), program);
      await chmod(program, 0o700);
      await writeFile(
        join(gnupg, 'gpg-agent.conf'),
        `pinentry-program ${program}\ndefault-cache-ttl 0\nmax-cache-ttl 0\n`,
      );
      await writeFile(join(gnupg, 'pinentry-mode'), 'accept');
      await writeFile(join(gnupg, 'fixture-passphrase'), 'synthetic-p10-passphrase', { mode: 0o600 });
    }
    await new Promise<void>((done, reject) => {
      const child = execFile(
        'gpg',
        [
          '--batch',
          '--pinentry-mode',
          'loopback',
          '--passphrase-fd',
          '0',
          '--quick-generate-key',
          'Workbench Test <signing@example.test>',
          'ed25519',
          'sign',
          '0',
        ],
        { env },
        (error) => (error ? reject(error) : done()),
      );
      child.stdin?.end(options.protected ? 'synthetic-p10-passphrase\n' : '\n');
    });
    const keys = await execute('gpg', ['--batch', '--with-colons', '--list-secret-keys'], { env });
    const fingerprint = keys.stdout
      .split('\n')
      .find((line) => line.startsWith('fpr:'))
      ?.split(':')[9];
    if (!fingerprint) throw new Error('Fixture key was not generated.');
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'Workbench Test');
    await run('config', 'user.email', 'signing@example.test');
    await run('config', 'user.signingkey', fingerprint);
    await run('commit', '--allow-empty', '--no-gpg-sign', '-qm', 'Unsigned baseline');
    return { root, cwd, gnupg, env, git, run, fingerprint, cleanup, repositoryId: `repo-${'f'.repeat(64)}` };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
