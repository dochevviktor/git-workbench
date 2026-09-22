import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F34 global and repository settings: scope, cancel, stale state, presentation and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f34-e2e-'));
  const cwd = join(root, 'Café repository');
  const profile = join(root, 'profile');
  const global = join(root, 'global');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(cwd);
    await writeFile(global, '[user]\n name = Global Fixture\n email = global@example.test\n');
    const git = new GitRunner();
    const run = async (...args: string[]) =>
      (
        await git.run(args, { cwd, env: { GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' } })
      ).stdout.trimEnd();
    await run('init', '-q', '-b', 'main');
    await writeFile(join(cwd, 'value.txt'), 'base\n');
    await run('add', '.');
    await run('commit', '-qm', 'Fix #42');
    const before = await run('rev-parse', 'HEAD');
    const original = await readFile(join(cwd, '.git/config'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.GIT_CONFIG_GLOBAL = global;
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.ELECTRON_RENDERER_URL = '';
    const launch = () =>
      electron.launch({
        chromiumSandbox: true,
        args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
        env,
      });
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await page.keyboard.press('Control+,');
    const preferences = () => page.getByRole('dialog', { name: 'Preferences', exact: true });
    await expect(preferences()).toBeVisible();
    await preferences().getByLabel('Diff font size').selectOption('16');
    await preferences().getByLabel('Show −/+ marks').uncheck();
    await preferences().getByRole('button', { name: 'Commit', exact: true }).click();
    await preferences().getByLabel('Subject length guide').selectOption('72');
    await preferences().getByLabel('Check commit message spelling').uncheck();
    await preferences().getByRole('button', { name: 'General', exact: true }).click();
    await preferences().getByLabel('Appearance').selectOption('dark');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/f34-general-dark.png' });
    await preferences().getByLabel('Appearance').selectOption('light');
    await preferences().getByRole('button', { name: 'Git', exact: true }).click();
    await expect(preferences().getByLabel('User name', { exact: true })).toHaveValue('Global Fixture');
    const executable = (await git.version()).executable;
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, executable);
    await preferences().getByRole('button', { name: 'Choose Git…', exact: true }).click();
    await preferences().getByRole('button', { name: 'Save Git instance', exact: true }).click();
    await expect(preferences().getByRole('status')).toContainText('Restart');
    await preferences().getByLabel('User name', { exact: true }).fill('Global Changed');
    await preferences().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(preferences()).not.toBeVisible();
    expect(await run('config', '--global', 'user.name')).toBe('Global Changed');
    await page.evaluate(async (path) => {
      const result = await window.desktop!.repository.open({ path });
      if (result.ok) await window.desktop!.repository.setTrust({ id: result.value.id, trusted: true });
      if (!result.ok) throw new Error(result.error.message);
    }, cwd);
    await page.reload();
    const gear = () => page.getByRole('button', { name: 'Repository settings', exact: true });
    await expect(gear()).toBeVisible();
    await gear().click();
    const settings = () => page.getByRole('dialog', { name: 'Repository Settings', exact: true });
    await expect(settings().getByText('Global Changed', { exact: false }).first()).toBeVisible();
    await settings().getByLabel('User name', { exact: true }).fill('Canceled');
    await settings().getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(gear()).toBeFocused();
    expect(await readFile(join(cwd, '.git/config'))).toEqual(original);
    await gear().click();
    await settings().getByLabel('User name', { exact: true }).fill('Local Author');
    await settings().getByLabel('Email', { exact: true }).fill('bad email');
    await expect(settings().getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await settings().getByLabel('Email', { exact: true }).fill('local@example.test');
    await settings().getByLabel('Issue URL', { exact: true }).fill('https://example.test/issues/{id}');
    await page.screenshot({ path: 'test-results/f34-repository-light.png' });
    await page.setViewportSize({ width: 780, height: 650 });
    expect(await settings().evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/f34-repository-narrow.png' });
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings()).not.toBeVisible();
    expect(await run('var', 'GIT_AUTHOR_IDENT')).toContain('Local Author <local@example.test>');
    await gear().click();
    await settings().getByLabel('User name', { exact: true }).fill('Stale');
    await run('config', 'alias.external', 'status');
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings().getByRole('alert')).toContainText('changed outside');
    await settings().getByRole('button', { name: 'Reload settings (discard edits)', exact: true }).click();
    await expect(settings().getByLabel('User name', { exact: true })).toHaveValue('Local Author');
    await settings().getByRole('button', { name: 'Remove identity overrides', exact: true }).click();
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings()).not.toBeVisible();
    expect(await run('config', 'user.name')).toBe('Global Changed');
    expect(await run('config', 'alias.external')).toBe('status');
    expect(await run('rev-parse', 'HEAD')).toBe(before);
    const opened: string[] = [];
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        (globalThis as typeof globalThis & { opened: string[] }).opened = [url];
      };
    });
    await page.getByRole('button', { name: '#42 ↗', exact: true }).click();
    await expect
      .poll(() => app!.evaluate(() => (globalThis as typeof globalThis & { opened?: string[] }).opened))
      .toEqual(['https://example.test/issues/42']);
    opened.push(
      ...(await app.evaluate(() => (globalThis as typeof globalThis & { opened: string[] }).opened)),
    );
    expect(opened).toEqual(['https://example.test/issues/42']);
    const inspectorReady = app.waitForEvent('window');
    await page.evaluate(async (commitId) => {
      const repositories = await window.desktop!.repository.listOpen();
      if (!repositories.ok || !repositories.value[0]) throw new Error('Missing fixture repository');
      const result = await window.desktop!.repository.openCommitDetails({
        id: repositories.value[0].id,
        commitId,
        tab: 'commit',
        theme: 'light',
      });
      if (!result.ok) throw new Error(result.error.message);
    }, before);
    const inspector = await inspectorReady;
    await expect(inspector.getByRole('button', { name: '#42 ↗', exact: true })).toBeVisible();
    const denied = await inspector.evaluate(() => window.desktop!.settings.getGit({ id: null }));
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await page.bringToFront();
    await page.keyboard.press('Control+,');
    await preferences().getByLabel('Appearance').selectOption('dark');
    await expect(inspector.locator('html')).toHaveAttribute('data-theme', 'dark');
    await preferences().getByLabel('Appearance').selectOption('light');
    await preferences().getByRole('button', { name: 'Close', exact: true }).click();
    await gear().click();
    await settings().getByLabel('Issue URL', { exact: true }).fill('https://example.test/tickets/{id}');
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(inspector.getByRole('button', { name: '#42 ↗', exact: true })).toHaveAttribute(
      'title',
      'https://example.test/tickets/42',
    );
    await inspector.close();
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await expect(page.getByTestId('diff-content')).toBeVisible();
    await expect(page.getByTestId('diff-content')).toHaveCSS('font-size', '16px');
    await expect(page.locator('.diff-line-sign').first()).toHaveCSS('visibility', 'hidden');
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByTestId('commit-subject')).toHaveAttribute('spellcheck', 'false');
    await expect(page.getByLabel('72 characters left in the 72-character subject guide')).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(gear()).toBeVisible();
    await page.keyboard.press('Control+,');
    await expect(preferences().getByLabel('Diff font size')).toHaveValue('16');
    await preferences().getByRole('button', { name: 'Git', exact: true }).click();
    await expect(preferences().getByLabel('User name', { exact: true })).toHaveValue('Global Changed');
    await expect(preferences().getByText(`Next launch: ${executable}`, { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/f34-git-light.png' });
    await page.keyboard.press('Escape');
    await gear().click();
    await expect(settings().getByLabel('Issue URL', { exact: true })).toHaveValue(
      'https://example.test/tickets/{id}',
    );
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
