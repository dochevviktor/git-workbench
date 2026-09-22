import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { applyBisectAction, readBisectContext } from '../../src/backend/repositories/bisect-service';
import type { RepositoryBisectActionRequest } from '../../src/common/ipc/contracts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-bisect-'));
  roots.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'Bisect Test');
  await run('config', 'user.email', 'bisect@example.test');
  const commits: string[] = [];
  for (let index = 0; index < 9; index++) {
    await writeFile(join(cwd, 'value.txt'), `${index}\n`);
    await run('add', '.');
    await run('commit', '-qm', `Step ${index}`);
    commits.push(await run('rev-parse', 'HEAD'));
  }
  const input = { repositoryId: `repo-${'b'.repeat(64)}`, cwd, gitDir: join(cwd, '.git') };
  const read = () => readBisectContext(git, input);
  const apply = async (action: RepositoryBisectActionRequest['action']) =>
    applyBisectAction(git, input, { id: input.repositoryId, action, snapshot: (await read()).snapshot });
  return { cwd, git, input, run, commits, read, apply };
}

describe('F26 bisect', () => {
  it('keeps linked-worktree bisect state separate and restores a detached origin', async () => {
    const f = await fixture();
    const linked = join(f.cwd, '..', 'linked');
    await f.run('worktree', 'add', '--detach', linked, f.commits[8]!);
    const gitDir = (await f.git.run(['rev-parse', '--absolute-git-dir'], { cwd: linked })).stdout.trim();
    const input = { ...f.input, cwd: linked, gitDir };
    const apply = async (action: RepositoryBisectActionRequest['action']) =>
      applyBisectAction(f.git, input, {
        id: input.repositoryId,
        action,
        snapshot: (await readBisectContext(f.git, input)).snapshot,
      });
    expect(await apply('start')).toMatchObject({ original: f.commits[8], active: true });
    await apply('bad');
    expect(await f.read()).toMatchObject({ active: false, bad: null });
    await f.git.run(['checkout', '--detach', f.commits[0]!], { cwd: linked });
    await apply('good');
    await writeFile(join(linked, 'value.txt'), 'local test edit');
    await expect(apply('reset')).rejects.toThrow('local changes');
    expect(await readFile(join(linked, 'value.txt'), 'utf8')).toBe('local test edit');
    await f.git.run(['restore', 'value.txt'], { cwd: linked });
    expect(await apply('reset')).toMatchObject({ active: false, head: f.commits[8] });
    expect(await f.run('symbolic-ref', '--short', 'HEAD')).toBe('main');
  });
  it('matches P2-006-skip-subcase and restores the original branch and index', async () => {
    const f = await fixture();
    const refs = await f.run('show-ref');
    const tree = await f.run('write-tree');
    expect(await f.apply('start')).toMatchObject({ active: true, original: 'main', bad: null });
    await expect(f.apply('good')).rejects.toThrow('Mark a bad commit');
    await f.apply('bad');
    await f.run('checkout', '--detach', f.commits[0]!);
    const midpoint = await f.apply('good');
    expect(midpoint.head).toBe(f.commits[4]);
    const skipped = await f.apply('skip');
    expect(skipped.skipped).toEqual([f.commits[4]]);
    expect(skipped.head).not.toBe(midpoint.head);
    expect(await f.run('bisect', 'log')).toContain(`git bisect skip ${f.commits[4]}`);
    // Recreate the reader with a fresh runner: no application memory is needed for recovery.
    expect(await readBisectContext(new GitRunner(), f.input)).toEqual(skipped);
    expect(await f.apply('reset')).toMatchObject({ active: false, head: f.commits[8], skipped: [] });
    expect(await f.run('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await f.run('show-ref')).toBe(refs);
    expect(await f.run('write-tree')).toBe(tree);
    expect(await f.run('status', '--porcelain')).toBe('');
  });
  it('finds the known first bad commit and retains the successful outcome across restart', async () => {
    const f = await fixture();
    await f.apply('start');
    await f.apply('bad');
    await f.run('checkout', '--detach', f.commits[0]!);
    await f.apply('good');
    for (let n = 0; n < 8; n++) {
      const state = await f.read();
      if (state.firstBad) break;
      const value = Number(await readFile(join(f.cwd, 'value.txt'), 'utf8'));
      await f.apply(value >= 5 ? 'bad' : 'good');
    }
    expect(await readBisectContext(new GitRunner(), f.input)).toMatchObject({
      active: true,
      firstBad: f.commits[5],
    });
    await f.apply('reset');
  });
  it('reports ambiguous skipped candidates as an outcome', async () => {
    const f = await fixture();
    await f.apply('start');
    await f.apply('bad');
    await f.run('checkout', '--detach', f.commits[0]!);
    await f.apply('good');
    for (let n = 0; n < 10; n++) {
      if ((await f.read()).candidates.length) break;
      await f.apply('skip');
    }
    const state = await f.read();
    expect(state.firstBad).toBeNull();
    expect(state.candidates).toContain(f.commits[8]);
    expect(state.candidates.length).toBeGreaterThan(1);
    await f.apply('reset');
  });
  it('refuses stale, dirty, and pending-operation requests without changing state', async () => {
    const f = await fixture();
    const oldBranch = await f.read();
    await f.run('checkout', '-b', 'same-target');
    await expect(
      applyBisectAction(f.git, f.input, {
        id: f.input.repositoryId,
        action: 'start',
        snapshot: oldBranch.snapshot,
      }),
    ).rejects.toThrow('changed');
    await f.run('checkout', 'main');
    const before = await f.read();
    await writeFile(join(f.cwd, 'untracked.txt'), 'keep me');
    await expect(
      applyBisectAction(f.git, f.input, {
        id: f.input.repositoryId,
        action: 'start',
        snapshot: before.snapshot,
      }),
    ).rejects.toThrow('changed');
    await expect(f.apply('start')).rejects.toThrow('local changes');
    expect(await readFile(join(f.cwd, 'untracked.txt'), 'utf8')).toBe('keep me');
    await rm(join(f.cwd, 'untracked.txt'));
    await writeFile(join(f.input.gitDir, 'MERGE_HEAD'), f.commits[0]!);
    await expect(f.apply('start')).rejects.toThrow('merge');
    await rm(join(f.input.gitDir, 'MERGE_HEAD'));
    await f.apply('start');
    const controller = new AbortController();
    controller.abort();
    await expect(
      applyBisectAction(
        f.git,
        f.input,
        { id: f.input.repositoryId, action: 'bad', snapshot: (await f.read()).snapshot },
        controller.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect((await f.read()).bad).toBeNull();
    await f.apply('reset');
  });
});
