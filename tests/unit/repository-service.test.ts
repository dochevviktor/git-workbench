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

  it('pipes backend patch data to Git without exposing a shell command', async () => {
    const directory = await fixtureDirectory();
    const runner = new GitRunner();
    await expect(
      runner.run(['hash-object', '--stdin'], { cwd: directory, stdin: 'patch data\n' }),
    ).resolves.toMatchObject({ stdout: /^[0-9a-f]{40}\n$/u });
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
    await service.setTrust(7, openedFromNestedPath.id, true);
    expect(openedFromNestedPath.id).toBe(initialized.id);
    await expect(service.listOpen(7)).resolves.toHaveLength(1);
    expect((await service.listRecent(7))[0]).toMatchObject({
      id: initialized.id,
      path: unusual,
      status: 'available',
      open: true,
    });

    await service.close(7, initialized.id);
    await expect(service.listOpen(7)).resolves.toEqual([]);
    const reopenedService = new RepositoryService({ storagePath });
    expect((await reopenedService.listRecent(8))[0]).toMatchObject({
      id: initialized.id,
      path: unusual,
      open: false,
    });
    const reopened = await reopenedService.open(8, unusual);
    await reopenedService.setTrust(8, reopened.id, true);
    expect(reopened.id).toBe(initialized.id);
  });

  it('reports dirty worktrees and restores ordered tabs and preferences', async () => {
    const directory = await fixtureDirectory();
    const firstPath = join(directory, 'first');
    const secondPath = join(directory, 'second');
    await mkdir(firstPath);
    await mkdir(secondPath);
    const storagePath = join(directory, 'recent.json');
    const service = new RepositoryService({ storagePath });
    const first = await service.initialize(1, firstPath, false);
    const second = await service.initialize(1, secondPath, false);

    const changedPath = join(firstPath, 'unusual\nfilename.txt');
    await writeFile(changedPath, 'uncommitted\n', 'utf8');
    const dirtyTabs = await service.listOpen(1);
    expect(dirtyTabs.find((repository) => repository.id === first.id)).toMatchObject({
      workingTree: { state: 'dirty', changedFileCount: 1 },
    });
    expect(dirtyTabs.find((repository) => repository.id === second.id)).toMatchObject({
      workingTree: { state: 'clean', changedFileCount: 0 },
    });

    await expect(service.getTabPreferences(1)).resolves.toMatchObject({ tabOrientation: 'horizontal' });
    await service.setTabOrientation('vertical');
    await expect(service.getTabPreferences(1)).resolves.toMatchObject({
      tabOrientation: 'vertical',
      activeRepositoryId: second.id,
    });

    const restarted = new RepositoryService({ storagePath });
    await expect(restarted.listOpen(2)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, path: first.path }),
        expect.objectContaining({ id: second.id, path: second.path }),
      ]),
    );
    expect(await restarted.listOpen(2)).toHaveLength(2);
    await expect(restarted.getTabPreferences(2)).resolves.toMatchObject({
      tabOrientation: 'vertical',
      activeRepositoryId: second.id,
    });
  });

  it('applies a validated working-tree hunk through the repository service', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'repository');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(1, repositoryPath, false);
    await writeFile(join(repositoryPath, 'file.txt'), 'one\ntwo\n', 'utf8');
    await runner.run(['add', '--', 'file.txt'], { cwd: repositoryPath });
    await runner.run(
      [
        '-c',
        'user.name=Service Author',
        '-c',
        'user.email=service@example.test',
        'commit',
        '--quiet',
        '-m',
        'base',
      ],
      { cwd: repositoryPath },
    );
    await writeFile(join(repositoryPath, 'file.txt'), 'one changed\ntwo\n', 'utf8');

    const target = { kind: 'working', area: 'unstaged', path: 'file.txt', previousPath: null } as const;
    const diff = await service.getDiff(1, repository.id, target, 'normal');
    expect(diff.snapshot).toMatch(/^[a-f0-9]{64}$/u);
    const result = await service.applyWorkingChange(1, {
      id: repository.id,
      action: 'stage',
      targets: [{ area: 'unstaged', path: 'file.txt', previousPath: null }],
      snapshot: diff.snapshot!,
      selection: { kind: 'hunk', hunk: 0 },
    });
    expect(result).toMatchObject({
      repositoryId: repository.id,
      action: 'stage',
      changes: { staged: [expect.objectContaining({ path: 'file.txt' })], unstaged: [] },
    });
    await expect(
      runner.run(['diff', '--cached', '--exit-code'], { cwd: repositoryPath }),
    ).rejects.toMatchObject({
      exitCode: 1,
    });
    await expect(runner.run(['diff', '--exit-code'], { cwd: repositoryPath })).resolves.toMatchObject({
      stdout: '',
    });
  });

  it('commits staged changes through the repository service and rejects a stale composer', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'repository');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(1, repositoryPath, false);
    await runner.run(['config', 'user.name', 'Service Author'], { cwd: repositoryPath });
    await runner.run(['config', 'user.email', 'service@example.test'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'file.txt'), 'one\n', 'utf8');
    await runner.run(['add', '--', 'file.txt'], { cwd: repositoryPath });

    const context = await service.getCommitContext(1, repository.id);
    expect(context).toMatchObject({ repositoryId: repository.id, stagedCount: 1, amend: null });

    // Only a repository this window has open can be addressed.
    await expect(service.getCommitContext(1, `repo-${'7'.repeat(64)}`)).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_OPEN',
    });

    const committed = await service.commit(1, {
      id: repository.id,
      subject: 'Service commit',
      body: '',
      amend: false,
      snapshot: context.snapshot,
      skipHooks: false,
    });
    expect(committed).toMatchObject({ status: 'committed', amended: false, subject: 'Service commit' });
    const log = await runner.run(['log', '-1', '--format=%s'], { cwd: repositoryPath });
    expect(log.stdout.trim()).toBe('Service commit');

    await expect(
      service.commit(1, {
        id: repository.id,
        subject: 'Stale commit',
        body: '',
        amend: true,
        snapshot: context.snapshot,
        skipHooks: false,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('refuses commit workflows for a bare repository', async () => {
    const directory = await fixtureDirectory();
    const barePath = join(directory, 'bare');
    await mkdir(barePath);
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json') });
    const repository = await service.initialize(1, barePath, true);

    await expect(service.getCommitContext(1, repository.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('creates and checks out a branch through the repository service and rejects a stale token', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'repository');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(1, repositoryPath, false);
    await runner.run(['config', 'user.name', 'Service Author'], { cwd: repositoryPath });
    await runner.run(['config', 'user.email', 'service@example.test'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'file.txt'), 'one\n', 'utf8');
    await runner.run(['add', '--', 'file.txt'], { cwd: repositoryPath });
    await runner.run(['commit', '--quiet', '-m', 'first'], { cwd: repositoryPath });

    const context = await service.getReferenceContext(1, repository.id);
    expect(context.branches).toHaveLength(1);
    expect(context.branches[0]).toMatchObject({ isHead: true, worktreePath: null, merged: true });

    // Only a repository this window has open can be addressed.
    await expect(service.getReferenceContext(1, `repo-${'8'.repeat(64)}`)).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_OPEN',
    });

    const applied = await service.applyReferenceAction(1, {
      id: repository.id,
      action: {
        kind: 'create-branch',
        name: 'topic',
        startPoint: { kind: 'reference', fullName: context.branches[0]!.fullName },
        checkout: true,
        tracking: 'auto',
      },
      snapshot: context.snapshot,
    });
    expect(applied).toMatchObject({ status: 'applied', kind: 'create-branch' });
    const head = await runner.run(['symbolic-ref', '--short', 'HEAD'], { cwd: repositoryPath });
    expect(head.stdout.trim()).toBe('topic');

    await expect(
      service.applyReferenceAction(1, {
        id: repository.id,
        action: { kind: 'delete-branch', fullName: 'refs/heads/topic', force: true },
        snapshot: context.snapshot,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('refuses branch and tag workflows for a bare repository', async () => {
    const directory = await fixtureDirectory();
    const barePath = join(directory, 'bare-references');
    await mkdir(barePath);
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json') });
    const repository = await service.initialize(1, barePath, true);

    await expect(service.getReferenceContext(1, repository.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
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
    await service.setTrust(1, repository.id, true);
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
    await service.setTrust(1, opened.id, true);
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
    expect(repository.workingTree).toEqual({ state: 'unavailable', changedFileCount: null });
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

  it('persists source directories and rebuilds a nested repository manager tree', async () => {
    const directory = await fixtureDirectory();
    const source = join(directory, 'source folder');
    const teamRepository = join(source, 'team', 'alpha');
    const secondTeamRepository = join(source, 'team', 'beta');
    const bareRepository = join(source, 'infra', 'mirror.git');
    const outsideRepository = join(directory, 'outside');
    await mkdir(teamRepository, { recursive: true });
    await mkdir(secondTeamRepository, { recursive: true });
    await mkdir(bareRepository, { recursive: true });
    await mkdir(outsideRepository);

    const storagePath = join(directory, 'recent.json');
    const managerStoragePath = join(directory, 'manager.json');
    const service = new RepositoryService({ storagePath, managerStoragePath });
    const alpha = await service.initialize(1, teamRepository, false);
    const beta = await service.initialize(1, secondTeamRepository, false);
    const bare = await service.initialize(1, bareRepository, true);
    await service.initialize(1, outsideRepository, false);

    if (process.platform !== 'win32') {
      await symlink(outsideRepository, join(source, 'linked-outside'), 'dir');
    }

    const firstSnapshot = await service.addSourceDirectory(1, source);
    expect(firstSnapshot.sourceDirectories).toMatchObject([
      {
        path: source,
        name: 'source folder',
        status: 'available',
        repositoryCount: 3,
        truncated: false,
      },
    ]);
    expect(firstSnapshot.repositories.map((repository) => repository.path)).toEqual(
      expect.arrayContaining([teamRepository, secondTeamRepository, bareRepository]),
    );
    expect(firstSnapshot.repositories.map((repository) => repository.path)).not.toContain(outsideRepository);
    expect(firstSnapshot.repositories.find((repository) => repository.path === alpha.path)?.sessionId).toBe(
      alpha.id,
    );
    expect(firstSnapshot.repositories.find((repository) => repository.path === bare.path)?.kind).toBe('bare');

    const teamFolder = firstSnapshot.folders.find((folder) => folder.relativePath === 'team');
    expect(teamFolder).toMatchObject({ name: 'team', parentId: null });
    expect(
      firstSnapshot.repositories
        .filter(
          (repository) => repository.path === teamRepository || repository.path === secondTeamRepository,
        )
        .every((repository) => repository.folderId === teamFolder?.id),
    ).toBe(true);
    expect(firstSnapshot.repositories.find((repository) => repository.path === beta.path)?.sessionId).toBe(
      beta.id,
    );

    const reopened = new RepositoryService({ storagePath, managerStoragePath });
    const reopenedSnapshot = await reopened.listManager(2);
    expect(reopenedSnapshot.sourceDirectories[0]).toMatchObject({ path: source, repositoryCount: 3 });
    expect(
      reopenedSnapshot.repositories.find((repository) => repository.path === alpha.path)?.sessionId,
    ).toBe(alpha.id);

    const duplicate = await reopened.addSourceDirectory(2, source);
    expect(duplicate.sourceDirectories).toHaveLength(1);
    const overlapping = await reopened.addSourceDirectory(2, join(source, 'team'));
    expect(overlapping.sourceDirectories.map((sourceDirectory) => sourceDirectory.repositoryCount)).toEqual([
      2, 1,
    ]);
    expect(overlapping.repositories).toHaveLength(3);
    await reopened.removeSourceDirectory(overlapping.sourceDirectories[0]!.id);
    const secondSource = join(directory, 'second source');
    await mkdir(secondSource);
    const twoSources = await reopened.addSourceDirectory(2, secondSource);
    expect(twoSources.sourceDirectories.map((sourceDirectory) => sourceDirectory.path)).toEqual([
      secondSource,
      source,
    ]);
    await reopened.removeSourceDirectory(twoSources.sourceDirectories[0]!.id);
    await reopened.removeSourceDirectory(twoSources.sourceDirectories[1]!.id);
    await expect(reopened.listManager(2)).resolves.toMatchObject({
      sourceDirectories: [],
      folders: [],
      repositories: [],
    });
  });

  it('reports missing roots and bounds source scans without following links', async () => {
    const directory = await fixtureDirectory();
    const source = join(directory, 'source');
    const outside = join(directory, 'outside');
    const nestedRepository = join(source, 'one', 'two', 'repository');
    await mkdir(nestedRepository, { recursive: true });
    await mkdir(outside);
    const service = new RepositoryService({
      storagePath: join(directory, 'recent.json'),
      managerStoragePath: join(directory, 'manager.json'),
      sourceScanOptions: { maxDepth: 1, maxEntries: 100 },
    });
    await service.initialize(1, nestedRepository, false);
    if (process.platform !== 'win32') await symlink(outside, join(source, 'outside-link'), 'dir');

    const limited = await service.addSourceDirectory(1, source);
    expect(limited.sourceDirectories[0]).toMatchObject({ truncated: true, repositoryCount: 0 });
    expect(limited.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'depth-limit' })]),
    );

    await rm(source, { recursive: true, force: true });
    const missing = await service.listManager(1);
    expect(missing.sourceDirectories[0]).toMatchObject({ status: 'missing', repositoryCount: 0 });
  });

  it('resolves file-manager locations only from identifiers issued to the window', async () => {
    const directory = await fixtureDirectory();
    const source = join(directory, 'source');
    const managed = join(source, 'managed');
    const closed = join(directory, 'closed');
    await mkdir(managed, { recursive: true });
    await mkdir(closed);
    const service = new RepositoryService({
      storagePath: join(directory, 'recent.json'),
      managerStoragePath: join(directory, 'manager.json'),
      workspaceStoragePath: join(directory, 'workspace.json'),
    });
    const open = await service.initialize(1, managed, false);
    const recentOnly = await service.initialize(1, closed, false);
    await service.close(1, recentOnly.id);
    const snapshot = await service.addSourceDirectory(1, source);
    const managerRepository = snapshot.repositories[0]!;
    const sourceDirectory = snapshot.sourceDirectories[0]!;

    await expect(service.resolveLocation(1, { kind: 'open', id: open.id })).resolves.toBe(managed);
    await expect(service.resolveLocation(1, { kind: 'recent', id: recentOnly.id })).resolves.toBe(closed);
    await expect(
      service.resolveLocation(1, { kind: 'manager-repository', id: managerRepository.id }),
    ).resolves.toBe(managed);
    await expect(
      service.resolveLocation(1, { kind: 'source-directory', id: sourceDirectory.id }),
    ).resolves.toBe(source);

    await expect(service.resolveLocation(1, { kind: 'open', id: recentOnly.id })).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_OPEN',
    });
    await expect(
      service.resolveLocation(2, { kind: 'manager-repository', id: managerRepository.id }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
    await expect(
      service.resolveLocation(1, { kind: 'recent', id: `repo-${'0'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
    await expect(
      service.resolveLocation(1, { kind: 'source-directory', id: `source-${'0'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'SOURCE_DIRECTORY_NOT_FOUND' });

    await rm(closed, { recursive: true, force: true });
    await expect(service.resolveLocation(1, { kind: 'recent', id: recentOnly.id })).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND',
    });
    await writeFile(closed, 'now a file\n', 'utf8');
    await expect(service.resolveLocation(1, { kind: 'recent', id: recentOnly.id })).rejects.toMatchObject({
      code: 'NOT_A_DIRECTORY',
    });
    service.disposeWindow(1);
    await expect(
      service.resolveLocation(1, { kind: 'manager-repository', id: managerRepository.id }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
  });

  it('quarantines invalid repository-manager settings', async () => {
    const directory = await fixtureDirectory();
    const managerStoragePath = join(directory, 'manager.json');
    await writeFile(managerStoragePath, '{not-json', 'utf8');
    const service = new RepositoryService({
      storagePath: join(directory, 'recent.json'),
      managerStoragePath,
    });

    await expect(service.listManager(1)).resolves.toMatchObject({
      sourceDirectories: [],
      folders: [],
      repositories: [],
    });
    await expect(readdir(directory)).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^manager\.json\.corrupt-/u)]),
    );
  });
});
