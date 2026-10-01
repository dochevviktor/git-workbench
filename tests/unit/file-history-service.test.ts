import { fixtureName, testPlatform } from '../platform';
import { mkdir, mkdtemp, rm, writeFile, readFile, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-file-history-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('repository file history and blame service', () => {
  it('follows a committed rename and attributes historical lines without changing the checkout', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'rename');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(31, repositoryPath, false);
    await runner.run(['branch', '--quiet', '-M', 'main'], { cwd: repositoryPath });

    await writeFile(join(repositoryPath, 'old.txt'), 'Alpha\nBeta\n', 'utf8');
    const first = await commit(runner, repositoryPath, 'Create original filename');
    await writeFile(join(repositoryPath, 'old.txt'), 'Alpha\nBeta revised\n', 'utf8');
    const second = await commit(runner, repositoryPath, 'Edit before rename');
    await runner.run(['mv', '--', 'old.txt', 'renamed café.txt'], { cwd: repositoryPath });
    const rename = await commit(runner, repositoryPath, 'Rename synthetic notes');
    await writeFile(join(repositoryPath, 'renamed café.txt'), 'Alpha\nBeta revised\nGamma\n', 'utf8');
    const newest = await commit(runner, repositoryPath, 'Edit after rename');

    const history = await service.getFileHistory(31, repository.id, newest, 'renamed café.txt');
    expect(history.revisions.map((revision) => revision.commit.id)).toEqual([newest, rename, second, first]);
    expect(history.revisions.map((revision) => revision.path)).toEqual([
      'renamed café.txt',
      'renamed café.txt',
      'old.txt',
      'old.txt',
    ]);
    expect(history.revisions[1]).toMatchObject({
      status: 'renamed',
      previousPath: 'old.txt',
      path: 'renamed café.txt',
      similarity: 100,
    });

    const renameDiff = await service.getDiff(
      31,
      repository.id,
      {
        kind: 'commit',
        commitId: rename,
        path: 'renamed café.txt',
        previousPath: 'old.txt',
      },
      'normal',
    );
    expect(renameDiff.state).toBe('text');

    const blame = await service.getBlame(31, repository.id, newest, 'renamed café.txt');
    expect(blame.state).toBe('text');
    expect(blame.lines.map((line) => line.content)).toEqual(['Alpha', 'Beta revised', 'Gamma']);
    expect(blame.lines.map((line) => line.line)).toEqual([1, 2, 3]);
    expect(blame.lines.map((line) => line.originalPath)).toEqual(['old.txt', 'old.txt', 'renamed café.txt']);
    expect(blame.lines.map((line) => line.originalLine)).toEqual([1, 2, 3]);
    expect(blame.commits.map((commit) => commit.id)).toEqual(expect.arrayContaining([first, second, newest]));

    expect((await runner.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim()).toBe(newest);
    expect((await runner.run(['status', '--porcelain'], { cwd: repositoryPath })).stdout).toBe('');
  });

  it('tracks selected code and directory descendants across successive renames, omitting unrelated edits', async () => {
    const root = await fixtureDirectory();
    const cwd = join(root, 'repo');
    await mkdir(cwd);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner });
    try {
      const { id } = await service.initialize(42, cwd, false);
      await mkdir(join(cwd, 'old'));
      await writeFile(join(cwd, 'old/code.txt'), 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
      const first = await commit(runner, cwd, 'Create code');
      await writeFile(join(cwd, 'old/code.txt'), 'alpha\nbeta revised\ngamma\ndelta\nepsilon\n');
      const second = await commit(runner, cwd, 'Edit chosen line');
      await runner.run(['mv', 'old', 'middle'], { cwd });
      await commit(runner, cwd, 'Rename directory once');
      await runner.run(['mv', 'middle', 'new'], { cwd });
      const renamed = await commit(runner, cwd, 'Rename directory twice');
      await writeFile(join(cwd, 'new/code.txt'), 'alpha\nbeta revised\ngamma\ndelta\nother edit\n');
      await writeFile(join(cwd, 'new/second.txt'), 'another descendant\n');
      const head = await commit(runner, cwd, 'Edit elsewhere');
      const directory = await service.getFileHistory(42, id, head, 'new', { kind: 'directory' });
      expect(directory.revisions[0]?.changes?.map((change) => change.path)).toEqual([
        'new/code.txt',
        'new/second.txt',
      ]);
      expect(directory.revisions.map((revision) => revision.commit.id)).toEqual(
        expect.arrayContaining([first, second, renamed, head]),
      );
      expect(directory.revisions.at(-1)?.path).toBe('old/code.txt');
      const lines = await service.getFileHistory(42, id, head, 'new/code.txt', {
        kind: 'lines',
        start: 2,
        end: 2,
      });
      expect(lines.revisions.map((revision) => revision.commit.id)).toEqual([second, first]);
      expect(lines.revisions.map((revision) => revision.path)).toEqual(['old/code.txt', 'old/code.txt']);
      await expect(
        service.getFileHistory(42, id, head, 'new/code.txt', { kind: 'lines', start: 10, end: 12 }),
      ).rejects.toThrow(/outside/u);
      expect((await runner.run(['status', '--porcelain'], { cwd })).stdout).toBe('');
      expect((await runner.run(['rev-parse', 'HEAD'], { cwd })).stdout.trim()).toBe(head);
    } finally {
      service.dispose();
    }
  });

  it('saves exact historical binary and CRLF bytes outside the checkout and refuses linked destinations', async () => {
    const root = await fixtureDirectory();
    const cwd = join(root, 'repo');
    await mkdir(cwd);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner });
    try {
      const { id } = await service.initialize(43, cwd, false);
      const bytes = Buffer.from([0xff, 0, 13, 10, 97, 13, 10]);
      await writeFile(join(cwd, 'bytes.dat'), bytes);
      const commitId = await commit(runner, cwd, 'Bytes');
      await writeFile(join(cwd, 'bytes.dat'), 'local work');
      const request = { id, commitId, path: 'bytes.dat' };
      expect(await service.saveRevisionFile(43, request, join(root, 'export.dat'))).toMatchObject({
        status: 'saved',
        byteLength: bytes.length,
      });
      expect(await readFile(join(root, 'export.dat'))).toEqual(bytes);
      await expect(service.saveRevisionFile(43, request, join(cwd, 'bytes.dat'))).rejects.toThrow(/outside/u);
      if (testPlatform.symlinks) {
        await symlink(cwd, join(root, 'alias'), 'dir');
        await expect(service.saveRevisionFile(43, request, join(root, 'alias/bytes.dat'))).rejects.toThrow(
          /outside/u,
        );
        await symlink(join(cwd, 'bytes.dat'), join(root, 'symbolic'));
      }
      await link(join(cwd, 'bytes.dat'), join(root, 'hard'));
      for (const name of testPlatform.symlinks ? ['symbolic', 'hard'] : ['hard'])
        await expect(service.saveRevisionFile(43, request, join(root, name))).rejects.toThrow(/links/u);
      expect(await readFile(join(cwd, 'bytes.dat'), 'utf8')).toBe('local work');
      await service.close(43, id);
      await expect(service.saveRevisionFile(43, request, join(root, 'closed'))).rejects.toMatchObject({
        code: 'REPOSITORY_NOT_OPEN',
      });
    } finally {
      service.dispose();
    }
  });

  it('preserves quoted Unicode and newline filenames in blame attribution', async () => {
    const root = await fixtureDirectory();
    const cwd = join(root, 'repo');
    await mkdir(cwd);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner });
    try {
      const { id } = await service.initialize(45, cwd, false);
      const path = fixtureName('notes 𝄞\nwith\ttabs.txt');
      await writeFile(join(cwd, path), 'attributed\n');
      const commitId = await commit(runner, cwd, 'Unicode pathname');
      expect((await service.getBlame(45, id, commitId, path)).lines[0]).toMatchObject({
        originalPath: path,
        originalLine: 1,
      });
    } finally {
      service.dispose();
    }
  });

  it('reads an earlier filename at the selected revision and rejects unsafe paths', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'history');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(32, repositoryPath, false);
    await writeFile(join(repositoryPath, 'notes.txt'), 'one\n', 'utf8');
    const first = await commit(runner, repositoryPath, 'first');
    await writeFile(join(repositoryPath, 'notes.txt'), 'one\ntwo\n', 'utf8');
    const second = await commit(runner, repositoryPath, 'second');

    await expect(service.getFileHistory(32, repository.id, second, 'notes.txt')).resolves.toMatchObject({
      startingCommitId: second,
      revisions: [
        expect.objectContaining({ path: 'notes.txt', commit: expect.objectContaining({ id: second }) }),
        expect.objectContaining({ path: 'notes.txt', commit: expect.objectContaining({ id: first }) }),
      ],
    });
    await expect(service.getFileHistory(32, repository.id, second, '../notes.txt')).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
    await expect(service.getBlame(32, repository.id, second, 'notes.txt')).resolves.toMatchObject({
      state: 'text',
      lines: [
        expect.objectContaining({ line: 1, content: 'one' }),
        expect.objectContaining({ line: 2, content: 'two' }),
      ],
    });
  });
});

async function commit(runner: GitRunner, cwd: string, subject: string): Promise<string> {
  await runner.run(['add', '-A', '--'], { cwd });
  await runner.run(
    [
      '-c',
      'user.name=File History Author',
      '-c',
      'user.email=file-history@example.test',
      'commit',
      '--quiet',
      '-m',
      subject,
    ],
    { cwd },
  );
  return (await runner.run(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}
