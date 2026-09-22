import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { readLeanContext, runLeanAction } from '../../src/backend/repositories/lean-branching-service';
import { StaleReferenceSnapshotError } from '../../src/backend/repositories/reference-service';
import { readRecovery, recover } from '../../src/backend/repositories/recovery-service';
import { repositoryLeanActionSchema, requests } from '../../src/common/ipc/contracts';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-lean-'));
  directories.push(root);
  const cwd = join(root, 'repository');
  await mkdir(cwd);
  const runner = new GitRunner();
  const git = async (...args: string[]) => (await runner.run(args, { cwd })).stdout.trim();
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Lean Author');
  await git('config', 'user.email', 'lean@example.test');
  const commit = async (file: string, value: string) => {
    await writeFile(join(cwd, file), value);
    await git('add', '--', file);
    await git('commit', '-qm', value);
    return git('rev-parse', 'HEAD');
  };
  const initial = await commit('file.txt', 'initial');
  const input = { repositoryId: `repo-${'a'.repeat(64)}`, cwd, gitDir: join(cwd, '.git'), worktreePath: cwd };
  const context = (base = 'main') => readLeanContext(runner, { ...input, base });
  const apply = async (kind: 'start' | 'sync' | 'finish', name?: string, base = 'main') => {
    const before = await context(base);
    return runLeanAction(
      runner,
      input,
      { id: input.repositoryId, kind, base, snapshot: before.snapshot, ...(name ? { name } : {}) },
      { signal: new AbortController().signal, setProgress: () => {}, appendOutput: () => {} },
    );
  };
  return { root, cwd, runner, git, commit, initial, input, context, apply };
}

describe('Lean Branching', () => {
  it('starts without Git-flow, retains the topic, fast-forwards one commit and merges multiple commits', async () => {
    const f = await fixture();
    expect((await f.context()).finishReason).toContain('itself');
    expect((await f.apply('start', 'topic/one')).status).toBe('succeeded');
    const tip = await f.commit('one.txt', 'one');
    expect((await f.apply('finish')).status).toBe('succeeded');
    expect(await f.git('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await f.git('rev-parse', 'HEAD')).toBe(tip);
    expect(await f.git('rev-parse', 'topic/one')).toBe(tip);
    await f.apply('start', 'topic/two');
    await f.commit('two.txt', 'two');
    const topic = await f.commit('three.txt', 'three');
    expect((await f.apply('finish')).status).toBe('succeeded');
    expect((await f.git('rev-list', '--parents', '-1', 'HEAD')).split(' ').slice(1)).toEqual([tip, topic]);
    expect(await f.git('status', '--porcelain')).toBe('');
  });

  it('starts at the newer upstream and rejects stale fetched refs without checkout', async () => {
    const f = await fixture();
    await f.git('branch', 'upstream');
    await f.git('branch', '--set-upstream-to=upstream', 'main');
    await f.git('checkout', '-q', 'upstream');
    const newer = await f.commit('new.txt', 'new');
    await f.git('checkout', '-q', 'main');
    const before = await f.context();
    expect(before.startTarget).toBe(newer);
    await f.git('update-ref', 'refs/heads/upstream', f.initial);
    await expect(
      runLeanAction(
        f.runner,
        f.input,
        { id: f.input.repositoryId, kind: 'start', name: 'stale', base: 'main', snapshot: before.snapshot },
        { signal: new AbortController().signal, setProgress: () => {}, appendOutput: () => {} },
      ),
    ).rejects.toBeInstanceOf(StaleReferenceSnapshotError);
    expect(await f.git('symbolic-ref', '--short', 'HEAD')).toBe('main');
    await f.git('update-ref', 'refs/heads/upstream', newer);
    expect((await f.apply('start', 'topic')).status).toBe('succeeded');
    expect(await f.git('rev-parse', 'HEAD')).toBe(newer);
    expect((await f.context()).finishReason).toContain('upstream');
  });

  it('syncs upstream and base without moving tracking refs or configured dependent branches', async () => {
    const f = await fixture();
    await f.git('branch', 'upstream');
    await f.apply('start', 'topic');
    const old = await f.commit('topic.txt', 'topic');
    await f.git('branch', 'dependent');
    await f.git('config', 'rebase.updateRefs', 'true');
    await f.git('branch', '--set-upstream-to=upstream', 'topic');
    await f.git('checkout', '-q', 'upstream');
    const upstream = await f.commit('upstream.txt', 'upstream');
    await f.git('checkout', '-q', 'main');
    const base = await f.commit('base.txt', 'base');
    await f.git('checkout', '-q', 'topic');
    expect((await f.apply('sync')).status).toBe('succeeded');
    expect(await f.git('merge-base', 'main', 'topic')).toBe(base);
    expect(await f.git('rev-parse', 'upstream')).toBe(upstream);
    expect(await f.git('rev-parse', 'dependent')).toBe(old);
    expect(await f.git('show', 'HEAD:upstream.txt')).toBe('upstream');
    expect(await f.git('show', 'HEAD:topic.txt')).toBe('topic');
  });

  it('stops a conflicting Sync and reconstructs ordinary recovery for Abort', async () => {
    const f = await fixture();
    await f.apply('start', 'topic');
    const topic = await f.commit('file.txt', 'topic change');
    await f.git('checkout', '-q', 'main');
    await f.commit('file.txt', 'base change');
    await f.git('checkout', '-q', 'topic');
    expect((await f.apply('sync')).status).toBe('failed');
    const context = {
      id: f.input.repositoryId,
      cwd: f.cwd,
      gitDir: f.input.gitDir,
      head: { state: 'detached' as const, name: null, commit: await f.git('rev-parse', 'HEAD') },
    };
    const recovery = await readRecovery(f.runner, context);
    expect(recovery.pendingOperation).toBe('rebase');
    await recover(
      f.runner,
      context,
      { id: f.input.repositoryId, action: 'abort', snapshot: recovery.snapshot },
      new AbortController().signal,
    );
    expect(await f.git('rev-parse', 'HEAD')).toBe(topic);
    expect(await f.git('status', '--porcelain')).toBe('');
  });

  it('blocks dirty, detached, unborn, invalid-name and occupied-base states', async () => {
    const f = await fixture();
    expect((await f.apply('start', '../bad')).status).toBe('failed');
    await writeFile(join(f.cwd, 'untracked'), 'keep');
    expect((await f.apply('start', 'blocked')).status).toBe('failed');
    await f.git('add', 'untracked');
    await f.git('commit', '-qm', 'keep');
    await f.git('checkout', '--detach');
    expect((await f.context()).syncReason).toContain('Check out');
    await f.git('checkout', 'main');
    await f.apply('start', 'topic');
    await f.commit('topic.txt', 'topic');
    await f.git('worktree', 'add', join(f.root, 'linked'), 'main');
    expect((await f.context()).finishReason).toContain('another worktree');
    expect((await f.apply('finish')).status).toBe('failed');
    await f.git('checkout', '--orphan', 'empty');
    expect((await f.context()).startReason).toContain('Check out');
  });

  it('rejects fetched remote changes, missing upstreams and divergent bases; Sync on the base reconciles divergence', async () => {
    const f = await fixture();
    await f.git('remote', 'add', 'origin', join(f.root, 'not-contacted'));
    await f.git('update-ref', 'refs/remotes/origin/main', f.initial);
    await f.git('branch', '--set-upstream-to=origin/main', 'main');
    const oldReview = await f.context();
    await f.git('checkout', '-qb', 'remote-work');
    const remote = await f.commit('remote.txt', 'remote');
    await f.git('checkout', 'main');
    await f.git('branch', '-D', 'remote-work');
    await f.git('update-ref', 'refs/remotes/origin/main', remote);
    // The local-reference snapshot is unchanged; the fetched remote target must still invalidate it.
    await expect(
      runLeanAction(
        f.runner,
        f.input,
        { id: f.input.repositoryId, kind: 'sync', base: 'main', snapshot: oldReview.snapshot },
        { signal: new AbortController().signal, setProgress: () => {}, appendOutput: () => {} },
      ),
    ).rejects.toBeInstanceOf(StaleReferenceSnapshotError);
    await f.commit('local.txt', 'local');
    expect((await f.context()).startReason).toContain('diverged');
    expect((await f.apply('sync')).status).toBe('succeeded');
    expect(await f.git('merge-base', 'HEAD', remote)).toBe(remote);
    expect(await f.git('rev-parse', 'refs/remotes/origin/main')).toBe(remote);
    await f.git('update-ref', '-d', 'refs/remotes/origin/main');
    expect((await f.context()).syncReason).toContain('missing');
  });

  it('cancels before mutation and continues a conflicting Sync using durable recovery', async () => {
    const f = await fixture();
    const before = await f.context();
    await expect(
      runLeanAction(
        f.runner,
        f.input,
        {
          id: f.input.repositoryId,
          kind: 'start',
          name: 'cancelled',
          base: 'main',
          snapshot: before.snapshot,
        },
        { signal: AbortSignal.abort(), setProgress: () => {}, appendOutput: () => {} },
      ),
    ).rejects.toThrow();
    expect(await f.git('branch', '--format=%(refname:short)')).toBe('main');
    await f.apply('start', 'topic');
    await f.commit('file.txt', 'topic change');
    await f.git('checkout', 'main');
    const base = await f.commit('file.txt', 'base change');
    await f.git('checkout', 'topic');
    expect((await f.apply('sync')).status).toBe('failed');
    await writeFile(join(f.cwd, 'file.txt'), 'resolved');
    await f.git('add', 'file.txt');
    const recoveryContext = {
      id: f.input.repositoryId,
      cwd: f.cwd,
      gitDir: f.input.gitDir,
      head: { state: 'detached' as const, name: null, commit: await f.git('rev-parse', 'HEAD') },
    };
    const recovery = await readRecovery(new GitRunner(), recoveryContext);
    await recover(
      new GitRunner(),
      recoveryContext,
      { id: f.input.repositoryId, action: 'continue', snapshot: recovery.snapshot },
      new AbortController().signal,
    );
    expect((await f.apply('sync')).status).toBe('succeeded');
    expect(await f.git('merge-base', 'HEAD', 'main')).toBe(base);
    expect(await f.git('show', 'HEAD:file.txt')).toBe('resolved');
    expect((await f.apply('finish')).status).toBe('succeeded');
  });

  it('requires named validated requests and denies all inspector variants', () => {
    const valid = { id: `repo-${'a'.repeat(64)}`, kind: 'sync', base: 'main', snapshot: 'a'.repeat(64) };
    expect(repositoryLeanActionSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, args: ['reset', '--hard'] },
      { ...valid, name: 'bad' },
      { ...valid, kind: 'start' },
      { ...valid, base: '--all' },
    ])
      expect(repositoryLeanActionSchema.safeParse(invalid).success).toBe(false);
    for (const inspector of ['commit-details', 'file-history', 'blame'] as const)
      for (const request of [requests.getRepositoryLean, requests.startRepositoryLean])
        expect(canInvokeInspector(inspector, request.channel, valid)).toBe(false);
  });
});
