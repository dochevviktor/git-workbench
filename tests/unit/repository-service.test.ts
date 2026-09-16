import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GitCancelledError,
  GitExecutableError,
  GitOutputLimitError,
  GitRunner,
} from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-repository-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('Git runner', () => {
  it('uses exact argument data and bounds output', async () => {
    const directory = await fixtureDirectory();
    const logs: string[] = [];
    const runner = new GitRunner({
      executable: process.execPath,
      maxOutputBytes: 32,
      logger: (entry) => logs.push(entry.command),
    });

    await expect(
      runner.run(['-e', 'process.stdout.write("x".repeat(100))'], { cwd: directory }),
    ).rejects.toBeInstanceOf(GitOutputLimitError);
    expect(logs[0]).toContain(JSON.stringify('-e'));
    expect(logs[0]).toContain('process.stdout.write');
  });

  it('reports cancellation after the child has been terminated', async () => {
    const directory = await fixtureDirectory();
    const runner = new GitRunner({ executable: process.execPath });
    const controller = new AbortController();
    const operation = runner.run(['-e', 'setTimeout(() => undefined, 5000)'], {
      cwd: directory,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(operation).rejects.toBeInstanceOf(GitCancelledError);
  });

  it('classifies a missing executable before spawning', async () => {
    const directory = await fixtureDirectory();
    const runner = new GitRunner({ executable: join(directory, 'missing-git') });
    await expect(runner.run(['--version'], { cwd: directory })).rejects.toBeInstanceOf(GitExecutableError);
  });
});

describe('repository service', () => {
  it('initializes, discovers, deduplicates, closes, and reopens a local repository', async () => {
    const directory = await fixtureDirectory();
    const unusual = join(directory, '-leading space and unicode-✓\nname');
    await mkdir(unusual);
    const storagePath = join(directory, 'settings', 'recent.json');
    const service = new RepositoryService({ storagePath });

    const initialized = await service.initialize(7, unusual, false);
    expect(initialized.path).toBe(unusual);
    expect(initialized.worktreePath).toBe(unusual);
    expect(initialized.bare).toBe(false);
    expect(initialized.head).toEqual({ state: 'unborn', name: expect.any(String), commit: null });
    await access(join(unusual, '.git'), constants.F_OK);

    const nestedPath = join(unusual, 'nested');
    await mkdir(nestedPath);
    const openedFromNestedPath = await service.open(7, nestedPath);
    expect(openedFromNestedPath.id).toBe(initialized.id);
    expect(service.listOpen(7)).toHaveLength(1);
    expect((await service.listRecent(7))[0]).toMatchObject({
      id: initialized.id,
      path: unusual,
      status: 'available',
      open: true,
    });

    service.close(7, initialized.id);
    expect(service.listOpen(7)).toEqual([]);
    const reopenedService = new RepositoryService({ storagePath });
    expect((await reopenedService.listRecent(8))[0]).toMatchObject({
      id: initialized.id,
      path: unusual,
      open: false,
    });
    const reopened = await reopenedService.open(8, unusual);
    expect(reopened.id).toBe(initialized.id);
  });

  it('discovers a repository whose Git directory is stored in a .git file', async () => {
    const directory = await fixtureDirectory();
    const worktree = join(directory, 'worktree');
    const gitDirectory = join(directory, 'separate-git');
    await mkdir(worktree);
    await mkdir(gitDirectory);
    const runner = new GitRunner();
    await runner.run(['init', '--quiet', '--separate-git-dir', gitDirectory], { cwd: worktree });

    const service = new RepositoryService({
      storagePath: join(directory, 'recent.json'),
      runner,
    });
    const repository = await service.open(1, worktree);
    expect(await readFile(join(worktree, '.git'), 'utf8')).toContain('gitdir:');
    expect(repository.gitDir).toBe(await realpath(gitDirectory));
    expect(repository.commonDir).toBe(await realpath(gitDirectory));
  });

  it('canonicalizes a symlinked repository path on Linux', async () => {
    if (process.platform === 'win32') return;
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'repository');
    const aliasPath = join(directory, 'repository-alias');
    await mkdir(repositoryPath);
    await symlink(repositoryPath, aliasPath, 'dir');
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json') });
    await service.initialize(1, repositoryPath, false);

    const opened = await service.open(1, aliasPath);
    expect(opened.path).toBe(repositoryPath);
  });

  it('discovers a bare repository without inventing a working tree', async () => {
    const directory = await fixtureDirectory();
    await mkdir(join(directory, 'bare'));
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json') });
    const repository = await service.initialize(1, join(directory, 'bare'), true);
    expect(repository.bare).toBe(true);
    expect(repository.worktreePath).toBeNull();
    expect(repository.path).toBe(repository.commonDir);
    expect(repository.head.state).toBe('unborn');
  });

  it('keeps opening read-only and classifies invalid paths and missing Git', async () => {
    const directory = await fixtureDirectory();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json') });
    await expect(service.open(1, join(directory, 'not-a-repository'))).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND',
    });
    expect(await readdir(directory)).toEqual([]);

    const missingGit = new RepositoryService({
      storagePath: join(directory, 'missing-git-recent.json'),
      runner: new GitRunner({ executable: join(directory, 'does-not-exist') }),
    });
    await expect(missingGit.open(1, directory)).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' });
    await expect(missingGit.getGitInfo()).resolves.toEqual({
      status: 'missing',
      version: null,
      executable: null,
    });
  });

  it('quarantines invalid recent data instead of crashing startup', async () => {
    const directory = await fixtureDirectory();
    const storagePath = join(directory, 'recent.json');
    await writeFile(storagePath, '{not-json', 'utf8');
    const service = new RepositoryService({ storagePath });
    await expect(service.listRecent(1)).resolves.toEqual([]);
    await expect(readdir(directory)).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^recent\.json\.corrupt-/u)]),
    );
  });
});
