import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCancelledError, GitCommandError, GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { classifyNetworkFailure } from '../../src/backend/repositories/network-service';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';
import {
  requests,
  repositoryPushPreviewSchema,
  repositoryPushPreviewRequestSchema,
} from '../../src/common/ipc/contracts';
import type {
  RepositoryNetworkRequest,
  RepositoryOperation,
  RepositoryReferenceAction,
} from '../../src/common/ipc/contracts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p05-'));
  const cwd = join(root, 'local');
  const bare = join(root, 'hub.git');
  await mkdir(cwd);
  const runner = new GitRunner();
  const git = async (args: string[], path = cwd) => (await runner.run(args, { cwd: path })).stdout.trim();
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'P05 Fixture']);
  await git(['config', 'user.email', 'p05@example.invalid']);
  await git(['commit', '--allow-empty', '-m', 'baseline']);
  await git(['init', '--bare', '-b', 'main', bare]);
  await git(['remote', 'add', 'origin', bare]);
  await git(['push', '-u', 'origin', 'main']);
  const service = new RepositoryService({ storagePath: join(root, 'profile.json'), runner });
  await service.setAutomaticFetch(false);
  const repo = await service.open(1, cwd);
  await service.setTrust(1, repo.id, true);
  cleanup.push(async () => {
    service.dispose();
    await service.settled();
    await rm(root, { recursive: true, force: true });
  });
  const wait = async (accepted: RepositoryOperation) => {
    await expect
      .poll(() => service.listOperations(1).find((operation) => operation.id === accepted.id)?.status)
      .not.toBe('running');
    return service.listOperations(1).find((operation) => operation.id === accepted.id)!;
  };
  const network = async (request: RepositoryNetworkRequest) =>
    wait(await service.startNetworkOperation(1, { id: repo.id, request }));
  const reference = async (action: RepositoryReferenceAction) =>
    service.applyReferenceAction(1, {
      id: repo.id,
      snapshot: (await service.getReferenceContext(1, repo.id)).snapshot,
      action,
    });
  const targets = [{ fullName: 'refs/heads/main', remoteBranch: 'main' }];
  const review = () => service.previewPush(1, { id: repo.id, remote: 'origin', targets, tags: false });
  const force = (previewToken?: string) =>
    network({
      kind: 'push',
      remote: 'origin',
      targets,
      tags: false,
      force: 'with-lease',
      setUpstream: false,
      ...(previewToken ? { previewToken } : {}),
    });
  return { root, cwd, bare, git, service, repo, wait, network, reference, review, force };
}

describe('P05 reviewed remote writes', () => {
  it('keeps the reviewed lease when background fetch advances tracking refs, then permits a fresh review', async () => {
    const f = await fixture();
    const baseline = await f.git(['rev-parse', 'HEAD']);
    await f.git(['commit', '--allow-empty', '-m', 'local']);
    const reviewed = await f.review();
    expect(reviewed.targets[0]).toMatchObject({ remoteId: baseline, replacedCommits: 0 });
    const other = join(f.root, 'peer');
    await f.git(['clone', f.bare, other]);
    await f.git(['config', 'user.name', 'Peer'], other);
    await f.git(['config', 'user.email', 'peer@example.invalid'], other);
    await f.git(['commit', '--allow-empty', '-m', 'remote'], other);
    await f.git(['push', 'origin', 'main'], other);
    const advanced = await f.git(['rev-parse', 'main'], f.bare);
    await f.network({ kind: 'fetch', remote: 'origin', prune: true, tags: false });
    const refused = await f.force(reviewed.token);
    expect(refused).toMatchObject({ status: 'failed', failureReason: 'lease', canForceWithLease: false });
    expect(refused.command).toContain(`--force-with-lease=refs/heads/main:${baseline}`);
    expect(await f.git(['rev-parse', 'main'], f.bare)).toBe(advanced);
    expect(await f.force()).toMatchObject({ status: 'failed' });
    const fresh = await f.review();
    expect(fresh.targets[0]).toMatchObject({ remoteId: advanced, replacedCommits: 1 });
    expect(await f.force(fresh.token)).toMatchObject({ status: 'succeeded' });
    expect(await f.git(['rev-parse', 'main'], f.bare)).toBe(await f.git(['rev-parse', 'HEAD']));
    expect(await f.force(fresh.token)).toMatchObject({ status: 'failed' });
  });

  it('refuses moved sources, retargeted URLs, cross-window tokens and unknown remote branches', async () => {
    const f = await fixture();
    const preview = await f.review();
    await f.git(['commit', '--allow-empty', '-m', 'changed after review']);
    expect((await f.force(preview.token)).message).toContain('changed');
    const otherOwner = await f.service.open(2, f.cwd);
    const second = await f.review();
    const request = {
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      tags: false,
      force: 'with-lease',
      setUpstream: false,
      previewToken: second.token,
    } as const;
    const cross = await f.service.startNetworkOperation(2, {
      id: otherOwner.id,
      request: { ...request, targets: [...request.targets] },
    });
    await expect
      .poll(() => f.service.listOperations(2).find((op) => op.id === cross.id)?.status)
      .toBe('failed');
    const redirected = join(f.root, 'other.git');
    await f.git(['init', '--bare', redirected]);
    await f.git(['remote', 'set-url', '--push', 'origin', redirected]);
    expect(await f.force(second.token)).toMatchObject({ status: 'failed' });
    expect(await f.git(['for-each-ref'], redirected)).toBe('');
    await f.git(['config', '--unset-all', 'remote.origin.pushurl']);
    await f.git(['update-ref', '-d', 'refs/remotes/origin/main']);
    const unknown = await f.review();
    expect(unknown.targets[0]?.remoteId).toBeNull();
    expect(await f.force(unknown.token)).toMatchObject({ status: 'failed', failureReason: 'lease' });
  });

  it('pushes all tags including lightweight and unrelated annotated tags, with opt-out tracking', async () => {
    const f = await fixture();
    await f.git(['tag', 'lightweight']);
    await f.git(['tag', '-a', '-m', 'reachable', 'annotated-at-base']);
    await f.git(['checkout', '--orphan', 'unrelated']);
    await f.git(['commit', '--allow-empty', '-m', 'unrelated']);
    await f.git(['tag', '-a', '-m', 'separate', 'unrelated-tag']);
    await f.git(['checkout', 'main']);
    await f.git(['branch', 'publish']);
    await f.git(['config', 'push.followTags', 'true']);
    expect(
      await f.network({
        kind: 'push',
        remote: 'origin',
        targets: [{ fullName: 'refs/heads/publish', remoteBranch: 'different-name', setUpstream: false }],
        setUpstream: false,
        force: 'none',
        tags: false,
      }),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.git(['tag', '--list'], f.bare)).toBe('');
    expect(
      await f.reference({ kind: 'push-tag', fullName: 'refs/tags/lightweight', remote: 'origin' }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.git(['tag', '--list'], f.bare)).toBe('lightweight');
    const result = await f.network({
      kind: 'push',
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/publish', remoteBranch: 'different-name', setUpstream: false }],
      setUpstream: false,
      force: 'none',
      tags: true,
    });
    expect(result.status).toBe('succeeded');
    expect(await f.git(['tag', '--list'], f.bare)).toBe('annotated-at-base\nlightweight\nunrelated-tag');
    expect(await f.git(['cat-file', '-t', 'refs/tags/lightweight'], f.bare)).toBe('commit');
    expect(await f.git(['cat-file', '-t', 'refs/tags/unrelated-tag'], f.bare)).toBe('tag');
    await expect(f.git(['config', '--get', 'branch.publish.remote'])).rejects.toBeInstanceOf(GitCommandError);
  });

  it('saves remote name, fetch and push URLs together and rejects stale or invalid edits before mutation', async () => {
    const f = await fixture();
    const old = (await f.service.listRemotes(1, f.repo.id))[0]!;
    const edit = {
      kind: 'edit',
      name: 'origin',
      newName: 'team',
      url: f.bare,
      pushUrl: join(f.root, 'publish.git'),
      snapshot: old.snapshot!,
    } as const;
    expect(
      await f.service.applyRemoteAction(1, { id: f.repo.id, action: { ...edit, url: 'ext::sh bad' } }),
    ).toMatchObject({ status: 'blocked', reason: 'invalid-url' });
    expect(await f.git(['remote'])).toBe('origin');
    expect(await f.service.applyRemoteAction(1, { id: f.repo.id, action: edit })).toMatchObject({
      status: 'applied',
    });
    expect(await f.git(['config', '--get', 'branch.main.remote'])).toBe('team');
    expect(await f.git(['remote', 'get-url', '--push', 'team'])).toBe(edit.pushUrl);
    const updated = (await f.service.listRemotes(1, f.repo.id))[0]!;
    await f.git(['remote', 'set-url', 'team', '/different/location']);
    expect(
      await f.service.applyRemoteAction(1, {
        id: f.repo.id,
        action: {
          ...edit,
          name: 'team',
          newName: 'renamed',
          snapshot: updated.snapshot!,
          pushUrl: null,
        },
      }),
    ).toMatchObject({ status: 'blocked' });
    expect(await f.git(['remote'])).toBe('team');
    const fresh = (await f.service.listRemotes(1, f.repo.id))[0]!;
    expect(
      await f.service.applyRemoteAction(1, {
        id: f.repo.id,
        action: {
          ...edit,
          name: 'team',
          newName: 'team',
          snapshot: fresh.snapshot!,
          pushUrl: null,
        },
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.git(['remote', 'get-url', '--push', 'team'])).toBe(f.bare);
  });

  it('retains local references on denied remote deletion and deletes only the reviewed mapped upstream', async () => {
    const f = await fixture();
    await f.git(['branch', 'topic']);
    await f.git(['push', '-u', 'origin', 'topic:published']);
    await f.git(['config', 'receive.denyDeletes', 'true'], f.bare);
    expect(
      await f.reference({
        kind: 'delete-branch',
        fullName: 'refs/heads/topic',
        force: false,
        deleteUpstream: true,
      }),
    ).toMatchObject({ status: 'blocked', message: expect.stringContaining('local reference was retained') });
    expect(await f.git(['rev-parse', 'topic'])).toBe(await f.git(['rev-parse', 'main']));
    await f.git(['tag', '-a', '-m', '', 'empty-tag']);
    await f.git(['push', 'origin', 'refs/tags/empty-tag']);
    const rejectingHook = join(f.bare, 'hooks', 'pre-receive');
    await writeFile(
      rejectingHook,
      `#!${process.execPath}\nprocess.stderr.write('protected tag\\n'); process.exit(1);\n`,
    );
    await chmod(rejectingHook, 0o700);
    expect(
      await f.reference({ kind: 'delete-tag', fullName: 'refs/tags/empty-tag', remoteNames: ['origin'] }),
    ).toMatchObject({ status: 'blocked' });
    expect(await f.git(['cat-file', '-t', 'empty-tag'])).toBe('tag');
    await unlink(rejectingHook);
    await f.git(['config', 'receive.denyDeletes', 'false'], f.bare);
    expect(
      await f.reference({
        kind: 'delete-branch',
        fullName: 'refs/heads/topic',
        force: false,
        deleteUpstream: true,
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.git(['for-each-ref', '--format=%(refname)', 'refs/heads'], f.bare)).toBe(
      'refs/heads/main',
    );
    expect(
      await f.reference({ kind: 'delete-tag', fullName: 'refs/tags/empty-tag', remoteNames: ['origin'] }),
    ).toMatchObject({ status: 'applied' });
  });

  it('validates every selected branch before batch deletion and protects current/worktree branches', async () => {
    const f = await fixture();
    await f.git(['branch', 'one']);
    await f.git(['branch', 'two']);
    const names = ['refs/heads/one', 'refs/heads/main'];
    expect(await f.reference({ kind: 'delete-references', fullNames: names, force: true })).toMatchObject({
      status: 'blocked',
      reason: 'current-branch',
    });
    expect(await f.git(['rev-parse', 'one'])).toBe(await f.git(['rev-parse', 'main']));
    await f.git(['worktree', 'add', join(f.root, 'linked'), 'two']);
    expect(
      await f.reference({
        kind: 'delete-references',
        fullNames: ['refs/heads/one', 'refs/heads/two'],
        force: true,
      }),
    ).toMatchObject({ status: 'blocked', reason: 'checked-out' });
    await f.git(['branch', 'three']);
    expect(
      await f.reference({
        kind: 'delete-references',
        fullNames: ['refs/heads/one', 'refs/heads/three'],
        force: false,
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await f.git(['branch', '--format=%(refname)'])).toBe('refs/heads/main\nrefs/heads/two');
  });

  it.each(['pre-receive', 'post-receive'])(
    'cancels an accepting receiver at %s and reports the actual remote state',
    async (hookName) => {
      const f = await fixture();
      const before = await f.git(['rev-parse', 'main'], f.bare);
      await f.git(['commit', '--allow-empty', '-m', 'to push']);
      const hook = join(f.bare, 'hooks', hookName);
      await copyFile(resolve('tests/fixtures/accepting-receiver.ts'), hook);
      await chmod(hook, 0o700);
      const accepted = await f.service.startNetworkOperation(1, {
        id: f.repo.id,
        request: {
          kind: 'push',
          remote: 'origin',
          targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
          tags: false,
          setUpstream: false,
          force: 'none',
        },
      });
      await expect
        .poll(() => f.service.listOperations(1).find((operation) => operation.id === accepted.id)?.output)
        .toContain('P05 accepting receiver');
      expect(f.service.cancelOperation(1, accepted.id)).toMatchObject({
        status: 'running',
        cancelRequested: true,
      });
      expect(await f.wait(accepted)).toMatchObject({ status: 'cancelled', failureReason: 'cancelled' });
      expect(await f.git(['rev-parse', 'main'], f.bare)).toBe(
        hookName === 'pre-receive' ? before : await f.git(['rev-parse', 'HEAD']),
      );
      const pid = Number(await readFile(join(f.bare, 'receiver.pid'), 'utf8'));
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    },
  );

  it('cancels a real askpass process and classifies expired credentials and missing upstreams actionably', async () => {
    const f = await fixture();
    const helper = join(f.root, 'askpass.ts');
    await copyFile(resolve('tests/fixtures/cancellable-askpass.ts'), helper);
    await chmod(helper, 0o700);
    const marker = join(f.root, 'askpass.pid');
    const controller = new AbortController();
    const result = new GitRunner()
      .run(['-c', 'credential.helper=', 'credential', 'fill'], {
        cwd: f.cwd,
        stdin: 'protocol=https\nhost=fixture.invalid\n\n',
        authentication: 'prompt',
        signal: controller.signal,
        env: { GIT_ASKPASS: helper, GW_ASKPASS_PID: marker },
      })
      .catch((error: unknown) => error);
    await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).not.toBe('');
    controller.abort();
    expect(await result).toBeInstanceOf(GitCancelledError);
    const pid = Number(await readFile(marker, 'utf8'));
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    for (const status of [401, 403])
      expect(
        classifyNetworkFailure(
          'fetch',
          `fatal: unable to access: The requested URL returned error: ${status}`,
        ),
      ).toMatchObject({ reason: 'authentication', canForceWithLease: false });
    await f.git(['branch', 'orphaned']);
    await f.git(['push', '-u', 'origin', 'orphaned']);
    await f.git(['push', 'origin', '--delete', 'orphaned']);
    await f.network({ kind: 'fetch', remote: 'origin', prune: true, tags: false });
    const refs = await f.service.getReferenceContext(1, f.repo.id);
    expect(refs.branches.find((branch) => branch.name === 'orphaned')?.upstreamGone).toBe(true);
    const pull = await f.network({
      kind: 'pull',
      remote: 'origin',
      branch: 'orphaned',
      into: 'refs/heads/main',
      expectedHead: refs.head.commit!,
      snapshot: refs.snapshot,
      prune: true,
    });
    expect(pull).toMatchObject({ status: 'failed', failureReason: 'not-found' });
    expect(pull.message).toContain('tracking');
  });

  it('validates push review IPC and excludes inspector windows', () => {
    expect(
      repositoryPushPreviewRequestSchema.safeParse({ id: 'repo', remote: 'origin', targets: [], tags: false })
        .success,
    ).toBe(false);
    expect(repositoryPushPreviewSchema.safeParse({ token: 'fake' }).success).toBe(false);
    for (const kind of ['commit-details', 'blame', 'file-history'] as const)
      expect(canInvokeInspector(kind, requests.previewRepositoryPush.channel, {})).toBe(false);
  });
});
