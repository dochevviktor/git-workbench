import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { statisticsFixture } from '../statistics-fixture';

test('F35 statistics and treemap: totals, dates, selection, empty state, refresh and keyboard close', async () => {
  const f = await statisticsFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await f.populate();
    const refs = await f.run('show-ref');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
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
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate((path) => window.desktop!.repository.open({ path }), f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Statistics…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Repository Statistics', exact: true });
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(1000);
    await expect(dialog.locator('.statistics-summary')).toContainText('3 commits · 2 contributors · 2 paths');
    await expect(dialog.getByRole('table', { name: 'All contributors' })).toContainText(
      'Alice <alice@example.test>',
    );
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'light';
    });
    await page.screenshot({ path: test.info().outputPath('f35-statistics-light.png') });
    await dialog.locator('.statistics-donut').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('f35-contributors-light.png') });
    await dialog.getByRole('button', { name: 'Treemap', exact: true }).click();
    await dialog.locator('.statistics-tile').filter({ hasText: 'README.md' }).click();
    await expect(dialog.locator('aside')).toContainText('Update README');
    await expect(dialog.locator('aside')).toContainText('Initial files');
    await dialog.getByRole('button', { name: 'Authors', exact: true }).click();
    await expect(dialog.locator('aside')).toContainText('Bob <bob@example.test>');
    await page.screenshot({ path: test.info().outputPath('f35-treemap-light.png') });
    await dialog.locator('.statistics-tile').filter({ hasText: 'docs' }).click();
    await dialog.locator('.statistics-tile').filter({ hasText: 'café' }).click();
    await expect(dialog.locator('aside')).toContainText('café');
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.screenshot({ path: test.info().outputPath('f35-treemap-dark.png') });
    await dialog.getByRole('button', { name: 'Statistics', exact: true }).click();
    await dialog.getByLabel('From date').fill('2025-03-03');
    await dialog.getByLabel('To date').fill('2025-03-03');
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click();
    await expect(dialog.locator('.statistics-summary')).toContainText('1 commits · 1 contributors · 1 paths');
    await dialog.getByLabel('From date').fill('2026-01-01');
    await dialog.getByLabel('To date').fill('2026-02-01');
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click();
    await expect(dialog).toContainText('No commits in this date range.');
    await dialog.getByLabel('From date').fill('');
    await dialog.getByLabel('To date').fill('');
    await f.commit('New history', '2025-04-01T00:00:00Z');
    await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(dialog.locator('.statistics-summary')).toContainText('4 commits');
    await dialog.getByLabel('Computation limit').selectOption('2');
    await expect(dialog.getByText(/Higher limits increase/)).toContainText('20,000 commits');
    await expect(dialog.getByText(/Higher limits increase/)).toContainText('CPU and memory');
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click();
    await expect(dialog.locator('.statistics-summary')).toContainText('4 commits');
    await page.setViewportSize({ width: 760, height: 640 });
    await page.screenshot({ path: test.info().outputPath('f35-statistics-narrow-dark.png') });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(await f.run('show-ref')).not.toBe(refs); // Only the fixture's explicit new commit changed HEAD.
    expect(await f.run('rev-list', '--count', 'HEAD')).toBe('4');
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
