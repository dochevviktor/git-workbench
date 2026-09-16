import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('production build loads its isolated preload and renderer', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'git-workbench-test-'));
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-repository-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-tab-'));
  const fixtureRepository = join(fixtureRoot, 'sample');
  const secondRepository = join(secondRoot, 'second');
  await mkdir(fixtureRepository);
  await mkdir(secondRepository);
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
    await expect(page.getByText('This repository has no commits yet.')).toBeVisible();
    const fixtureGit = new GitRunner();
    await writeFile(join(fixtureRepository, 'history.txt'), 'first commit\n', 'utf8');
    await fixtureGit.run(['add', '--', 'history.txt'], { cwd: fixtureRepository });
    await fixtureGit.run(
      [
        '-c',
        'user.name=History Author',
        '-c',
        'user.email=history@example.test',
        'commit',
        '--quiet',
        '-m',
        'First history commit',
      ],
      { cwd: fixtureRepository },
    );
    await page.reload();
    await expect(page.getByTestId('history-commit')).toHaveCount(1);
    await expect(page.getByTestId('history-commit').first()).toContainText('First history commit');
    await page.getByTestId('history-commit').first().click();
    await expect(page.getByRole('heading', { name: 'First history commit' })).toBeVisible();
    await expect(page.locator('.history-full-hash')).toHaveText(/^[0-9a-f]{40}$/u);
    const secondInitialized = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.initialize({ path, bare: false });
    }, secondRepository);
    expect(secondInitialized).toMatchObject({ ok: true, value: { path: secondRepository, bare: false } });
    await page.reload();
    await expect(page.getByTestId('backend-status')).toHaveText('Desktop connected');
    await expect(page.getByRole('tab', { name: /sample, Clean working tree/u })).toBeVisible();
    await expect(page.getByRole('tab', { name: /second, Clean working tree/u })).toBeVisible();
    await writeFile(join(secondRepository, 'dirty\nfile.txt'), 'uncommitted\n', 'utf8');
    await expect(page.getByRole('tab', { name: /second, Uncommitted changes/u })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Use horizontal repository tabs' }).click();
    await expect(page.locator('.repository-tabs.horizontal')).toBeVisible();
    await page.getByRole('button', { name: 'Use vertical repository tabs' }).click();
    await expect(page.locator('.repository-tabs.vertical')).toBeVisible();
    await page.getByRole('button', { name: 'Close second' }).click();
    await expect(page.getByRole('button', { name: 'Reopen closed tab' })).toBeEnabled();
    await page.keyboard.press('Control+Shift+T');
    await expect(page.getByRole('tab', { name: /second, Uncommitted changes/u })).toBeVisible();
    const manager = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.addSourceDirectory({ path });
    }, fixtureRoot);
    expect(manager).toMatchObject({
      ok: true,
      value: {
        sourceDirectories: [{ path: fixtureRoot, repositoryCount: 1 }],
        repositories: [{ path: fixtureRepository, kind: 'worktree' }],
      },
    });
    await page.reload();
    await expect(page.getByTestId('backend-status')).toHaveText('Desktop connected');
    await expect(page.getByTestId('manager-repository').filter({ hasText: 'sample' })).toBeVisible();
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
      await rm(secondRoot, { recursive: true, force: true });
    }
  }
});
