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
  it('stages new files into a two-parent stash and preserves the existing staged distinction', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, '.gitignore'), 'ignored.txt\n');
    await f.run('add', '.gitignore');
    await f.run('commit', '--quiet', '-m', 'ignore');
    const head = await f.run('rev-parse', 'HEAD');
    await writeFile(join(f.cwd, 'a.txt'), 'staged\n');
    await f.run('add', 'a.txt');
    await writeFile(join(f.cwd, 'a.txt'), 'unstaged\n');
    await writeFile(join(f.cwd, 'new.txt'), 'new file\n');
    await writeFile(join(f.cwd, 'ignored.txt'), 'ignored\n');
    expect(
      await stash(f, {
        kind: 'save',
        message: '',
        includeUntracked: false,
        stageNewFiles: true,
        paths: [],
        changesSnapshot: (await f.service.previewLocalChanges(1, f.id)).snapshot,
      }),
    ).toMatchObject({ status: 'succeeded' });
    const [entry] = await f.service.listStashes(1, f.id);
    expect((await f.run('show', '-s', '--format=%P', entry!.commitId)).split(' ')).toHaveLength(2);
    expect(await f.run('show', `${entry!.commitId}^2:new.txt`)).toBe('new file');
    expect(await f.run('show', `${entry!.commitId}^2:a.txt`)).toBe('staged');
    expect(await f.run('show', `${entry!.commitId}:a.txt`)).toBe('unstaged');
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(f.cwd, 'ignored.txt'), 'utf8')).toBe('ignored\n');
    expect(await stash(f, { kind: 'apply', stashId: entry!.commitId })).toMatchObject({
      status: 'succeeded',
    });
    expect(await f.run('show', ':a.txt')).toBe('staged');
    expect(await f.run('show', ':new.txt')).toBe('new file');
  });

  it('renames a non-top stash while preserving all saved objects and worktree contents', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'first stash\n');
    await stash(f, { kind: 'save', message: 'first', includeUntracked: false, paths: [] });
    const [first] = await f.service.listStashes(1, f.id);
    await writeFile(join(f.cwd, 'b.txt'), 'second stash\n');
    await stash(f, { kind: 'save', message: 'second', includeUntracked: false, paths: [] });
    expect(
      await stash(f, { kind: 'rename', stashId: first!.commitId, message: 'renamed café' }),
    ).toMatchObject({ status: 'succeeded' });
    expect((await f.service.listStashes(1, f.id)).map((entry) => entry.message)).toEqual([
      'renamed café',
      'second',
    ]);
    expect(await f.run('show', `${first!.commitId}:a.txt`)).toBe('first stash');
    expect(await f.run('status', '--porcelain')).toBe('');
  });

  it('retains a conflicting pop and accepts external resolution without moving HEAD', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'stash change\n');
    await stash(f, { kind: 'save', message: 'conflict', includeUntracked: false, paths: [] });
    const [entry] = await f.service.listStashes(1, f.id);
    await writeFile(join(f.cwd, 'a.txt'), 'branch change\n');
    await f.run('add', 'a.txt');
    await f.run('commit', '--quiet', '-m', 'branch');
    const head = await f.run('rev-parse', 'HEAD');
    await writeFile(join(f.cwd, 'note.txt'), 'untracked note\n');
    expect(await stash(f, { kind: 'pop', stashId: entry!.commitId })).toMatchObject({
      status: 'failed',
      failureReason: 'conflict',
    });
    expect((await f.service.getRecovery(1, f.id)).conflictedCount).toBe(1);
    expect(await f.service.listStashes(1, f.id)).toHaveLength(1);
    expect(await readFile(join(f.cwd, 'note.txt'), 'utf8')).toBe('untracked note\n');
    await writeFile(join(f.cwd, 'a.txt'), 'stash change\n');
    await f.run('add', 'a.txt');
    expect((await f.service.getRecovery(1, f.id)).conflictedCount).toBe(0);
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect(await f.service.listStashes(1, f.id)).toHaveLength(1);
  });

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
