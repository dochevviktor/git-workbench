import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    expect(blame.commits.map((commit) => commit.id)).toEqual(expect.arrayContaining([first, second, newest]));

    expect((await runner.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim()).toBe(newest);
    expect((await runner.run(['status', '--porcelain'], { cwd: repositoryPath })).stdout).toBe('');
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
