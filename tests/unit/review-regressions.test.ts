import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCommandError, GitRunner } from '../../src/backend/git/runner';
import { ReadCoordinator } from '../../src/backend/git/read-coordinator';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { GitRunnerLike } from '../../src/backend/repositories/repository-service';
import { createDesktopApi } from '../../src/backend/preload/create-desktop-api';
import { pullRequestUrl } from '../../src/backend/repositories/hosting-service';
import { buildCollapsedHistory } from '../../src/common/history-collapse';
import type {
  RepositoryNetworkRequest,
  RepositoryOperation,
  RepositoryMergeRebaseAction,
  RepositoryReferenceAction,
  RepositoryRecoveryRequest,
} from '../../src/common/ipc/contracts';
import { mergeOperation } from '../../src/frontend/react/lib/operations';

const directories: string[] = [];
const services: RepositoryService[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(wrap?: (git: GitRunner) => GitRunnerLike) {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-review-regression-'));
  directories.push(root);
  const cwd = join(root, 'work');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => {
    try {
      return (await git.run(args, { cwd })).stdout.trim();
    } catch (error) {
      throw error instanceof GitCommandError ? new Error(error.stderr, { cause: error }) : error;
    }
  };
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Review Fixture');
  await run('config', 'user.email', 'review@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'base.txt'), 'base\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'base');
  const storagePath = join(root, 'recent.json');
  const service = new RepositoryService({ storagePath, runner: wrap?.(git) ?? git });
  services.push(service);
  const summary = await service.open(1, cwd);
  const id = summary.id;
  const apply = async (action: RepositoryReferenceAction) =>
    service.applyReferenceAction(1, {
      id,
      action,
      snapshot: (await service.getReferenceContext(1, id)).snapshot,
    });
  return { root, cwd, git, run, service, id, storagePath, apply };
}

async function terminal(
  service: RepositoryService,
  accepted: RepositoryOperation,
): Promise<RepositoryOperation> {
  const current = service.listOperations(1).find((operation) => operation.id === accepted.id);
  if (current && current.status !== 'running') return current;
  return new Promise((resolve) => {
    const off = service.subscribeOperations((_owner, operation) => {
      if (operation.id === accepted.id && operation.status !== 'running') {
        off();
        resolve(operation);
      }
    });
  });
}

async function operation(f: Awaited<ReturnType<typeof fixture>>, request: RepositoryNetworkRequest) {
  return terminal(f.service, await f.service.startNetworkOperation(1, { id: f.id, request }));
}

async function recoveryOperation(
  service: RepositoryService,
  id: string,
  action: RepositoryRecoveryRequest['action'],
  copyId?: string,
) {
  return terminal(
    service,
    service.startRecovery(1, { id, action, copyId, snapshot: (await service.getRecovery(1, id)).snapshot }),
  );
}

async function mergeRebaseOperation(
  f: Awaited<ReturnType<typeof fixture>>,
  action: Omit<RepositoryMergeRebaseAction, 'snapshot'>,
  snapshot?: string,
) {
  const context = await f.service.getReferenceContext(1, f.id);
  return terminal(
    f.service,
    f.service.startMergeRebase(1, {
      id: f.id,
      action: { ...action, snapshot: snapshot ?? context.snapshot },
    }),
  );
}

async function remoteFixture(wrap?: (git: GitRunner) => GitRunnerLike) {
  const f = await fixture(wrap);
  const remote = join(f.root, 'origin.git');
  const peer = join(f.root, 'peer');
  await f.run('init', '--quiet', '--bare', '--initial-branch=main', remote);
  await f.run('remote', 'add', 'origin', remote);
  await f.run('push', '--quiet', '--set-upstream', 'origin', 'main');
  await f.run('clone', '--quiet', remote, peer);
  const peerRun = async (...args: string[]) => (await f.git.run(args, { cwd: peer })).stdout.trim();
  await peerRun('config', 'user.name', 'Peer Fixture');
  await peerRun('config', 'user.email', 'peer@example.test');
  await peerRun('config', 'commit.gpgsign', 'false');
  return { ...f, remote, peer, peerRun };
}

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('review correctness regressions', () => {
  it('stages and diffs literal wildcard, bracket, and colon filenames without including other paths', async () => {
    const f = await fixture();
    for (const path of ['note*.txt', 'notes.txt', '[ab].txt', 'a.txt', ':(glob)*.txt'])
      await writeFile(join(f.cwd, path), 'original\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'paths');
    for (const path of ['note*.txt', 'notes.txt', '[ab].txt', 'a.txt', ':(glob)*.txt'])
      await writeFile(join(f.cwd, path), `edited ${path}\n`);
    const previous = process.env.GIT_GLOB_PATHSPECS;
    process.env.GIT_GLOB_PATHSPECS = '1';
    try {
      for (const path of ['note*.txt', '[ab].txt', ':(glob)*.txt']) {
        const diff = await f.service.getDiff(
          1,
          f.id,
          { kind: 'working', area: 'unstaged', path, previousPath: null },
          'normal',
        );
        expect(diff.content.match(/^diff --git /gmu)).toHaveLength(1);
        await f.service.applyWorkingChange(1, {
          id: f.id,
          action: 'stage',
          targets: [{ area: 'unstaged', path, previousPath: null }],
          selection: { kind: 'file' },
          snapshot: null,
        });
      }
    } finally {
      if (previous === undefined) delete process.env.GIT_GLOB_PATHSPECS;
      else process.env.GIT_GLOB_PATHSPECS = previous;
    }
    expect((await f.run('diff', '--cached', '--name-only')).split('\n').sort()).toEqual(
      [':(glob)*.txt', '[ab].txt', 'note*.txt'].sort(),
    );
    expect(await f.run('diff', '--name-only')).toBe('a.txt\nnotes.txt');
  });

  it('retains the selected branch namespace when a tag has the same name', async () => {
    const f = await fixture();
    await f.run('tag', 'topic');
    await writeFile(join(f.cwd, 'base.txt'), 'new\n');
    await f.run('commit', '--quiet', '-am', 'new');
    await f.run('branch', 'topic');
    const startPoint = { kind: 'reference', fullName: 'refs/heads/topic' } as const;
    expect(await f.apply({ kind: 'create-tag', name: 'release', message: '', startPoint })).toMatchObject({
      status: 'applied',
    });
    expect(
      await f.apply({ kind: 'create-branch', name: 'copied', checkout: false, tracking: 'auto', startPoint }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('rev-parse', 'refs/tags/release')).toBe(await f.run('rev-parse', 'refs/heads/topic'));
    expect(await f.run('rev-parse', 'refs/heads/copied')).toBe(await f.run('rev-parse', 'refs/heads/topic'));
    expect(await f.apply({ kind: 'checkout-branch', fullName: 'refs/heads/topic' })).toMatchObject({
      status: 'applied',
      head: { state: 'branch', name: 'topic' },
    });
  });

  it('distinguishes a remote-tracking ref from a local branch with the same display name', async () => {
    const f = await remoteFixture();
    const remoteTarget = await f.run('rev-parse', 'refs/remotes/origin/main');
    await writeFile(join(f.cwd, 'base.txt'), 'local only\n');
    await f.run('commit', '--quiet', '-am', 'local only');
    await f.run('branch', 'origin/main');
    expect((await f.service.getReferenceContext(1, f.id)).remoteBranches).toContain('origin/main');
    expect(
      await f.apply({
        kind: 'create-tag',
        name: 'remote-tag',
        message: '',
        startPoint: { kind: 'reference', fullName: 'refs/remotes/origin/main' },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('rev-parse', 'refs/tags/remote-tag')).toBe(remoteTarget);
    expect(
      await f.apply({
        kind: 'set-upstream',
        fullName: 'refs/heads/main',
        upstream: 'refs/heads/origin/main',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('config', 'branch.main.remote')).toBe('.');
    expect(
      await f.apply({
        kind: 'set-upstream',
        fullName: 'refs/heads/main',
        upstream: 'refs/remotes/origin/main',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('config', 'branch.main.remote')).toBe('origin');
  });

  it('recognizes local upstreams and refreshes externally changed HEAD and refs', async () => {
    const f = await fixture();
    await f.run('branch', 'topic');
    await f.run('branch', '--set-upstream-to=main', 'topic');
    expect(
      (await f.service.getReferenceContext(1, f.id)).branches.find((branch) => branch.name === 'topic'),
    ).toMatchObject({
      upstreamGone: false,
      upstreamFullName: 'refs/heads/main',
      upstreamRemote: '.',
      upstreamBranch: 'main',
    });
    const before = (await f.service.listOpen(1))[0]!;
    await f.run('checkout', '--quiet', 'topic');
    const after = (await f.service.listOpen(1))[0]!;
    expect(after.head.name).toBe('topic');
    expect(after.referenceVersion).not.toBe(before.referenceVersion);
    await f.run('branch', 'external');
    expect((await f.service.listOpen(1))[0]?.referenceVersion).not.toBe(after.referenceVersion);
  });

  it('keeps URL credentials out of DTOs and preserves an unchanged redacted URL', async () => {
    const f = await fixture();
    const privateUrl = 'https://fixture-user:fixture-secret@example.test/repo.git';
    await f.run('remote', 'add', 'origin', privateUrl);
    await f.run('remote', 'set-url', '--push', 'origin', privateUrl);
    const [remote] = await f.service.listRemotes(1, f.id);
    expect(JSON.stringify(remote)).not.toContain('fixture-secret');
    expect(remote?.fetchUrl).toBe('https://<redacted>@example.test/repo.git');
    expect(
      await f.service.applyRemoteAction(1, {
        id: f.id,
        action: { kind: 'set-url', name: 'origin', url: remote!.fetchUrl, push: false },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('remote', 'get-url', 'origin')).toBe(privateUrl);
    expect(
      await f.service.applyRemoteAction(1, {
        id: f.id,
        action: {
          kind: 'set-url',
          name: 'origin',
          url: 'https://<redacted>@another.test/repo.git',
          push: false,
        },
      }),
    ).toMatchObject({ status: 'blocked' });
    await f.run('config', 'url.https://fixture-user:fixture-secret@example.test/.insteadOf', 'private:');
    await f.run('remote', 'add', 'rewritten', 'private:repo.git');
    expect(JSON.stringify(await f.service.listRemotes(1, f.id))).not.toContain('fixture-secret');
  });

  it('rejects a pull queued behind checkout instead of changing the newly checked-out branch', async () => {
    const gate = deferred();
    const entered = deferred();
    let armed = false;
    const f = await remoteFixture((git) => ({
      executable: git.executable,
      version: () => git.version(),
      run: async (args, options) => {
        if (armed && args[0] === 'checkout') {
          armed = false;
          entered.resolve();
          await gate.promise;
        }
        return git.run(args, options);
      },
    }));
    await f.run('branch', 'topic');
    await f.run('push', '--quiet', '--set-upstream', 'origin', 'topic');
    await writeFile(join(f.peer, 'peer.txt'), 'peer\n');
    await f.peerRun('add', '--all');
    await f.peerRun('commit', '--quiet', '-m', 'peer');
    await f.peerRun('push', '--quiet', 'origin', 'main:topic');
    const before = await f.run('rev-parse', 'refs/heads/topic');
    armed = true;
    const checkout = f.apply({ kind: 'checkout-branch', fullName: 'refs/heads/topic' });
    await entered.promise;
    const accepted = await f.service.startNetworkOperation(1, {
      id: f.id,
      request: { kind: 'pull', prune: false },
    });
    gate.resolve();
    await checkout;
    expect(await terminal(f.service, accepted)).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('destination branch changed'),
    });
    expect(await f.run('rev-parse', 'refs/heads/topic')).toBe(before);
  });

  it('returns a commit job before the control deadline and retains the final result', async () => {
    const gate = deferred();
    const entered = deferred();
    const f = await fixture((git) => ({
      executable: git.executable,
      version: () => git.version(),
      run: async (args, options) => {
        if (args[0] === 'commit') {
          entered.resolve();
          await gate.promise;
        }
        return git.run(args, options);
      },
    }));
    await writeFile(join(f.cwd, 'base.txt'), 'commit me\n');
    await f.run('add', '--all');
    const context = await f.service.getCommitContext(1, f.id);
    const api = createDesktopApi(
      {
        invoke: async (_channel, payload) => ({
          ok: true,
          value: f.service.startCommit(1, payload as Parameters<RepositoryService['startCommit']>[1]),
        }),
        on() {},
        removeListener() {},
      },
      25,
    );
    const response = await api.repository.commit({
      id: f.id,
      subject: 'slow job',
      body: '',
      amend: false,
      snapshot: context.snapshot,
      skipHooks: false,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.value.status).toBe('running');
    await entered.promise;
    expect(f.service.listOperations(1)[0]?.status).toBe('running');
    gate.resolve();
    const finished = await terminal(f.service, response.value);
    expect(finished).toMatchObject({
      status: 'succeeded',
      result: { kind: 'commit', value: { status: 'committed' } },
    });
    expect(await f.run('log', '-1', '--format=%s')).toBe('slow job');
    expect(mergeOperation([finished], response.value)[0]?.status).toBe('succeeded');
  });

  it('coalesces reads but never coalesces writes that happen to name a branch status', async () => {
    const git = new GitRunner();
    let reads = 0;
    let writes = 0;
    const coordinator = new ReadCoordinator({
      executable: git.executable,
      version: () => git.version(),
      run: async (args) => {
        if (args[0] === 'for-each-ref') reads++;
        else writes++;
        return { stdout: '', stderr: '', exitCode: 0, signal: null };
      },
    });
    await Promise.all(Array.from({ length: 10 }, () => coordinator.run(['for-each-ref'], { cwd: tmpdir() })));
    await Promise.all(
      Array.from({ length: 2 }, () => coordinator.run(['branch', 'status'], { cwd: tmpdir() })),
    );
    expect(reads).toBe(1);
    expect(writes).toBe(2);
  });

  it('avoids topology rediscovery and duplicate status scans for routine working/remote queries', async () => {
    const calls: readonly string[][] = [];
    const log = calls as string[][];
    const f = await fixture((git) => ({
      executable: git.executable,
      version: () => git.version(),
      run: (args, options) => {
        log.push([...args]);
        return git.run(args, options);
      },
    }));
    log.length = 0;
    await f.service.getWorkingChanges(1, f.id, true, false);
    expect(log.filter((args) => args.includes('status'))).toHaveLength(1);
    expect(log.some((args) => args[0] === 'rev-parse')).toBe(false);
    log.length = 0;
    await f.service.listRemotes(1, f.id);
    expect(log).toHaveLength(2);
  });

  it('never shares a pre-mutation read with mutation-time revalidation', async () => {
    const gate = deferred();
    const entered = deferred();
    const git = new GitRunner();
    let reads = 0;
    const coordinator = new ReadCoordinator({
      executable: git.executable,
      version: () => git.version(),
      run: async (args) => {
        let stdout = '';
        if (args[0] === 'for-each-ref') {
          reads += 1;
          stdout = reads === 1 ? 'old' : 'new';
          if (reads === 1) {
            entered.resolve();
            await gate.promise;
          }
        }
        return { stdout, stderr: '', exitCode: 0, signal: null };
      },
    });
    const stale = coordinator.run(['for-each-ref'], { cwd: tmpdir() });
    await entered.promise;
    await coordinator.run(['branch', 'new'], { cwd: tmpdir() });
    expect((await coordinator.run(['for-each-ref'], { cwd: tmpdir() })).stdout).toBe('new');
    gate.resolve();
    expect((await stale).stdout).toBe('old');
    expect(reads).toBe(2);
  });
});

describe('branch workflow recovery', () => {
  it('checks out an explicitly selected inactive Pull destination and preserves local changes', async () => {
    const f = await remoteFixture();
    await f.run('checkout', '--quiet', '-b', 'topic');
    const topic = await f.run('rev-parse', 'HEAD');
    await writeFile(join(f.cwd, 'base.txt'), 'work carried to destination\n');
    await writeFile(join(f.peer, 'remote.txt'), 'remote update\n');
    await f.peerRun('add', '--all');
    await f.peerRun('commit', '--quiet', '-m', 'remote');
    await f.peerRun('push', '--quiet');
    const context = await f.service.getReferenceContext(1, f.id);
    const preview = await f.service.previewLocalChanges(1, f.id);
    expect(
      await operation(f, {
        kind: 'pull',
        remote: 'origin',
        branch: 'main',
        into: 'refs/heads/main',
        expectedHead: topic,
        snapshot: context.snapshot,
        rebase: false,
        autostash: true,
        changesSnapshot: preview.snapshot,
        prune: false,
      }),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('branch', '--show-current')).toBe('main');
    expect(await f.run('rev-parse', 'HEAD')).toBe(await f.peerRun('rev-parse', 'HEAD'));
    expect(await f.run('rev-parse', 'refs/heads/topic')).toBe(topic);
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('work carried to destination\n');
  });
  it('stashes and reapplies staged, unstaged and untracked changes on checkout', async () => {
    const f = await fixture();
    await f.run('branch', 'topic');
    await writeFile(join(f.cwd, 'base.txt'), 'staged\n');
    await f.run('add', '--all');
    await writeFile(join(f.cwd, 'base.txt'), 'staged\nunstaged\n');
    await writeFile(join(f.cwd, 'new.txt'), 'untracked\n');
    const preview = await f.service.previewLocalChanges(1, f.id);
    expect(
      await f.apply({
        kind: 'checkout-branch',
        fullName: 'refs/heads/topic',
        localChanges: 'stash',
        changesSnapshot: preview.snapshot,
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('branch', '--show-current')).toBe('topic');
    expect(await f.run('show', ':base.txt')).toBe('staged');
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('staged\nunstaged\n');
    expect(await readFile(join(f.cwd, 'new.txt'), 'utf8')).toBe('untracked\n');
    expect((await f.service.getRecovery(1, f.id)).copies).toMatchObject([
      { pending: false, commitId: expect.any(String) },
    ]);
  });

  it('refuses a changed discard preview and retains a recoverable copy of a confirmed discard', async () => {
    const f = await fixture();
    await f.run('branch', 'topic');
    await writeFile(join(f.cwd, 'base.txt'), 'discard this\n');
    const old = await f.service.previewLocalChanges(1, f.id);
    await writeFile(join(f.cwd, 'new.txt'), 'keep recoverable\n');
    await expect(
      f.apply({
        kind: 'checkout-branch',
        fullName: 'refs/heads/topic',
        localChanges: 'discard',
        changesSnapshot: old.snapshot,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(await f.run('branch', '--show-current')).toBe('main');
    const preview = await f.service.previewLocalChanges(1, f.id);
    expect(preview.untrackedPaths).toEqual(['new.txt']);
    expect(
      await f.apply({
        kind: 'checkout-branch',
        fullName: 'refs/heads/topic',
        localChanges: 'discard',
        changesSnapshot: preview.snapshot,
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.run('status', '--porcelain')).toBe('');
    const [copy] = (await f.service.getRecovery(1, f.id)).copies;
    expect(copy?.pending).toBe(false);
    expect(await recoveryOperation(f.service, f.id, 'apply', copy!.id)).toMatchObject({
      status: 'succeeded',
    });
    expect(await readFile(join(f.cwd, 'new.txt'), 'utf8')).toBe('keep recoverable\n');
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('discard this\n');
    const reviewed = await f.service.getRecovery(1, f.id);
    await f.run('checkout', '--quiet', 'main');
    expect(
      await terminal(
        f.service,
        f.service.startRecovery(1, {
          id: f.id,
          action: 'drop',
          copyId: copy!.id,
          snapshot: reviewed.snapshot,
        }),
      ),
    ).toMatchObject({ status: 'failed', message: expect.stringContaining('recovery state changed') });
    expect((await f.service.getRecovery(1, f.id)).copies).toHaveLength(1);
  });

  it('keeps saved changes discoverable after checkout conflicts and service restart', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'topic');
    await writeFile(join(f.cwd, 'base.txt'), 'topic\n');
    await f.run('commit', '--quiet', '-am', 'topic');
    await f.run('checkout', '--quiet', 'main');
    await writeFile(join(f.cwd, 'base.txt'), 'local\n');
    const preview = await f.service.previewLocalChanges(1, f.id);
    await expect(
      f.apply({
        kind: 'checkout-branch',
        fullName: 'refs/heads/topic',
        localChanges: 'stash',
        changesSnapshot: preview.snapshot,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED', message: expect.stringContaining('Recovery') });
    f.service.dispose();
    const reopened = new RepositoryService({ storagePath: f.storagePath, runner: f.git });
    services.push(reopened);
    await reopened.open(1, f.cwd);
    const recovery = await reopened.getRecovery(1, f.id);
    expect(recovery.copies[0]?.pending).toBe(true);
    expect(await f.run('show', `${recovery.copies[0]!.commitId}:base.txt`)).toBe('local');
    expect(await f.run('ls-files', '--unmerged')).not.toBe('');
    await writeFile(join(f.cwd, 'base.txt'), 'resolved\n');
    await f.run('add', '--', 'base.txt');
    expect(
      await terminal(
        reopened,
        reopened.startRecovery(1, {
          id: f.id,
          action: 'finish',
          copyId: recovery.copies[0]!.id,
          snapshot: (await reopened.getRecovery(1, f.id)).snapshot,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('merges a divergent branch through the operation registry and preserves both parents', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(f.cwd, 'feature.txt'), 'feature\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'feature');
    await f.run('checkout', '--quiet', 'main');
    await writeFile(join(f.cwd, 'main.txt'), 'main\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'main');

    const result = await mergeRebaseOperation(f, {
      kind: 'merge',
      sourceFullName: 'refs/heads/feature',
      autostash: false,
    });
    expect(result).toMatchObject({ status: 'succeeded', kind: 'merge' });
    expect((await f.run('rev-list', '-1', '--parents', 'HEAD')).split(' ')).toHaveLength(3);
    expect(await f.run('show', 'HEAD:feature.txt')).toBe('feature');
    expect(await f.run('show', 'HEAD:main.txt')).toBe('main');
  });

  it('rebases the current branch onto a selected branch without invoking an editor', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(f.cwd, 'feature.txt'), 'feature\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'feature');
    await f.run('checkout', '--quiet', 'main');
    await writeFile(join(f.cwd, 'main.txt'), 'main\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'main');

    const result = await mergeRebaseOperation(f, {
      kind: 'rebase',
      sourceFullName: 'refs/heads/feature',
      autostash: false,
    });
    expect(result).toMatchObject({ status: 'succeeded', kind: 'rebase' });
    expect(await f.run('log', '-2', '--format=%s')).toBe('main\nfeature');
    expect(await f.run('show', 'HEAD:feature.txt')).toBe('feature');
    expect(await f.run('show', 'HEAD:main.txt')).toBe('main');
  });

  it('leaves a merge conflict in Recovery and continues it after a fresh state read', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(f.cwd, 'base.txt'), 'feature\n');
    await f.run('commit', '--quiet', '-am', 'feature');
    await f.run('checkout', '--quiet', 'main');
    await writeFile(join(f.cwd, 'base.txt'), 'main\n');
    await f.run('commit', '--quiet', '-am', 'main');

    const result = await mergeRebaseOperation(f, {
      kind: 'merge',
      sourceFullName: 'refs/heads/feature',
      autostash: false,
    });
    expect(result).toMatchObject({
      status: 'failed',
      kind: 'merge',
      failureReason: 'conflict',
      message: expect.stringContaining('Resolve and stage'),
    });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe('merge');
    expect(await f.run('ls-files', '--unmerged')).not.toBe('');
    await writeFile(join(f.cwd, 'base.txt'), 'resolved\n');
    await f.run('add', '--', 'base.txt');
    expect(await recoveryOperation(f.service, f.id, 'continue')).toMatchObject({ status: 'succeeded' });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
    expect(await f.run('show', 'HEAD:base.txt')).toBe('resolved');
  });

  it('allows a conflicted rebase commit to be skipped from Recovery', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(f.cwd, 'base.txt'), 'feature\n');
    await f.run('commit', '--quiet', '-am', 'feature');
    await f.run('checkout', '--quiet', 'main');
    await writeFile(join(f.cwd, 'base.txt'), 'main\n');
    await f.run('commit', '--quiet', '-am', 'main');

    const result = await mergeRebaseOperation(f, {
      kind: 'rebase',
      sourceFullName: 'refs/heads/feature',
      autostash: false,
    });
    expect(result).toMatchObject({ status: 'failed', failureReason: 'conflict' });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe('rebase');
    expect(await recoveryOperation(f.service, f.id, 'skip')).toMatchObject({ status: 'succeeded' });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
    expect(await f.run('log', '-1', '--format=%s')).toBe('feature');
  });

  it('stashes and reapplies local edits around a merge while keeping the staged index state', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(f.cwd, 'feature.txt'), 'feature\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'feature');
    await f.run('checkout', '--quiet', 'main');
    await writeFile(join(f.cwd, 'base.txt'), 'staged\n');
    await f.run('add', '--', 'base.txt');
    await writeFile(join(f.cwd, 'base.txt'), 'staged and edited\n');
    await writeFile(join(f.cwd, 'untracked.txt'), 'untracked\n');
    const preview = await f.service.previewLocalChanges(1, f.id);
    const context = await f.service.getReferenceContext(1, f.id);
    const result = await mergeRebaseOperation(
      f,
      {
        kind: 'merge',
        sourceFullName: 'refs/heads/feature',
        autostash: true,
        changesSnapshot: preview.snapshot,
      },
      context.snapshot,
    );
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', ':base.txt')).toBe('staged');
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('staged and edited\n');
    expect(await readFile(join(f.cwd, 'untracked.txt'), 'utf8')).toBe('untracked\n');
    expect((await f.service.getRecovery(1, f.id)).copies[0]?.pending).toBe(false);
  });

  it('fast-forwards an inactive branch without touching the current worktree', async () => {
    const f = await remoteFixture();
    await f.run('checkout', '--quiet', '-b', 'topic');
    await writeFile(join(f.cwd, 'base.txt'), 'unsaved current work\n');
    await writeFile(join(f.peer, 'remote.txt'), 'remote\n');
    await f.peerRun('add', '--all');
    await f.peerRun('commit', '--quiet', '-m', 'remote');
    await f.peerRun('push', '--quiet');
    const context = await f.service.getReferenceContext(1, f.id);
    expect(
      await operation(f, { kind: 'fast-forward', fullName: 'refs/heads/main', snapshot: context.snapshot }),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('branch', '--show-current')).toBe('topic');
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('unsaved current work\n');
    expect(await f.run('rev-parse', 'refs/heads/main')).toBe(await f.peerRun('rev-parse', 'HEAD'));
  });

  it.each([false, true])(
    'pulls an explicit source with rebase=%s and preserves saved local edits',
    async (rebase) => {
      const f = await remoteFixture();
      await writeFile(join(f.cwd, 'local.txt'), 'local commit\n');
      await f.run('add', '--all');
      await f.run('commit', '--quiet', '-m', 'local');
      await writeFile(join(f.cwd, 'base.txt'), 'local edits\n');
      await writeFile(join(f.peer, 'remote.txt'), 'remote commit\n');
      await f.peerRun('add', '--all');
      await f.peerRun('commit', '--quiet', '-m', 'remote');
      await f.peerRun('push', '--quiet');
      const context = await f.service.getReferenceContext(1, f.id);
      const preview = await f.service.previewLocalChanges(1, f.id);
      const result = await operation(f, {
        kind: 'pull',
        remote: 'origin',
        branch: 'main',
        into: 'refs/heads/main',
        expectedHead: context.head.commit!,
        rebase,
        autostash: true,
        changesSnapshot: preview.snapshot,
        prune: true,
      });
      expect(result).toMatchObject({ status: 'succeeded' });
      expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('local edits\n');
      expect(await readFile(join(f.cwd, 'remote.txt'), 'utf8')).toBe('remote commit\n');
      expect(await f.run('rev-list', '--count', '--merges', 'HEAD')).toBe(rebase ? '0' : '1');
    },
  );

  it.each([false, true])(
    'aborts a conflicted pull (rebase=%s) and reapplies the pre-pull staged state',
    async (rebase) => {
      const f = await remoteFixture();
      await writeFile(join(f.cwd, 'base.txt'), 'local commit\n');
      await f.run('commit', '--quiet', '-am', 'local');
      const before = await f.run('rev-parse', 'HEAD');
      await writeFile(join(f.cwd, 'saved.txt'), 'saved\n');
      await f.run('add', '--', 'saved.txt');
      await writeFile(join(f.peer, 'base.txt'), 'remote commit\n');
      await f.peerRun('commit', '--quiet', '-am', 'remote');
      await f.peerRun('push', '--quiet');
      const preview = await f.service.previewLocalChanges(1, f.id);
      expect(
        await operation(f, {
          kind: 'pull',
          remote: 'origin',
          branch: 'main',
          into: 'refs/heads/main',
          expectedHead: before,
          rebase,
          autostash: true,
          changesSnapshot: preview.snapshot,
          prune: false,
        }),
      ).toMatchObject({ status: 'failed' });
      expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe(rebase ? 'rebase' : 'merge');
      expect(await recoveryOperation(f.service, f.id, 'abort')).toMatchObject({ status: 'succeeded' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(before);
      expect(await f.run('show', ':saved.txt')).toBe('saved');
      expect((await f.service.getRecovery(1, f.id)).copies[0]?.pending).toBe(false);
    },
  );

  it.each([false, true])(
    'continues a resolved pull (rebase=%s) and then reapplies saved changes',
    async (rebase) => {
      const f = await remoteFixture();
      await writeFile(join(f.cwd, 'base.txt'), 'local commit\n');
      await f.run('commit', '--quiet', '-am', 'local');
      await writeFile(join(f.cwd, 'saved.txt'), 'saved local work\n');
      await writeFile(join(f.peer, 'base.txt'), 'remote commit\n');
      await f.peerRun('commit', '--quiet', '-am', 'remote');
      await f.peerRun('push', '--quiet');
      const preview = await f.service.previewLocalChanges(1, f.id);
      expect(
        await operation(f, {
          kind: 'pull',
          remote: 'origin',
          branch: 'main',
          into: 'refs/heads/main',
          expectedHead: await f.run('rev-parse', 'HEAD'),
          rebase,
          autostash: true,
          changesSnapshot: preview.snapshot,
          prune: false,
        }),
      ).toMatchObject({ status: 'failed' });
      await writeFile(join(f.cwd, 'base.txt'), 'resolved result\n');
      await f.service.applyWorkingChange(1, {
        id: f.id,
        action: 'stage',
        targets: [{ area: 'unstaged', path: 'base.txt', previousPath: null }],
        selection: { kind: 'file' },
        snapshot: null,
      });
      expect(await recoveryOperation(f.service, f.id, 'continue')).toMatchObject({ status: 'succeeded' });
      expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
      expect((await f.service.getRecovery(1, f.id)).copies[0]?.pending).toBe(false);
      expect(await readFile(join(f.cwd, 'saved.txt'), 'utf8')).toBe('saved local work\n');
      expect(await f.run('show', 'HEAD:base.txt')).toBe('resolved result');
    },
  );

  it('refuses fast-forward when the target is checked out in another worktree', async () => {
    const f = await remoteFixture();
    await f.run('checkout', '--quiet', '-b', 'topic');
    await f.run('worktree', 'add', '--quiet', join(f.root, 'linked'), 'main');
    const context = await f.service.getReferenceContext(1, f.id);
    const before = await f.run('rev-parse', 'refs/heads/main');
    expect(
      await operation(f, { kind: 'fast-forward', fullName: 'refs/heads/main', snapshot: context.snapshot }),
    ).toMatchObject({ status: 'failed', message: expect.stringContaining('another worktree') });
    expect(await f.run('rev-parse', 'refs/heads/main')).toBe(before);
  });

  it('uses the exact upstream remote when remote names share a prefix', async () => {
    const f = await remoteFixture();
    // New Git rejects adding overlapping names; older/external configuration can still contain them.
    await f.run('config', 'remote.origin/team.url', f.remote);
    await f.run('config', 'remote.origin/team.fetch', '+refs/heads/*:refs/remotes/origin/team/*');
    await f.run('update-ref', 'refs/remotes/origin/team/main', await f.run('rev-parse', 'HEAD'));
    await f.run('config', 'branch.main.remote', 'origin/team');
    await f.run('config', 'branch.main.merge', 'refs/heads/main');
    expect(
      (await f.service.getReferenceContext(1, f.id)).branches.find((branch) => branch.isHead),
    ).toMatchObject({ upstreamRemote: 'origin/team', upstreamBranch: 'main', upstreamGone: false });
  });
});

describe('projection and hosting', () => {
  it('projects merge-heavy history without scanning ancestry when nothing is collapsed', () => {
    let reads = 0;
    const commits = Array.from({ length: 4000 }, (_, index) => ({
      id: `${index}`,
      get parents() {
        reads++;
        return index < 3998 ? [`${index + 1}`, `${index + 2}`] : index < 3999 ? ['3999'] : [];
      },
    }));
    expect(buildCollapsedHistory(commits, new Set()).commits).toHaveLength(4000);
    expect(reads).toBeLessThan(20000);
  });

  it('creates only known hosting browser URLs and encodes branch names', () => {
    expect(pullRequestUrl('git@github.com:team/repo.git', 'feature/a#b')).toBe(
      'https://github.com/team/repo/compare/feature%2Fa%23b?expand=1',
    );
    expect(pullRequestUrl('https://gitlab.com/team/sub/repo.git', 'topic')).toContain(
      '/-/merge_requests/new?merge_request%5Bsource_branch%5D=topic',
    );
    expect(pullRequestUrl('git@bitbucket.org:team/repo.git', 'topic')).toBe(
      'https://bitbucket.org/team/repo/pull-requests/new?source=topic',
    );
    expect(pullRequestUrl('git@ssh.dev.azure.com:v3/team/project/repo', 'topic')).toBe(
      'https://dev.azure.com/team/project/_git/repo/pullrequestcreate?sourceRef=topic',
    );
    for (const url of [
      'file:///tmp/repo',
      'https://github.com.evil.test/team/repo',
      'javascript:alert(1)',
      'https://example.test/team/repo',
    ])
      expect(pullRequestUrl(url, 'topic')).toBeNull();
  });
});
