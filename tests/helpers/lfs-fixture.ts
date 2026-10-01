import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { GitRunner } from '../../src/backend/git/runner';
import type { GitRunOptions } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { testPlatform } from '../platform';

export function hasGitLfs() {
  if (!testPlatform.openssl) return false;
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
export const lfsPointer = (bytes: Buffer) =>
  `version https://git-lfs.github.com/spec/v1\noid sha256:${createHash('sha256').update(bytes).digest('hex')}\nsize ${bytes.length}\n`;

/** Real git-lfs against an authenticated loopback TLS server; no hosting account or public writes. */
export async function lfsFixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-lfs-network-'));
  const cwd = join(root, 'repo');
  const key = join(root, 'key.pem');
  const cert = join(root, 'cert.pem');
  const token = 'p10-synthetic-lfs-secret';
  const authorization = `Basic ${Buffer.from(`alice:${token}`).toString('base64')}`;
  const objects = new Map<string, Buffer>();
  const locks = new Map<string, { id: string; path: string; locked_at: string; owner: { name: string } }>();
  const requests: string[] = [];
  const logs: string[] = [];
  let rejectAuth = false;
  let slow = false;
  let corrupt = false;
  let credentialsUsed = 0;
  let anonymous = false;
  await mkdir(cwd);
  await promisify(execFile)('openssl', [
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
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  let origin = '';
  const server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (request, response) => {
      void (async () => {
        const path = new URL(request.url!, origin).pathname;
        requests.push(`${request.method} ${path}`);
        const json = (status: number, value: unknown) => {
          response.writeHead(status, { 'Content-Type': 'application/vnd.git-lfs+json' });
          response.end(JSON.stringify(value));
        };
        if (rejectAuth || (!anonymous && request.headers.authorization !== authorization)) {
          response.setHeader('WWW-Authenticate', 'Basic realm="fixture"');
          json(401, { message: 'Authentication required' });
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
        const raw = Buffer.concat(chunks);
        const body =
          request.headers['content-type']?.includes('json') && raw.length
            ? (JSON.parse(raw.toString()) as Record<string, unknown>)
            : {};
        if (path.endsWith('/objects/batch')) {
          const upload = body.operation === 'upload';
          json(200, {
            transfer: 'basic',
            objects: (body.objects as { oid: string; size: number }[]).map((item) => ({
              ...item,
              authenticated: true,
              ...(!upload && !objects.has(item.oid)
                ? { error: { code: 404, message: 'Object not found' } }
                : {
                    actions: {
                      [upload ? 'upload' : 'download']: {
                        href: `${origin}/objects/${item.oid}`,
                        header: { Authorization: authorization },
                      },
                    },
                  }),
            })),
          });
          return;
        }
        if (path.startsWith('/objects/')) {
          const oid = path.slice('/objects/'.length);
          if (request.method === 'PUT') {
            objects.set(oid, raw);
            response.writeHead(200);
            response.end();
            return;
          }
          const bytes = objects.get(oid);
          if (!bytes) {
            json(404, { message: 'Object not found' });
            return;
          }
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': bytes.length,
          });
          if (slow) {
            response.write(bytes.subarray(0, Math.min(1, bytes.length)));
            return;
          }
          response.end(corrupt ? Buffer.alloc(bytes.length, 0x19) : bytes);
          return;
        }
        if (path.endsWith('/locks/verify')) {
          json(200, {
            ours: [...locks.values()].filter((lock) => lock.owner.name === 'alice'),
            theirs: [...locks.values()].filter((lock) => lock.owner.name !== 'alice'),
            next_cursor: '',
          });
          return;
        }
        if (path.endsWith('/locks')) {
          if (request.method === 'GET') {
            json(200, { locks: [...locks.values()], next_cursor: '' });
            return;
          }
          if ([...locks.values()].some((lock) => lock.path === body.path)) {
            json(409, { message: 'Already locked' });
            return;
          }
          const lock = {
            id: String(locks.size + 100),
            path: String(body.path),
            locked_at: new Date().toISOString(),
            owner: { name: 'alice' },
          };
          locks.set(lock.id, lock);
          json(201, { lock });
          return;
        }
        const unlock = path.match(/\/locks\/([^/]+)\/unlock$/u);
        if (unlock) {
          const lock = locks.get(unlock[1]!);
          if (!lock || lock.owner.name !== 'alice' || body.force === true) {
            json(403, { message: 'Not your lock' });
            return;
          }
          locks.delete(lock.id);
          json(200, { lock });
          return;
        }
        json(404, { message: 'Unknown fixture endpoint' });
      })().catch(() => {
        response.writeHead(500);
        response.end();
      });
    },
  );
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'global'),
    GIT_LFS_SKIP_SMUDGE: '1',
    NO_PROXY: '127.0.0.1',
    no_proxy: '127.0.0.1',
  };
  const native = new GitRunner({
    logger: (entry) => logs.push(entry.command),
    credentials: {
      executable: process.execPath,
      helperPath: resolve('src/backend/git/credential-helper.ts'),
      source: {
        available: async () => true,
        scopes: async () => [origin],
        get: async (context) => {
          if (context.host !== new URL(origin).host || !context.path.startsWith('org/repo.git')) return null;
          credentialsUsed++;
          return { username: 'alice', password: token };
        },
      },
    },
  });
  const runner = {
    get executable() {
      return native.executable;
    },
    version: () => native.version(),
    run: (args: readonly string[], options: GitRunOptions) =>
      native.run(args, { ...options, env: { ...env, ...options.env } }),
  };
  const git = async (...args: string[]) => (await runner.run(args, { cwd })).stdout.trim();
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'LFS Fixture');
  await git('config', 'user.email', 'lfs@example.invalid');
  await git('config', 'http.sslCAInfo', cert);
  await git('remote', 'add', 'origin', `${origin}/org/repo.git`);
  await git('config', 'lfs.url', `${origin}/org/repo.git/info/lfs`);
  const payload = Buffer.alloc(32768, 0x5a);
  const oid = createHash('sha256').update(payload).digest('hex');
  objects.set(oid, payload);
  const pointer = lfsPointer(payload);
  await writeFile(join(cwd, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
  await writeFile(join(cwd, 'sample.bin'), pointer);
  await git('add', '.');
  await git('commit', '-qm', 'LFS baseline');
  const head = await git('rev-parse', 'HEAD');
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner });
  await service.setAutomaticFetch(false);
  const repository = await service.open(1, cwd);
  await service.setTrust(1, repository.id, true);
  return {
    root,
    cwd,
    env,
    git,
    runner,
    service,
    repository,
    payload,
    oid,
    pointer,
    head,
    requests,
    logs,
    locks,
    objects,
    token,
    origin,
    credentialsUsed: () => credentialsUsed,
    setAnonymous: (value: boolean) => {
      anonymous = value;
    },
    setRejectAuth: (value: boolean) => {
      rejectAuth = value;
    },
    setSlow: (value: boolean) => {
      slow = value;
    },
    setCorrupt: (value: boolean) => {
      corrupt = value;
    },
    cleanup: async () => {
      service.dispose();
      await service.settled();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    },
  };
}
