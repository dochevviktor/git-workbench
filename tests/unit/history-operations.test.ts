import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { RepositoryHistoryOperationAction, RepositoryOperation } from '../../src/common/ipc/contracts';

const directories: string[] = [];
const services: RepositoryService[] = [];

async function terminal(
  service: RepositoryService,
  operation: RepositoryOperation,
): Promise<RepositoryOperation> {
  const current = service.listOperations(1).find((candidate) => candidate.id === operation.id);
  if (current && current.status !== 'running') return current;
  return new Promise((resolve) => {
    const unsubscribe = service.subscribeOperations((_owner, next) => {
      if (next.id === operation.id && next.status !== 'running') {
        unsubscribe();
        resolve(next);
      }
    });
  });
}

async function fixture(options: { readonly conflict?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-history-operations-'));
  directories.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'History Fixture');
  await run('config', 'user.email', 'history@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'value.txt'), 'base\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Base');
  const base = await run('rev-parse', 'HEAD');

  await run('checkout', '--quiet', '-b', 'feature');
  await writeFile(join(cwd, 'value.txt'), options.conflict ? 'feature\n' : 'base\n');
  if (!options.conflict) await writeFile(join(cwd, 'feature.txt'), 'feature\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Feature change');
  const source = await run('rev-parse', 'HEAD');

  await run('checkout', '--quiet', 'main');
  await writeFile(join(cwd, 'value.txt'), options.conflict ? 'main\n' : 'base\n');
  if (!options.conflict) await writeFile(join(cwd, 'main.txt'), 'main\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Main change');
  const before = await run('rev-parse', 'HEAD');

  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner: git });
  services.push(service);
  const { id } = await service.open(1, cwd);
  return { root, cwd, git, run, service, id, base, source, before };
}

async function revertConflictFixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-revert-conflict-'));
  directories.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Revert Fixture');
  await run('config', 'user.email', 'revert@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'value.txt'), 'base\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Base');
  await writeFile(join(cwd, 'value.txt'), 'middle\n');
  await run('commit', '--quiet', '-am', 'Middle change');
  const target = await run('rev-parse', 'HEAD');
  await writeFile(join(cwd, 'value.txt'), 'latest\n');
  await run('commit', '--quiet', '-am', 'Latest change');
  const before = await run('rev-parse', 'HEAD');
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner: git });
  services.push(service);
  const { id } = await service.open(1, cwd);
  return { root, cwd, git, run, service, id, target, before };
}

function cherryAction(
  preview: Awaited<ReturnType<RepositoryService['getHistoryOperationPreview']>>,
  overrides: Partial<Extract<RepositoryHistoryOperationAction, { kind: 'cherry-pick' }>> = {},
): Extract<RepositoryHistoryOperationAction, { kind: 'cherry-pick' }> {
  return {
    kind: 'cherry-pick',
    commitId: preview.targetCommitId,
    snapshot: preview.snapshot,
    commitChanges: true,
    appendOrigin: false,
    autostash: false,
    ...overrides,
  };
}

function resetAction(
  preview: Awaited<ReturnType<RepositoryService['getHistoryOperationPreview']>>,
  mode: 'soft' | 'mixed' | 'hard',
  confirmDiscard = false,
): Extract<RepositoryHistoryOperationAction, { kind: 'reset' }> {
  return {
    kind: 'reset',
    targetCommitId: preview.targetCommitId,
    mode,
    snapshot: preview.snapshot,
    changesSnapshot: preview.workingChanges.snapshot,
    confirmDiscard,
  };
}

afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('F19 cherry-pick, revert, and reset', () => {
  it('cherry-picks a selected commit and preserves the source author/message', async () => {
    const f = await fixture();
    const preview = await f.service.getHistoryOperationPreview(1, {
      kind: 'cherry-pick',
      id: f.id,
      commitId: f.source,
    });
    expect(preview).toMatchObject({ kind: 'cherry-pick', canStart: true, targetSubject: 'Feature change' });
    const result = await terminal(
      f.service,
      f.service.startHistoryOperation(1, { id: f.id, action: cherryAction(preview) }),
    );
    expect(result).toMatchObject({ status: 'succeeded', kind: 'cherry-pick' });
    expect(await f.run('show', '-s', '--format=%P', 'HEAD')).toBe(f.before);
    expect(await f.run('show', '-s', '--format=%s', 'HEAD')).toBe('Feature change');
    expect(await f.run('show', '-s', '--format=%an', 'HEAD')).toBe('History Fixture');
    expect(await readFile(join(f.cwd, 'feature.txt'), 'utf8')).toBe('feature\n');
  });

  it('reverts a selected commit and supports a staged no-commit result', async () => {
    const f = await fixture();
    const cherryPreview = await f.service.getHistoryOperationPreview(1, {
      kind: 'cherry-pick',
      id: f.id,
      commitId: f.source,
    });
    await terminal(
      f.service,
      f.service.startHistoryOperation(1, { id: f.id, action: cherryAction(cherryPreview) }),
    );
    const preview = await f.service.getHistoryOperationPreview(1, {
      kind: 'revert',
      id: f.id,
      commitId: f.source,
    });
    const action: Extract<RepositoryHistoryOperationAction, { kind: 'revert' }> = {
      kind: 'revert',
      commitId: preview.targetCommitId,
      snapshot: preview.snapshot,
      commitChanges: false,
      mainlineParent: undefined,
      autostash: false,
    };
    const result = await terminal(f.service, f.service.startHistoryOperation(1, { id: f.id, action }));
    expect(result).toMatchObject({ status: 'succeeded', kind: 'revert' });
    expect(await f.run('rev-parse', 'HEAD')).not.toBe(f.before);
    expect(await f.run('diff', '--cached', '--name-only')).toContain('feature.txt');
    await expect(readFile(join(f.cwd, 'feature.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves a cherry-pick conflict in Recovery, labels its sides, then continues it', async () => {
    const f = await fixture({ conflict: true });
    const preview = await f.service.getHistoryOperationPreview(1, {
      kind: 'cherry-pick',
      id: f.id,
      commitId: f.source,
    });
    const result = await terminal(
      f.service,
      f.service.startHistoryOperation(1, { id: f.id, action: cherryAction(preview) }),
    );
    expect(result).toMatchObject({ status: 'failed', failureReason: 'conflict' });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe('cherry-pick');
    const conflict = await f.service.getConflicts(1, { id: f.id, path: 'value.txt' });
    expect(conflict).toMatchObject({
      operation: 'cherry-pick',
      oursLabel: "Current 'main'",
      theirsLabel: expect.stringContaining('Cherry-picked'),
    });
    const resolved = await f.service.resolveConflict(
      {
        id: f.id,
        path: 'value.txt',
        snapshot: conflict.snapshot,
        content: 'feature\n',
      },
      1,
    );
    expect(resolved.conflictedCount).toBe(0);
    const recovery = await f.service.getRecovery(1, f.id);
    const continued = await terminal(
      f.service,
      f.service.startRecovery(1, { id: f.id, action: 'continue', snapshot: recovery.snapshot }),
    );
    expect(continued).toMatchObject({ status: 'succeeded' });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
    expect(await f.run('show', '-s', '--format=%s', 'HEAD')).toBe('Feature change');
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe('feature\n');
  });

  it('aborts a revert conflict and restores the original branch and worktree', async () => {
    const f = await revertConflictFixture();
    const preview = await f.service.getHistoryOperationPreview(1, {
      kind: 'revert',
      id: f.id,
      commitId: f.target,
    });
    const action: Extract<RepositoryHistoryOperationAction, { kind: 'revert' }> = {
      kind: 'revert',
      commitId: preview.targetCommitId,
      snapshot: preview.snapshot,
      commitChanges: true,
      mainlineParent: undefined,
      autostash: false,
    };
    const result = await terminal(f.service, f.service.startHistoryOperation(1, { id: f.id, action }));
    expect(result).toMatchObject({ status: 'failed', failureReason: 'conflict' });
    const conflict = await f.service.getConflicts(1, { id: f.id, path: 'value.txt' });
    expect(conflict).toMatchObject({
      operation: 'revert',
      oursLabel: "Current 'main'",
      theirsLabel: expect.stringContaining('Reverted'),
    });
    const recovery = await f.service.getRecovery(1, f.id);
    const aborted = await terminal(
      f.service,
      f.service.startRecovery(1, { id: f.id, action: 'abort', snapshot: recovery.snapshot }),
    );
    expect(aborted).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.before);
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe('latest\n');
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
  });

  it.each([
    ['soft', 'current\n', 'working\n'],
    ['mixed', 'base\n', 'working\n'],
  ] as const)(
    'reset %s moves HEAD while keeping the worktree',
    async (mode, _expectedIndex, expectedWorktree) => {
      const f = await fixture();
      await writeFile(join(f.cwd, 'value.txt'), 'working\n');
      const preview = await f.service.getHistoryOperationPreview(1, {
        kind: 'reset',
        id: f.id,
        targetCommitId: f.base,
        mode,
      });
      const result = await terminal(
        f.service,
        f.service.startHistoryOperation(1, { id: f.id, action: resetAction(preview, mode) }),
      );
      expect(result).toMatchObject({ status: 'succeeded', kind: 'reset' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(f.base);
      if (mode === 'soft') expect(await f.run('show', ':main.txt')).toBe('main');
      else await expect(f.run('show', ':main.txt')).rejects.toBeTruthy();
      expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe(expectedWorktree);
    },
  );

  it('hard reset saves a Recovery copy before discarding tracked changes', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'value.txt'), 'local staged\n');
    await f.run('add', '--all');
    await writeFile(join(f.cwd, 'value.txt'), 'local unstaged\n');
    const preview = await f.service.getHistoryOperationPreview(1, {
      kind: 'reset',
      id: f.id,
      targetCommitId: f.base,
      mode: 'hard',
    });
    const result = await terminal(
      f.service,
      f.service.startHistoryOperation(1, { id: f.id, action: resetAction(preview, 'hard', true) }),
    );
    expect(result).toMatchObject({ status: 'succeeded', kind: 'reset' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.base);
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe('base\n');
    const recovery = await f.service.getRecovery(1, f.id);
    expect(recovery.copies).toHaveLength(1);
    expect(recovery.copies[0]?.pending).toBe(false);
    const applied = await terminal(
      f.service,
      f.service.startRecovery(1, {
        id: f.id,
        action: 'apply',
        copyId: recovery.copies[0]!.id,
        snapshot: recovery.snapshot,
      }),
    );
    expect(applied).toMatchObject({ status: 'succeeded' });
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe('local unstaged\n');
  });

  it('recovers a reflog-only commit with the existing Mixed Reset workflow', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'recovered.txt'), 'recovered\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Lost main commit');
    const lost = await f.run('rev-parse', 'HEAD');
    await f.run('reset', '--hard', f.before);

    const normal = await f.service.getHistory(1, f.id, 0, 100);
    expect(normal.commits.map((commit) => commit.id)).not.toContain(lost);
    const reflog = await f.service.getHistory(1, f.id, 0, 100, undefined, undefined, 'reflog');
    expect(reflog.commits[0]).toMatchObject({ id: lost, subject: 'Lost main commit' });

    const preview = await f.service.getHistoryOperationPreview(1, {
      kind: 'reset',
      id: f.id,
      targetCommitId: lost,
      mode: 'mixed',
    });
    const result = await terminal(
      f.service,
      f.service.startHistoryOperation(1, { id: f.id, action: resetAction(preview, 'mixed') }),
    );
    expect(result).toMatchObject({ status: 'succeeded', kind: 'reset' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(lost);
    expect(await f.run('show', ':recovered.txt')).toBe('recovered');
    await expect(readFile(join(f.cwd, 'recovered.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.service.getHistory(1, f.id, 0, 100)).commits.map((commit) => commit.id)).toContain(lost);
  });
});
