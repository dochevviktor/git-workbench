import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import type { RepositoryHead } from '../../src/common/ipc/contracts';
import {
  AmendUnavailableError,
  buildCommitMessage,
  commitChanges,
  readAmendChanges,
  readCommitContext,
  StaleCommitSnapshotError,
} from '../../src/backend/repositories/commit-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'d'.repeat(64)}`;
const identity = [
  '-c',
  'user.name=Commit Author',
  '-c',
  'user.email=commit@example.test',
  '-c',
  'commit.gpgsign=false',
];

interface Fixture {
  readonly root: string;
  readonly gitDir: string;
  readonly git: GitRunner;
}

async function fixtureRepository(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-commit-'));
  temporaryDirectories.push(root);
  const repository = join(root, 'repository');
  await mkdir(repository);
  const git = new GitRunner();
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: repository });
  await git.run(['config', 'user.name', 'Commit Author'], { cwd: repository });
  await git.run(['config', 'user.email', 'commit@example.test'], { cwd: repository });
  return { root: repository, gitDir: join(repository, '.git'), git };
}

async function head(fixture: Fixture): Promise<RepositoryHead> {
  const branch = await run(fixture, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const commit = await run(fixture, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (branch && commit) return { state: 'branch', name: branch, commit };
  if (branch) return { state: 'unborn', name: branch, commit: null };
  if (commit) return { state: 'detached', name: null, commit };
  return { state: 'unknown', name: null, commit: null };
}

async function run(fixture: Fixture, args: readonly string[]): Promise<string | null> {
  try {
    const result = await fixture.git.run(args, { cwd: fixture.root });
    return result.stdout.replace(/\r?\n$/u, '') || null;
  } catch {
    return null;
  }
}

async function context(fixture: Fixture) {
  return readCommitContext(fixture.git, {
    repositoryId,
    cwd: fixture.root,
    gitDir: fixture.gitDir,
    head: await head(fixture),
  });
}

async function commit(
  fixture: Fixture,
  options: {
    readonly subject: string;
    readonly body?: string;
    readonly amend?: boolean;
    readonly snapshot?: string;
    readonly skipHooks?: boolean;
  },
) {
  const current = await context(fixture);
  return commitChanges(fixture.git, {
    repositoryId,
    cwd: fixture.root,
    gitDir: fixture.gitDir,
    head: await head(fixture),
    subject: options.subject,
    body: options.body ?? '',
    amend: options.amend ?? false,
    snapshot: options.snapshot ?? current.snapshot,
    skipHooks: options.skipHooks ?? false,
  });
}

async function stage(fixture: Fixture, path: string, content: string): Promise<void> {
  await writeFile(join(fixture.root, path), content, 'utf8');
  await fixture.git.run(['add', '--', path], { cwd: fixture.root });
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function writeHook(fixture: Fixture, name: string, body: string): Promise<void> {
  const path = join(fixture.gitDir, 'hooks', name);
  await writeFile(path, body, 'utf8');
  await chmod(path, 0o755);
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('commit message assembly', () => {
  it('separates the subject and body with one blank line', () => {
    expect(buildCommitMessage('Subject', 'Body line')).toBe('Subject\n\nBody line\n');
  });

  it('keeps a subject on one line and drops surrounding blank lines', () => {
    expect(buildCommitMessage('  Multi\nline  ', '\n\nBody\n\n')).toBe('Multi line\n\nBody\n');
  });

  it('normalizes CRLF input from the composer', () => {
    expect(buildCommitMessage('Subject\r\n', 'First\r\nSecond')).toBe('Subject\n\nFirst\nSecond\n');
  });

  it('returns an empty message for blank fields', () => {
    expect(buildCommitMessage('   ', '  \n ')).toBe('');
  });
});

describe('commit service', () => {
  it('creates the first commit of an unborn repository and records the staged tree', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');

    const before = await context(fixture);
    expect(before.head.state).toBe('unborn');
    expect(before.amend).toBeNull();
    expect(before.stagedCount).toBe(1);

    const result = await commit(fixture, { subject: 'Add file', body: 'Details here' });
    expect(result.status).toBe('committed');

    const message = await run(fixture, ['log', '-1', '--format=%B']);
    expect(message).toBe('Add file\n\nDetails here\n');
    const tree = await run(fixture, ['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(tree).toBe('file.txt');
    const status = await run(fixture, ['status', '--porcelain']);
    expect(status).toBeNull();
  });

  it('commits only the staged part of a partially staged file', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'first\n');
    await commit(fixture, { subject: 'base' });

    await stage(fixture, 'file.txt', 'first\nsecond\n');
    await writeFile(join(fixture.root, 'file.txt'), 'first\nsecond\nthird\n', 'utf8');

    const result = await commit(fixture, { subject: 'Add second line' });
    expect(result.status).toBe('committed');
    expect(await run(fixture, ['show', 'HEAD:file.txt'])).toBe('first\nsecond');
    expect(await run(fixture, ['status', '--porcelain'])).toBe(' M file.txt');
  });

  it('amends the previous commit without changing its author', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');
    await commit(fixture, { subject: 'Original subject', body: 'Original body' });
    const original = await run(fixture, ['rev-parse', 'HEAD']);
    const originalAuthorDate = await run(fixture, ['log', '-1', '--format=%aI']);

    const current = await context(fixture);
    expect(current.amend?.subject).toBe('Original subject');
    expect(current.amend?.body).toBe('Original body');
    expect(current.amend?.published).toBe(false);

    const result = await commit(fixture, { subject: 'Corrected subject', amend: true });
    expect(result.status).toBe('committed');
    expect(await run(fixture, ['rev-parse', 'HEAD'])).not.toBe(original);
    expect(await run(fixture, ['log', '-1', '--format=%s'])).toBe('Corrected subject');
    expect(await run(fixture, ['log', '-1', '--format=%aI'])).toBe(originalAuthorDate);
    expect(await run(fixture, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });

  it('refuses a commit when nothing is staged', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');
    await commit(fixture, { subject: 'base' });
    await writeFile(join(fixture.root, 'file.txt'), 'changed\n', 'utf8');

    const result = await commit(fixture, { subject: 'Nothing staged' });
    expect(result).toMatchObject({ status: 'failed', reason: 'nothing-staged' });
    expect(await run(fixture, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });

  it('refuses an empty message before running Git', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');

    const result = await commit(fixture, { subject: '   ', body: '\n' });
    expect(result).toMatchObject({ status: 'failed', reason: 'empty-message' });
    expect(await run(fixture, ['rev-parse', '--verify', '--quiet', 'HEAD'])).toBeNull();
  });

  it('rejects a snapshot taken before the staged set changed', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');
    const stale = (await context(fixture)).snapshot;
    await stage(fixture, 'other.txt', 'two\n');

    await expect(commit(fixture, { subject: 'Stale', snapshot: stale })).rejects.toBeInstanceOf(
      StaleCommitSnapshotError,
    );
    expect(await run(fixture, ['rev-parse', '--verify', '--quiet', 'HEAD'])).toBeNull();
  });

  it('reports a failing pre-commit hook with its output and allows an explicit skip', async () => {
    const fixture = await fixtureRepository();
    await writeHook(fixture, 'pre-commit', '#!/bin/sh\necho "policy check failed"\nexit 1\n');
    await stage(fixture, 'file.txt', 'one\n');

    const blocked = await commit(fixture, { subject: 'Blocked by hook' });
    expect(blocked).toMatchObject({ status: 'failed', reason: 'hook', canSkipHooks: true });
    if (blocked.status !== 'failed') throw new Error('Expected a failed commit.');
    expect(blocked.output).toContain('policy check failed');
    expect(await run(fixture, ['rev-parse', '--verify', '--quiet', 'HEAD'])).toBeNull();

    const skipped = await commit(fixture, { subject: 'Committed without hooks', skipHooks: true });
    expect(skipped.status).toBe('committed');
    expect(await run(fixture, ['log', '-1', '--format=%s'])).toBe('Committed without hooks');
  });

  it('lists the commit hooks a repository actually has', async () => {
    const fixture = await fixtureRepository();
    expect((await context(fixture)).hooks).toEqual([]);

    await writeHook(fixture, 'commit-msg', '#!/bin/sh\nexit 0\n');
    await writeFile(join(fixture.gitDir, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(join(fixture.gitDir, 'hooks', 'pre-commit'), 0o644);

    // A non-executable hook is not run by Git, so it must not be offered as skippable either.
    expect((await context(fixture)).hooks).toEqual(
      process.platform === 'win32' ? ['pre-commit', 'commit-msg'] : ['commit-msg'],
    );
  });

  it('keeps a message a commit-msg hook rewrote', async () => {
    const fixture = await fixtureRepository();
    await writeHook(fixture, 'commit-msg', '#!/bin/sh\nprintf "\\nRefs: #7\\n" >> "$1"\n');
    await stage(fixture, 'file.txt', 'one\n');

    const result = await commit(fixture, { subject: 'Hooked subject' });
    expect(result.status).toBe('committed');
    expect(await run(fixture, ['log', '-1', '--format=%B'])).toBe('Hooked subject\n\nRefs: #7\n');
  });

  it('offers a configured commit template with its comment lines removed', async () => {
    const fixture = await fixtureRepository();
    const templatePath = join(fixture.root, '.gitmessage');
    await writeFile(templatePath, 'Subject line\n\n# Explain why\nBody line\n', 'utf8');
    await fixture.git.run(['config', 'commit.template', templatePath], { cwd: fixture.root });

    const current = await context(fixture);
    expect(current.template).toBe('Subject line\n\nBody line');
  });

  it('reports the identity Git would use and whether it is configured', async () => {
    const fixture = await fixtureRepository();
    const configured = await context(fixture);
    expect(configured.identity).toEqual({
      name: 'Commit Author',
      email: 'commit@example.test',
      source: 'configured',
    });

    await fixture.git.run(['config', '--unset', 'user.email'], { cwd: fixture.root });
    // Ignore this machine's own Git identity so the test describes the repository, not the host.
    const previous = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';
    try {
      const afterUnset = await context(fixture);
      expect(['implicit', 'missing']).toContain(afterUnset.identity.source);
      expect(afterUnset.identity.name).toBe('Commit Author');
    } finally {
      restoreEnvironment('GIT_CONFIG_GLOBAL', previous.global);
      restoreEnvironment('GIT_CONFIG_SYSTEM', previous.system);
    }
  });

  it('collects recent commit messages without duplicates', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'a.txt', 'a\n');
    await commit(fixture, { subject: 'Repeated subject', body: 'Same body' });
    await stage(fixture, 'b.txt', 'b\n');
    await commit(fixture, { subject: 'Repeated subject', body: 'Same body' });
    await stage(fixture, 'c.txt', 'c\n');
    await commit(fixture, { subject: 'Newest subject' });

    const current = await context(fixture);
    expect(current.recentMessages.map((message) => message.subject)).toEqual([
      'Newest subject',
      'Repeated subject',
    ]);
    expect(current.recentMessages[1]?.body).toBe('Same body');
  });

  it('marks a commit reachable from a remote-tracking branch as published', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');
    await commit(fixture, { subject: 'base' });
    const commitId = await run(fixture, ['rev-parse', 'HEAD']);
    if (!commitId) throw new Error('Expected a commit.');
    await fixture.git.run(['update-ref', 'refs/remotes/origin/main', commitId], { cwd: fixture.root });

    const current = await context(fixture);
    expect(current.amend?.published).toBe(true);
    expect(current.amend?.publishedRefs).toEqual(['refs/remotes/origin/main']);
  });

  it('creates the merge commit and prefills its message while a merge is pending', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'base\n');
    await commit(fixture, { subject: 'base' });
    await fixture.git.run(['checkout', '--quiet', '-b', 'topic'], { cwd: fixture.root });
    await stage(fixture, 'topic.txt', 'topic\n');
    await commit(fixture, { subject: 'topic change' });
    await fixture.git.run(['checkout', '--quiet', 'main'], { cwd: fixture.root });
    await stage(fixture, 'main.txt', 'main\n');
    await commit(fixture, { subject: 'main change' });
    await fixture.git.run([...identity, 'merge', '--no-commit', '--no-ff', 'topic'], { cwd: fixture.root });

    const pending = await context(fixture);
    expect(pending.pendingOperation).toBe('merge');
    expect(pending.pendingMessage).toContain('topic');
    expect(pending.amend).toBeNull();

    const result = await commit(fixture, { subject: "Merge branch 'topic'" });
    expect(result.status).toBe('committed');
    expect(await run(fixture, ['log', '-1', '--format=%P'])).toMatch(/^[0-9a-f]+ [0-9a-f]+$/u);
  });

  it('previews and cancels amend without writes, then amends a merge message with its exact tree and both parents', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'base.txt', 'base\n');
    await commit(fixture, { subject: 'base' });
    await fixture.git.run(['checkout', '--quiet', '-b', 'topic'], { cwd: fixture.root });
    await stage(fixture, 'topic.txt', 'topic\n');
    await commit(fixture, { subject: 'topic' });
    await fixture.git.run(['checkout', '--quiet', 'main'], { cwd: fixture.root });
    await stage(fixture, 'main.txt', 'main\n');
    await commit(fixture, { subject: 'main' });
    await fixture.git.run(['merge', '--quiet', '--no-ff', '-m', 'Merge topic', 'topic'], {
      cwd: fixture.root,
    });
    const before = await run(fixture, ['show', '-s', '--format=%T %P', 'HEAD']);
    const headBefore = await run(fixture, ['rev-parse', 'HEAD']);
    const indexBefore = await run(fixture, ['ls-files', '--stage']);
    const current = await context(fixture);
    expect(current.amend?.parentCount).toBe(2);
    await readAmendChanges(fixture.git, {
      repositoryId,
      cwd: fixture.root,
      gitDir: fixture.gitDir,
      head: await head(fixture),
    });
    expect(await run(fixture, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(await run(fixture, ['ls-files', '--stage'])).toBe(indexBefore);
    expect(await run(fixture, ['status', '--porcelain'])).toBeNull();
    const amended = await commit(fixture, { subject: 'Updated merge message', amend: true });
    expect(amended.status).toBe('committed');
    expect(await run(fixture, ['show', '-s', '--format=%T %P', 'HEAD'])).toBe(before);
    expect(await run(fixture, ['rev-parse', 'HEAD'])).not.toBe(headBefore);
  });

  it('refuses to commit while a file is unmerged', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'base\n');
    await commit(fixture, { subject: 'base' });
    await fixture.git.run(['checkout', '--quiet', '-b', 'topic'], { cwd: fixture.root });
    await stage(fixture, 'file.txt', 'topic\n');
    await commit(fixture, { subject: 'topic change' });
    await fixture.git.run(['checkout', '--quiet', 'main'], { cwd: fixture.root });
    await stage(fixture, 'file.txt', 'main\n');
    await commit(fixture, { subject: 'main change' });
    await expect(
      fixture.git.run([...identity, 'merge', '--no-ff', 'topic'], { cwd: fixture.root }),
    ).rejects.toThrow();

    const current = await context(fixture);
    expect(current.conflictedCount).toBe(1);
    const result = await commit(fixture, { subject: 'Commit with conflicts' });
    expect(result).toMatchObject({ status: 'failed', reason: 'conflicts' });
  });

  it('refuses to amend an unborn branch', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');

    const current = await context(fixture);
    expect(current.amendBlockedReason).toContain('no commits yet');
    const result = await commit(fixture, { subject: 'Amend nothing', amend: true });
    expect(result).toMatchObject({ status: 'failed', reason: 'other' });
  });

  it('commits a file whose name begins with a dash', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, '--dashed.txt', 'content\n');

    const result = await commit(fixture, { subject: 'Add dashed path' });
    expect(result.status).toBe('committed');
    expect(await run(fixture, ['ls-tree', '-r', '--name-only', 'HEAD'])).toBe('--dashed.txt');
  });

  it('preserves a message body that contains comment characters', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');

    const result = await commit(fixture, { subject: 'Fix #42', body: '# not a comment\nSecond line' });
    expect(result.status).toBe('committed');
    expect(await run(fixture, ['log', '-1', '--format=%B'])).toBe(
      'Fix #42\n\n# not a comment\nSecond line\n',
    );
  });

  it("previews the amended commit as the index against HEAD's parent", async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'kept.txt', 'kept\n');
    await commit(fixture, { subject: 'base' });
    await stage(fixture, 'committed.txt', 'from the commit\n');
    await commit(fixture, { subject: 'commit to amend' });
    await stage(fixture, 'staged-now.txt', 'staged after the commit\n');

    const preview = await readAmendChanges(fixture.git, {
      repositoryId,
      cwd: fixture.root,
      gitDir: fixture.gitDir,
      head: await head(fixture),
    });

    expect(preview.commitId).toBe(await run(fixture, ['rev-parse', 'HEAD']));
    expect(preview.parentId).toBe(await run(fixture, ['rev-parse', 'HEAD^']));
    // Both the commit's own file and the newly staged one, because both land in the amended commit.
    expect(preview.changes.map((change) => change.path).sort()).toEqual(['committed.txt', 'staged-now.txt']);
    expect(preview.stagedPaths).toEqual(['staged-now.txt']);
    // Nothing moved: the commit is still there and the index still holds only the new file.
    expect(await run(fixture, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await run(fixture, ['diff', '--cached', '--name-only'])).toBe('staged-now.txt');
  });

  it('previews a root commit against the empty tree', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'first.txt', 'first\n');
    await commit(fixture, { subject: 'root commit' });

    const preview = await readAmendChanges(fixture.git, {
      repositoryId,
      cwd: fixture.root,
      gitDir: fixture.gitDir,
      head: await head(fixture),
    });
    expect(preview.parentId).toBeNull();
    expect(preview.changes.map((change) => change.path)).toEqual(['first.txt']);
  });

  it('refuses an amend preview before the first commit', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');
    await expect(
      readAmendChanges(fixture.git, {
        repositoryId,
        cwd: fixture.root,
        gitDir: fixture.gitDir,
        head: await head(fixture),
      }),
    ).rejects.toBeInstanceOf(AmendUnavailableError);
  });

  it('reports the new commit and leaves the index clean after committing', async () => {
    const fixture = await fixtureRepository();
    await stage(fixture, 'file.txt', 'one\n');

    const result = await commit(fixture, { subject: 'Reported commit' });
    if (result.status !== 'committed') throw new Error('Expected a committed result.');
    expect(result.commitId).toBe(await run(fixture, ['rev-parse', 'HEAD']));
    expect(result.amended).toBe(false);
    expect(result.subject).toBe('Reported commit');

    const after = await context(fixture);
    expect(after.stagedCount).toBe(0);
    expect(after.amend?.commitId).toBe(result.commitId);
  });
});
