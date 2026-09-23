import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { GitCommandError, GitRunner } from '../../src/backend/git/runner';
import { classifyNetworkFailure } from '../../src/backend/repositories/network-service';

const exec = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

it.skipIf(process.platform !== 'linux')(
  'P05 uses a real SSH agent and encrypted key for Git against an isolated loopback sshd',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-ssh-'));
    const children: ChildProcess[] = [];
    const runner = new GitRunner();
    const git = async (args: string[], cwd = root) => (await runner.run(args, { cwd })).stdout.trim();
    try {
      // Every key, known host, authorized-key file and agent belongs only to this fixture.
      const hostKey = join(root, 'host');
      const key = join(root, 'identity');
      const knownHosts = join(root, 'known-hosts');
      const socket = join(root, 'agent.socket');
      const helper = join(root, 'askpass.ts');
      await copyFile(resolve('tests/fixtures/native-askpass.ts'), helper);
      await chmod(helper, 0o700);
      await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey]);
      await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'fixture-password', '-f', key]);
      const agent = spawn('ssh-agent', ['-D', '-a', socket], { stdio: 'ignore' });
      children.push(agent);
      const env = {
        ...process.env,
        SSH_AUTH_SOCK: socket,
        SSH_ASKPASS: helper,
        SSH_ASKPASS_REQUIRE: 'force',
        GIT_WORKBENCH_ASKPASS_TEST_MARKER: join(root, 'prompted'),
      };
      await expect
        .poll(() =>
          exec('ssh-add', ['-l'], { env }).then(
            () => 'ready',
            (error: unknown) => ((error as { code: number }).code === 1 ? 'ready' : 'waiting'),
          ),
        )
        .toBe('ready');
      await exec('ssh-add', [key], { env });
      expect(await readFile(join(root, 'prompted'), 'utf8')).toBe('invoked\n');
      const reservation = createServer();
      await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
      const port = (reservation.address() as AddressInfo).port;
      await new Promise<void>((done) => reservation.close(() => done()));
      const host = (await readFile(`${hostKey}.pub`, 'utf8')).split(' ').slice(0, 2).join(' ');
      await writeFile(knownHosts, `[127.0.0.1]:${port} ${host}\n`);
      // No installed daemon, account, home-directory file or system configuration is changed.
      const { stdout } = await exec('which', ['sshd']);
      const server = spawn(
        stdout.trim(),
        [
          '-D',
          '-e',
          '-f',
          '/dev/null',
          '-p',
          String(port),
          '-h',
          hostKey,
          '-o',
          'ListenAddress=127.0.0.1',
          '-o',
          `AuthorizedKeysFile=${key}.pub`,
          '-o',
          'StrictModes=no',
          '-o',
          'UsePAM=no',
          '-o',
          'PasswordAuthentication=no',
          '-o',
          'KbdInteractiveAuthentication=no',
          '-o',
          `PidFile=${join(root, 'sshd.pid')}`,
          '-o',
          `AllowUsers=${userInfo().username}`,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      children.push(server);
      let output = '';
      server.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      await expect.poll(() => output).toContain('Server listening');
      const bare = join(root, 'hub.git');
      const seed = join(root, 'seed');
      const checkout = join(root, 'checkout');
      await git(['init', '--bare', '-b', 'main', bare]);
      await git(['init', '-b', 'main', seed]);
      await git(['config', 'user.name', 'SSH Fixture'], seed);
      await git(['config', 'user.email', 'ssh@example.invalid'], seed);
      await git(['commit', '--allow-empty', '-m', 'base'], seed);
      await git(['push', bare, 'main'], seed);
      const sshCommand = `ssh -F /dev/null -oIdentityFile=none -oBatchMode=yes -oStrictHostKeyChecking=yes -oUserKnownHostsFile=${quote(knownHosts)}`;
      const network = (args: string[], cwd = root) =>
        runner.run(args, {
          cwd,
          authentication: 'silent',
          env: { SSH_AUTH_SOCK: socket, GIT_SSH_COMMAND: sshCommand },
        });
      await network(['clone', `ssh://${userInfo().username}@127.0.0.1:${port}${bare}`, checkout]);
      await git(['commit', '--allow-empty', '-m', 'remote advance'], seed);
      await git(['push', bare, 'main'], seed);
      await network(['fetch', 'origin'], checkout);
      await network(['pull', '--ff-only'], checkout);
      await git(['config', 'user.name', 'SSH Fixture'], checkout);
      await git(['config', 'user.email', 'ssh@example.invalid'], checkout);
      await git(['commit', '--allow-empty', '-m', 'pushed with agent'], checkout);
      await network(['push', 'origin', 'main'], checkout);
      expect(await git(['rev-parse', 'main'], bare)).toBe(await git(['rev-parse', 'HEAD'], checkout));
      expect(await readFile(join(checkout, '.git/config'), 'utf8')).not.toContain('fixture-password');
      await exec('ssh-add', ['-D'], { env });
      const failure = await network(['fetch', 'origin'], checkout).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(GitCommandError);
      expect(classifyNetworkFailure('fetch', (failure as GitCommandError).stderr).reason).toBe(
        'authentication',
      );
    } finally {
      for (const child of children.reverse()) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          await new Promise<void>((done) => child.once('close', () => done()));
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
