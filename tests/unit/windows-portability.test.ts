import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { DirectoryWatcher } from '../../src/backend/repositories/directory-watcher';

it('repeated background status reads do not invalidate a clean checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-status-watch-'));
  const cwd = join(root, 'repo');
  const git = new GitRunner();
  let watcher: DirectoryWatcher | undefined;
  try {
    await mkdir(cwd);
    await git.run(['init', '-q', '-b', 'main'], { cwd });
    await writeFile(join(cwd, 'file.txt'), 'hello\n');
    await git.run(['add', '.'], { cwd });
    await git.run(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--no-gpg-sign',
        '-qm',
        'Initial',
      ],
      { cwd },
    );
    const events: string[] = [];
    watcher = new DirectoryWatcher(
      [
        { path: cwd, kind: 'worktree' },
        { path: join(cwd, '.git'), kind: 'git' },
      ],
      (mode) => events.push(mode),
    );
    await watcher.ready;
    // Drain events already queued by fixture creation and watch installation.
    await new Promise((resolve) => setTimeout(resolve, 400));
    events.length = 0;
    for (let index = 0; index < 4; index++) {
      expect((await git.run(['status', '--porcelain=v1'], { cwd })).stdout).toBe('');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(events).toEqual([]);
  } finally {
    watcher?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
