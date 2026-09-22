import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

async function commit(git: GitRunner, cwd: string, path: string, contents: string, message: string) {
  await writeFile(join(cwd, path), contents, 'utf8');
  await git.run(['add', '--', path], { cwd });
  await git.run(['commit', '--quiet', '-m', message], { cwd });
}

async function waitForOperation(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>,
  operationId: string,
) {
  await expect
    .poll(async () => {
      const result = await page.evaluate(() => window.desktop!.repository.listOperations());
      if (!result.ok) return 'error';
      return result.value.find((operation) => operation.id === operationId)?.status ?? 'missing';
    })
    .not.toBe('running');
  const result = await page.evaluate(() => window.desktop!.repository.listOperations());
  if (!result.ok) throw new Error(result.error.message);
  const operation = result.value.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error('Git-flow operation disappeared from Activity.');
  return operation;
}

test('F25 initializes and completes feature, release, and hotfix workflows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-f25-e2e-'));
  const repository = join(root, 'repository');
  const profile = join(root, 'profile');
  const git = new GitRunner();
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(repository);
    await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: repository });
    await git.run(['config', 'user.name', 'F25 Author'], { cwd: repository });
    await git.run(['config', 'user.email', 'f25@example.test'], { cwd: repository });
    await commit(git, repository, 'README.md', 'baseline\n', 'baseline');

    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    environment.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment,
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, repository);
    expect(opened).toMatchObject({ ok: true, value: { name: 'repository' } });
    if (!opened.ok) throw new Error(opened.error.message);
    const repositoryId = opened.value.id;
    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');

    await expect
      .poll(async () => {
        const result = await page.evaluate(
          async (id) => window.desktop!.repository.getGitFlow({ id }),
          repositoryId,
        );
        return result.ok ? result.value.status : 'error';
      })
      .toBe('unconfigured');

    await page.getByRole('button', { name: 'Git-flow', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Initialize', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const start = async (type: 'feature' | 'release' | 'hotfix', name: string) => {
      const current = await page.evaluate(
        async (id) => window.desktop!.repository.getGitFlow({ id }),
        repositoryId,
      );
      if (!current.ok) throw new Error(current.error.message);
      const accepted = await page.evaluate(
        async ({ id, type, name, snapshot }) =>
          window.desktop!.repository.startGitFlowOperation({
            id,
            action: { kind: 'start', type, name, snapshot },
          }),
        { id: repositoryId, type, name, snapshot: current.value.snapshot },
      );
      expect(accepted).toMatchObject({ ok: true, value: { kind: 'git-flow', status: 'running' } });
      if (!accepted.ok) throw new Error(accepted.error.message);
      return waitForOperation(page, accepted.value.id);
    };

    const finish = async (type: 'feature' | 'release' | 'hotfix', name: string, tagMessage = '') => {
      const current = await page.evaluate(
        async (id) => window.desktop!.repository.getGitFlow({ id }),
        repositoryId,
      );
      if (!current.ok) throw new Error(current.error.message);
      const accepted = await page.evaluate(
        async ({ id, type, name, snapshot, tagMessage }) =>
          window.desktop!.repository.startGitFlowOperation({
            id,
            action: {
              kind: 'finish',
              type,
              name,
              snapshot,
              noFastForward: true,
              mergeIntoDevelop: true,
              tagMessage,
              keepBranch: false,
            },
          }),
        { id: repositoryId, type, name, snapshot: current.value.snapshot, tagMessage },
      );
      expect(accepted).toMatchObject({ ok: true, value: { kind: 'git-flow', status: 'running' } });
      if (!accepted.ok) throw new Error(accepted.error.message);
      return waitForOperation(page, accepted.value.id);
    };

    expect((await start('feature', 'settings')).status).toBe('succeeded');
    await commit(git, repository, 'settings.txt', 'feature\n', 'feature settings');
    expect((await finish('feature', 'settings')).status).toBe('succeeded');

    expect((await start('release', '1.0.0')).status).toBe('succeeded');
    await commit(git, repository, 'VERSION', '1.0.0\n', 'prepare 1.0.0');
    const release = await finish('release', '1.0.0', 'Release 1.0.0');
    expect(release).toMatchObject({
      status: 'succeeded',
      result: { kind: 'git-flow', value: { tag: 'refs/tags/1.0.0' } },
    });

    expect((await start('hotfix', '1.0.1')).status).toBe('succeeded');
    await commit(git, repository, 'fix.txt', 'hotfix\n', 'fix production issue');
    const hotfix = await finish('hotfix', '1.0.1');
    expect(hotfix).toMatchObject({
      status: 'succeeded',
      result: { kind: 'git-flow', value: { tag: 'refs/tags/1.0.1' } },
    });

    expect((await git.run(['show', 'develop:fix.txt'], { cwd: repository })).stdout).toBe('hotfix\n');
    expect((await git.run(['cat-file', '-t', 'refs/tags/1.0.0'], { cwd: repository })).stdout.trim()).toBe(
      'tag',
    );
    expect((await git.run(['cat-file', '-t', 'refs/tags/1.0.1'], { cwd: repository })).stdout.trim()).toBe(
      'tag',
    );
    expect(await readFile(join(repository, 'fix.txt'), 'utf8')).toBe('hotfix\n');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
