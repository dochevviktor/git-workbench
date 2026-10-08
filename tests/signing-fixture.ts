import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitRunner } from '../src/backend/git/runner';
import type { GitRunOptions } from '../src/backend/git/runner';
import { gpgHome } from './platform';

const execute = promisify(execFile);
export async function signingFixture(
  options: {
    protected?: boolean;
    signal?: AbortSignal;
    onCleanup?: (cleanup: () => Promise<void>) => void;
  } = {},
) {
  // All agent sockets must fit Darwin's 104-byte sockaddr_un, including the longest suffix.
  const temporary = await realpath(tmpdir());
  const socketTemplate = join(temporary, 'workbench-signing-XXXXXX', 'gnupg', 'S.gpg-agent.browser');
  const parent =
    process.platform !== 'win32' && Buffer.byteLength(socketTemplate) >= 104
      ? await realpath('/tmp')
      : temporary;
  const root = await mkdtemp(join(parent, 'workbench-signing-'));
  const cwd = join(root, 'repo');
  const gnupg = join(root, 'gnupg');
  const env = {
    ...process.env,
    GNUPGHOME: gpgHome(gnupg),
    GIT_CONFIG_GLOBAL: join(root, 'global-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const runner = new GitRunner();
  const git = {
    run: (args: readonly string[], request: GitRunOptions) => {
      const signals = [options.signal, request.signal].filter((value): value is AbortSignal => !!value);
      return runner.run(args, {
        ...request,
        ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
        env: { ...env, ...request.env },
      });
    },
  };
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let cleaning: Promise<void> | undefined;
  const cleanup = () =>
    (cleaning ??= (async () => {
      await execute('gpgconf', ['--homedir', gpgHome(gnupg), '--kill', 'gpg-agent'], {
        env,
        timeout: 5000,
        killSignal: 'SIGKILL',
        windowsHide: true,
      }).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    })());
  options.onCleanup?.(cleanup);
  const command = (phase: string, args: string[], input?: string) =>
    new Promise<string>((done, reject) => {
      const child = execFile(
        'gpg',
        args,
        {
          env,
          timeout: 15000,
          killSignal: 'SIGKILL',
          windowsHide: true,
          maxBuffer: 64 * 1024,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        (error, stdout, stderr) => {
          if (error)
            reject(new Error(`GPG fixture ${phase} failed: ${error.message}\n${stderr.slice(0, 4000)}`));
          else done(stdout);
        },
      );
      child.stdin?.end(input);
    });
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
    await command(
      'key generation',
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
      options.protected ? 'synthetic-p10-passphrase\n' : '\n',
    );
    const keys = await command('key listing', ['--batch', '--with-colons', '--list-secret-keys']);
    const fingerprint = keys
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
