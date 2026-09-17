import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitOutputLimitError, GitRunner } from '../../src/backend/git/runner';
import { readRepositoryDiff } from '../../src/backend/repositories/diff-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'f'.repeat(64)}`;
const author = ['-c', 'user.name=Diff Author', '-c', 'user.email=diff@example.test'];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-diff-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('repository diff service', () => {
  it('reads staged, unstaged, untracked, and committed text diffs with literal paths', async () => {
    const root = await fixtureDirectory();
    const repository = join(root, 'repository');
    await mkdir(repository);
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: repository });
    await writeFile(join(repository, 'file.txt'), 'first\nkept\n', 'utf8');
    await git.run(['add', '--', 'file.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: repository });

    await writeFile(join(repository, 'file.txt'), 'changed\nkept\n', 'utf8');
    const unstaged = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'unstaged', path: 'file.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(unstaged).toMatchObject({ state: 'text', target: { kind: 'working', area: 'unstaged' } });
    expect(unstaged.content).toContain('-first');
    expect(unstaged.content).toContain('+changed');

    await git.run(['add', '--', 'file.txt'], { cwd: repository });
    const staged = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'staged', path: 'file.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(staged.content).toContain('-first');
    expect(staged.content).toContain('+changed');

    await writeFile(join(repository, 'untracked.txt'), 'new file\n', 'utf8');
    const untracked = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'untracked', path: 'untracked.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(untracked.state).toBe('text');
    expect(untracked.content).toContain('+new file');

    const commitId = (await git.run(['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
    const committed = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'commit', commitId, path: 'file.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(committed.state).toBe('text');
    expect(committed.content).toContain('+first');
  });

  it('applies whitespace comparison modes and classifies binary changes', async () => {
    const root = await fixtureDirectory();
    const repository = join(root, 'repository');
    await mkdir(repository);
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: repository });
    await writeFile(join(repository, 'file.txt'), 'value\n', 'utf8');
    await git.run(['add', '--', 'file.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: repository });

    await writeFile(join(repository, 'file.txt'), 'value  \n', 'utf8');
    const normal = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'unstaged', path: 'file.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(normal.content).toContain('+value  ');
    const ignored = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'unstaged', path: 'file.txt', previousPath: null },
      whitespace: 'ignore-space-at-eol',
    });
    expect(ignored).toMatchObject({ state: 'text', content: '' });

    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 1, 2, 3]), 'binary');
    const binary = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'untracked', path: 'binary.bin', previousPath: null },
      whitespace: 'normal',
    });
    expect(binary).toMatchObject({
      state: 'binary',
      content: '',
      message: 'Binary changes do not have an inline text diff.',
    });
  });

  it('returns an explicit oversized state when patch output exceeds the read budget', async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, signal: null })
        .mockRejectedValueOnce(new GitOutputLimitError('stdout')),
    };
    const diff = await readRepositoryDiff(runner, {
      repositoryId,
      cwd: '/tmp/repository',
      target: { kind: 'commit', commitId: 'a'.repeat(40), path: 'large.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(diff).toMatchObject({ state: 'too-large', content: '', byteLength: null });
  });

  it('keeps conflicted files out of the ordinary text diff view', async () => {
    const root = await fixtureDirectory();
    const repository = join(root, 'repository');
    await mkdir(repository);
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: repository });
    await writeFile(join(repository, 'conflict.txt'), 'base\n', 'utf8');
    await git.run(['add', '--', 'conflict.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: repository });
    const mainBranch = (
      await git.run(['symbolic-ref', '--short', 'HEAD'], { cwd: repository })
    ).stdout.trim();

    await git.run(['checkout', '--quiet', '-b', 'conflict-branch'], { cwd: repository });
    await writeFile(join(repository, 'conflict.txt'), 'theirs\n', 'utf8');
    await git.run(['add', '--', 'conflict.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'theirs'], { cwd: repository });
    await git.run(['checkout', '--quiet', mainBranch], { cwd: repository });
    await writeFile(join(repository, 'conflict.txt'), 'ours\n', 'utf8');
    await git.run(['add', '--', 'conflict.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'ours'], { cwd: repository });
    await expect(
      git.run([...author, 'merge', '--no-commit', '--no-ff', 'conflict-branch'], { cwd: repository }),
    ).rejects.toBeDefined();

    const diff = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'working', area: 'staged', path: 'conflict.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(diff).toMatchObject({
      state: 'unavailable',
      content: '',
      message: 'Conflict diffs are not available yet.',
    });
  });
});
