import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { hasGitLfs, lfsFixture } from '../helpers/lfs-fixture';
import { openTrustedFixture } from './trusted-fixture';

test('P10 LFS management, historical download, tracking and lock ownership through the desktop', async () => {
  test.skip(!hasGitLfs(), 'Install Git LFS to exercise the real transfer fixture.');
  const f = await lfsFixture();
  f.setAnonymous(true);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(
      Object.entries(f.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(f.root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    expect(opened.ok).toBe(true);
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(f.head);
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByTestId('commit-change').filter({ hasText: 'sample.bin' }).click();
    const card = page.getByTestId('lfs-file-card');
    await expect(card).toContainText('32.0 KB (32,768 B)');
    expect(f.requests).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('p10-lfs-missing-light.png') });
    const saved = join(f.root, 'downloaded.bin');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, saved);
    await card.getByRole('button', { name: 'LFS payload options' }).click();
    await page.getByRole('menuitem', { name: 'Save As…', exact: true }).click();
    await expect(card).toContainText('Saved 32,768 bytes');
    expect(await readFile(saved)).toEqual(f.payload);
    expect(await readFile(join(f.cwd, 'sample.bin'), 'utf8')).toBe(f.pointer);
    await page.screenshot({ path: test.info().outputPath('p10-lfs-saved-light.png') });
    await page.getByRole('menuitem', { name: 'Repository', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Git LFS', exact: true }).hover();
    await page.getByRole('menuitem', { name: 'Manage Git LFS…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Git LFS', exact: true });
    await expect(dialog.getByRole('combobox', { name: 'LFS remote' })).toHaveValue('origin');
    const context = await f.service.getLfsContext(1, f.repository.id);
    const refetch = dialog.getByRole('checkbox', { name: 'Download again, replacing cached LFS objects' });
    if (context.supportsRefetch) await expect(refetch).toBeEnabled();
    else await expect(refetch).toBeDisabled();
    await dialog.getByRole('tab', { name: 'Tracking', exact: true }).click();
    await expect(dialog).toContainText('*.bin');
    await dialog.getByRole('textbox', { name: 'LFS tracking pattern' }).fill('*.psd');
    await dialog.getByRole('button', { name: 'Track pattern', exact: true }).click();
    await expect(dialog).toContainText('Tracking rules updated.');
    expect(await readFile(join(f.cwd, '.gitattributes'), 'utf8')).toContain('*.psd filter=lfs');
    await expect(dialog.getByRole('row').filter({ hasText: '*.psd' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('p10-lfs-tracking-light.png') });
    await dialog
      .getByRole('row')
      .filter({ hasText: '*.psd' })
      .getByRole('button', { name: 'Stop tracking' })
      .click();
    await expect(dialog.getByRole('row').filter({ hasText: '*.psd' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Locks', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'LFS file to lock' }).fill('sample.bin');
    await dialog.getByRole('button', { name: 'Lock file', exact: true }).click();
    await expect(dialog).toContainText('File locked.');
    await dialog.getByRole('button', { name: 'Refresh locks', exact: true }).click();
    await expect(dialog).toContainText('alice (you)');
    await expect(dialog.getByRole('button', { name: 'Refresh locks', exact: true })).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('p10-lfs-owned-light.png') });
    const lock = [...f.locks.values()][0]!;
    lock.owner.name = 'bob';
    await dialog.getByRole('button', { name: 'Refresh locks', exact: true }).click();
    await expect(dialog).toContainText('bob');
    await expect(dialog.getByRole('button', { name: 'Refresh locks', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Unlock', exact: true })).toBeDisabled();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(880, 600));
    await page.screenshot({ path: test.info().outputPath('p10-lfs-other-dark-small.png') });
    lock.owner.name = 'alice';
    await dialog.getByRole('button', { name: 'Refresh locks', exact: true }).click();
    await expect(dialog).toContainText('alice (you)');
    await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(dialog).toContainText('File unlocked.');
    expect(f.locks.size).toBe(0);
    await dialog.getByRole('tab', { name: 'Transfers', exact: true }).click();
    f.objects.clear();
    await dialog.getByRole('button', { name: 'Push LFS objects', exact: true }).click();
    await expect(dialog).toContainText('LFS objects uploaded.');
    expect(f.objects.get(f.oid)).toEqual(f.payload);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await f.git('rev-parse', 'HEAD')).toBe(f.head);
    expect(await readFile(join(f.cwd, 'sample.bin'), 'utf8')).toBe(f.pointer);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
