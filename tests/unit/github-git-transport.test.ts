import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import type { Socket, AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { createCredentialBroker, credentialProgress } from '../../src/backend/git/credential-broker';
import type { GitCredentialSource } from '../../src/backend/git/credential-broker';
import { GitCommandError, GitRunner } from '../../src/backend/git/runner';
import { isAllowedRemoteUrl } from '../../src/backend/repositories/remote-service';
import { HostingAccountStore } from '../../src/backend/hosting/account-store';
import { HostingService } from '../../src/backend/hosting/hosting-service';
import { GitHubProvider } from '../../src/backend/hosting/github-provider';

const token = 'synthetic_private_git_token';
const credential = { username: 'fixture-user', password: token };
const helperPath = resolve('src/backend/git/credential-helper.ts');
const exec = promisify(execFile);

describe('GitHub account credential transport', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps its private socket usable with a long multibyte temporary path',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'workbench-long-temp-'));
      const temporary = join(root, 'é'.repeat(50));
      await mkdir(temporary);
      vi.stubEnv('TMPDIR', temporary);
      let broker: Awaited<ReturnType<typeof createCredentialBroker>> | undefined;
      try {
        broker = await createCredentialBroker({
          source: { available: async () => true, get: async () => credential },
          executable: process.execPath,
          helperPath,
        });
        expect(Buffer.byteLength(broker.env.GW_CREDENTIAL_SOCKET)).toBeLessThan(104);
        expect((await stat(dirname(broker.env.GW_CREDENTIAL_SOCKET))).mode & 0o777).toBe(0o700);
        const result = await new GitRunner().run([...broker.args, 'credential', 'fill'], {
          cwd: root,
          env: broker.env,
          stdin: 'protocol=https\nhost=github.com\npath=org/private.git\n\n',
        });
        expect(result.stdout).toContain(`password=${token}`);
      } finally {
        await broker?.close();
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
      }
      await expect(stat(dirname(broker!.env.GW_CREDENTIAL_SOCKET))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('accepts a public GitHub login in an HTTPS remote but rejects token URLs', () => {
    expect(isAllowedRemoteUrl('https://fixture-user@github.com/org/private.git')).toBe(true);
    expect(isAllowedRemoteUrl('https://fixture_user@git.example:8443/group/subgroup/private.git')).toBe(true);
    for (const url of [
      'https://user:password@github.com/org/private.git',
      'https://ghp_token@github.com/org/private.git',
      'https://glpat-private_token@gitlab.com/org/private.git',
      'https://user@github.com/org/private.git?token=private',
    ])
      expect(isAllowedRemoteUrl(url)).toBe(false);
  });
  it('feeds Git through a private helper, refuses hostile contexts, redacts split output and removes its socket', async () => {
    const source: GitCredentialSource = { available: async () => true, get: vi.fn(async () => credential) };
    const broker = await createCredentialBroker({ source, executable: process.execPath, helperPath });
    try {
      const runner = new GitRunner();
      const result = await runner.run([...broker.args, 'credential', 'fill'], {
        cwd: tmpdir(),
        env: broker.env,
        stdin:
          'capability[]=authtype\ncapability[]=state\nprotocol=https\nhost=github.com\npath=org/private.git\n\n',
      });
      expect(result.stdout).toContain(`password=${token}`);
      expect(source.get).toHaveBeenCalledWith({
        protocol: 'https',
        host: 'github.com',
        path: 'org/private.git',
        username: '',
      });
      const progress: string[] = [];
      const stream = credentialProgress(broker.redact, broker.retain, (value) => progress.push(value));
      stream.write(`progress\n${token.slice(0, 10)}`);
      expect(progress.join('')).toBe('progress\n');
      stream.write(`${token.slice(10)}\n`);
      stream.flush();
      expect(progress.join('')).toBe('progress\n<redacted>\n');
      stream.write(token.slice(0, 10));
      stream.flush();
      expect(progress.join('')).toBe('progress\n<redacted>\n<redacted>');
      expect(broker.redact(Buffer.from(`fixture-user:${token}`).toString('base64'))).toBe('<redacted>');
      // Even possession of the helper session cannot request a credential for another origin.
      const denied = await new Promise<string>((done) => {
        const socket = connect(broker.env.GW_CREDENTIAL_SOCKET);
        let data = '';
        socket.on('data', (chunk) => {
          data += String(chunk);
        });
        socket.on('end', () => done(data));
        socket.write(
          `${JSON.stringify({
            nonce: broker.env.GW_CREDENTIAL_NONCE,
            context: {
              protocol: 'http',
              host: 'evil.example',
              path: 'org/private.git',
              username: '',
            },
          })}\n`,
        );
      });
      expect(denied).toBe('null\n');
      expect(source.get).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(broker.args) + JSON.stringify(broker.env)).not.toContain(token);
    } finally {
      await broker.close();
    }
    if (process.platform !== 'win32')
      await expect(readFile(broker.env.GW_CREDENTIAL_SOCKET)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops reusing a rejected credential within one operation without deleting its account', async () => {
    const source: GitCredentialSource = { available: async () => true, get: vi.fn(async () => credential) };
    const runner = new GitRunner();
    const input = 'protocol=https\nhost=github.com\npath=org/private.git\n\n';
    const broker = await createCredentialBroker({ source, executable: process.execPath, helperPath });
    try {
      const call = (action: string, stdin = input) =>
        runner.run([...broker.args, 'credential', action], { cwd: tmpdir(), env: broker.env, stdin });
      expect((await call('fill')).stdout).toContain(`password=${token}`);
      await call(
        'reject',
        `protocol=https\nhost=github.com\npath=org/private.git\nusername=${credential.username}\npassword=${token}\n\n`,
      );
      await expect(call('fill')).rejects.toBeInstanceOf(GitCommandError);
      expect(source.get).toHaveBeenCalledTimes(1);
      expect(
        (await call('fill', 'protocol=https\nhost=github.com\npath=org/other.git\n\n')).stdout,
      ).toContain(`password=${token}`);
    } finally {
      await broker.close();
    }
    const next = await createCredentialBroker({ source, executable: process.execPath, helperPath });
    try {
      expect(
        (
          await runner.run([...next.args, 'credential', 'fill'], {
            cwd: tmpdir(),
            env: next.env,
            stdin: input,
          })
        ).stdout,
      ).toContain(`password=${token}`);
    } finally {
      await next.close();
    }
  });

  it.each([
    ['github', 'github.com', 'org'],
    ['gitlab-server', 'git.example', 'lab/org'],
  ] as const)(
    'authenticates real %s clone, fetch, pull and push using only a local TLS fixture',
    async (kind, host, repositoryPrefix) => {
      const root = await mkdtemp(join(tmpdir(), 'workbench-private-http-'));
      const bare = join(root, 'private.git');
      const seed = join(root, 'seed');
      const checkout = join(root, 'checkout');
      const globalConfig = join(root, 'global-config');
      const isolated = {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: globalConfig,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        NO_PROXY: '',
        no_proxy: '',
      };
      const plain = new GitRunner();
      const git = (args: string[], cwd = root) => plain.run(args, { cwd, env: isolated });
      let valid = true;
      let authenticated = 0;
      const provider = new GitHubProvider();
      vi.spyOn(provider, 'identity').mockResolvedValue({ id: '42', login: 'fixture-user' });
      const hosting = new HostingService(
        new HostingAccountStore(join(root, 'credentials.json'), {
          available: () => false,
          encrypt: () => Buffer.alloc(0),
          decrypt: () => '',
        }),
        provider,
        () => provider,
      );
      const source = hosting.gitCredentials;
      vi.spyOn(source, 'get');
      const logs: string[] = [];
      const runner = new GitRunner({
        credentials: { source, executable: process.execPath, helperPath },
        logger: (entry) => logs.push(entry.command),
      });
      const key = join(root, 'key.pem');
      const cert = join(root, 'cert.pem');
      const sockets = new Set<Socket>();
      let upstream: ReturnType<typeof createHttpsServer> | undefined;
      let proxy: ReturnType<typeof createHttpServer> | undefined;
      try {
        const account = await hosting.connectToken(1, {
          remember: false,
          provider: kind,
          token,
          ...(kind === 'gitlab-server' ? { serverUrl: `https://${host}/lab` } : {}),
        });
        await writeFile(globalConfig, '');
        await exec('openssl', [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          key,
          '-out',
          cert,
          '-days',
          '1',
          '-subj',
          `/CN=${host}`,
        ]);
        await git(['init', '--bare', bare]);
        await git(['--git-dir', bare, 'config', 'http.receivepack', 'true']);
        await git(['init', '-b', 'main', seed]);
        await writeFile(join(seed, 'readme.txt'), 'initial\n');
        await git(['add', '.'], seed);
        await git(['commit', '-m', 'initial'], seed);
        await git(['push', bare, 'main'], seed);
        await git(['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
        const backend = join((await git(['--exec-path'])).stdout.trim(), 'git-http-backend');
        upstream = createHttpsServer(
          { key: await readFile(key), cert: await readFile(cert) },
          (request, response) => {
            if (
              !valid ||
              request.headers.authorization !==
                `Basic ${Buffer.from(`fixture-user:${token}`).toString('base64')}`
            ) {
              response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' });
              response.end('Authentication required');
              return;
            }
            authenticated++;
            const url = new URL(request.url!, `https://${host}`);
            const child = spawn(backend, [], {
              env: {
                ...process.env,
                ...isolated,
                GIT_PROJECT_ROOT: root,
                GIT_HTTP_EXPORT_ALL: '1',
                REMOTE_USER: 'fixture-user',
                PATH_INFO: url.pathname.replace(`/${repositoryPrefix}/`, '/'),
                QUERY_STRING: url.search.slice(1),
                REQUEST_METHOD: request.method!,
                CONTENT_TYPE: request.headers['content-type'] ?? '',
                CONTENT_LENGTH: request.headers['content-length'] ?? '',
              },
              stdio: ['pipe', 'pipe', 'ignore'],
            });
            request.pipe(child.stdin);
            child.stdin.on('error', () => undefined);
            let headers = Buffer.alloc(0);
            let started = false;
            child.stdout.on('data', (chunk: Buffer) => {
              if (started) {
                response.write(chunk);
                return;
              }
              headers = Buffer.concat([headers, chunk]);
              const end = headers.indexOf('\r\n\r\n');
              if (end < 0) return;
              for (const line of headers.subarray(0, end).toString().split('\r\n')) {
                const colon = line.indexOf(':');
                if (line.startsWith('Status:'))
                  response.statusCode = Number(
                    line
                      .slice(colon + 1)
                      .trim()
                      .split(' ')[0],
                  );
                else response.setHeader(line.slice(0, colon), line.slice(colon + 1).trim());
              }
              response.write(headers.subarray(end + 4));
              headers = Buffer.alloc(0);
              started = true;
            });
            child.on('close', () => response.end());
            child.on('error', () => {
              response.statusCode = 500;
              response.end();
            });
          },
        );
        await new Promise<void>((done) => upstream!.listen(0, '127.0.0.1', done));
        const upstreamPort = (upstream.address() as AddressInfo).port;
        proxy = createHttpServer();
        proxy.on('connect', (request, client, head) => {
          // The proxy connects ONLY to this local fixture, never to a requested public destination.
          if (request.url !== `${host}:443`) {
            client.destroy();
            return;
          }
          const remote = connect(upstreamPort, '127.0.0.1', () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) remote.write(head);
            client.pipe(remote).pipe(client);
          });
          sockets.add(remote);
          remote.on('close', () => sockets.delete(remote));
          remote.on('error', () => client.destroy());
          client.on('error', () => remote.destroy());
        });
        proxy.on('connection', (socket) => {
          sockets.add(socket);
          socket.on('close', () => sockets.delete(socket));
        });
        await new Promise<void>((done) => proxy!.listen(0, '127.0.0.1', done));
        const proxyPort = (proxy.address() as AddressInfo).port;
        const options = { cwd: root, env: isolated, onStderr: (value: string) => logs.push(value) };
        // Certificate verification is disabled only for this synthetic TLS server, in this test's argv.
        const network = (args: string[], cwd = root) =>
          runner
            .run(
              [
                '-c',
                `http.proxy=http://127.0.0.1:${proxyPort}`,
                '-c',
                'http.sslVerify=false',
                '-c',
                'credential.helper=',
                ...args,
              ],
              { ...options, cwd },
            )
            .catch((error: unknown) => {
              if (error instanceof GitCommandError) error.message = error.stderr;
              throw error;
            });
        expect(
          (await network(['ls-remote', '--symref', `https://${host}/${repositoryPrefix}/private.git`]))
            .stdout,
        ).toContain('refs/heads/main');
        await network(['clone', `https://fixture-user@${host}/${repositoryPrefix}/private.git`, checkout]);
        await git(['commit', '--allow-empty', '-m', 'upstream'], seed);
        await git(['push', bare, 'main'], seed);
        await network(['fetch', 'origin'], checkout);
        expect((await git(['rev-list', '--count', 'HEAD..origin/main'], checkout)).stdout.trim()).toBe('1');
        await network(['pull', '--ff-only'], checkout);
        await git(['commit', '--allow-empty', '-m', 'from app'], checkout);
        await network(['push', 'origin', 'main'], checkout);
        expect((await git(['--git-dir', bare, 'rev-parse', 'main'])).stdout).toBe(
          (await git(['rev-parse', 'HEAD'], checkout)).stdout,
        );
        expect(authenticated).toBeGreaterThanOrEqual(4);
        expect(source.get).toHaveBeenCalled();
        expect(await readFile(join(checkout, '.git/config'), 'utf8')).not.toMatch(
          /credential|synthetic_private_git_token/u,
        );
        expect(await readFile(globalConfig, 'utf8')).toBe('');
        expect(logs.join('')).not.toContain(token);
        valid = false;
        await expect(network(['fetch', 'origin'], checkout)).rejects.toBeInstanceOf(GitCommandError);
        await hosting.disconnect(account!.id);
        const calls = vi.mocked(source.get).mock.calls.length;
        await expect(network(['fetch', 'origin'], checkout)).rejects.toBeInstanceOf(GitCommandError);
        expect(source.get).toHaveBeenCalledTimes(calls);
      } finally {
        for (const socket of sockets) socket.destroy();
        proxy?.closeAllConnections();
        upstream?.closeAllConnections();
        await Promise.all(
          [proxy, upstream]
            .filter((server) => server?.listening)
            .map((server) => new Promise<void>((done) => server!.close(() => done()))),
        );
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
