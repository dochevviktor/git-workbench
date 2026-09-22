import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F38 reviews, cancels, starts, syncs and finishes with independently checked Git history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f38-e2e-'));
  const cwd = join(root, 'repository');
  const git = new GitRunner();
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const commit = async (file: string, value: string) => {
    await writeFile(join(cwd, file), value);
    await run('add', '--', file);
    await run('commit', '-qm', value);
    return run('rev-parse', 'HEAD');
  };
  try {
    await mkdir(cwd);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'F38 Author');
    await run('config', 'user.email', 'f38@example.test');
    const initial = await commit('README.md', 'baseline');
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: { ...environment, ELECTRON_RENDERER_URL: '' },
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    const id = opened.value.id;
    await page.reload();
    const branchMenu = async () => {
      await expect(page.getByRole('button', { name: 'Branch menu', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    };
    await branchMenu();
    await expect(
      page.getByRole('menuitem', { name: "Finish (Merge into 'main')…", exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: 'test-results/f38-menu.png' });
    await page.getByRole('menuitem', { name: "Start Branch on 'main'…", exact: true }).click();
    await expect(page.getByLabel('Base branch:')).toHaveValue('main');
    await page.getByLabel('New branch:').fill('topic/ui');
    await page.screenshot({ path: 'test-results/f38-start.png' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await run('rev-parse', 'HEAD')).toBe(initial);
    expect(await run('branch', '--format=%(refname:short)')).toBe('main');
    await page.keyboard.press('Control+,');
    await page
      .getByRole('dialog', { name: 'Preferences', exact: true })
      .getByLabel('Appearance')
      .selectOption('dark');
    await page
      .getByRole('dialog', { name: 'Preferences', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await branchMenu();
    await page.getByRole('menuitem', { name: "Start Branch on 'main'…", exact: true }).click();
    await page.getByLabel('New branch:').fill('topic/ui');
    await expect(page.getByRole('button', { name: 'Start Branch', exact: true })).toBeEnabled();
    await page.screenshot({ path: 'test-results/f38-start-dark.png' });
    await run('branch', 'independent');
    await page.getByRole('button', { name: 'Start Branch', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('changed');
    expect(await run('symbolic-ref', '--short', 'HEAD')).toBe('main');
    await page.getByRole('button', { name: 'Refresh branch state', exact: true }).click();
    await page.getByRole('button', { name: 'Start Branch', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await run('symbolic-ref', '--short', 'HEAD')).toBe('topic/ui');
    await commit('topic.txt', 'topic');
    await run('checkout', '-q', 'main');
    const base = await commit('base.txt', 'base');
    await run('checkout', '-q', 'topic/ui');
    await page.reload();
    await branchMenu();
    await page.getByRole('menuitem', { name: "Sync 'topic/ui' (Rebase on 'main')…", exact: true }).click();
    await page.getByRole('button', { name: 'Sync Branch', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await run('merge-base', 'main', 'topic/ui')).toBe(base);
    const tip = await run('rev-parse', 'HEAD');
    await branchMenu();
    await page.getByRole('menuitem', { name: "Finish (Merge into 'main')…", exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('fast-forward 1 commit');
    await page.setViewportSize({ width: 780, height: 650 });
    await page.screenshot({ path: 'test-results/f38-finish-narrow.png' });
    await page.getByRole('button', { name: 'Finish Branch', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await run('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await run('rev-parse', 'main')).toBe(tip);
    expect(await run('rev-parse', 'topic/ui')).toBe(tip);
    expect(await run('status', '--porcelain')).toBe('');
    const unauthorized = await page.evaluate(() =>
      window.desktop!.repository.getLean({ id: 'repo-unknown' }),
    );
    expect(unauthorized.ok).toBe(false);
    const activities = await page.evaluate(() => window.desktop!.repository.listOperations());
    expect(
      activities.ok &&
        activities.value.filter(
          (op) => op.repositoryId === id && op.kind === 'lean-branching' && op.status === 'succeeded',
        ).length,
    ).toBe(3);
    await writeFile(join(cwd, 'README.md'), 'dirty main');
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.keyboard.press('Control+,');
    await page
      .getByRole('dialog', { name: 'Preferences', exact: true })
      .getByLabel('Appearance')
      .selectOption('light');
    await page
      .getByRole('dialog', { name: 'Preferences', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await branchMenu();
    await page.screenshot({ path: 'test-results/f38-dirty-main-menu-light.png' });
    await page.getByRole('menuitem', { name: "Start Branch on 'main'…", exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Commit or stash');
    await expect(page.getByRole('button', { name: 'Start Branch', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
