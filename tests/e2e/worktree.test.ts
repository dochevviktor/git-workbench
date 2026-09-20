import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
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

test('F22 creates, opens, labels, and removes a linked worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-f22-e2e-'));
  const repository = join(root, 'repository');
  const linked = join(root, 'linked-worktree');
  const git = new GitRunner();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(repository);
    await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: repository });
    await git.run(['config', 'user.name', 'F22 Author'], { cwd: repository });
    await git.run(['config', 'user.email', 'f22@example.test'], { cwd: repository });
    await git.run(['commit', '--quiet', '--allow-empty', '-m', 'base'], { cwd: repository });
    await git.run(['branch', 'feature'], { cwd: repository });

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(async (path) => window.desktop!.repository.open({ path }), repository);
    expect(opened.ok).toBe(true);
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'feature', exact: true })).toBeVisible();

    await page.getByRole('treeitem', { name: 'feature', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: "Create Worktree from 'feature'…", exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Checkout Branch as Worktree', exact: true });
    await create.getByLabel('Location:').fill(linked);
    await create.getByTestId('reference-dialog-submit').click();
    await expect(create).toHaveCount(0);
    await expect
      .poll(async () => (await git.run(['worktree', 'list', '--porcelain'], { cwd: repository })).stdout)
      .toContain(linked);
    await expect(page.getByRole('tab', { name: /^linked-worktree,/u })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^linked-worktree,/u })).toHaveAttribute(
      'aria-label',
      /Linked worktree/u,
    );

    await page.getByRole('tab', { name: /^repository,/u }).click();
    const linkedRow = page.locator('.tree-row.worktree').filter({ hasText: 'feature' });
    await expect(linkedRow).toBeVisible();
    await linkedRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Worktree…', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Remove Worktree', exact: true });
    await remove.getByTestId('reference-dialog-submit').click();
    await expect(remove).toHaveCount(0);
    await expect
      .poll(async () => (await git.run(['worktree', 'list', '--porcelain'], { cwd: repository })).stdout)
      .not.toContain(linked);
    await expect(page.getByRole('tab', { name: /^linked-worktree,/u })).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: 'Worktrees', exact: true })).toHaveCount(0);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
