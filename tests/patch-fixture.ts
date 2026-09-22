import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner } from '../src/backend/git/runner';

export async function patchFixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-patch-'));
  const cwd = join(root, 'repo');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await mkdir(cwd);
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'Patch Fixture');
  await run('config', 'user.email', 'patch@example.test');
  await run('config', 'core.autocrlf', 'false');
  await run('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'change.txt'), 'before\r\n');
  await writeFile(join(cwd, 'old name.txt'), 'unchanged\n');
  await run('add', '.');
  await run('commit', '-qm', 'Baseline');
  const head = await run('rev-parse', 'HEAD');
  await writeFile(join(cwd, 'change.txt'), 'after\r\n');
  await writeFile(join(cwd, 'added café.txt'), 'new file\n');
  await run('mv', 'old name.txt', 'new name.txt');
  await run('add', '.');
  const bytes = Buffer.from(
    (await git.run(['diff', '--cached', '--binary', '--full-index'], { cwd, stdoutEncoding: 'base64' }))
      .stdout,
    'base64',
  );
  const index = await run('ls-files', '--stage');
  await run('reset', '--hard', 'HEAD');
  const path = join(root, 'mixed.patch');
  await writeFile(path, bytes);
  const snapshot = async () =>
    Promise.all([
      run('status', '--porcelain=v2'),
      run('show-ref'),
      run('reflog', '--format=%H %gs'),
      run('ls-files', '--stage'),
      run('diff', '--binary'),
      run('diff', '--cached', '--binary'),
      readFile(join(cwd, 'change.txt'), 'base64'),
    ]);
  return {
    root,
    cwd,
    git,
    run,
    bytes,
    index,
    path,
    head,
    snapshot,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
