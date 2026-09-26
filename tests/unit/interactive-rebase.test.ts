import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
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
  await service.setTrust(1, id, true);
  return { root, cwd, git, run, service, id, base };
}

function requestFromPlan(
  plan: Awaited<ReturnType<RepositoryService['getInteractiveRebasePlan']>>,
  actions: RepositoryInteractiveRebaseRequest['actions'],
  overrides: Partial<RepositoryInteractiveRebaseRequest> = {},
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
  it.each(['moved', 'checked-out'] as const)(
    'protects a dependent branch that is %s while the rebase is paused',
    async (change) => {
      const f = await fixture();
      await f.run('branch', 'dependent', 'HEAD~3');
      const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
      const actions = plan.commits.map((row) =>
        row.subject === 'Add Gamma' ? { ...row, action: 'edit' as const } : row,
      );
      await terminal(
        f.service,
        f.service.startInteractiveRebase(1, requestFromPlan(plan, actions, { updateRefs: true })),
      );
      const context = await f.service.getCommitContext(1, f.id);
      await terminal(
        f.service,
        f.service.startCommit(1, {
          id: f.id,
          snapshot: context.snapshot,
          amend: true,
          skipHooks: false,
          subject: 'Gamma changed',
          body: '',
        }),
      );
      if (change === 'moved') await f.run('update-ref', 'refs/heads/dependent', f.base);
      else await f.run('worktree', 'add', '--quiet', join(f.root, 'dependent'), 'dependent');
      const dependent = await f.run('rev-parse', 'dependent');
      const state = await f.service.getRecovery(1, f.id);
      const result = await terminal(
        f.service,
        f.service.startRecovery(1, { id: f.id, action: 'continue', snapshot: state.snapshot }),
      );
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Dependent branch');
      expect(await f.run('rev-parse', 'dependent')).toBe(dependent);
      expect(await abort(f.service, f.id)).toMatchObject({ status: 'succeeded' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(plan.headCommit);
    },
  );
  it('rewrites a root and an empty commit without changing their trees or author metadata', async () => {
    const f = await fixture();
    await f.git.run(['commit', '--quiet', '--allow-empty', '-m', 'Empty marker'], {
      cwd: f.cwd,
      env: { GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z' },
    });
    await f.run('config', 'sequence.editor', 'false');
    await f.run('config', 'core.editor', 'false');
    const tree = await f.run('rev-parse', 'HEAD^{tree}');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: null });
    const actions = plan.commits.map((row) =>
      row.subject === 'Empty marker' || row.subject === 'Base'
        ? { ...row, action: 'reword' as const, subject: `${row.subject} rewritten` }
        : row,
    );
    expect(
      await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(plan, actions))),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-list', '--count', 'HEAD')).toBe('8');
    expect(await f.run('show', '-s', '--format=%P', 'HEAD~7')).toBe('');
    expect(await f.run('show', '-s', '--format=%s', 'HEAD~7')).toBe('Base rewritten');
    expect(await f.run('rev-parse', 'HEAD^{tree}')).toBe(tree);
    expect(await f.run('diff', 'HEAD^', 'HEAD')).toBe('');
    expect(await f.run('show', '-s', '--format=%at', 'HEAD')).toBe('978307200');
    expect(await f.run('show', '-s', '--format=%ct', 'HEAD')).not.toBe('978307200');
  });

  it('keeps the amended message when an Edit target is subsequently squashed', async () => {
    const f = await fixture();
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const actions = plan.commits.map((row) => ({
      ...row,
      action:
        row.subject === 'Add Alpha'
          ? ('edit' as const)
          : row.subject === 'Add Beta'
            ? ('fixup' as const)
            : row.subject === 'Add Gamma'
              ? ('squash' as const)
              : row.action,
    }));
    await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(plan, actions)));
    const context = await f.service.getCommitContext(1, f.id);
    expect(
      await terminal(
        f.service,
        f.service.startCommit(1, {
          id: f.id,
          snapshot: context.snapshot,
          amend: true,
          skipHooks: false,
          subject: 'User amendment',
          body: 'Preserved at Edit',
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    const state = await f.service.getRecovery(1, f.id);
    expect(
      await terminal(
        f.service,
        f.service.startRecovery(1, { id: f.id, action: 'continue', snapshot: state.snapshot }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', '-s', '--format=%B', 'HEAD~3')).toBe(
      'User amendment\n\nPreserved at Edit\n\nAdd Gamma',
    );
    expect(await f.run('rev-parse', 'HEAD^{tree}')).toBe(
      await f.run('rev-parse', `${plan.headCommit}^{tree}`),
    );
  });

  it('preserves external todo edits, rejects stale Continue, and accepts a message-identical amendment', async () => {
    const f = await fixture();
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const actions = plan.commits.map((row) =>
      row.subject === 'Add Alpha' ? { ...row, action: 'edit' as const } : row,
    );
    await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(plan, actions)));
    const context = await f.service.getCommitContext(1, f.id);
    expect(
      await terminal(
        f.service,
        f.service.startCommit(1, {
          id: f.id,
          snapshot: context.snapshot,
          amend: true,
          skipHooks: false,
          subject: 'Add Alpha',
          body: '',
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    const state = await f.service.getRecovery(1, f.id);
    expect(state.rebaseEdit).toBe('ready-to-continue');
    const todoPath = join(f.cwd, '.git/rebase-merge/git-rebase-todo');
    const beta = plan.commits.find((row) => row.subject === 'Add Beta')!;
    await writeFile(
      todoPath,
      (await readFile(todoPath, 'utf8')).replace(`pick ${beta.commitId}`, `drop ${beta.commitId}`),
    );
    expect(
      (
        await terminal(
          f.service,
          f.service.startRecovery(1, { id: f.id, action: 'continue', snapshot: state.snapshot }),
        )
      ).message,
    ).toContain('recovery state changed');
    expect(
      await terminal(
        f.service,
        f.service.startRecovery(1, {
          id: f.id,
          action: 'continue',
          snapshot: (await f.service.getRecovery(1, f.id)).snapshot,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('beta.txt');
  });

  it('reconstructs an interactive conflict after restart and continues the staged resolution', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'topic', f.base);
    await writeFile(join(f.cwd, 'collision.txt'), 'one\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'A');
    await writeFile(join(f.cwd, 'collision.txt'), 'two\n');
    await f.run('commit', '--quiet', '-am', 'B');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const actions = plan.commits.map((row) =>
      row.subject === 'A' ? { ...row, action: 'drop' as const } : row,
    );
    expect(
      await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(plan, actions))),
    ).toMatchObject({ failureReason: 'conflict' });
    f.service.dispose();
    const reopened = new RepositoryService({ storagePath: join(f.root, 'recent.json'), runner: f.git });
    services.push(reopened);
    await reopened.open(1, f.cwd);
    expect((await reopened.getRecovery(1, f.id)).conflictedCount).toBe(1);
    await writeFile(join(f.cwd, 'collision.txt'), 'resolved\n');
    await f.run('add', 'collision.txt');
    expect(
      await terminal(
        reopened,
        reopened.startRecovery(1, {
          id: f.id,
          action: 'continue',
          snapshot: (await reopened.getRecovery(1, f.id)).snapshot,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', 'HEAD:collision.txt')).toBe('resolved');
    expect(await f.run('rev-list', '--count', `${f.base}..HEAD`)).toBe('1');
    expect(await f.run('status', '--porcelain')).toBe('');
  });
  it('matches independently prepared trees, parents, authors and edited combined messages; updates only reviewed eligible branches', async () => {
    const f = await fixture();
    const originalHead = await f.run('rev-parse', 'HEAD');
    await f.run('branch', 'beta-tip', 'HEAD~4');
    await f.run('branch', 'gamma-tip', 'HEAD~3');
    await f.run('branch', 'held', 'HEAD~2');
    const held = await f.run('rev-parse', 'held');
    await f.run('worktree', 'add', '--quiet', join(f.root, 'held'), 'held');
    // Construct the expected result independently with ordinary index/commit operations in another repo.
    const expected = join(f.root, 'expected');
    await f.git.run(['clone', '--quiet', f.cwd, expected], { cwd: f.root });
    const expectedRun = async (...args: string[]) => (await f.git.run(args, { cwd: expected })).stdout.trim();
    await expectedRun('config', 'user.name', 'Interactive Fixture');
    await expectedRun('config', 'user.email', 'interactive@example.test');
    await expectedRun('config', 'commit.gpgsign', 'false');
    await expectedRun('checkout', '--quiet', '--detach', f.base);
    for (const name of ['Alpha', 'Beta', 'Gamma'])
      await writeFile(join(expected, `${name.toLowerCase()}.txt`), `${name}\n`);
    await expectedRun('add', '--all');
    await expectedRun('commit', '--quiet', '-m', 'Reviewed Alpha\n\nOnly the reviewed combined body');
    for (const name of ['Zeta', 'Delta']) {
      await writeFile(join(expected, `${name.toLowerCase()}.txt`), `${name}\n`);
      await expectedRun('add', '--all');
      await expectedRun('commit', '--quiet', '-m', `Add ${name}`);
    }
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    expect(plan.dependentBranches.find((branch) => branch.name === 'held')?.checkedOut).toBe(true);
    const row = (name: string) => plan.commits.find((item) => item.subject === `Add ${name}`)!;
    const actions = [
      row('Delta'),
      { ...row('Epsilon'), action: 'drop' as const },
      row('Zeta'),
      { ...row('Gamma'), action: 'squash' as const },
      { ...row('Beta'), action: 'fixup' as const },
      {
        ...row('Alpha'),
        action: 'reword' as const,
        combinedMessage: 'Reviewed Alpha\n\nOnly the reviewed combined body',
      },
    ];
    const result = await terminal(
      f.service,
      f.service.startInteractiveRebase(
        1,
        requestFromPlan(plan, actions, { updateRefs: true, backupBranch: true }),
      ),
    );
    expect(result).toMatchObject({ status: 'succeeded' });
    const signature = ['log', '--reverse', '--format=%T%n%s%n%b%n%an%n%ae', `${f.base}..HEAD`];
    expect(await f.run(...signature)).toBe(await expectedRun(...signature));
    expect(await f.run('rev-parse', 'HEAD~3')).toBe(f.base);
    expect(await f.run('rev-list', '--min-parents=2', `${f.base}..HEAD`)).toBe('');
    expect(await f.run('rev-parse', 'beta-tip')).toBe(await f.run('rev-parse', 'HEAD~2'));
    expect(await f.run('rev-parse', 'gamma-tip')).toBe(await f.run('rev-parse', 'HEAD~2'));
    expect(await f.run('rev-parse', 'held')).toBe(held);
    const recovery = await f.service.getRecovery(1, f.id);
    const backup = recovery.rebaseBackups![0]!;
    expect(await f.run('rev-parse', `refs/git-workbench/rebase-backup/${backup.id}`)).toBe(originalHead);
    expect(await f.run('rev-parse', backup.backupBranch!)).toBe(originalHead);
    expect(
      await terminal(
        f.service,
        f.service.startRecovery(1, {
          id: f.id,
          snapshot: recovery.snapshot,
          action: 'dismiss-rebase-backup',
          copyId: backup.id,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect((await f.service.getRecovery(1, f.id)).rebaseBackups).toEqual([]);
    expect(await f.run('rev-parse', backup.backupBranch!)).toBe(originalHead);
  });

  it('preserves merge topology and merge/ordinary messages with native Git rebase-merges', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'side', 'HEAD~3');
    await writeFile(join(f.cwd, 'side.txt'), 'side\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Side change');
    await f.run('checkout', '--quiet', 'main');
    await f.run('merge', '--no-ff', '--quiet', '-m', 'Merge side', 'side');
    const tree = await f.run('rev-parse', 'HEAD^{tree}');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    expect(plan.mergeCommitCount).toBe(1);
    const actions = plan.commits.map((row) => ({
      ...row,
      action: 'reword' as const,
      subject: `Reviewed ${row.subject}`,
    }));
    expect(
      await terminal(
        f.service,
        f.service.startInteractiveRebase(
          1,
          requestFromPlan(plan, actions, { updateRefs: true, backupBranch: true }),
        ),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD^{tree}')).toBe(tree);
    expect(await f.run('show', '-s', '--format=%s', 'HEAD')).toBe('Reviewed Merge side');
    expect((await f.run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toHaveLength(2);
    expect(await f.run('show', '-s', '--format=%s', 'HEAD^2')).toBe('Reviewed Side change');
    expect(await f.run('rev-parse', 'side')).toBe(await f.run('rev-parse', 'HEAD^2'));
    expect(await f.run('rev-parse', 'HEAD^1~3')).toBe(await f.run('rev-parse', 'HEAD^2~1'));
    const backup = (await f.service.getRecovery(1, f.id)).rebaseBackups![0]!;
    expect(await f.run('rev-parse', backup.backupBranch!)).toBe(plan.headCommit);
  });

  it('requires published-history acknowledgement and rejects moving upstreams or dependent references', async () => {
    const f = await fixture();
    await f.run('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await f.run('branch', 'dependent', 'HEAD~2');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    expect(plan.publishedCommitCount).toBe(6);
    expect(
      (await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(plan, plan.commits))))
        .message,
    ).toContain('published commits');
    await f.run('update-ref', 'refs/remotes/origin/main', f.base);
    expect(
      (
        await terminal(
          f.service,
          f.service.startInteractiveRebase(
            1,
            requestFromPlan(plan, plan.commits, { acknowledgePublished: true }),
          ),
        )
      ).message,
    ).toContain('repository changed');
    const reread = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    await f.run('branch', '--force', 'dependent', 'HEAD~1');
    expect(
      (
        await terminal(
          f.service,
          f.service.startInteractiveRebase(1, requestFromPlan(reread, reread.commits, { updateRefs: true })),
        )
      ).message,
    ).toContain('repository changed');
    expect(await f.run('rev-parse', 'HEAD')).toBe(plan.headCommit);
    expect((await f.service.getRecovery(1, f.id)).rebaseBackups).toEqual([]);
  });

  it('previews autosquash by subject/hash without losing edited messages and ignores repository rebase defaults', async () => {
    const f = await fixture();
    const alpha = await f.run('rev-parse', 'HEAD~5');
    await f.run('commit', '--quiet', '--allow-empty', '-m', `fixup! ${alpha.slice(0, 10)}`);
    await f.run('commit', '--quiet', '--allow-empty', '-m', 'squash! Add Alpha');
    await f.run('branch', 'untouched', 'HEAD~4');
    const untouched = await f.run('rev-parse', 'untouched');
    await f.run('config', 'rebase.updateRefs', 'true');
    await f.run('config', 'rebase.autoSquash', 'true');
    await f.run('config', 'rebase.rebaseMerges', 'true');
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const actions = plan.commits.map((row) =>
      row.subject === 'Add Zeta' ? { ...row, action: 'reword' as const, subject: 'Manual Zeta' } : row,
    );
    const preview = await f.service.getInteractiveRebasePlan(1, {
      id: f.id,
      ontoCommitId: f.base,
      autosquash: true,
      snapshot: plan.snapshot,
      actions: actions.map(({ commitId, action, subject, body }) => ({ commitId, action, subject, body })),
    });
    expect(preview.commits.filter((row) => ['squash', 'fixup'].includes(row.action))).toHaveLength(2);
    expect(preview.commits.some((row) => row.subject === 'Manual Zeta')).toBe(true);
    expect(
      await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(plan, preview.commits))),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-list', '--count', `${f.base}..HEAD`)).toBe('6');
    expect(await f.run('show', '-s', '--format=%B', 'HEAD~5')).toBe('Add Alpha\n\nsquash! Add Alpha');
    expect(await f.run('rev-parse', 'untouched')).toBe(untouched);
  });

  it('restarts through Edit, a content amendment and Continue, preserving author dates and staged/untracked local work', async () => {
    const f = await fixture();
    const gamma = await f.run('rev-parse', 'HEAD~3');
    const author = await f.run('show', '-s', '--format=%an%n%ae%n%aI', gamma);
    await f.run('config', 'user.name', 'New Committer');
    await writeFile(join(f.cwd, 'base.txt'), 'staged local work\n');
    await f.run('add', 'base.txt');
    await writeFile(join(f.cwd, 'base.txt'), 'unstaged local work\n');
    await writeFile(join(f.cwd, 'local.txt'), 'untracked local work\n');
    const plan = await f.service.getInteractiveRebasePlan(1, {
      id: f.id,
      ontoCommitId: gamma,
      quickAction: { commitId: gamma, action: 'edit' },
    });
    expect(plan.commits.at(-1)?.action).toBe('edit');
    await terminal(
      f.service,
      f.service.startInteractiveRebase(
        1,
        requestFromPlan(plan, plan.commits, {
          autostash: true,
          changesSnapshot: plan.workingChanges.snapshot,
        }),
      ),
    );
    f.service.dispose();
    const restart = async () => {
      const service = new RepositoryService({ storagePath: join(f.root, 'recent.json'), runner: f.git });
      services.push(service);
      await service.open(1, f.cwd);
      return service;
    };
    let reopened = await restart();
    const paused = await reopened.getRecovery(1, f.id);
    expect(paused.rebaseEdit).toBe('needs-amend');
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(
      (
        await terminal(
          reopened,
          reopened.startRecovery(1, { id: f.id, action: 'continue', snapshot: paused.snapshot }),
        )
      ).status,
    ).toBe('failed');
    await writeFile(join(f.cwd, 'gamma.txt'), 'Gamma amended content\n');
    await f.run('add', 'gamma.txt');
    const context = await reopened.getCommitContext(1, f.id);
    expect(
      await terminal(
        reopened,
        reopened.startCommit(1, {
          id: f.id,
          snapshot: context.snapshot,
          amend: true,
          skipHooks: false,
          subject: 'Gamma amended',
          body: '',
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    reopened.dispose();
    reopened = await restart();
    expect((await reopened.getRecovery(1, f.id)).rebaseEdit).toBe('ready-to-continue');
    expect(
      await terminal(
        reopened,
        reopened.startRecovery(1, {
          id: f.id,
          action: 'continue',
          snapshot: (await reopened.getRecovery(1, f.id)).snapshot,
        }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', '-s', '--format=%an%n%ae%n%aI', 'HEAD~3')).toBe(author);
    expect(await f.run('show', '-s', '--format=%cn', 'HEAD~3')).toBe('New Committer');
    expect(await f.run('show', 'HEAD:gamma.txt')).toBe('Gamma amended content');
    expect(await f.run('show', ':base.txt')).toBe('staged local work');
    expect(await readFile(join(f.cwd, 'base.txt'), 'utf8')).toBe('unstaged local work\n');
    expect(await readFile(join(f.cwd, 'local.txt'), 'utf8')).toBe('untracked local work\n');
    expect((await reopened.getRecovery(1, f.id)).rebaseBackups).toHaveLength(1);
  });

  it('cancels a running rebase, reconstructs Recovery, and retains the original backup after Abort', async () => {
    const f = await fixture();
    const marker = join(f.root, 'entered');
    const hook = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'entered'); setInterval(() => {}, 1000);`;
    await writeFile(
      join(f.cwd, '.git/hooks/pre-rebase'),
      `#!/usr/bin/env node\n${stripTypeScriptTypes(hook)}\n`,
      { mode: 0o700 },
    );
    const plan = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const op = f.service.startInteractiveRebase(1, requestFromPlan(plan, plan.commits));
    await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).toBe('entered');
    f.service.cancelOperation(1, op.id);
    expect(await terminal(f.service, op)).toMatchObject({ failureReason: 'cancelled' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(plan.headCommit);
    expect((await f.service.getRecovery(1, f.id)).rebaseBackups).toHaveLength(1);
    await rm(join(f.cwd, '.git/hooks/pre-rebase'));
    const edit = await f.service.getInteractiveRebasePlan(1, { id: f.id, ontoCommitId: f.base });
    const actions = edit.commits.map((row) =>
      row.subject === 'Add Alpha' ? { ...row, action: 'edit' as const } : row,
    );
    await terminal(f.service, f.service.startInteractiveRebase(1, requestFromPlan(edit, actions)));
    expect(await abort(f.service, f.id)).toMatchObject({ status: 'succeeded' });
    expect((await f.service.getRecovery(1, f.id)).rebaseBackups).toHaveLength(2);
    expect(await f.run('rev-parse', 'HEAD')).toBe(plan.headCommit);
  });
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
