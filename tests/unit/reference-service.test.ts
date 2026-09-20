import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import type { RepositoryHead, RepositoryReferenceAction } from '../../src/common/ipc/contracts';
import {
  applyReferenceAction,
  readReferenceContext,
  StaleReferenceSnapshotError,
} from '../../src/backend/repositories/reference-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'e'.repeat(64)}`;

interface Fixture {
  readonly root: string;
  readonly worktree: string;
  readonly gitDir: string;
  readonly git: GitRunner;
}

async function fixtureRepository(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-reference-'));
  temporaryDirectories.push(root);
  const worktree = join(root, 'repository');
  await mkdir(worktree);
  const git = new GitRunner();
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: worktree });
  await git.run(['config', 'user.name', 'Reference Author'], { cwd: worktree });
  await git.run(['config', 'user.email', 'reference@example.test'], { cwd: worktree });
  await writeFile(join(worktree, 'file.txt'), 'one\n', 'utf8');
  await git.run(['add', '--', 'file.txt'], { cwd: worktree });
  await git.run(['commit', '--quiet', '-m', 'first'], { cwd: worktree });
  return { root, worktree, gitDir: join(worktree, '.git'), git };
}

async function head(fixture: Fixture): Promise<RepositoryHead> {
  const branch = await output(fixture, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const commit = await output(fixture, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (branch && commit) return { state: 'branch', name: branch, commit };
  if (branch) return { state: 'unborn', name: branch, commit: null };
  if (commit) return { state: 'detached', name: null, commit };
  return { state: 'unknown', name: null, commit: null };
}

async function output(fixture: Fixture, args: readonly string[]): Promise<string | null> {
  try {
    const result = await fixture.git.run(args, { cwd: fixture.worktree });
    return result.stdout.replace(/\r?\n$/u, '') || null;
  } catch {
    return null;
  }
}

async function context(fixture: Fixture) {
  return readReferenceContext(fixture.git, {
    repositoryId,
    cwd: fixture.worktree,
    gitDir: fixture.gitDir,
    worktreePath: fixture.worktree,
    head: await head(fixture),
  });
}

async function apply(fixture: Fixture, action: RepositoryReferenceAction, snapshot?: string) {
  const current = await context(fixture);
  return applyReferenceAction(fixture.git, {
    repositoryId,
    cwd: fixture.worktree,
    gitDir: fixture.gitDir,
    worktreePath: fixture.worktree,
    head: await head(fixture),
    action,
    snapshot: snapshot ?? current.snapshot,
  });
}

/** A second commit on a second branch, so merged and unmerged deletions can be distinguished. */
async function addBranchCommit(fixture: Fixture, branch: string, content: string) {
  await fixture.git.run(['checkout', '--quiet', '-b', branch], { cwd: fixture.worktree });
  await writeFile(join(fixture.worktree, `${branch}.txt`), content, 'utf8');
  await fixture.git.run(['add', '--all'], { cwd: fixture.worktree });
  await fixture.git.run(['commit', '--quiet', '-m', `${branch} commit`], { cwd: fixture.worktree });
  await fixture.git.run(['checkout', '--quiet', 'main'], { cwd: fixture.worktree });
}

/** A local bare repository stands in for a remote, without any network access. */
async function addRemote(fixture: Fixture): Promise<string> {
  const remote = join(fixture.root, 'remote.git');
  await fixture.git.run(['init', '--quiet', '--bare', remote], { cwd: fixture.root });
  await fixture.git.run(['remote', 'add', 'origin', remote], { cwd: fixture.worktree });
  await fixture.git.run(['push', '--quiet', 'origin', 'main'], { cwd: fixture.worktree });
  await fixture.git.run(['fetch', '--quiet', 'origin'], { cwd: fixture.worktree });
  return remote;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('reference context', () => {
  it('lists branches, tags, remotes, and working-tree state', async () => {
    const fixture = await fixtureRepository();
    await addBranchCommit(fixture, 'feature', 'feature\n');
    await fixture.git.run(['tag', 'v1'], { cwd: fixture.worktree });
    await fixture.git.run(['tag', '--annotate', '-m', 'release', 'v2'], { cwd: fixture.worktree });
    await writeFile(join(fixture.worktree, 'untracked.txt'), 'new\n', 'utf8');

    const current = await context(fixture);
    expect(current.branches.map((branch) => branch.name).sort()).toEqual(['feature', 'main']);
    expect(current.branches.find((branch) => branch.name === 'main')?.isHead).toBe(true);
    expect(current.branches.find((branch) => branch.name === 'feature')?.merged).toBe(false);
    expect(current.tags.map((tag) => [tag.name, tag.annotated])).toEqual([
      ['v1', false],
      ['v2', true],
    ]);
    const annotated = current.tags.find((tag) => tag.name === 'v2');
    expect(annotated?.target).toBe(await output(fixture, ['rev-parse', 'HEAD']));
    expect(current.untrackedCount).toBe(1);
    expect(current.dirty).toBe(false);
    expect(current.pendingOperation).toBeNull();
  });

  it('marks a branch whose upstream was deleted as gone', async () => {
    const fixture = await fixtureRepository();
    await addRemote(fixture);
    await fixture.git.run(['branch', '--set-upstream-to=origin/main', 'main'], { cwd: fixture.worktree });
    expect((await context(fixture)).branches[0]?.upstreamGone).toBe(false);

    await fixture.git.run(['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: fixture.worktree });
    const stale = (await context(fixture)).branches.find((branch) => branch.name === 'main');
    expect(stale?.upstream).toBe('origin/main');
    expect(stale?.upstreamGone).toBe(true);
  });

  it('reports the linked worktree that has a branch checked out', async () => {
    const fixture = await fixtureRepository();
    await addBranchCommit(fixture, 'feature', 'feature\n');
    const linked = join(fixture.root, 'linked');
    await fixture.git.run(['worktree', 'add', '--quiet', linked, 'feature'], { cwd: fixture.worktree });

    const current = await context(fixture);
    expect(current.branches.find((branch) => branch.name === 'feature')?.worktreePath).toBe(linked);
    expect(current.branches.find((branch) => branch.name === 'main')?.worktreePath).toBeNull();
  });

  it('excludes the symbolic remote HEAD from the upstream choices', async () => {
    const fixture = await fixtureRepository();
    await addRemote(fixture);
    await fixture.git.run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], {
      cwd: fixture.worktree,
    });
    expect((await context(fixture)).remoteBranches).toEqual(['origin/main']);
    expect((await context(fixture)).remotes).toEqual(['origin']);
  });
});

describe('branch actions', () => {
  it('creates a branch at a commit without moving HEAD', async () => {
    const fixture = await fixtureRepository();
    const commit = await output(fixture, ['rev-parse', 'HEAD']);
    const result = await apply(fixture, {
      kind: 'create-branch',
      name: 'topic',
      startPoint: { kind: 'commit', commitId: commit! },
      checkout: false,
      tracking: 'auto',
    });

    expect(result.status).toBe('applied');
    expect(await output(fixture, ['rev-parse', 'refs/heads/topic'])).toBe(commit);
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
  });

  it('creates and checks out a branch that tracks a remote branch', async () => {
    const fixture = await fixtureRepository();
    await addRemote(fixture);
    const result = await apply(fixture, {
      kind: 'create-branch',
      name: 'from-remote',
      startPoint: { kind: 'reference', fullName: 'refs/remotes/origin/main' },
      checkout: true,
      tracking: 'track',
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.head).toMatchObject({ state: 'branch', name: 'from-remote' });
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('from-remote');
    expect(await output(fixture, ['rev-parse', '--abbrev-ref', 'from-remote@{upstream}'])).toBe(
      'origin/main',
    );
  });

  it('honors an explicit request not to track the starting branch', async () => {
    const fixture = await fixtureRepository();
    await addRemote(fixture);
    await apply(fixture, {
      kind: 'create-branch',
      name: 'untracked-branch',
      startPoint: { kind: 'reference', fullName: 'refs/remotes/origin/main' },
      checkout: false,
      tracking: 'no-track',
    });
    expect(await output(fixture, ['rev-parse', '--abbrev-ref', 'untracked-branch@{upstream}'])).toBeNull();
  });

  it('refuses a name that already exists and one Git does not accept', async () => {
    const fixture = await fixtureRepository();
    const commit = await output(fixture, ['rev-parse', 'HEAD']);
    const start = { kind: 'commit', commitId: commit! } as const;

    const duplicate = await apply(fixture, {
      kind: 'create-branch',
      name: 'main',
      startPoint: start,
      checkout: false,
      tracking: 'auto',
    });
    expect(duplicate).toMatchObject({ status: 'blocked', reason: 'exists', canForce: false });

    const invalid = await apply(fixture, {
      kind: 'create-branch',
      name: 'bad name',
      startPoint: start,
      checkout: false,
      tracking: 'auto',
    });
    expect(invalid).toMatchObject({ status: 'blocked', reason: 'invalid-name' });
    expect(await output(fixture, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe(
      'refs/heads/main',
    );
  });

  it('renames a branch and keeps its commit', async () => {
    const fixture = await fixtureRepository();
    await addBranchCommit(fixture, 'feature', 'feature\n');
    const target = await output(fixture, ['rev-parse', 'refs/heads/feature']);

    const result = await apply(fixture, {
      kind: 'rename-branch',
      fullName: 'refs/heads/feature',
      name: 'renamed',
    });
    expect(result.status).toBe('applied');
    expect(await output(fixture, ['rev-parse', 'refs/heads/renamed'])).toBe(target);
    expect(await output(fixture, ['rev-parse', '--verify', '--quiet', 'refs/heads/feature'])).toBeNull();
  });

  it('deletes a merged branch and only deletes an unmerged one when forced', async () => {
    const fixture = await fixtureRepository();
    const commit = await output(fixture, ['rev-parse', 'HEAD']);
    await fixture.git.run(['branch', 'merged', commit!], { cwd: fixture.worktree });
    await addBranchCommit(fixture, 'unmerged', 'work\n');

    expect(
      await apply(fixture, { kind: 'delete-branch', fullName: 'refs/heads/merged', force: false }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['rev-parse', '--verify', '--quiet', 'refs/heads/merged'])).toBeNull();

    const refused = await apply(fixture, {
      kind: 'delete-branch',
      fullName: 'refs/heads/unmerged',
      force: false,
    });
    expect(refused).toMatchObject({ status: 'blocked', reason: 'not-merged', canForce: true });
    expect(await output(fixture, ['rev-parse', '--verify', '--quiet', 'refs/heads/unmerged'])).not.toBeNull();

    expect(
      await apply(fixture, { kind: 'delete-branch', fullName: 'refs/heads/unmerged', force: true }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['rev-parse', '--verify', '--quiet', 'refs/heads/unmerged'])).toBeNull();
  });

  it('refuses to delete the current branch', async () => {
    const fixture = await fixtureRepository();
    const result = await apply(fixture, {
      kind: 'delete-branch',
      fullName: 'refs/heads/main',
      force: true,
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'current-branch' });
    expect(await output(fixture, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'])).not.toBeNull();
  });

  it('refuses to check out or delete a branch another worktree has checked out', async () => {
    const fixture = await fixtureRepository();
    await addBranchCommit(fixture, 'feature', 'feature\n');
    const linked = join(fixture.root, 'linked');
    await fixture.git.run(['worktree', 'add', '--quiet', linked, 'feature'], { cwd: fixture.worktree });

    const checkout = await apply(fixture, { kind: 'checkout-branch', fullName: 'refs/heads/feature' });
    expect(checkout).toMatchObject({ status: 'blocked', reason: 'checked-out' });
    if (checkout.status !== 'blocked') throw new Error('expected a blocked result');
    expect(checkout.message).toContain(linked);
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');

    expect(
      await apply(fixture, { kind: 'delete-branch', fullName: 'refs/heads/feature', force: true }),
    ).toMatchObject({ status: 'blocked', reason: 'checked-out' });
  });

  it('sets and unsets the upstream of a branch', async () => {
    const fixture = await fixtureRepository();
    await addRemote(fixture);

    expect(
      await apply(fixture, {
        kind: 'set-upstream',
        fullName: 'refs/heads/main',
        upstream: 'origin/main',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBe('origin/main');

    expect(
      await apply(fixture, { kind: 'set-upstream', fullName: 'refs/heads/main', upstream: null }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBeNull();
  });

  it('rejects an upstream that this read never reported', async () => {
    const fixture = await fixtureRepository();
    const result = await apply(fixture, {
      kind: 'set-upstream',
      fullName: 'refs/heads/main',
      upstream: 'origin/invented',
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'not-found' });
  });
});

describe('checkout actions', () => {
  it('checks out a branch and reports the new HEAD', async () => {
    const fixture = await fixtureRepository();
    await addBranchCommit(fixture, 'feature', 'feature\n');
    const result = await apply(fixture, { kind: 'checkout-branch', fullName: 'refs/heads/feature' });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.head).toMatchObject({ state: 'branch', name: 'feature' });
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('feature');
  });

  it('keeps local changes when Git refuses to overwrite them', async () => {
    const fixture = await fixtureRepository();
    await fixture.git.run(['checkout', '--quiet', '-b', 'other'], { cwd: fixture.worktree });
    await writeFile(join(fixture.worktree, 'file.txt'), 'branch content\n', 'utf8');
    await fixture.git.run(['commit', '--quiet', '--all', '-m', 'other'], { cwd: fixture.worktree });
    await fixture.git.run(['checkout', '--quiet', 'main'], { cwd: fixture.worktree });
    await writeFile(join(fixture.worktree, 'file.txt'), 'local edit\n', 'utf8');

    const result = await apply(fixture, { kind: 'checkout-branch', fullName: 'refs/heads/other' });
    expect(result).toMatchObject({ status: 'blocked', reason: 'local-changes' });
    if (result.status !== 'blocked') throw new Error('expected a blocked result');
    expect(result.paths).toEqual(['file.txt']);
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
  });

  it('checks out a commit with a detached HEAD', async () => {
    const fixture = await fixtureRepository();
    const first = await output(fixture, ['rev-parse', 'HEAD']);
    await writeFile(join(fixture.worktree, 'file.txt'), 'two\n', 'utf8');
    await fixture.git.run(['commit', '--quiet', '--all', '-m', 'second'], { cwd: fixture.worktree });

    const result = await apply(fixture, { kind: 'checkout-commit', commitId: first! });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.head).toMatchObject({ state: 'detached', commit: first });
    expect(await output(fixture, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).toBeNull();
  });

  it('checks out a remote branch as a new local tracking branch', async () => {
    const fixture = await fixtureRepository();
    await addRemote(fixture);
    await fixture.git.run(['push', '--quiet', 'origin', 'main:published'], { cwd: fixture.worktree });
    await fixture.git.run(['fetch', '--quiet', 'origin'], { cwd: fixture.worktree });

    const result = await apply(fixture, {
      kind: 'checkout-remote-branch',
      fullName: 'refs/remotes/origin/published',
      name: 'published',
    });
    expect(result.status).toBe('applied');
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('published');
    expect(await output(fixture, ['rev-parse', '--abbrev-ref', 'published@{upstream}'])).toBe(
      'origin/published',
    );
  });

  it('refuses a checkout while a merge is in progress', async () => {
    const fixture = await fixtureRepository();
    await fixture.git.run(['checkout', '--quiet', '-b', 'left'], { cwd: fixture.worktree });
    await writeFile(join(fixture.worktree, 'file.txt'), 'left\n', 'utf8');
    await fixture.git.run(['commit', '--quiet', '--all', '-m', 'left'], { cwd: fixture.worktree });
    await fixture.git.run(['checkout', '--quiet', '-b', 'right', 'main'], { cwd: fixture.worktree });
    await writeFile(join(fixture.worktree, 'file.txt'), 'right\n', 'utf8');
    await fixture.git.run(['commit', '--quiet', '--all', '-m', 'right'], { cwd: fixture.worktree });
    await fixture.git.run(['merge', 'left'], { cwd: fixture.worktree }).catch(() => undefined);

    const current = await context(fixture);
    expect(current.pendingOperation).toBe('merge');
    expect(current.conflictedCount).toBeGreaterThan(0);

    const result = await apply(fixture, { kind: 'checkout-branch', fullName: 'refs/heads/main' });
    expect(result).toMatchObject({ status: 'blocked', reason: 'pending-operation' });
    expect(await output(fixture, ['symbolic-ref', '--short', 'HEAD'])).toBe('right');
  });
});

describe('tag actions', () => {
  it('creates annotated tags with blank and multiline messages, and exposes tag details', async () => {
    const fixture = await fixtureRepository();
    const commit = await output(fixture, ['rev-parse', 'HEAD']);
    const start = { kind: 'commit', commitId: commit! } as const;

    expect(
      await apply(fixture, { kind: 'create-tag', name: 'light', startPoint: start, message: '' }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['cat-file', '-t', 'refs/tags/light'])).toBe('tag');
    expect(await output(fixture, ['rev-parse', 'refs/tags/light^{commit}'])).toBe(commit);
    expect(await output(fixture, ['for-each-ref', '--format=%(contents)', 'refs/tags/light'])).toBeNull();

    expect(
      await apply(fixture, {
        kind: 'create-tag',
        name: 'annotated',
        startPoint: start,
        message: 'release notes\n# keeps this line\n',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['cat-file', '-t', 'refs/tags/annotated'])).toBe('tag');
    // `--cleanup=whitespace` keeps the comment line the user typed; only trailing space is removed.
    expect(await output(fixture, ['tag', '--list', '--format=%(contents)', 'annotated'])).toBe(
      'release notes\n# keeps this line\n',
    );
    expect(await output(fixture, ['rev-list', '-1', 'refs/tags/annotated'])).toBe(commit);
    const details = (await context(fixture)).tags.find((tag) => tag.name === 'annotated');
    expect(details).toMatchObject({
      tagger: 'Reference Author <reference@example.test>',
      message: 'release notes\n# keeps this line\n',
    });
    expect(details?.taggedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('pushes a created or existing tag and deletes selected remote copies', async () => {
    const fixture = await fixtureRepository();
    const remote = await addRemote(fixture);
    const commit = (await output(fixture, ['rev-parse', 'HEAD']))!;
    expect(
      await apply(fixture, {
        kind: 'create-tag',
        name: 'published',
        startPoint: { kind: 'commit', commitId: commit },
        message: '',
        pushRemote: 'origin',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(
      (await fixture.git.run(['cat-file', '-t', 'refs/tags/published'], { cwd: remote })).stdout.trim(),
    ).toBe('tag');
    expect(
      await apply(fixture, { kind: 'push-tag', fullName: 'refs/tags/published', remote: 'origin' }),
    ).toMatchObject({ status: 'applied' });
    expect(
      await apply(fixture, { kind: 'delete-tag', fullName: 'refs/tags/published', remoteNames: ['origin'] }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['tag', '--list'])).toBeNull();
    expect((await fixture.git.run(['tag', '--list'], { cwd: remote })).stdout.trim()).toBe('');
  });

  it('reports a partial tag push failure and retains the created local annotated tag', async () => {
    const fixture = await fixtureRepository();
    await fixture.git.run(['remote', 'add', 'missing', join(fixture.root, 'missing.git')], {
      cwd: fixture.worktree,
    });
    const commit = (await output(fixture, ['rev-parse', 'HEAD']))!;
    const result = await apply(fixture, {
      kind: 'create-tag',
      name: 'retained',
      startPoint: { kind: 'commit', commitId: commit },
      message: '',
      pushRemote: 'missing',
    });
    expect(result).toMatchObject({
      status: 'blocked',
      message: expect.stringContaining("Created annotated tag 'retained'"),
    });
    expect(await output(fixture, ['cat-file', '-t', 'refs/tags/retained'])).toBe('tag');
  });

  it('refuses a duplicate tag name and deletes an existing tag', async () => {
    const fixture = await fixtureRepository();
    const commit = await output(fixture, ['rev-parse', 'HEAD']);
    await fixture.git.run(['tag', 'v1'], { cwd: fixture.worktree });

    expect(
      await apply(fixture, {
        kind: 'create-tag',
        name: 'v1',
        startPoint: { kind: 'commit', commitId: commit! },
        message: '',
      }),
    ).toMatchObject({ status: 'blocked', reason: 'exists' });

    expect(await apply(fixture, { kind: 'delete-tag', fullName: 'refs/tags/v1' })).toMatchObject({
      status: 'applied',
    });
    expect(await output(fixture, ['tag', '--list'])).toBeNull();
  });

  it('creates a tag on a name that begins with a dot-free path segment containing a dash', async () => {
    const fixture = await fixtureRepository();
    const commit = await output(fixture, ['rev-parse', 'HEAD']);
    expect(
      await apply(fixture, {
        kind: 'create-tag',
        name: 'release/v1.0-rc1',
        startPoint: { kind: 'commit', commitId: commit! },
        message: '',
      }),
    ).toMatchObject({ status: 'applied' });
    expect(await output(fixture, ['tag', '--list'])).toBe('release/v1.0-rc1');
  });
});

describe('reference action guards', () => {
  it('rejects a snapshot taken before the references changed', async () => {
    const fixture = await fixtureRepository();
    const stale = (await context(fixture)).snapshot;
    await fixture.git.run(['branch', 'created-elsewhere'], { cwd: fixture.worktree });

    await expect(
      apply(
        fixture,
        { kind: 'delete-branch', fullName: 'refs/heads/created-elsewhere', force: false },
        stale,
      ),
    ).rejects.toBeInstanceOf(StaleReferenceSnapshotError);
  });

  it('accepts only a reference the same read reported as a starting point', async () => {
    const fixture = await fixtureRepository();
    const result = await apply(fixture, {
      kind: 'create-branch',
      // Revision syntax never reaches Git: only a named reference from the context is resolved.
      name: 'from-syntax',
      startPoint: { kind: 'reference', fullName: 'HEAD@{1}' },
      checkout: false,
      tracking: 'auto',
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'not-found' });
    expect(await output(fixture, ['rev-parse', '--verify', '--quiet', 'refs/heads/from-syntax'])).toBeNull();
  });

  it('reports that a branch is already checked out instead of running Git', async () => {
    const fixture = await fixtureRepository();
    const result = await apply(fixture, { kind: 'checkout-branch', fullName: 'refs/heads/main' });
    expect(result).toMatchObject({ status: 'blocked', reason: 'other' });
  });
});
