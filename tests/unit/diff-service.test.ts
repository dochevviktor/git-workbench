import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitCancelledError, GitOutputLimitError, GitRunner } from '../../src/backend/git/runner';
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
  it('cancels the bounded Git read when its owner cancels a large diff', async () => {
    const controller = new AbortController();
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, signal: null })
        .mockImplementationOnce(
          (_args: readonly string[], options: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              expect(options.signal).toBe(controller.signal);
              options.signal?.addEventListener('abort', () => reject(new GitCancelledError()), {
                once: true,
              });
              controller.abort();
            }),
        ),
    };
    await expect(
      readRepositoryDiff(runner, {
        repositoryId,
        cwd: '/unused-disposable-target',
        target: { kind: 'commit', commitId: 'a'.repeat(40), path: 'large.txt', previousPath: null },
        whitespace: 'normal',
        options: { loadLarge: true },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(GitCancelledError);
  });

  it('changes context and exposes the full file while large diffs require an explicit bounded load', async () => {
    const root = await fixtureDirectory();
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: root });
    const base = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    await writeFile(join(root, 'file.txt'), base);
    await git.run(['add', '--', 'file.txt'], { cwd: root });
    await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: root });
    await writeFile(join(root, 'file.txt'), base.replace('line 40\n', 'changed 40\n'));
    const target = {
      kind: 'working' as const,
      area: 'unstaged' as const,
      path: 'file.txt',
      previousPath: null,
    };
    const narrow = await readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { contextLines: 0 },
    });
    const wide = await readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { contextLines: 6 },
    });
    const entire = await readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { entireFile: true },
    });
    expect(narrow.content).not.toContain('\n line 39\n');
    expect(wide.content).toContain('line 34');
    expect(entire.content).toContain('line 80');
    expect(entire.snapshot).toBe(narrow.snapshot);
    await writeFile(
      join(root, 'file.txt'),
      Array.from({ length: 60000 }, (_, index) => `new line ${index}`).join('\n') + '\n',
    );
    expect(
      (await readRepositoryDiff(git, { repositoryId, cwd: root, target, whitespace: 'normal' })).state,
    ).toBe('too-large');
    const loaded = await readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { loadLarge: true },
    });
    expect(loaded.state).toBe('text');
    expect(loaded.content).toContain('+new line 59999');
  });

  it("diffs an amend target against the commit's parent, including files only in the commit", async () => {
    const root = await fixtureDirectory();
    const repository = join(root, 'repository');
    await mkdir(repository);
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: repository });
    await writeFile(join(repository, 'file.txt'), 'base\n', 'utf8');
    await git.run(['add', '--', 'file.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: repository });
    await writeFile(join(repository, 'file.txt'), 'amended\n', 'utf8');
    await git.run(['add', '--', 'file.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'commit to amend'], { cwd: repository });
    await writeFile(join(repository, 'extra.txt'), 'staged later\n', 'utf8');
    await git.run(['add', '--', 'extra.txt'], { cwd: repository });

    const committed = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'amend', path: 'file.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(committed).toMatchObject({ state: 'text', target: { kind: 'amend' }, snapshot: null });
    expect(committed.content).toContain('-base');
    expect(committed.content).toContain('+amended');

    const alsoStaged = await readRepositoryDiff(git, {
      repositoryId,
      cwd: repository,
      target: { kind: 'amend', path: 'extra.txt', previousPath: null },
      whitespace: 'normal',
    });
    expect(alsoStaged.content).toContain('+staged later');
  });

  it('reports an amend diff as unavailable before the first commit', async () => {
    const root = await fixtureDirectory();
    const repository = join(root, 'repository');
    await mkdir(repository);
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: repository });

    await expect(
      readRepositoryDiff(git, {
        repositoryId,
        cwd: repository,
        target: { kind: 'amend', path: 'file.txt', previousPath: null },
        whitespace: 'normal',
      }),
    ).resolves.toMatchObject({ state: 'unavailable' });
  });

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
    expect(unstaged.snapshot).toMatch(/^[a-f0-9]{64}$/u);
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
    expect(committed.snapshot).toBeNull();
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
      message: 'This file has conflicts. Choose Resolve conflict to review and stage a resolution.',
    });
  });
});
