import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

test('production build loads its isolated preload and renderer', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'git-workbench-test-'));
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-repository-'));
  const fixtureRepository = join(fixtureRoot, 'sample');
  await mkdir(fixtureRepository);
  const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ['.']),
        `--user-data-dir=${profile}`,
        ...(process.env.ELECTRON_TEST_OZONE_PLATFORM
          ? [`--ozone-platform=${process.env.ELECTRON_TEST_OZONE_PLATFORM}`]
          : []),
        ...(process.env.ELECTRON_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []),
      ],
      env: { ...process.env, ELECTRON_RENDERER_URL: process.env.ELECTRON_TEST_RENDERER_URL ?? '' },
    });

    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await expect(page.getByTestId('backend-status')).toHaveText('Desktop connected');
    await expect(page.getByRole('heading', { name: 'Your repository, in perspective.' })).toBeVisible();
    const bridge = await page.evaluate(async () => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return {
        info: await window.desktop.app.getInfo(),
        requireAvailable: 'require' in window,
        ipcAvailable: 'ipcRenderer' in window,
        keys: Object.keys(window.desktop),
      };
    });
    expect(bridge.requireAvailable).toBe(false);
    expect(bridge.ipcAvailable).toBe(false);
    expect(bridge.keys).toEqual(['app', 'window', 'repository']);
    expect(bridge.info).toMatchObject({ ok: true, value: { name: 'Git Workbench' } });
    const gitInfo = await page.evaluate(async () => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.getGitInfo();
    });
    expect(gitInfo).toMatchObject({ ok: true, value: { status: 'available' } });
    await page.getByRole('button', { name: 'Working changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A clear view of your next commit.' })).toBeVisible();
    await page.getByLabel('Appearance').selectOption('dark');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.getByTestId('backend-status')).toHaveText('Desktop connected');
    const initialized = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.initialize({ path, bare: false });
    }, fixtureRepository);
    expect(initialized).toMatchObject({ ok: true, value: { path: fixtureRepository, bare: false } });
    if (!initialized.ok) throw new Error(initialized.error.message);
    await page.reload();
    await expect(page.getByTestId('backend-status')).toHaveText('Desktop connected');
    await expect(page.getByRole('heading', { name: 'sample' })).toBeVisible();
    await expect(
      page
        .getByRole('main')
        .getByText(/Unborn /u)
        .first(),
    ).toBeVisible();
    await expect(
      page.evaluate(async (id) => {
        if (!window.desktop) throw new Error('Desktop API missing');
        return window.desktop.repository.close({ id });
      }, initialized.value.id),
    ).resolves.toMatchObject({ ok: true });
    await page.screenshot({ path: 'test-results/workspace.png' });
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      await application?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
});
