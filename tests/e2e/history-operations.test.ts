import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

function environment(): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  result.ELECTRON_RENDERER_URL = '';
  return result;
}

async function open(application: ElectronApplication, cwd: string): Promise<Page> {
  const page = await application.firstWindow();
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
  expect((await page.evaluate(async (path) => window.desktop!.repository.open({ path }), cwd)).ok).toBe(true);
  await page.reload();
  await expect(page.getByTestId('history-commit').first()).toBeVisible();
  return page;
}

test('F19 reaches cherry-pick, revert, and reset through the history menu', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-history-ui-'));
  const cwd = join(root, 'work');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(cwd);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'History UI');
    await run('config', 'user.email', 'history-ui@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'base.txt'), 'base\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'Base');
    const base = await run('rev-parse', 'HEAD');
    await run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(cwd, 'feature.txt'), 'feature\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'Feature change');
    const source = await run('rev-parse', 'HEAD');
    await run('checkout', '--quiet', 'main');
    await writeFile(join(cwd, 'main.txt'), 'main\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'Main change');

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await open(application, cwd);
    const dialog = page.getByTestId('reference-dialog');
    const row = (commitId: string) => page.locator(`[data-commit-id="${commitId}"]`);

    await row(source).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Cherry-pick Commit…', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('show', '-s', '--format=%s', 'HEAD')).toBe('Feature change');
    expect(await readFile(join(cwd, 'feature.txt'), 'utf8')).toBe('feature\n');
    await page.getByTestId('toolbar-activity').click();
    await expect(page.getByTestId('activity')).toHaveCount(0);

    const picked = await run('rev-parse', 'HEAD');
    await row(picked).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Revert Commit…', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('show', '-s', '--format=%s', 'HEAD')).toContain('Revert');
    await expect.poll(() => run('status', '--porcelain')).toBe('');
    await expect(readFile(join(cwd, 'feature.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await page.getByTestId('toolbar-activity').click();
    await expect(page.getByTestId('activity')).toHaveCount(0);

    await row(base).click({ button: 'right' });
    await page.getByRole('menuitem', { name: "Reset 'main' to Here…", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('rev-parse', 'HEAD')).toBe(base);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
