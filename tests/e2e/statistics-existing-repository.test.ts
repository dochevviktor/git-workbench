import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { statisticsFixture } from '../statistics-fixture';
import { GitRunner } from '../../src/backend/git/runner';

// Opt-in, read-only regression check. Never create fixture commits in the supplied repository.
test('statistics on an existing large repository', async () => {
  const cwd = process.env.STATISTICS_TEST_REPOSITORY;
  test.skip(!cwd, 'Set STATISTICS_TEST_REPOSITORY for the opt-in read-only check.');
  const f = await statisticsFixture();
  const git = new GitRunner();
  const state = async () =>
    Promise.all([
      git.run(['show-ref'], { cwd: cwd! }),
      git.run(['status', '--porcelain=v2'], { cwd: cwd! }),
      git.run(['ls-files', '--stage', '-z'], { cwd: cwd! }),
    ]).then((results) => results.map((result) => result.stdout));
  const before = await state();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
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
    await page.evaluate(() => window.desktop!.repository.setAutomaticFetch({ enabled: false }));
    const opened = await page.evaluate((path) => window.desktop!.repository.open({ path }), cwd!);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Statistics…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Repository Statistics', exact: true });
    await expect(dialog.getByRole('alert')).toContainText('limit', { timeout: 30000 });
    await dialog.getByLabel('From date').fill('2026-09-01');
    await dialog.getByLabel('To date').fill('2026-09-14');
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click();
    await expect(dialog.locator('.statistics-summary')).toBeVisible({ timeout: 30000 });
    const timestamps = (await git.run(['log', '--format=%at', 'HEAD'], { cwd: cwd! })).stdout
      .trim()
      .split('\n');
    const expected = timestamps.filter((timestamp) => {
      const day = new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
      return day >= '2026-09-01' && day <= '2026-09-14';
    }).length;
    await expect(dialog.locator('.statistics-summary')).toContainText(`${expected} commits`);
    await page.screenshot({ path: test.info().outputPath('statistics-existing-range.png') });
    await dialog.getByLabel('From date').fill('');
    await dialog.getByLabel('To date').fill('');
    await dialog.getByLabel('Computation limit').selectOption('2');
    await expect(dialog.getByText(/Higher limits increase/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click();
    await expect(dialog.locator('.statistics-summary')).toContainText(`${timestamps.length} commits`, {
      timeout: 60000,
    });
    await page.screenshot({ path: test.info().outputPath('statistics-existing-full.png') });
  } finally {
    await app?.close();
    expect(await state()).toEqual(before);
    await f.cleanup();
  }
});
