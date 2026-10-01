import { fixtureName } from '../platform';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import {
  parseWorkingTreeStatus,
  readWorkingChanges,
} from '../../src/backend/repositories/working-tree-service';

const temporaryDirectories: string[] = [];
const author = ['-c', 'user.name=Changes Author', '-c', 'user.email=changes@example.test'];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-working-tree-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('working-tree status parser', () => {
  it('preserves NUL-delimited paths and parses tracked, rename, conflict, and visibility records', () => {
    const objectId = 'a'.repeat(40);
    const indexObjectId = 'b'.repeat(40);
    const zeroObjectId = '0'.repeat(40);
    const output = [
      '# branch.oid abc',
      `1 AM N... 100644 100644 100644 ${objectId} ${indexObjectId} folder/file name.txt`,
      `2 R. N... 100644 100644 100644 ${objectId} ${indexObjectId} R87 renamed.txt`,
      'old name.txt',
      `u UU N... 100644 100644 100644 100644 ${zeroObjectId} ${objectId} ${indexObjectId} conflict.txt`,
      '? untracked\nname.txt',
      '! ignored.txt',
    ].join('\0');

    const changes = parseWorkingTreeStatus(output);
    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'tracked',
        path: 'folder/file name.txt',
        indexStatus: 'A',
        worktreeStatus: 'M',
        headMode: '100644',
        indexObjectId,
      }),
      expect.objectContaining({
        kind: 'tracked',
        path: 'renamed.txt',
        previousPath: 'old name.txt',
        similarity: 87,
        indexStatus: 'R',
      }),
      expect.objectContaining({ kind: 'unmerged', path: 'conflict.txt' }),
      expect.objectContaining({ kind: 'untracked', path: 'untracked\nname.txt' }),
      expect.objectContaining({ kind: 'ignored', path: 'ignored.txt' }),
    ]);
  });

  it('rejects malformed records instead of guessing their paths', () => {
    expect(() => parseWorkingTreeStatus('1 AM N... 100644')).toThrow(/incomplete/u);
    expect(() => parseWorkingTreeStatus('? ')).toThrow(/empty untracked/u);
    expect(() => parseWorkingTreeStatus('2 R. N... 100644 100644 100644 a b R80 renamed\0')).toThrow(
      /incomplete rename/u,
    );
  });
});

describe('working-tree status service', () => {
  it('separates staged, unstaged, untracked, ignored, rename, and mode metadata', async () => {
    const root = await fixtureDirectory();
    const repository = join(root, 'repository');
    await mkdir(repository);
    const git = new GitRunner();
    await git.run(['init', '--quiet'], { cwd: repository });
    await git.run([...author, 'config', 'core.filemode', 'true'], { cwd: repository });
    await writeFile(join(repository, 'partial.txt'), 'base\n', 'utf8');
    await writeFile(join(repository, 'old name.txt'), 'rename\n', 'utf8');
    await git.run(['add', '--', 'partial.txt', 'old name.txt'], { cwd: repository });
    await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: repository });

    await writeFile(join(repository, 'partial.txt'), 'staged\n', 'utf8');
    await git.run(['add', '--', 'partial.txt'], { cwd: repository });
    await writeFile(join(repository, 'partial.txt'), 'staged and unstaged\n', 'utf8');
    await git.run(['mv', '--', 'old name.txt', 'new name.txt'], { cwd: repository });
    await writeFile(join(repository, fixtureName('untracked\nfile.txt')), 'untracked\n', 'utf8');
    await writeFile(join(repository, '.gitignore'), 'ignored.txt\n', 'utf8');
    await writeFile(join(repository, 'ignored.txt'), 'ignored\n', 'utf8');
    if (process.platform !== 'win32') await chmod(join(repository, 'new name.txt'), 0o755);

    const repositoryId = `repo-${'a'.repeat(64)}`;
    const visible = await readWorkingChanges(git, {
      repositoryId,
      cwd: repository,
      includeUntracked: true,
      includeIgnored: true,
    });
    expect(visible.repositoryId).toBe(repositoryId);
    expect(visible.staged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'partial.txt', area: 'staged', status: 'modified' }),
        expect.objectContaining({
          path: 'new name.txt',
          previousPath: 'old name.txt',
          area: 'staged',
          status: 'renamed',
        }),
      ]),
    );
    expect(visible.unstaged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'partial.txt', area: 'unstaged' }),
        ...(process.platform !== 'win32'
          ? [expect.objectContaining({ path: 'new name.txt', oldMode: '100644', newMode: '100755' })]
          : []),
      ]),
    );
    expect(visible.untracked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: fixtureName('untracked\nfile.txt'), status: 'untracked' }),
        expect.objectContaining({ path: '.gitignore', status: 'untracked' }),
      ]),
    );
    expect(visible.ignored).toEqual([expect.objectContaining({ path: 'ignored.txt', status: 'ignored' })]);
    expect(visible.counts).toMatchObject({
      staged: 2,
      unstaged: process.platform === 'win32' ? 1 : 2,
      untracked: 2,
      ignored: 1,
    });

    const trackedOnly = await readWorkingChanges(git, {
      repositoryId,
      cwd: repository,
      includeUntracked: false,
      includeIgnored: false,
    });
    expect(trackedOnly.untracked).toEqual([]);
    expect(trackedOnly.ignored).toEqual([]);
    expect(trackedOnly.staged.map((change) => change.path)).toEqual(
      expect.arrayContaining(['partial.txt', 'new name.txt']),
    );
    const ignoredOnly = await readWorkingChanges(git, {
      repositoryId,
      cwd: repository,
      includeUntracked: false,
      includeIgnored: true,
    });
    expect(ignoredOnly.untracked).toEqual([]);
    expect(ignoredOnly.ignored).toEqual([expect.objectContaining({ path: 'ignored.txt' })]);
    expect(ignoredOnly.unstaged).toEqual(trackedOnly.unstaged);
  });
});
