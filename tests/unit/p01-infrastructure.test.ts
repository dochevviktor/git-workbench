import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
  rm,
  rename,
  access,
  copyFile,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitRunner,
  GitCancelledError,
  GitCommandError,
  GitExecutableError,
  GitOutputLimitError,
  GitSpawnError,
  GitTimeoutError,
  sanitizeGitOutput,
} from '../../src/backend/git/runner';
import { ReadCoordinator } from '../../src/backend/git/read-coordinator';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { RepositoryTrustStore } from '../../src/backend/git/trust-store';
import { RepositoryGitRunner } from '../../src/backend/git/repository-runner';
import { OperationRegistry } from '../../src/backend/operations/operation-registry';
import type { OperationHandle, OperationOutcome } from '../../src/backend/operations/operation-registry';
import { gitCapabilities } from '../../src/backend/git/capabilities';
import { requests } from '../../src/common/ipc/contracts';
import { canInvokeCommitInspector } from '../../src/backend/electron/commit-inspector-policy';
import { operationFixture } from '../operation-fixture';

const cleanups: (() => Promise<unknown>)[] = [];
const script = resolve('tests/fixtures/operation-process.ts');
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'git-workbench-runner-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function fixture() {
  const f = await operationFixture();
  cleanups.push(f.cleanup);
  return f;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

describe('P01 execution boundary', () => {
  it('classifies discovery, spawn, exit, output and timeout failures separately', async () => {
    const cwd = await directory();
    await expect(new GitRunner({ executable: join(cwd, 'missing') }).run([], { cwd })).rejects.toBeInstanceOf(
      GitExecutableError,
    );
    await expect(new GitRunner({ executable: cwd }).run([], { cwd })).rejects.toBeInstanceOf(
      GitExecutableError,
    );
    const runner = new GitRunner({ executable: process.execPath });
    await expect(runner.run([script], { cwd: join(cwd, 'missing') })).rejects.toBeInstanceOf(GitSpawnError);
    await expect(runner.run(['--invalid-option'], { cwd })).rejects.toMatchObject({
      constructor: GitCommandError,
      exitCode: expect.any(Number),
    });
    await expect(runner.run([script, 'output'], { cwd, maxOutputBytes: 128 })).rejects.toBeInstanceOf(
      GitOutputLimitError,
    );
    await expect(runner.run([script, 'wait'], { cwd, timeoutMs: 50 })).rejects.toBeInstanceOf(
      GitTimeoutError,
    );
  });

  it('preserves unusual argv as data and never logs URL or header credentials', async () => {
    const cwd = await directory();
    const logs: unknown[] = [];
    const runner = new GitRunner({ executable: process.execPath, logger: (entry) => logs.push(entry) });
    const args = [
      '-dash',
      'space café\nline',
      '$(touch injected)',
      '`touch injected`',
      'https://user:private@host/a?token=secret',
      'Authorization: Bearer sensitive',
    ];
    expect(JSON.parse((await runner.run([script, 'arguments', ...args], { cwd })).stdout)).toEqual(args);
    await expect(access(join(cwd, 'injected'))).rejects.toThrow();
    const text = JSON.stringify(logs);
    for (const secret of ['private', 'secret', 'sensitive']) expect(text).not.toContain(secret);
    expect(sanitizeGitOutput('\u001b[31mPassword=private\u001b[0m')).toBe('Password=<redacted>');
  });

  it('removes inherited repository redirects, config injection and trace destinations', async () => {
    const f = await fixture();
    const trace = join(f.root, 'trace');
    vi.stubEnv('GIT_DIR', f.bare);
    vi.stubEnv('GIT_INDEX_FILE', join(f.root, 'foreign-index'));
    vi.stubEnv('GIT_TRACE', trace);
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'user.name');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'injected');
    expect(await f.run('config', 'user.name')).toBe('Operation Fixture');
    expect(await f.run('rev-parse', '--show-toplevel')).toBe(f.cwd);
    expect(await f.run('ls-files', '-z')).toContain('-file café');
    await expect(access(trace)).rejects.toThrow();
  });

  it('kills a descendant that ignores SIGTERM even when its parent exits and closes the pipes', async () => {
    const cwd = await directory();
    const marker = join(cwd, 'pid');
    const runner = new GitRunner({ executable: process.execPath });
    const controller = new AbortController();
    const pending = runner.run([script, 'tree', marker], { cwd, signal: controller.signal });
    const stopped = expect(pending).rejects.toBeInstanceOf(GitCancelledError);
    await expect.poll(async () => readFile(marker, 'utf8').catch(() => '')).not.toBe('');
    const pid = Number(await readFile(marker, 'utf8'));
    controller.abort();
    await stopped;
    await expect
      .poll(async () => {
        try {
          return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2];
        } catch {
          return 'gone';
        }
      })
      .toMatch(/^(?:Z|gone)$/u);
  });

  it('bounds signalled reads, removes queued cancellations and drains shutdown', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const reads = new ReadCoordinator(
      {
        executable: 'git',
        version: async () => ({ executable: 'git', version: '2.55.0' }),
        run: async (args, options) => {
          seen.push(args[1]!);
          if (args[1] === 'first') await gate;
          if (options.signal?.aborted) throw new GitCancelledError();
          return { stdout: '', stderr: '', exitCode: 0, signal: null };
        },
      },
      1,
    );
    const a = reads.run(['log', 'first'], { cwd: '/fixture', signal: new AbortController().signal });
    const controller = new AbortController();
    const b = reads.run(['log', 'cancelled'], { cwd: '/fixture', signal: controller.signal });
    const stopped = expect(b).rejects.toBeInstanceOf(GitCancelledError);
    controller.abort();
    await stopped;
    expect(seen).toEqual(['first']);
    release();
    await a;
    await reads.run(['log', 'next'], { cwd: '/other', signal: new AbortController().signal });
    expect(seen).toEqual(['first', 'next']);
    reads.dispose();
    await reads.settled();
    await expect(reads.run(['log'], { cwd: '/fixture' })).rejects.toBeInstanceOf(GitCancelledError);
  });
});

describe('P01 repository trust', () => {
  it('refuses lazy fetching of missing objects before trust, including on the minimum Git version', async () => {
    const f = await fixture();
    const oid = await f.run('rev-parse', 'HEAD:topic.txt');
    const object = join(f.cwd, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
    await access(object);
    await f.run('config', 'remote.origin.promisor', 'true');
    await f.run('config', 'extensions.partialClone', 'origin');
    await f.run('config', 'protocol.file.allow', 'always');
    await rm(object);
    const runner = new RepositoryGitRunner(f.git, new RepositoryTrustStore(join(f.root, 'trust')));
    runner.register(join(f.cwd, '.git'), [f.cwd]);
    await expect(runner.run(['cat-file', '-p', oid], { cwd: f.cwd })).rejects.toBeInstanceOf(GitCommandError);
    await expect(access(object)).rejects.toThrow();
    await expect(runner.run(['fetch', 'origin'], { cwd: f.cwd })).rejects.toMatchObject({
      code: 'REPOSITORY_UNTRUSTED',
    });
  });

  it('keeps Git ownership checks and existing lock files intact', async () => {
    const f = await fixture();
    const global = join(f.root, 'global-config');
    await writeFile(global, '');
    const before = await readFile(join(f.cwd, '.git', 'config'));
    vi.stubEnv('GIT_CONFIG_GLOBAL', global);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_TEST_ASSUME_DIFFERENT_OWNER', '1');
    const service = new RepositoryService({ storagePath: join(f.root, 'ownership', 'recent') });
    cleanups.push(async () => {
      service.dispose();
      await service.settled();
    });
    await expect(service.open(1, f.cwd)).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
      message: expect.stringContaining('ownership'),
    });
    expect(await readFile(global, 'utf8')).toBe('');
    expect(await readFile(join(f.cwd, '.git', 'config'))).toEqual(before);
    vi.stubEnv('GIT_TEST_ASSUME_DIFFERENT_OWNER', '');
    const opened = await service.open(1, f.cwd);
    await service.setTrust(1, opened.id, true);
    const lock = join(f.cwd, '.git', 'index.lock');
    await writeFile(lock, 'owned by another Git process');
    await writeFile(join(f.cwd, 'new.txt'), 'new\n');
    await expect(
      service.applyWorkingChange(1, {
        id: opened.id,
        action: 'stage',
        targets: [{ area: 'untracked', path: 'new.txt', previousPath: null }],
        selection: { kind: 'file' },
        snapshot: null,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
    expect(await readFile(lock, 'utf8')).toBe('owned by another Git process');
    expect(await f.run('ls-files', '--', 'new.txt')).toBe('');
  });

  it('opens history without executing repository programs, persists shared worktree trust and revokes it', async () => {
    const f = await fixture();
    const marker = join(f.root, 'program-ran');
    const hook = join(f.cwd, '.git', 'hooks', 'post-checkout');
    await copyFile(script, hook);
    await chmod(hook, 0o700);
    await f.run('config', 'core.fsmonitor', hook);
    await f.run('config', 'filter.fixture.clean', `${process.execPath} ${script} hook`);
    await writeFile(join(f.cwd, '.gitattributes'), '*.txt filter=fixture\n');
    vi.stubEnv('GIT_WORKBENCH_FIXTURE_MARKER', marker);
    const storagePath = join(f.root, 'profile', 'recent.json');
    const service = new RepositoryService({ storagePath });
    cleanups.push(async () => {
      service.dispose();
      await service.settled();
    });
    const opened = await service.open(1, f.cwd);
    expect(opened.trusted).toBe(false);
    expect(opened.workingTree.state).toBe('unknown');
    expect((await service.getHistory(1, opened.id, 0, 50)).commits.length).toBe(3);
    await expect(service.getWorkingChanges(1, opened.id, true, false)).rejects.toMatchObject({
      code: 'REPOSITORY_UNTRUSTED',
    });
    await expect(access(marker)).rejects.toThrow();
    await expect(service.setTrust(2, opened.id, true)).rejects.toMatchObject({ code: 'REPOSITORY_NOT_OPEN' });
    await service.setTrust(1, opened.id, true);
    await service.getWorkingChanges(1, opened.id, true, false);
    expect(await readFile(marker, 'utf8')).toBe('ran');
    const linked = await service.open(1, f.linked);
    expect(linked.trusted).toBe(true);
    const restored = new RepositoryService({ storagePath });
    cleanups.push(async () => {
      restored.dispose();
      await restored.settled();
    });
    expect((await restored.open(3, f.cwd)).trusted).toBe(true);
    await service.setTrust(1, linked.id, false);
    expect((await service.listOpen(1)).every((entry) => !entry.trusted)).toBe(true);
    expect(
      canInvokeCommitInspector(requests.setRepositoryTrust.channel, { id: opened.id, trusted: true }),
    ).toBe(false);
    expect(requests.setRepositoryTrust.input.safeParse({ id: opened.id, trusted: 'yes' }).success).toBe(
      false,
    );
    expect((await stat(`${storagePath}.trust`)).mode & 0o777).toBe(0o600);
  });

  it('fails closed for corrupt trust files and for a replaced Git directory', async () => {
    const cwd = await directory();
    const common = join(cwd, 'git');
    await mkdir(common);
    const path = join(cwd, 'trust.json');
    const store = new RepositoryTrustStore(path);
    await store.set(common, true);
    expect(await store.isTrusted(common)).toBe(true);
    await rename(common, join(cwd, 'previous'));
    await mkdir(common);
    expect(await store.isTrusted(common)).toBe(false);
    await writeFile(path, '{bad');
    const corrupt = new RepositoryTrustStore(path);
    expect(await corrupt.isTrusted(common)).toBe(false);
    await expect(corrupt.set(common, true)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await readFile(path, 'utf8')).toBe('{bad');
  });

  it('reports unsupported Git and exposes optional capabilities without guessing flags', async () => {
    const cwd = await directory();
    expect(gitCapabilities('2.43.0.windows.1')).toMatchObject({ supported: true, rebaseUpdateRefs: true });
    expect(gitCapabilities('2.24.9')).toMatchObject({ supported: false, pathspecFromFile: false });
    expect(gitCapabilities('unknown')).toMatchObject({ supported: false });
    const service = new RepositoryService({
      storagePath: join(cwd, 'recent'),
      runner: {
        executable: '/fixture/git',
        version: async () => ({ executable: '/fixture/git', version: '2.24.9' }),
        run: async () => {
          throw new Error('Unsupported Git must not run');
        },
      },
    });
    expect(await service.getGitInfo()).toMatchObject({ status: 'unsupported', minimumVersion: '2.43.0' });
    await expect(service.open(1, cwd)).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' });
    service.dispose();
  });
});

describe('P01 durable activity', () => {
  it('serializes linked worktrees, cancels queued jobs before launch and leaves other repositories independent', async () => {
    const f = await fixture();
    const other = await fixture();
    const service = new RepositoryService({ storagePath: join(f.root, 'queue-profile', 'recent') });
    cleanups.push(async () => {
      service.dispose();
      await service.settled();
    });
    const first = await service.open(1, f.cwd);
    await service.setTrust(1, first.id, true);
    const linked = await service.open(2, f.linked);
    const independent = await service.open(3, other.cwd);
    await service.setTrust(3, independent.id, true);
    const make = async (owner: number, id: string, marker: string, wait: boolean) => {
      const commands = await service.customCommands.store.save({
        definition: {
          name: 'P01 fixture',
          target: 'repository',
          fields: [],
          action: {
            kind: 'process',
            executable: process.execPath,
            args: [script, wait ? 'wait' : 'arguments', marker],
          },
        },
        enabled: true,
      });
      return service.previewCustomCommand(owner, {
        commandId: commands.at(-1)!.id,
        context: { repositoryId: id, target: 'repository', value: '' },
        inputs: [],
      });
    };
    const marker = join(f.root, 'active');
    const queuedMarker = join(f.root, 'queued');
    const a = await make(1, first.id, marker, true);
    const b = await make(2, linked.id, queuedMarker, true);
    const c = await make(3, independent.id, 'independent', false);
    const active = service.startCustomCommand(1, a.token, async () => undefined);
    await expect
      .poll(() =>
        access(marker).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    const queued = service.startCustomCommand(2, b.token, async () => undefined);
    service.cancelOperation(2, queued.id);
    await expect
      .poll(() => service.listOperations(2).find((job) => job.id === queued.id)?.status)
      .toBe('cancelled');
    await expect(access(queuedMarker)).rejects.toThrow();
    const concurrent = service.startCustomCommand(3, c.token, async () => undefined);
    await expect
      .poll(() => service.listOperations(3).find((job) => job.id === concurrent.id)?.status)
      .toBe('succeeded');
    expect(service.listOperations(1).find((job) => job.id === active.id)?.status).toBe('running');
    service.dispose();
    await service.settled();
    const pid = Number(await readFile(marker, 'utf8'));
    await expect
      .poll(async () => {
        try {
          return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2];
        } catch {
          return 'gone';
        }
      })
      .toMatch(/^(?:Z|gone)$/u);
    await expect(access(queuedMarker)).rejects.toThrow();
  });

  it('retains terminal results on cancellation, redacts split secrets and tolerates disconnected listeners', async () => {
    const registry = new OperationRegistry();
    let handle!: OperationHandle;
    let finish!: (outcome: OperationOutcome) => void;
    registry.subscribe(() => {
      throw new Error('Disconnected consumer');
    });
    const accepted = registry.start(
      {
        ownerId: 1,
        repositoryId: `repo-${'a'.repeat(64)}`,
        kind: 'fetch',
        title: 'Fetch',
        command: 'git fetch',
      },
      (h) => {
        handle = h;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    handle.appendOutput('https://user:pri');
    expect(registry.get(accepted.id)?.output).toBe('');
    handle.appendOutput('vate@host/repo\n');
    expect(registry.get(accepted.id)?.output).toBe('https://<redacted>@host/repo\n');
    registry.cancel(1, accepted.id);
    const result = {
      kind: 'lfs' as const,
      value: { path: '/fixture', byteLength: 1, sha256: 'a'.repeat(64) },
    };
    finish({ status: 'succeeded', message: 'saved', output: 'Authorization: Bearer private', result });
    await registry.settled();
    expect(registry.get(accepted.id)).toMatchObject({
      status: 'cancelled',
      result,
      output: 'Authorization: <redacted>',
    });
    expect(registry.list(1)).toHaveLength(1);
    registry.dispose();
    expect(() =>
      registry.start(
        { ownerId: 1, repositoryId: `repo-${'a'.repeat(64)}`, kind: 'fetch', title: 'Fetch', command: '' },
        async () => ({ status: 'succeeded', message: '', output: '' }),
      ),
    ).toThrow();
  });
});
