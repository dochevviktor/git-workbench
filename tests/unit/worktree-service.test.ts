import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { applyWorktreeAction, readWorktreeContext } from '../../src/backend/repositories/worktree-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'a'.repeat(64)}`;

interface Fixture {
  readonly root: string;
  readonly worktree: string;
  readonly commonDir: string;
  readonly git: GitRunner;
}

async function fixtureRepository(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-worktree-'));
  temporaryDirectories.push(root);
  const worktree = join(root, 'repository');
  await mkdir(worktree);
  const git = new GitRunner();
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: worktree });
  await git.run(['config', 'user.name', 'Worktree Author'], { cwd: worktree });
  await git.run(['config', 'user.email', 'worktree@example.test'], { cwd: worktree });
  await writeFile(join(worktree, 'file.txt'), 'one\n', 'utf8');
  await git.run(['add', '--', 'file.txt'], { cwd: worktree });
  await git.run(['commit', '--quiet', '-m', 'first'], { cwd: worktree });
  await git.run(['branch', 'feature'], { cwd: worktree });
  return { root, worktree, commonDir: join(worktree, '.git'), git };
}

async function context(fixture: Fixture) {
  return readWorktreeContext(fixture.git, {
    repositoryId,
    cwd: fixture.worktree,
    commonDir: fixture.commonDir,
    currentWorktreePath: fixture.worktree,
  });
}

async function apply(
  fixture: Fixture,
  action: Parameters<typeof applyWorktreeAction>[1]['action'],
  snapshot?: string,
) {
  const current = await context(fixture);
  return applyWorktreeAction(fixture.git, {
    repositoryId,
    cwd: fixture.worktree,
    commonDir: fixture.commonDir,
    currentWorktreePath: fixture.worktree,
    action,
    snapshot: snapshot ?? current.snapshot,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('worktree service', () => {
  it('invalidates force-removal reviews when a dirty file changes without changing the path count', async () => {
    const f = await fixtureRepository();
    const path = join(f.root, 'reviewed');
    const created = await apply(f, { kind: 'create', path, sourceFullName: 'refs/heads/feature' });
    await writeFile(join(path, 'local.txt'), 'old\n');
    const before = await context(f);
    const worktreeId = before.worktrees.find((item) => item.path === path)!.id;
    expect(created.worktreeId).toBe(worktreeId);
    await writeFile(join(path, 'local.txt'), 'new\n');
    await expect(apply(f, { kind: 'remove', worktreeId, force: true }, before.snapshot)).rejects.toThrow(
      'changed after it was read',
    );
    expect(await readFile(join(path, 'local.txt'), 'utf8')).toBe('new\n');
  });
  it('creates detached worktrees, locks/unlocks them, and protects nested repositories on force removal', async () => {
    const f = await fixtureRepository();
    const head = (await f.git.run(['rev-parse', 'HEAD'], { cwd: f.worktree })).stdout.trim();
    const path = join(f.root, 'detached');
    expect(
      await apply(f, { kind: 'create-detached', path: join(f.worktree, 'nested'), commitId: head }),
    ).toMatchObject({ status: 'blocked', reason: 'invalid-path' });
    expect(await apply(f, { kind: 'create-detached', path, commitId: head })).toMatchObject({
      status: 'applied',
    });
    const tree = (await context(f)).worktrees.find((item) => item.path === path)!;
    expect(tree).toMatchObject({ branchName: null, head });
    expect(await apply(f, { kind: 'lock', worktreeId: tree.id, reason: 'Portable disk' })).toMatchObject({
      status: 'applied',
    });
    expect((await context(f)).worktrees.find((item) => item.id === tree.id)).toMatchObject({
      locked: true,
      lockReason: 'Portable disk',
    });
    expect(await apply(f, { kind: 'unlock', worktreeId: tree.id })).toMatchObject({ status: 'applied' });
    const nested = join(path, 'unrelated');
    await mkdir(nested);
    await f.git.run(['init', '--quiet'], { cwd: nested });
    await writeFile(join(nested, 'precious.txt'), 'preserve');
    expect(await apply(f, { kind: 'remove', worktreeId: tree.id, force: true })).toMatchObject({
      status: 'blocked',
      reason: 'invalid-path',
    });
    expect(await readFile(join(nested, 'precious.txt'), 'utf8')).toBe('preserve');
    expect((await f.git.run(['rev-parse', 'main'], { cwd: f.worktree })).stdout.trim()).toBe(head);
  });

  it('retains locked missing registrations when pruning other stale worktrees', async () => {
    const f = await fixtureRepository();
    const path = join(f.root, 'portable');
    await apply(f, { kind: 'create', path, sourceFullName: 'refs/heads/feature' });
    const tree = (await context(f)).worktrees.find((item) => item.path === path)!;
    await apply(f, { kind: 'lock', worktreeId: tree.id, reason: 'Offline' });
    await rm(path, { recursive: true, force: true });
    await apply(f, { kind: 'prune' });
    expect((await context(f)).worktrees).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tree.id, exists: false, locked: true })]),
    );
  });
  it('creates and removes a linked worktree without changing the parent branch', async () => {
    const fixture = await fixtureRepository();
    const linked = join(fixture.root, 'linked');

    const created = await apply(fixture, {
      kind: 'create',
      path: linked,
      sourceFullName: 'refs/heads/feature',
    });
    expect(created).toMatchObject({ status: 'applied', path: linked });
    expect((await context(fixture)).worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: linked, branchName: 'feature', isCurrent: false, isMain: false }),
      ]),
    );
    expect(
      (await fixture.git.run(['branch', '--show-current'], { cwd: fixture.worktree })).stdout.trim(),
    ).toBe('main');

    const parent = (await context(fixture)).worktrees.find((worktree) => worktree.isCurrent);
    expect(parent).toBeDefined();
    expect(
      await apply(fixture, {
        kind: 'remove',
        worktreeId: parent!.id,
        force: true,
      }),
    ).toMatchObject({ status: 'blocked', reason: 'current' });

    const removed = await apply(fixture, {
      kind: 'remove',
      worktreeId: created.status === 'applied' ? created.worktreeId! : 'worktree-unknown',
      force: false,
    });
    expect(removed).toMatchObject({ status: 'applied', path: linked });
    expect((await context(fixture)).worktrees).toHaveLength(1);
  });

  it('reports an occupied branch before Git is asked to create a duplicate worktree', async () => {
    const fixture = await fixtureRepository();
    const linked = join(fixture.root, 'linked');
    await fixture.git.run(['worktree', 'add', '--quiet', linked, 'feature'], { cwd: fixture.worktree });

    const result = await apply(fixture, {
      kind: 'create',
      path: join(fixture.root, 'second'),
      sourceFullName: 'refs/heads/feature',
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'checked-out' });
    expect(
      (await fixture.git.run(['worktree', 'list', '--porcelain'], { cwd: fixture.worktree })).stdout,
    ).not.toContain('second');
  });

  it('creates a local branch worktree from a remote-tracking branch', async () => {
    const fixture = await fixtureRepository();
    const remote = join(fixture.root, 'origin.git');
    await fixture.git.run(['init', '--quiet', '--bare', remote], { cwd: fixture.root });
    await fixture.git.run(['remote', 'add', 'origin', remote], { cwd: fixture.worktree });
    await fixture.git.run(['push', '--quiet', 'origin', 'main:remote-feature'], { cwd: fixture.worktree });
    await fixture.git.run(['fetch', '--quiet', 'origin'], { cwd: fixture.worktree });

    const linked = await apply(fixture, {
      kind: 'create',
      path: join(fixture.root, 'remote-linked'),
      sourceFullName: 'refs/remotes/origin/remote-feature',
      branchName: 'from-remote',
    });
    expect(linked).toMatchObject({ status: 'applied' });
    expect(
      (
        await fixture.git.run(['rev-parse', '--abbrev-ref', 'from-remote@{upstream}'], {
          cwd: fixture.worktree,
        })
      ).stdout.trim(),
    ).toBe('origin/remote-feature');
  });

  it('requires explicit force for dirty and locked removals', async () => {
    const fixture = await fixtureRepository();
    const dirtyPath = join(fixture.root, 'dirty');
    const dirty = await apply(fixture, {
      kind: 'create',
      path: dirtyPath,
      sourceFullName: 'refs/heads/feature',
    });
    await writeFile(join(dirtyPath, 'local.txt'), 'uncommitted\n', 'utf8');
    const dirtyContext = await context(fixture);
    expect(dirtyContext.worktrees.find((worktree) => worktree.path === dirtyPath)?.workingTree.state).toBe(
      'dirty',
    );
    expect(
      await apply(fixture, {
        kind: 'remove',
        worktreeId: dirty.status === 'applied' ? dirty.worktreeId! : 'worktree-unknown',
        force: false,
      }),
    ).toMatchObject({ status: 'blocked', reason: 'dirty' });
    expect(
      await apply(fixture, {
        kind: 'remove',
        worktreeId: dirty.status === 'applied' ? dirty.worktreeId! : 'worktree-unknown',
        force: true,
      }),
    ).toMatchObject({ status: 'applied' });

    const lockedPath = join(fixture.root, 'locked');
    const locked = await apply(fixture, {
      kind: 'create',
      path: lockedPath,
      sourceFullName: 'refs/heads/feature',
    });
    await fixture.git.run(['worktree', 'lock', '--reason', 'keep for review', lockedPath], {
      cwd: fixture.worktree,
    });
    expect(
      await apply(fixture, {
        kind: 'remove',
        worktreeId: locked.status === 'applied' ? locked.worktreeId! : 'worktree-unknown',
        force: false,
      }),
    ).toMatchObject({ status: 'blocked', reason: 'locked' });
    expect(
      await apply(fixture, {
        kind: 'remove',
        worktreeId: locked.status === 'applied' ? locked.worktreeId! : 'worktree-unknown',
        force: true,
      }),
    ).toMatchObject({ status: 'applied' });
  });

  it('prunes a missing linked registration without touching the parent worktree', async () => {
    const fixture = await fixtureRepository();
    const linked = join(fixture.root, 'missing');
    await fixture.git.run(['worktree', 'add', '--quiet', linked, 'feature'], { cwd: fixture.worktree });
    await rm(linked, { recursive: true, force: true });
    const before = await context(fixture);
    expect(before.worktrees.find((worktree) => worktree.path === linked)?.prunable).toBe(true);
    expect((await apply(fixture, { kind: 'prune' })).status).toBe('applied');
    expect((await context(fixture)).worktrees).toHaveLength(1);
  });
});
