import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-revision-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('repository revision inspection service', () => {
  it('reads changed paths, directory entries, and bounded text blobs from committed revisions', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'revision');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({
      storagePath: join(directory, 'recent.json'),
      runner,
    });
    const repository = await service.initialize(21, repositoryPath, false);

    await mkdir(join(repositoryPath, 'src'));
    await writeFile(join(repositoryPath, 'root.txt'), 'root\n', 'utf8');
    await writeFile(join(repositoryPath, 'src', 'file.txt'), 'first\n', 'utf8');
    const firstCommit = await commit(runner, repositoryPath, 'first');

    await runner.run(['mv', '--', 'root.txt', 'renamed.txt'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'src', 'file.txt'), 'second\n', 'utf8');
    await writeFile(join(repositoryPath, 'odd\nname.txt'), 'unusual path\n', 'utf8');
    const secondCommit = await commit(runner, repositoryPath, 'second');

    const changes = await service.getCommitChanges(21, repository.id, secondCommit);
    expect(changes.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'renamed',
          previousPath: 'root.txt',
          path: 'renamed.txt',
          similarity: 100,
        }),
        expect.objectContaining({ status: 'modified', path: 'src/file.txt' }),
        expect.objectContaining({ status: 'added', path: 'odd\nname.txt' }),
      ]),
    );
    const expectedChangedPaths = (
      await runner.run(
        ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-M', '-C', '-z', secondCommit, '--'],
        { cwd: repositoryPath },
      )
    ).stdout
      .split('\0')
      .filter(Boolean);
    expect(changes.changes.map((change) => change.path).sort()).toEqual(expectedChangedPaths.sort());

    const rootTree = await service.getRevisionTree(21, repository.id, secondCommit, '');
    const expectedRootPaths = (
      await runner.run(['ls-tree', '-z', '--full-tree', '--name-only', secondCommit, '--'], {
        cwd: repositoryPath,
      })
    ).stdout
      .split('\0')
      .filter(Boolean);
    expect(rootTree.entries.map((entry) => entry.path)).toEqual(expectedRootPaths);
    expect(rootTree.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'renamed.txt', path: 'renamed.txt', type: 'blob', size: 5 }),
        expect.objectContaining({ name: 'src', path: 'src', type: 'tree', size: null }),
        expect.objectContaining({ name: 'odd\nname.txt', type: 'blob' }),
      ]),
    );

    const sourceTree = await service.getRevisionTree(21, repository.id, secondCommit, 'src');
    expect(sourceTree.path).toBe('src');
    expect(sourceTree.entries).toEqual([
      expect.objectContaining({ name: 'file.txt', path: 'src/file.txt', type: 'blob', size: 7 }),
    ]);
    await expect(service.getRevisionTree(21, repository.id, firstCommit, 'src')).resolves.toMatchObject({
      path: 'src',
      entries: [expect.objectContaining({ path: 'src/file.txt' })],
    });

    await expect(
      service.getRevisionBlob(21, repository.id, secondCommit, 'src/file.txt'),
    ).resolves.toMatchObject({
      path: 'src/file.txt',
      state: 'text',
      content: 'second\n',
      byteLength: 7,
    });

    await writeFile(join(repositoryPath, 'binary.bin'), Buffer.from([0, 1, 2, 3]), 'binary');
    const binaryCommit = await commit(runner, repositoryPath, 'binary');
    await expect(
      service.getRevisionBlob(21, repository.id, binaryCommit, 'binary.bin'),
    ).resolves.toMatchObject({
      state: 'binary',
      content: '',
      byteLength: 4,
    });

    await writeFile(join(repositoryPath, 'large.txt'), Buffer.alloc(1_048_577, 97), 'binary');
    const largeCommit = await commit(runner, repositoryPath, 'large');
    await expect(service.getRevisionBlob(21, repository.id, largeCommit, 'large.txt')).resolves.toMatchObject(
      {
        state: 'too-large',
        content: '',
        byteLength: 1_048_577,
      },
    );
  });

  it('rejects a revision path that is not a committed directory or blob', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'revision');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(22, repositoryPath, false);
    await writeFile(join(repositoryPath, 'file.txt'), 'content\n', 'utf8');
    const revision = await commit(runner, repositoryPath, 'file');

    await expect(service.getRevisionTree(22, repository.id, revision, '../')).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
    await expect(service.getRevisionTree(22, repository.id, revision, 'file.txt')).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
    await expect(service.getRevisionBlob(22, repository.id, revision, 'missing.txt')).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });
});

async function commit(runner: GitRunner, cwd: string, subject: string): Promise<string> {
  await runner.run(['add', '-A', '--'], { cwd });
  await runner.run(
    [
      '-c',
      'user.name=Revision Author',
      '-c',
      'user.email=revision@example.test',
      'commit',
      '--quiet',
      '-m',
      subject,
    ],
    { cwd },
  );
  return (await runner.run(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}
