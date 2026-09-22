import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F31 Quick Launch command, parameter, confirmation, checkout and historical file lookup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-f31-'));
  const repository = join(root, 'repository');
  const git = new GitRunner();
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(join(repository, 'docs'), { recursive: true });
    await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: repository });
    await git.run(['config', 'user.name', 'F31 Author'], { cwd: repository });
    await git.run(['config', 'user.email', 'f31@example.test'], { cwd: repository });
    await writeFile(join(repository, 'docs', 'Café 日本.md'), 'historical file\n');
    await git.run(['add', '.'], { cwd: repository });
    await git.run(['commit', '--quiet', '-m', 'baseline'], { cwd: repository });
    await git.run(['checkout', '-b', 'feature/sidebar'], { cwd: repository });
    await writeFile(join(repository, 'sidebar.txt'), 'sidebar\n');
    await git.run(['add', '.'], { cwd: repository });
    await git.run(['commit', '--quiet', '-m', 'sidebar'], { cwd: repository });
    await git.run(['tag', 'v1.0'], { cwd: repository });
    await git.run(['checkout', 'main'], { cwd: repository });
    await writeFile(join(repository, 'main.txt'), 'main work\n');
    await git.run(['add', '.'], { cwd: repository });
    await git.run(['commit', '--quiet', '-m', 'main work'], { cwd: repository });
    const before = (await git.run(['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const launch = page.getByRole('dialog', { name: 'Quick Launch', exact: true });
    const search = () => launch.getByRole('combobox');
    await page.keyboard.press('Control+p');
    await expect(launch).toBeVisible();
    await search().fill('rebase');
    await expect(launch.getByRole('option', { name: 'Rebase…', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await search().press('Enter');
    await expect(search()).toHaveValue('rebase');
    await page.keyboard.press('Escape');
    const opened = await page.evaluate(openTrustedFixture, repository);
    expect(opened.ok).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Branch', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await page.getByRole('button', { name: 'Quick Launch', exact: true }).click();
    await expect(launch).toContainText('Recent Repositories');
    await search().press('ArrowDown');
    await expect(launch.getByRole('option', { name: 'Rebase…', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await search().press('ArrowUp');
    await expect(launch.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: 'test-results/f31-commands.png' });
    await search().fill('rbse');
    await search().press('Enter');
    await expect(launch).toContainText('Branches and Tags');
    await search().fill('sidebar');
    await page.screenshot({ path: 'test-results/f31-parameters.png' });
    await search().press('Enter');
    await expect(page.getByRole('dialog', { name: 'Rebase Branch' })).toContainText('feature/sidebar');
    await page.screenshot({ path: 'test-results/f31-rebase-dialog.png' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()).toBe(before);
    expect((await git.run(['status', '--porcelain'], { cwd: repository })).stdout).toBe('');

    await page.keyboard.press('Control+p');
    await search().fill('rebase');
    await search().press('Enter');
    await search().fill('v1.0');
    await search().press('Enter');
    await expect(page.getByRole('dialog', { name: 'Rebase Branch' })).toContainText('v1.0');
    await page.getByRole('button', { name: 'Rebase', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Rebase Branch' })).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.desktop!.repository.listOperations());
        return result.ok ? result.value.find((op) => op.kind === 'rebase')?.status : 'error';
      })
      .toBe('succeeded');
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()).not.toBe(before);
    expect(
      (await git.run(['merge-base', '--is-ancestor', 'v1.0', 'HEAD'], { cwd: repository })).exitCode,
    ).toBe(0);
    expect((await git.run(['show', 'HEAD:main.txt'], { cwd: repository })).stdout).toBe('main work\n');
    expect((await git.run(['show', 'HEAD:sidebar.txt'], { cwd: repository })).stdout).toBe('sidebar\n');

    await page.keyboard.press('Control+p');
    await search().fill('checkout branch');
    await search().press('Enter');
    await search().press('Backspace');
    await expect(search()).toHaveAttribute('aria-label', 'Search commands and repositories');
    await search().fill('checkout branch');
    await search().press('Enter');
    await search().fill('sidebar');
    await search().press('Enter');
    await expect
      .poll(async () => (await git.run(['branch', '--show-current'], { cwd: repository })).stdout.trim())
      .toBe('feature/sidebar');
    await expect(page.getByRole('button', { name: 'Branch', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await page.keyboard.press('Control+p');
    await search().fill('file history');
    await search().press('Enter');
    await expect(launch.getByRole('option')).toHaveCount(2);
    await search().fill('cf日');
    const childPromise = application.waitForEvent('window');
    await search().press('Enter');
    const child = await childPromise;
    await expect(child.getByText('Café 日本.md', { exact: false }).first()).toBeVisible();
    await child.close();

    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Quick Launch', exact: true }).click();
      await search().fill('nothing-matches-xyz');
      await expect(launch).toContainText('No matches.');
      await search().press('Enter');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Quick Launch', exact: true })).toBeFocused();
    }
    await page.keyboard.press('Control+p');
    await search().fill('dark');
    await search().press('Enter');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Control+p');
    await page.screenshot({ path: 'test-results/f31-dark.png' });
    await page.mouse.click(10, 150);
    await expect(launch).toHaveCount(0);
    await page.keyboard.press('Control+p');
    await search().fill(repository);
    await search().press('Enter');
    await expect(launch).toHaveCount(0);
    const sessions = await page.evaluate(() => window.desktop!.repository.listOpen());
    expect(sessions.ok && sessions.value).toHaveLength(1);
    await page.keyboard.press('Control+p');
    await search().fill('merge');
    await search().press('Enter');
    await search().fill('main');
    await search().press('Enter');
    await expect(page.getByRole('dialog', { name: 'Merge Branch' })).toContainText('main');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Control+p');
    await search().fill('rebase');
    await search().press('Enter');
    await expect(launch).toContainText('Branches and Tags');
    // External checkout changes the snapshot. A chooser cannot silently target the new branch.
    await git.run(['checkout', 'main'], { cwd: repository });
    await expect(launch).toHaveCount(0, { timeout: 15_000 });
    expect((await git.run(['status', '--porcelain'], { cwd: repository })).stdout).toBe('');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
