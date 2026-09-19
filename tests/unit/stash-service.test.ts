import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCommandError, GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { RepositoryOperation, RepositoryStashAction } from '../../src/common/ipc/contracts';

const directories: string[] = [];
const services: RepositoryService[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-stash-'));
  directories.push(root);
  const cwd = join(root, 'repository');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => {
    try {
      return (await git.run(args, { cwd })).stdout.trim();
    } catch (error) {
      if (error instanceof GitCommandError) throw new Error(error.stderr, { cause: error });
      throw error;
    }
  };
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Stash Fixture');
  await run('config', 'user.email', 'stash@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'a.txt'), 'a base\n');
  await writeFile(join(cwd, 'b.txt'), 'b base\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'base');
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner: git });
  services.push(service);
  const repository = await service.open(1, cwd);
  return { root, cwd, git, run, service, id: repository.id };
}

async function terminal(
  service: RepositoryService,
  accepted: RepositoryOperation,
): Promise<RepositoryOperation> {
  const current = service.listOperations(1).find((operation) => operation.id === accepted.id);
  if (current && current.status !== 'running') return current;
  return new Promise((resolve) => {
    const release = service.subscribeOperations((_ownerId, operation) => {
      if (operation.id === accepted.id && operation.status !== 'running') {
        release();
        resolve(operation);
      }
    });
  });
}

async function stash(f: Awaited<ReturnType<typeof fixture>>, request: RepositoryStashAction) {
  return terminal(f.service, f.service.startStashOperation(1, { id: f.id, request }));
}

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('F15 stash workflows', () => {
  it('saves only selected files and restores staged state with apply --index', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'a staged\n');
    await f.run('add', '--', 'a.txt');
    await writeFile(join(f.cwd, 'a.txt'), 'a staged and unstaged\n');
    await writeFile(join(f.cwd, 'b.txt'), 'b remains\n');
    await writeFile(join(f.cwd, 'untracked.txt'), 'untracked remains\n');

    const preview = await f.service.previewLocalChanges(1, f.id);
    const saved = await stash(f, {
      kind: 'save',
      message: 'selected work',
      includeUntracked: false,
      paths: ['a.txt'],
      changesSnapshot: preview.snapshot,
    });
    expect(saved).toMatchObject({ status: 'succeeded', kind: 'stash' });
    expect(await readFile(join(f.cwd, 'a.txt'), 'utf8')).toBe('a base\n');
    expect(await readFile(join(f.cwd, 'b.txt'), 'utf8')).toBe('b remains\n');
    expect(await readFile(join(f.cwd, 'untracked.txt'), 'utf8')).toBe('untracked remains\n');

    const entries = await f.service.listStashes(1, f.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ message: 'selected work', includesUntracked: false });
    const history = await f.service.getHistory(1, f.id, 0, 50);
    expect(history.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'stash',
          target: entries[0]!.commitId,
          name: expect.stringContaining('selected work'),
        }),
      ]),
    );
    expect(history.commits.map((commit) => commit.id)).toContain(entries[0]!.commitId);

    // Save the remaining files so the selected stash can be applied to a clean worktree.
    expect(
      await stash(f, {
        kind: 'save',
        message: 'remaining work',
        includeUntracked: true,
        paths: [],
      }),
    ).toMatchObject({ status: 'succeeded' });
    const selected = entries[0]!;
    const applied = await stash(f, { kind: 'apply', stashId: selected.commitId });
    expect(applied).toMatchObject({ status: 'succeeded' });
    expect((await f.run('diff', '--cached', '--', 'a.txt')).trim()).toContain('+a staged');
    expect((await f.run('diff', '--', 'a.txt')).trim()).toContain('+a staged and unstaged');
    expect(await f.service.listStashes(1, f.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ commitId: selected.commitId })]),
    );
  });

  it('does not delete a stash when pop cannot apply to a dirty worktree', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'saved\n');
    const saved = await stash(f, {
      kind: 'save',
      message: 'conflicting pop',
      includeUntracked: false,
      paths: [],
    });
    expect(saved.status).toBe('succeeded');
    const [entry] = await f.service.listStashes(1, f.id);
    await writeFile(join(f.cwd, 'a.txt'), 'local\n');
    const popped = await stash(f, { kind: 'pop', stashId: entry!.commitId });
    expect(popped).toMatchObject({ status: 'failed', failureReason: 'local-changes' });
    expect(await f.service.listStashes(1, f.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ commitId: entry!.commitId })]),
    );
  });

  it('inspects and exports commit, stash, and selected working patches', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'working\n');
    const workingPatch = join(f.root, 'working.patch');
    const working = await f.service.savePatch(
      1,
      { id: f.id, target: { kind: 'working', paths: ['a.txt'], includeUntracked: true } },
      workingPatch,
    );
    expect(working).toMatchObject({ status: 'saved', path: workingPatch });
    expect(await readFile(workingPatch, 'utf8')).toContain('working');

    const saved = await stash(f, { kind: 'save', message: 'export me', includeUntracked: false, paths: [] });
    expect(saved.status).toBe('succeeded');
    const [entry] = await f.service.listStashes(1, f.id);
    const details = await f.service.getStashDetails(1, f.id, entry!.commitId);
    expect(details).toMatchObject({ state: 'text', entry: { message: 'export me' } });
    expect(details.content).toContain('working');

    const stashPatch = join(f.root, 'stash.patch');
    await f.service.savePatch(
      1,
      { id: f.id, target: { kind: 'stash', stashId: entry!.commitId } },
      stashPatch,
    );
    expect(await readFile(stashPatch, 'utf8')).toContain('working');

    await f.service.savePatch(
      1,
      { id: f.id, target: { kind: 'commit', commitId: await f.run('rev-parse', 'HEAD') } },
      join(f.root, 'commit.patch'),
    );
    expect(await readFile(join(f.root, 'commit.patch'), 'utf8')).toContain('Subject: [PATCH] base');
  });
});
