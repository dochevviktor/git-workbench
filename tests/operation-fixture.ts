import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitRunner } from '../src/backend/git/runner';

/** P01 shared fixture family: unusual paths, a merge, bare remote and a linked worktree. */
export async function operationFixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p01-'));
  const cwd = join(root, '-space café\nrepository');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Operation Fixture');
  await run('config', 'user.email', 'operations@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, '-file café\n.txt'), 'base\n');
  await run('add', '--', '-file café\n.txt');
  await run('commit', '--quiet', '-m', 'base');
  await run('checkout', '--quiet', '-b', 'topic');
  await writeFile(join(cwd, 'topic.txt'), 'topic\n');
  await run('add', '--', 'topic.txt');
  await run('commit', '--quiet', '-m', 'topic');
  await run('checkout', '--quiet', 'main');
  await run('merge', '--quiet', '--no-ff', '-m', 'merge', 'topic');
  const bare = join(root, 'remote.git');
  await run('init', '--quiet', '--bare', '--initial-branch=main', bare);
  await run('remote', 'add', 'origin', bare);
  await run('push', '--quiet', '--set-upstream', 'origin', 'main');
  const linked = join(root, 'linked');
  await run('worktree', 'add', '--quiet', '-b', 'linked', linked);
  return { root, cwd, bare, linked, git, run, cleanup: () => rm(root, { recursive: true, force: true }) };
}
