import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { RepositoryInteractiveRebaseRequest, RepositoryOperation } from '../../src/common/ipc/contracts';

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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-interactive-rebase-'));
  directories.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Interactive Fixture');
  await run('config', 'user.email', 'interactive@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'base.txt'), 'base\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Base');
  const base = await run('rev-parse', 'HEAD');
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']) {
    await writeFile(join(cwd, `${name.toLowerCase()}.txt`), `${name}\n`);
    await run('add', '--all');
    await run('commit', '--quiet', '-m', `Add ${name}`);
  }
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner: git });
  services.push(service);
  const { id } = await service.open(1, cwd);
  return { root, cwd, git, run, service, id, base };
}

function requestFromPlan(
  plan: Awaited<ReturnType<RepositoryService['getInteractiveRebasePlan']>>,
  actions: RepositoryInteractiveRebaseRequest['actions'],
  overrides: Partial<
    Pick<RepositoryInteractiveRebaseRequest, 'autosquash' | 'autostash' | 'changesSnapshot'>
  > = {},
): RepositoryInteractiveRebaseRequest {
  return {
    id: plan.repositoryId,
    ontoCommitId: plan.ontoCommitId,
    snapshot: plan.snapshot,
    actions,
    autosquash: false,
    autostash: false,
    ...overrides,
  };
}

async function abort(service: RepositoryService, id: string) {
  const state = await service.getRecovery(1, id);
  return terminal(service, service.startRecovery(1, { id, action: 'abort', snapshot: state.snapshot }));
}

afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('F18 interactive rebase', () => {
  it('executes newest-first reorder, reword, squash, fixup, and drop actions', async () => {
    const f = await fixture();
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    expect(plan.commits.map((commit) => commit.subject)).toEqual([
      'Add Zeta',
      'Add Epsilon',
      'Add Delta',
      'Add Gamma',
      'Add Beta',
      'Add Alpha',
    ]);
    const bySubject = new Map(plan.commits.map((commit) => [commit.subject, commit] as const));
    const actions = [
      bySubject.get('Add Zeta')!,
      { ...bySubject.get('Add Epsilon')!, action: 'drop' as const },
      {
        ...bySubject.get('Add Delta')!,
        action: 'reword' as const,
        subject: 'Delta revised',
        body: 'Changed body',
      },
      { ...bySubject.get('Add Gamma')!, action: 'squash' as const },
      { ...bySubject.get('Add Beta')!, action: 'fixup' as const },
      bySubject.get('Add Alpha')!,
    ].map(({ commitId, action, subject, body }) => ({ commitId, action, subject, body }));
    const result = await terminal(
      f.service,
      f.service.startInteractiveRebase(1, requestFromPlan(plan, actions)),
    );
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(await f.run('log', '--format=%s', '--reverse', `${f.base}..HEAD`)).toBe(
      'Add Alpha\nDelta revised\nAdd Zeta',
    );
    expect(await f.run('show', '-s', '--format=%B', 'HEAD~1')).toContain('Changed body');
    expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).toContain('alpha.txt');
    expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('epsilon.txt');
  });

  it('pauses Edit detached, exposes amend, and resumes through Continue', async () => {
    const f = await fixture();
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const bySubject = new Map(plan.commits.map((commit) => [commit.subject, commit] as const));
    const actions = [
      bySubject.get('Add Zeta')!,
      bySubject.get('Add Epsilon')!,
      bySubject.get('Add Delta')!,
      { ...bySubject.get('Add Gamma')!, action: 'edit' as const },
      bySubject.get('Add Beta')!,
      bySubject.get('Add Alpha')!,
    ].map(({ commitId, action, subject, body }) => ({ commitId, action, subject, body }));
    const paused = await terminal(
      f.service,
      f.service.startInteractiveRebase(1, requestFromPlan(plan, actions)),
    );
    expect(paused).toMatchObject({ status: 'failed' });
    expect((await f.service.getRecovery(1, f.id)).rebaseEdit).toBe('needs-amend');
    const context = await f.service.getCommitContext(1, f.id);
    expect(context).toMatchObject({
      pendingOperation: 'rebase',
      rebaseEdit: 'needs-amend',
      amend: { subject: 'Add Gamma' },
    });
    const amended = await terminal(
      f.service,
      f.service.startCommit(1, {
        id: f.id,
        subject: 'Gamma amended',
        body: 'Amended during rebase',
        amend: true,
        skipHooks: false,
        snapshot: context.snapshot,
      }),
    );
    expect(amended).toMatchObject({ status: 'succeeded' });
    expect((await f.service.getRecovery(1, f.id)).rebaseEdit).toBe('ready-to-continue');
    const continued = await terminal(
      f.service,
      f.service.startRecovery(1, {
        id: f.id,
        action: 'continue',
        snapshot: (await f.service.getRecovery(1, f.id)).snapshot,
      }),
    );
    expect(continued).toMatchObject({ status: 'succeeded' });
    expect(await f.run('branch', '--show-current')).toBe('main');
    expect(await f.run('log', '--format=%s', '--reverse', `${f.base}..HEAD`)).toContain('Gamma amended');
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBeNull();
  });

  it('supports a root plan and preserves local work with an explicit recovery stash', async () => {
    const f = await fixture();
    await f.run('commit', '--quiet', '--allow-empty', '-m', 'Empty marker');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: null });
    expect(plan.root).toBe(true);
    expect(plan.commits.some((commit) => commit.subject === 'Empty marker')).toBe(true);
    await writeFile(join(f.cwd, 'later.txt'), 'keep me\n');
    const preview = await f.service.previewLocalChanges(1, f.id);
    const actions = plan.commits.map(({ commitId, action, subject, body }) => ({
      commitId,
      action,
      subject,
      body,
    }));
    const result = await terminal(
      f.service,
      f.service.startInteractiveRebase(
        1,
        requestFromPlan(plan, actions, { autostash: true, changesSnapshot: preview.snapshot }),
      ),
    );
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(await readFile(join(f.cwd, 'later.txt'), 'utf8')).toBe('keep me\n');
    expect(await f.run('status', '--porcelain')).toBe('?? later.txt');
    expect(await f.run('log', '--format=%s', '--all')).toContain('Empty marker');
  });

  it('can abort an interactive conflict and returns the original branch tree', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'topic', f.base);
    await writeFile(join(f.cwd, 'collision.txt'), 'one\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Conflict A');
    await writeFile(join(f.cwd, 'collision.txt'), 'two\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Conflict B');
    const topicHead = await f.run('rev-parse', 'HEAD');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const newestFirst = [...plan.commits].reverse();
    const result = await terminal(
      f.service,
      f.service.startInteractiveRebase(
        1,
        requestFromPlan(
          plan,
          newestFirst.map(({ commitId, action, subject, body }) => ({ commitId, action, subject, body })),
        ),
      ),
    );
    expect(result).toMatchObject({ status: 'failed', failureReason: 'conflict' });
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe('rebase');
    expect(await abort(f.service, f.id)).toMatchObject({ status: 'succeeded' });
    expect(await f.run('branch', '--show-current')).toBe('topic');
    expect(await f.run('rev-parse', 'HEAD')).toBe(topicHead);
    expect(await f.run('show', 'HEAD:collision.txt')).toBe('two');
  });

  it('refuses a plan after the branch tip changes outside the reviewed snapshot', async () => {
    const f = await fixture();
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    await f.run('commit', '--quiet', '--allow-empty', '-m', 'Changed upstream');
    const result = await terminal(
      f.service,
      f.service.startInteractiveRebase(
        1,
        requestFromPlan(
          plan,
          plan.commits.map(({ commitId, action, subject, body }) => ({ commitId, action, subject, body })),
        ),
      ),
    );
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.message).toContain('repository changed');
    expect(await f.run('show', '-s', '--format=%s', 'HEAD')).toBe('Changed upstream');
  });
});
