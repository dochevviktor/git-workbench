import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-history-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('repository history service', () => {
  it('reads commit metadata, merge ancestry, references, tags, and pages from Git', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'history');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({
      storagePath: join(directory, 'recent.json'),
      runner,
    });
    const repository = await service.initialize(11, repositoryPath, false);

    await runner.run(['branch', '--quiet', '-M', 'main'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'root.txt'), 'root\n', 'utf8');
    await commit(
      runner,
      repositoryPath,
      'Root subject',
      'Root body',
      'Ada',
      'ada@example.test',
      '2026-01-01',
    );

    await runner.run(['branch', 'feature'], { cwd: repositoryPath });
    await runner.run(['switch', '--quiet', 'feature'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'feature.txt'), 'feature\n', 'utf8');
    const featureCommit = await commit(
      runner,
      repositoryPath,
      'Feature subject',
      'Feature body\nwith another line',
      'Bea',
      'bea@example.test',
      '2026-01-02',
    );

    await runner.run(['switch', '--quiet', 'main'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'main.txt'), 'main\n', 'utf8');
    await commit(runner, repositoryPath, 'Main subject', '', 'Cy', 'cy@example.test', '2026-01-03');
    await runner.run(
      [
        '-c',
        'user.name=Dee',
        '-c',
        'user.email=dee@example.test',
        'merge',
        '--no-ff',
        '--quiet',
        '-m',
        'Merge feature',
        'feature',
      ],
      { cwd: repositoryPath, env: commitDates('2026-01-04') },
    );
    const mergeCommit = (await runner.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim();
    await runner.run(
      ['-c', 'user.name=Dee', '-c', 'user.email=dee@example.test', 'tag', '-a', 'v1.0', '-m', 'Release'],
      { cwd: repositoryPath, env: commitDates('2026-01-04') },
    );

    const firstPage = await service.getHistory(11, repository.id, 0, 2);
    expect(firstPage.head).toEqual({ state: 'branch', name: 'main', commit: mergeCommit });
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextOffset).toBe(2);
    expect(firstPage.tracking).toEqual({ upstream: null, ahead: null, behind: null });

    const secondPage = await service.getHistory(11, repository.id, 2, 2);
    const commits = [...firstPage.commits, ...secondPage.commits];
    const expectedLines = (
      await runner.run(['rev-list', '--all', '--topo-order'], { cwd: repositoryPath })
    ).stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    const expectedParents = new Map(
      (await runner.run(['rev-list', '--all', '--topo-order', '--parents'], { cwd: repositoryPath })).stdout
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => {
          const [id, ...parents] = line.split(/\s+/u);
          return [id, parents] as const;
        }),
    );

    expect(commits.map((commit) => commit.id)).toEqual(expectedLines);
    expect(commits.every((commit) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit.id))).toBe(true);
    for (const commit of commits) expect(commit.parents).toEqual(expectedParents.get(commit.id));
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextOffset).toBeNull();

    const feature = commits.find((commit) => commit.id === featureCommit);
    expect(feature).toMatchObject({
      subject: 'Feature subject',
      body: expect.stringContaining('Feature body\nwith another line'),
      author: {
        name: 'Bea',
        email: 'bea@example.test',
        date: expect.stringContaining('2026-01-02'),
      },
    });
    expect(firstPage.commits[0]).toMatchObject({
      id: mergeCommit,
      subject: 'Merge feature',
      parents: [expect.any(String), expect.any(String)],
      decorations: expect.arrayContaining([
        expect.objectContaining({ name: 'main', kind: 'branch', isHead: true, target: mergeCommit }),
        expect.objectContaining({ name: 'v1.0', kind: 'tag', target: mergeCommit }),
      ]),
    });
    expect(firstPage.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'main', fullName: 'refs/heads/main', kind: 'branch', isHead: true }),
        expect.objectContaining({ name: 'feature', fullName: 'refs/heads/feature', kind: 'branch' }),
        expect.objectContaining({
          name: 'v1.0',
          fullName: 'refs/tags/v1.0',
          kind: 'tag',
          target: mergeCommit,
        }),
      ]),
    );
  });

  it('returns a valid empty history for an unborn repository', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'empty');
    await mkdir(repositoryPath);
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json') });
    const repository = await service.initialize(12, repositoryPath, false);

    await expect(service.getHistory(12, repository.id, 0, 50)).resolves.toMatchObject({
      commits: [],
      hasMore: false,
      nextOffset: null,
      head: { state: 'unborn', commit: null },
    });
  });
});

async function commit(
  runner: GitRunner,
  cwd: string,
  subject: string,
  body: string,
  name: string,
  email: string,
  date: string,
): Promise<string> {
  await runner.run(['add', '--', '.'], { cwd });
  await runner.run(
    [
      '-c',
      `user.name=${name}`,
      '-c',
      `user.email=${email}`,
      'commit',
      '--quiet',
      '-m',
      subject,
      ...(body ? ['-m', body] : []),
    ],
    { cwd, env: commitDates(date) },
  );
  return (await runner.run(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}

function commitDates(date: string): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_DATE: `${date}T12:00:00+00:00`,
    GIT_COMMITTER_DATE: `${date}T12:00:00+00:00`,
  };
}
