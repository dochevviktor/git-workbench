import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { repositoryHistoryRequestSchema } from '../../src/common/ipc/contracts';

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
  it('validates search fields, scopes and object-only navigation anchors', () => {
    const base = { id: `repo-${'a'.repeat(64)}`, offset: 0, limit: 100 };
    expect(
      repositoryHistoryRequestSchema.safeParse({
        ...base,
        filter: { kind: 'commit-search', query: 'hello', field: 'author', scope: 'current-branch' },
        anchor: { kind: 'commit', commitId: 'a'.repeat(40) },
      }).success,
    ).toBe(true);
    for (const filter of [
      { kind: 'commit-search', query: 'hello', field: '--exec' },
      { kind: 'commit-search', query: 'hello', scope: '--all' },
      { kind: 'commit-search', query: 'hello\0there' },
    ])
      expect(repositoryHistoryRequestSchema.safeParse({ ...base, filter }).success).toBe(false);
    expect(
      repositoryHistoryRequestSchema.safeParse({
        ...base,
        anchor: { kind: 'commit', commitId: 'HEAD;touch file' },
      }).success,
    ).toBe(false);
    expect(repositoryHistoryRequestSchema.safeParse({ ...base, mode: 'reflog' }).success).toBe(true);
    expect(repositoryHistoryRequestSchema.safeParse({ ...base, mode: 'lost' }).success).toBe(false);
  });

  it('adds bounded reflog-only commits above the reachable graph and supports paging', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'reflog');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(18, repositoryPath, false);
    await runner.run(['branch', '--quiet', '-M', 'main'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'history.txt'), 'base\n', 'utf8');
    const baseCommit = await commit(
      runner,
      repositoryPath,
      'Reachable base',
      '',
      'Reflog Author',
      'reflog@example.test',
      '2026-02-01',
    );
    await writeFile(join(repositoryPath, 'history.txt'), 'lost\n', 'utf8');
    const lostCommit = await commit(
      runner,
      repositoryPath,
      'Lost commit',
      '',
      'Reflog Author',
      'reflog@example.test',
      '2026-02-02',
    );
    await runner.run(['reset', '--hard', baseCommit], { cwd: repositoryPath });

    const normal = await service.getHistory(18, repository.id, 0, 50);
    expect(normal.commits.map((entry) => entry.id)).toEqual([baseCommit]);

    const first = await service.getHistory(18, repository.id, 0, 1, undefined, undefined, 'reflog');
    expect(first.commits).toHaveLength(1);
    expect(first.commits[0]).toMatchObject({ id: lostCommit, subject: 'Lost commit', parents: [baseCommit] });
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(1);

    const second = await service.getHistory(18, repository.id, 1, 1, undefined, undefined, 'reflog');
    expect(second.commits.map((entry) => entry.id)).toEqual([baseCommit]);
    expect(second.hasMore).toBe(false);

    const located = await service.getHistory(
      18,
      repository.id,
      0,
      2,
      undefined,
      { kind: 'commit', commitId: lostCommit },
      'reflog',
    );
    expect(located.commits.map((entry) => entry.id)).toContain(lostCommit);
  });

  it('keeps octopus parents, reordered dates, disconnected roots and detached selection consistent with Git', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'topology');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(17, repositoryPath, false);
    const tree = (await runner.run(['mktree'], { cwd: repositoryPath, stdin: '' })).stdout.trim();
    const create = async (message: string, date: string, parents: string[] = []) =>
      (
        await runner.run(
          [
            '-c',
            'user.name=Topology',
            '-c',
            'user.email=topology@test.invalid',
            'commit-tree',
            tree,
            ...parents.flatMap((parent) => ['-p', parent]),
            '-m',
            message,
          ],
          { cwd: repositoryPath, env: commitDates(date) },
        )
      ).stdout.trim();
    const root = await create('root', '2026-01-05');
    const left = await create('left', '2026-01-02', [root]);
    const middle = await create('middle', '2026-01-03', [root]);
    const right = await create('right', '2026-01-04', [root]);
    const merge = await create('octopus', '2026-01-01', [left, middle, right]);
    const disconnected = await create('disconnected', '2026-01-06');
    await runner.run(['update-ref', 'refs/heads/main', merge], { cwd: repositoryPath });
    await runner.run(['update-ref', 'refs/heads/disconnected', disconnected], { cwd: repositoryPath });
    await runner.run(['update-ref', 'refs/tags/root-label', root], { cwd: repositoryPath });
    await runner.run(['switch', '--detach', merge], { cwd: repositoryPath });
    const expected = (
      await runner.run(['rev-list', '--all', '--topo-order', '--parents', merge], { cwd: repositoryPath })
    ).stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [id, ...parents] = line.split(' ');
        return { id, parents };
      });
    const page = await service.getHistory(17, repository.id, 0, 100);
    expect(page.commits.map(({ id, parents }) => ({ id, parents }))).toEqual(expected);
    expect(page.head).toEqual({ state: 'detached', name: null, commit: merge });
    expect(page.commits.find((entry) => entry.id === merge)?.parents).toEqual([left, middle, right]);
    const located = await service.getHistory(17, repository.id, 0, 2, undefined, {
      kind: 'commit',
      commitId: root,
    });
    expect(located.commits.map((entry) => entry.id)).toContain(root);
    const oldest = await service.getHistory(17, repository.id, 0, 2, undefined, { kind: 'oldest' });
    expect(oldest.commits.at(-1)?.id).toBe(expected.at(-1)?.id);
    expect(oldest.hasMore).toBe(false);
  });
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

    const featureHistory = await service.getHistory(11, repository.id, 0, 50, {
      kind: 'reference',
      target: featureCommit,
    });
    const expectedFeatureHistory = (
      await runner.run(['rev-list', '--topo-order', 'feature'], {
        cwd: repositoryPath,
      })
    ).stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    expect(featureHistory.commits.map((commit) => commit.id)).toEqual(expectedFeatureHistory);
    expect(featureHistory.commits.map((commit) => commit.id)).not.toContain(mergeCommit);

    const searched = await service.getHistory(11, repository.id, 0, 50, {
      kind: 'commit-search',
      query: 'Feature subject',
    });
    expect(searched.commits.map((commit) => commit.id)).toEqual([featureCommit]);

    const firstSearchPage = await service.getHistory(11, repository.id, 0, 1, {
      kind: 'commit-search',
      query: 'subject',
    });
    const secondSearchPage = await service.getHistory(11, repository.id, 1, 2, {
      kind: 'commit-search',
      query: 'subject',
    });
    expect(firstSearchPage.hasMore).toBe(true);
    expect(firstSearchPage.nextOffset).toBe(1);
    expect(
      new Set([...firstSearchPage.commits, ...secondSearchPage.commits].map((commit) => commit.subject)),
    ).toEqual(new Set(['Feature subject', 'Main subject', 'Root subject']));

    const literalSearch = await service.getHistory(11, repository.id, 0, 50, {
      kind: 'commit-search',
      query: 'Feature [subject]',
    });
    expect(literalSearch.commits).toEqual([]);
  });

  it('marks a branch whose upstream no longer exists as gone', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'stale');
    const remotePath = join(directory, 'remote.git');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(14, repositoryPath, false);
    await runner.run(['branch', '--quiet', '-M', 'main'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'file.txt'), 'one\n', 'utf8');
    await commit(runner, repositoryPath, 'Only commit', '', 'Ada', 'ada@example.test', '2026-01-01');

    // A local bare repository stands in for a remote; nothing leaves this machine.
    await runner.run(['init', '--quiet', '--bare', remotePath], { cwd: directory });
    await runner.run(['remote', 'add', 'origin', remotePath], { cwd: repositoryPath });
    await runner.run(['push', '--quiet', '--set-upstream', 'origin', 'main'], { cwd: repositoryPath });

    const tracked = await service.getHistory(14, repository.id, 0, 10);
    expect(tracked.references.find((reference) => reference.fullName === 'refs/heads/main')).toMatchObject({
      upstream: 'origin/main',
      upstreamGone: false,
    });

    await runner.run(['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: repositoryPath });
    const stale = await service.getHistory(14, repository.id, 0, 10);
    expect(stale.references.find((reference) => reference.fullName === 'refs/heads/main')).toMatchObject({
      upstream: 'origin/main',
      upstreamGone: true,
    });
  });

  it('searches literal author, changed path and diff content in repository or current-branch scope without checkout', async () => {
    const directory = await fixtureDirectory();
    const repositoryPath = join(directory, 'search');
    await mkdir(repositoryPath);
    const runner = new GitRunner();
    const service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner });
    const repository = await service.initialize(16, repositoryPath, false);
    await runner.run(['branch', '-M', 'main'], { cwd: repositoryPath });
    await mkdir(join(repositoryPath, 'docs'));
    await writeFile(join(repositoryPath, 'docs', 'literal[one].txt'), 'keep\nneedle[1]\n');
    const root = await commit(
      runner,
      repositoryPath,
      'first',
      '',
      'Ada [Team]',
      'ada@test.invalid',
      '2026-01-01',
    );
    await runner.run(['switch', '-c', 'other'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'other.txt'), 'other\n');
    const other = await commit(
      runner,
      repositoryPath,
      'sidebar other',
      '',
      'Bea',
      'bea@test.invalid',
      '2026-01-02',
    );
    await runner.run(['switch', 'main'], { cwd: repositoryPath });
    // Same count, but changed line: -S alone would miss this commit.
    await writeFile(join(repositoryPath, 'docs', 'literal[one].txt'), 'keep\nchanged needle[1]\n');
    const changed = await commit(
      runner,
      repositoryPath,
      'sidebar main',
      '',
      'Ada [Team]',
      'ada@test.invalid',
      '2026-01-03',
    );
    const search = async (
      field: 'message' | 'author' | 'path' | 'content',
      query: string,
      scope: 'repository' | 'current-branch' = 'repository',
    ) =>
      (
        await service.getHistory(16, repository.id, 0, 50, { kind: 'commit-search', query, field, scope })
      ).commits.map((entry) => entry.id);
    expect(await search('author', 'ADA [team]')).toEqual([changed, root]);
    expect(await search('path', 'LITERAL[ONE]')).toEqual([changed, root]);
    expect(await search('path', 'docs/literal[one]')).toEqual([changed, root]);
    expect(await search('path', 'literal*')).toEqual([]);
    expect(await search('content', 'needle[1]')).toEqual([changed, root]);
    expect(await search('content', 'needle.*')).toEqual([]);
    expect(new Set(await search('message', 'sidebar'))).toEqual(new Set([changed, other]));
    expect(await search('message', 'sidebar', 'current-branch')).toEqual([changed]);
    expect(
      (await runner.run(['symbolic-ref', '--short', 'HEAD'], { cwd: repositoryPath })).stdout.trim(),
    ).toBe('main');
    expect((await runner.run(['status', '--porcelain'], { cwd: repositoryPath })).stdout).toBe('');
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
