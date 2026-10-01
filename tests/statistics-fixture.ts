import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner } from '../src/backend/git/runner';
import type { GitRunOptions } from '../src/backend/git/runner';

export const statisticsUnusualPath =
  process.platform === 'win32' ? 'docs/café notes.txt' : 'docs/café\nnotes.txt';

export async function statisticsFixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-statistics-'));
  const cwd = join(root, 'repo');
  const runner = new GitRunner();
  const env = { GIT_CONFIG_GLOBAL: join(root, 'global-config'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = {
    run: (args: readonly string[], options: GitRunOptions) =>
      runner.run(args, { ...options, env: { ...env, ...options.env } }),
  };
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const cleanup = () => rm(root, { recursive: true, force: true });
  await mkdir(cwd);
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'Alice');
  await run('config', 'user.email', 'alice@example.test');
  const commit = async (message: string, date: string, author = 'Alice <alice@example.test>') => {
    await run('add', '.');
    await git.run(['commit', '--allow-empty', '--no-gpg-sign', '--author', author, '-qm', message], {
      cwd,
      env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  };
  const populate = async () => {
    await mkdir(join(cwd, 'docs'));
    await writeFile(join(cwd, statisticsUnusualPath), 'one\n');
    await writeFile(join(cwd, 'README.md'), 'one\n');
    await commit('Initial files', '2025-01-31T23:30:00-02:00');
    await writeFile(join(cwd, 'README.md'), 'two\n');
    await commit('Update README', '2025-03-03T12:00:00Z', 'Bob <bob@example.test>');
    await commit('Empty commit', '2025-03-04T12:00:00Z');
  };
  return { root, cwd, git, run, commit, cleanup, populate };
}

/** Fast-import is restricted to the disposable fixture; author dates deliberately differ from commit dates. */
export async function populateLargeStatisticsFixture(f: Awaited<ReturnType<typeof statisticsFixture>>) {
  const records: string[] = [];
  for (let index = 0; index < 10005; index++) {
    const subject = `Commit ${index}`;
    const date = index === 0 || index === 10004 ? '1735689600' : '1767225600';
    records.push(
      `commit refs/heads/main\nauthor Author <author@example.test> ${date} +0000\ncommitter Committer <committer@example.test> 1704067200 +0000\ndata ${subject.length}\n${subject}\n\n`,
    );
  }
  await f.git.run(['fast-import', '--quiet'], { cwd: f.cwd, stdin: records.join(''), timeoutMs: 15000 });
}
