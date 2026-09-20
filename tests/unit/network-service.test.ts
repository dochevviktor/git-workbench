import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { GitRunnerLike } from '../../src/backend/repositories/repository-service';
import {
  classifyNetworkFailure,
  parseProgress,
  planNetworkOperation,
  ProgressCollector,
} from '../../src/backend/repositories/network-service';
import { isAllowedRemoteUrl } from '../../src/backend/repositories/remote-service';
import type {
  RepositoryNetworkRequest,
  RepositoryOperation,
  RepositoryOperationProgress,
} from '../../src/common/ipc/contracts';

const temporaryDirectories: string[] = [];
const branchHead = { state: 'branch', name: 'main', commit: 'a'.repeat(40) } as const;

interface Fixture {
  readonly root: string;
  readonly worktree: string;
  readonly remote: string;
  readonly git: GitRunner;
  readonly service: RepositoryService;
  readonly repositoryId: string;
}

async function fixture(backgroundFetchIntervalMs = 20 * 60 * 1_000): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-network-'));
  temporaryDirectories.push(root);
  const worktree = join(root, 'repository');
  const remote = join(root, 'remote.git');
  await mkdir(worktree);
  const git = new GitRunner();
  await git.run(['init', '--quiet', '--bare', '--initial-branch=main', remote], { cwd: root });
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: worktree });
  await git.run(['config', 'user.name', 'Network Author'], { cwd: worktree });
  await git.run(['config', 'user.email', 'network@example.test'], { cwd: worktree });
  await git.run(['remote', 'add', 'origin', remote], { cwd: worktree });
  await writeFile(join(worktree, 'file.txt'), 'one\n', 'utf8');
  await git.run(['add', '--all'], { cwd: worktree });
  await git.run(['commit', '--quiet', '-m', 'first'], { cwd: worktree });

  const service = new RepositoryService({
    storagePath: join(root, 'recent.json'),
    runner: git,
    backgroundFetchIntervalMs,
  });
  const summary = await service.open(1, worktree);
  return { root, worktree, remote, git, service, repositoryId: summary.id };
}

async function output(fixture: Fixture, args: readonly string[], cwd?: string): Promise<string> {
  const result = await fixture.git.run(args, { cwd: cwd ?? fixture.worktree });
  return result.stdout.replace(/\r?\n$/u, '');
}

/** Starts the operation and waits for the registry to report a terminal state for it. */
async function runOperation(
  fixture: Fixture,
  request: RepositoryNetworkRequest,
): Promise<RepositoryOperation> {
  const records: RepositoryOperation[] = [];
  const finished = new Promise<RepositoryOperation>((resolve) => {
    const release = fixture.service.subscribeOperations((_ownerId, operation) => {
      records.push(operation);
      if (operation.status !== 'running') {
        release();
        resolve(operation);
      }
    });
  });
  const accepted = await fixture.service.startNetworkOperation(1, { id: fixture.repositoryId, request });
  expect(accepted.status).toBe('running');
  const result = await finished;
  expect(result.id).toBe(accepted.id);
  return result;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('network command planning', () => {
  it('builds fetch, pull, push, and delete invocations from named options only', () => {
    const cwd = '/tmp/repository';
    expect(
      planNetworkOperation({
        cwd,
        head: branchHead,
        request: { kind: 'fetch', remote: 'origin', prune: true, tags: false },
      }).args,
    ).toEqual(['fetch', '--progress', '--no-auto-gc', '--prune', '--no-tags', '--', 'origin']);

    expect(
      planNetworkOperation({
        cwd,
        head: branchHead,
        request: { kind: 'fetch', remote: null, prune: false, tags: true },
      }).args,
    ).toEqual(['fetch', '--progress', '--no-auto-gc', '--tags', '--all']);

    const pull = planNetworkOperation({
      cwd,
      head: branchHead,
      request: { kind: 'pull', prune: false },
    });
    expect(pull.args).toEqual(['pull', '--progress', '--ff-only', '--no-rebase', '--no-autostash']);
    expect(pull.title).toBe("Pull 'main'");

    const push = planNetworkOperation({
      cwd,
      head: branchHead,
      request: {
        kind: 'push',
        remote: 'origin',
        targets: [
          { fullName: 'refs/heads/main', remoteBranch: 'main' },
          { fullName: 'refs/heads/topic', remoteBranch: 'renamed' },
        ],
        setUpstream: true,
        force: 'with-lease',
        tags: true,
      },
    });
    expect(push.args).toEqual([
      'push',
      '--progress',
      '--set-upstream',
      '--force-with-lease',
      '--follow-tags',
      '--',
      'origin',
      'refs/heads/main:refs/heads/main',
      'refs/heads/topic:refs/heads/renamed',
    ]);
    expect(push.title).toBe("Push 2 branches to 'origin'");

    expect(
      planNetworkOperation({
        cwd,
        head: branchHead,
        request: { kind: 'delete-remote-branch', remote: 'origin', remoteBranch: 'topic' },
      }).args,
    ).toEqual(['push', '--progress', '--', 'origin', ':refs/heads/topic']);
  });

  it('refuses to push anything that is not a local branch', () => {
    expect(() =>
      planNetworkOperation({
        cwd: '/tmp/repository',
        head: branchHead,
        request: {
          kind: 'push',
          remote: 'origin',
          targets: [{ fullName: 'refs/stash', remoteBranch: 'main' }],
          setUpstream: false,
          force: 'none',
          tags: false,
        },
      }),
    ).toThrow(/local branches/u);
  });

  it('refuses to pull with a detached HEAD instead of guessing an upstream', () => {
    expect(() =>
      planNetworkOperation({
        cwd: '/tmp/repository',
        head: { state: 'detached', name: null, commit: 'b'.repeat(40) },
        request: { kind: 'pull', prune: false },
      }),
    ).toThrow(/detached HEAD/u);
  });

  it('declines a remote URL that would run a local command', () => {
    expect(isAllowedRemoteUrl('https://example.test/repo.git')).toBe(true);
    expect(isAllowedRemoteUrl('git@example.test:team/repo.git')).toBe(true);
    expect(isAllowedRemoteUrl('ext::sh -c "curl http://example.test"')).toBe(false);
  });
});

describe('network output handling', () => {
  it('classifies the refusals a remote can answer with', () => {
    expect(
      classifyNetworkFailure('push', 'fatal: Authentication failed for https://example.test'),
    ).toMatchObject({ reason: 'authentication' });
    expect(
      classifyNetworkFailure('fetch', 'fatal: unable to access: Could not resolve host: example'),
    ).toMatchObject({ reason: 'network' });
    expect(
      classifyNetworkFailure('push', '! [rejected] main -> main (non-fast-forward)\nUpdates were rejected'),
    ).toMatchObject({ reason: 'not-fast-forward', canForceWithLease: true });
    expect(classifyNetworkFailure('push', '! [rejected] main -> main (stale info)')).toMatchObject({
      reason: 'lease',
      canForceWithLease: false,
    });
    expect(
      classifyNetworkFailure('push', '! [remote rejected] main -> main (pre-receive hook declined)'),
    ).toMatchObject({ reason: 'rejected' });
    expect(classifyNetworkFailure('pull', 'fatal: Not possible to fast-forward, aborting.')).toMatchObject({
      reason: 'not-fast-forward',
      canForceWithLease: false,
    });
    expect(
      classifyNetworkFailure('push', 'fatal: The current branch main has no upstream branch'),
    ).toMatchObject({ reason: 'no-upstream' });
    expect(classifyNetworkFailure('fetch', "fatal: couldn't find remote ref topic")).toMatchObject({
      reason: 'not-found',
    });
    expect(classifyNetworkFailure('fetch', 'something unexpected')).toMatchObject({ reason: 'other' });
  });

  it('turns carriage-return progress into updates and keeps only completed phases in the log', () => {
    const progress: RepositoryOperationProgress[] = [];
    const lines: string[] = [];
    const collector = new ProgressCollector(
      (update) => progress.push(update),
      (line) => lines.push(line),
    );

    collector.push('remote: Enumerating objects: 5, done.\rReceiving objects:  40% (2/5)\r');
    collector.push('Receiving objects: 100% (5/5), done.\nFrom https://user:secret@example.test/repo\n');
    collector.push(' * branch main -> FETCH_HEAD');
    collector.flush();

    expect(progress).toEqual([
      { phase: 'Receiving objects', percent: 40 },
      { phase: 'Receiving objects', percent: 100 },
    ]);
    expect(lines).toEqual([
      'remote: Enumerating objects: 5, done.',
      'Receiving objects: 100% (5/5), done.',
      'From https://<redacted>@example.test/repo',
      ' * branch main -> FETCH_HEAD',
    ]);
  });

  it('reads Git progress percentages and ignores ordinary lines', () => {
    expect(parseProgress('Resolving deltas:  67% (2/3)')).toEqual({
      phase: 'Resolving deltas',
      percent: 67,
    });
    expect(parseProgress('remote: Counting objects:   5% (1/20)')).toEqual({
      phase: 'Counting objects',
      percent: 5,
    });
    expect(parseProgress('To https://example.test/repo.git')).toBeNull();
  });
});

describe('network operations against a local remote', () => {
  it('pushes a branch, sets its upstream, and reports the tracking counts', async () => {
    const context = await fixture();
    const pushed = await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: true,
      force: 'none',
      tags: false,
    });

    expect(pushed).toMatchObject({ status: 'succeeded', kind: 'push', failureReason: null });
    expect(pushed.command).toBe(
      'git push --progress --set-upstream -- origin refs/heads/main:refs/heads/main',
    );
    expect(await output(context, ['rev-parse', 'refs/heads/main'], context.remote)).toBe(
      await output(context, ['rev-parse', 'HEAD']),
    );
    expect(await output(context, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBe('origin/main');

    const references = await context.service.getReferenceContext(1, context.repositoryId);
    expect(references.branches[0]).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });

    await writeFile(join(context.worktree, 'file.txt'), 'two\n', 'utf8');
    await context.git.run(['commit', '--quiet', '--all', '-m', 'second'], { cwd: context.worktree });
    const ahead = await context.service.getReferenceContext(1, context.repositoryId);
    expect(ahead.branches[0]).toMatchObject({ ahead: 1, behind: 0, upstreamGone: false });
  });

  it('fetches new commits from the remote and prunes a deleted branch', async () => {
    const context = await fixture();
    await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: true,
      force: 'none',
      tags: false,
    });
    // A second clone commits on the remote, which is the change the fetch must bring back.
    const other = join(context.root, 'other');
    await context.git.run(['clone', '--quiet', context.remote, other], { cwd: context.root });
    await context.git.run(['config', 'user.name', 'Other Author'], { cwd: other });
    await context.git.run(['config', 'user.email', 'other@example.test'], { cwd: other });
    await writeFile(join(other, 'file.txt'), 'remote change\n', 'utf8');
    await context.git.run(['commit', '--quiet', '--all', '-m', 'remote commit'], { cwd: other });
    await context.git.run(['push', '--quiet', 'origin', 'main'], { cwd: other });
    await context.git.run(['push', '--quiet', 'origin', 'main:doomed'], { cwd: other });

    const fetched = await runOperation(context, {
      kind: 'fetch',
      remote: 'origin',
      prune: false,
      tags: false,
    });
    expect(fetched).toMatchObject({ status: 'succeeded', kind: 'fetch' });
    expect(await output(context, ['rev-parse', 'refs/remotes/origin/doomed'])).toHaveLength(40);
    const behind = await context.service.getReferenceContext(1, context.repositoryId);
    expect(behind.branches[0]).toMatchObject({ ahead: 0, behind: 1 });

    await context.git.run(['push', '--quiet', 'origin', '--delete', 'doomed'], { cwd: other });
    await runOperation(context, { kind: 'fetch', remote: 'origin', prune: true, tags: false });
    expect(await output(context, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/doomed'])).toBe(
      '',
    );
  });

  it('fast-forwards a pull and refuses one that would need a merge', async () => {
    const context = await fixture();
    await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: true,
      force: 'none',
      tags: false,
    });
    const other = join(context.root, 'other');
    await context.git.run(['clone', '--quiet', context.remote, other], { cwd: context.root });
    await context.git.run(['config', 'user.name', 'Other Author'], { cwd: other });
    await context.git.run(['config', 'user.email', 'other@example.test'], { cwd: other });
    await writeFile(join(other, 'remote.txt'), 'remote\n', 'utf8');
    await context.git.run(['add', '--all'], { cwd: other });
    await context.git.run(['commit', '--quiet', '-m', 'remote commit'], { cwd: other });
    await context.git.run(['push', '--quiet', 'origin', 'main'], { cwd: other });

    const pulled = await runOperation(context, { kind: 'pull', prune: false });
    expect(pulled).toMatchObject({ status: 'succeeded', kind: 'pull' });
    expect(await output(context, ['log', '-1', '--format=%s'])).toBe('remote commit');

    // Both sides now commit, so the next pull is no longer a fast-forward.
    await writeFile(join(other, 'remote.txt'), 'remote again\n', 'utf8');
    await context.git.run(['commit', '--quiet', '--all', '-m', 'second remote commit'], { cwd: other });
    await context.git.run(['push', '--quiet', 'origin', 'main'], { cwd: other });
    await writeFile(join(context.worktree, 'local.txt'), 'local\n', 'utf8');
    await context.git.run(['add', '--all'], { cwd: context.worktree });
    await context.git.run(['commit', '--quiet', '-m', 'local commit'], { cwd: context.worktree });

    const refused = await runOperation(context, { kind: 'pull', prune: false });
    expect(refused).toMatchObject({ status: 'failed', failureReason: 'not-fast-forward' });
    expect(await output(context, ['log', '-1', '--format=%s'])).toBe('local commit');
  });

  it('rejects a diverged push and only overwrites after an explicit lease-checked retry', async () => {
    const context = await fixture();
    await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: true,
      force: 'none',
      tags: false,
    });
    const other = join(context.root, 'other');
    await context.git.run(['clone', '--quiet', context.remote, other], { cwd: context.root });
    await context.git.run(['config', 'user.name', 'Other Author'], { cwd: other });
    await context.git.run(['config', 'user.email', 'other@example.test'], { cwd: other });
    await writeFile(join(other, 'remote.txt'), 'remote\n', 'utf8');
    await context.git.run(['add', '--all'], { cwd: other });
    await context.git.run(['commit', '--quiet', '-m', 'remote commit'], { cwd: other });
    await context.git.run(['push', '--quiet', 'origin', 'main'], { cwd: other });

    await writeFile(join(context.worktree, 'local.txt'), 'local\n', 'utf8');
    await context.git.run(['add', '--all'], { cwd: context.worktree });
    await context.git.run(['commit', '--quiet', '-m', 'local commit'], { cwd: context.worktree });
    const remoteTip = await output(context, ['rev-parse', 'refs/heads/main'], context.remote);

    const rejected = await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: false,
      force: 'none',
      tags: false,
    });
    expect(rejected).toMatchObject({
      status: 'failed',
      failureReason: 'not-fast-forward',
      canForceWithLease: true,
    });
    // Nothing was overwritten: an ordinary push never falls back to a force.
    expect(await output(context, ['rev-parse', 'refs/heads/main'], context.remote)).toBe(remoteTip);

    // The lease is stale until the remote's commit is fetched, so even a lease-checked push refuses.
    const stale = await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: false,
      force: 'with-lease',
      tags: false,
    });
    expect(stale).toMatchObject({ status: 'failed', failureReason: 'lease', canForceWithLease: false });
    expect(await output(context, ['rev-parse', 'refs/heads/main'], context.remote)).toBe(remoteTip);

    await runOperation(context, { kind: 'fetch', remote: 'origin', prune: false, tags: false });
    const forced = await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: false,
      force: 'with-lease',
      tags: false,
    });
    expect(forced).toMatchObject({ status: 'succeeded' });
    expect(await output(context, ['rev-parse', 'refs/heads/main'], context.remote)).toBe(
      await output(context, ['rev-parse', 'HEAD']),
    );
  });

  it('deletes a branch on the remote and reports a missing one as not found', async () => {
    const context = await fixture();
    await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [
        { fullName: 'refs/heads/main', remoteBranch: 'main' },
        { fullName: 'refs/heads/main', remoteBranch: 'temporary' },
      ],
      setUpstream: false,
      force: 'none',
      tags: false,
    });
    expect(await output(context, ['rev-parse', 'refs/heads/temporary'], context.remote)).toHaveLength(40);

    const deleted = await runOperation(context, {
      kind: 'delete-remote-branch',
      remote: 'origin',
      remoteBranch: 'temporary',
    });
    expect(deleted).toMatchObject({ status: 'succeeded', kind: 'delete-remote-branch' });
    expect(
      await output(context, ['for-each-ref', '--format=%(refname)', 'refs/heads/temporary'], context.remote),
    ).toBe('');

    // Git answers a delete of a branch the remote no longer has with a warning, not an error.
    const repeated = await runOperation(context, {
      kind: 'delete-remote-branch',
      remote: 'origin',
      remoteBranch: 'temporary',
    });
    expect(repeated).toMatchObject({ status: 'succeeded' });
    expect(repeated.output).toContain('non-existent ref');

    // A remote that does not exist at all is reported as such instead of being invented.
    const unknownRemote = await runOperation(context, {
      kind: 'fetch',
      remote: 'invented',
      prune: false,
      tags: false,
    });
    expect(unknownRemote).toMatchObject({ status: 'failed', failureReason: 'not-found' });
  });

  it('reports an unreachable remote without leaving the operation running', async () => {
    const context = await fixture();
    await rm(context.remote, { recursive: true, force: true });
    const failed = await runOperation(context, {
      kind: 'fetch',
      remote: 'origin',
      prune: false,
      tags: false,
    });
    expect(failed.status).toBe('failed');
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.output.length).toBeGreaterThan(0);
  });

  it('refuses a second network operation while one is running for the same repository', async () => {
    const context = await fixture();
    // A slow fetch keeps the first operation running while the second request arrives.
    const slow = new RepositoryService({
      storagePath: join(context.root, 'slow.json'),
      runner: delayedRunner(context.git, (args) => args[0] === 'fetch', 300),
    });
    const summary = await slow.open(2, context.worktree);
    const settled = new Promise<void>((resolve) => {
      const release = slow.subscribeOperations((_ownerId, operation) => {
        if (operation.status !== 'running') {
          release();
          resolve();
        }
      });
    });

    const fetchRequest = {
      id: summary.id,
      request: { kind: 'fetch', remote: 'origin', prune: false, tags: false },
    } as const;
    await expect(slow.startNetworkOperation(2, fetchRequest)).resolves.toMatchObject({
      status: 'running',
    });
    await expect(slow.startNetworkOperation(2, fetchRequest)).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
    await settled;
    expect(slow.listOperations(2)).toHaveLength(1);
    slow.dispose();
  });

  it('cancels a running operation and reports what it left behind', async () => {
    const context = await fixture();
    const slow = new RepositoryService({
      storagePath: join(context.root, 'cancel.json'),
      runner: delayedRunner(context.git, (args) => args[0] === 'fetch', 2_000),
    });
    const summary = await slow.open(3, context.worktree);
    const settled = new Promise<RepositoryOperation>((resolve) => {
      const release = slow.subscribeOperations((_ownerId, operation) => {
        if (operation.status !== 'running') {
          release();
          resolve(operation);
        }
      });
    });

    const accepted = await slow.startNetworkOperation(3, {
      id: summary.id,
      request: { kind: 'fetch', remote: 'origin', prune: false, tags: false },
    });
    expect(slow.cancelOperation(3, accepted.id)).toMatchObject({ status: 'running' });
    const cancelled = await settled;
    expect(cancelled).toMatchObject({ status: 'cancelled', failureReason: 'cancelled' });
    expect(cancelled.finishedAt).not.toBeNull();
    slow.dispose();
  });
});

/** Wraps the runner so one kind of command takes long enough to observe while it runs. */
function delayedRunner(
  git: GitRunner,
  matches: (args: readonly string[]) => boolean,
  delayMs: number,
): GitRunnerLike {
  return {
    executable: git.executable,
    version: () => git.version(),
    run: async (args, options) => {
      if (matches(args)) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return git.run(args, options);
    },
  };
}

describe('remote management', () => {
  it('adds, renames, retargets, and removes a remote', async () => {
    const context = await fixture();
    expect(await context.service.listRemotes(1, context.repositoryId)).toEqual([
      {
        name: 'origin',
        fetchUrl: context.remote,
        pushUrl: null,
        branchCount: 0,
        fetchAutomatically: true,
      },
    ]);

    const added = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'add', name: 'upstream', url: 'https://example.test/repo.git' },
    });
    expect(added).toMatchObject({ status: 'applied' });
    expect(
      (await context.service.listRemotes(1, context.repositoryId)).map((remote) => remote.name).sort(),
    ).toEqual(['origin', 'upstream']);

    const duplicate = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'add', name: 'upstream', url: 'https://example.test/other.git' },
    });
    expect(duplicate).toMatchObject({ status: 'blocked', reason: 'exists' });

    const invalidUrl = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'add', name: 'dangerous', url: 'ext::sh -c cat' },
    });
    expect(invalidUrl).toMatchObject({ status: 'blocked', reason: 'invalid-url' });

    const renamed = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'rename', name: 'upstream', newName: 'fork' },
    });
    expect(renamed).toMatchObject({ status: 'applied' });

    const retargeted = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'set-url', name: 'fork', url: 'https://example.test/pushed.git', push: true },
    });
    expect(retargeted).toMatchObject({ status: 'applied' });
    expect(
      (await context.service.listRemotes(1, context.repositoryId)).find((remote) => remote.name === 'fork'),
    ).toMatchObject({
      fetchUrl: 'https://example.test/repo.git',
      pushUrl: 'https://example.test/pushed.git',
    });

    const removed = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'remove', name: 'fork' },
    });
    expect(removed).toMatchObject({ status: 'applied' });
    expect(await context.service.listRemotes(1, context.repositoryId)).toHaveLength(1);

    const missing = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'remove', name: 'fork' },
    });
    expect(missing).toMatchObject({ status: 'blocked', reason: 'not-found' });
  });

  it('refuses an existing local-command transport before running network work', async () => {
    const context = await fixture();
    await context.git.run(['config', 'remote.danger.url', 'ext::sh -c echo-danger'], {
      cwd: context.worktree,
    });
    const refused = await runOperation(context, {
      kind: 'fetch',
      remote: 'danger',
      prune: false,
      tags: false,
    });
    expect(refused).toMatchObject({ status: 'failed', failureReason: 'other' });
    expect(refused.message).toContain('will not run');
  });

  it('counts the remote-tracking branches a remote has', async () => {
    const context = await fixture();
    await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [
        { fullName: 'refs/heads/main', remoteBranch: 'main' },
        { fullName: 'refs/heads/main', remoteBranch: 'release' },
      ],
      setUpstream: false,
      force: 'none',
      tags: false,
    });
    await runOperation(context, { kind: 'fetch', remote: 'origin', prune: false, tags: false });
    expect(await context.service.listRemotes(1, context.repositoryId)).toEqual([
      {
        name: 'origin',
        fetchUrl: context.remote,
        pushUrl: null,
        branchCount: 2,
        fetchAutomatically: true,
      },
    ]);
  });

  it('runs an automatic fetch after a remote opt-out is re-enabled', async () => {
    const context = await fixture(25);
    await runOperation(context, {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      setUpstream: true,
      force: 'none',
      tags: false,
    });

    const other = join(context.root, 'background-fetch-source');
    await context.git.run(['clone', '--quiet', context.remote, other], { cwd: context.root });
    await context.git.run(['config', 'user.name', 'Background Author'], { cwd: other });
    await context.git.run(['config', 'user.email', 'background@example.test'], { cwd: other });
    await writeFile(join(other, 'background.txt'), 'background\n', 'utf8');
    await context.git.run(['add', '--all'], { cwd: other });
    await context.git.run(['commit', '--quiet', '-m', 'background commit'], { cwd: other });
    await context.git.run(['push', '--quiet', 'origin', 'main'], { cwd: other });

    const disabled = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'set-automatic-fetch', name: 'origin', enabled: false },
    });
    expect(disabled).toMatchObject({
      status: 'applied',
      remotes: [{ name: 'origin', fetchAutomatically: false }],
    });
    // Opting out cancels any in-flight automatic fetch. Observe the new run after re-enabling,
    // rather than confusing the old job's asynchronous cancellation with its successor's result.
    const priorOperations = new Set(context.service.listOperations(1).map((operation) => operation.id));
    const finished = new Promise<RepositoryOperation>((resolve) => {
      const release = context.service.subscribeOperations((_ownerId, operation) => {
        if (
          operation.source === 'background' &&
          operation.status !== 'running' &&
          !priorOperations.has(operation.id)
        ) {
          release();
          resolve(operation);
        }
      });
    });
    const enabled = await context.service.applyRemoteAction(1, {
      id: context.repositoryId,
      action: { kind: 'set-automatic-fetch', name: 'origin', enabled: true },
    });
    expect(enabled).toMatchObject({
      status: 'applied',
      remotes: [{ name: 'origin', fetchAutomatically: true }],
    });

    const background = await finished;
    expect(background).toMatchObject({
      source: 'background',
      kind: 'fetch',
      status: 'succeeded',
    });
    expect(await output(context, ['rev-parse', 'refs/remotes/origin/main'])).toBe(
      await output(context, ['rev-parse', 'main'], other),
    );
    context.service.dispose();
  });
});
