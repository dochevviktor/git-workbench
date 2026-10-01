import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

test('P12 workspaces own windows, tab colors and saved layouts; profile preferences propagate and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p12-ui-'));
  const repo = join(root, 'Café project');
  const profile = join(root, 'profile');
  const git = new GitRunner();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(repo);
    const run = async (...args: string[]) => (await git.run(args, { cwd: repo })).stdout.trim();
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'P12 Author');
    await run('config', 'user.email', 'p12@example.test');
    await writeFile(join(repo, 'value.ts'), 'const value = 1;\n');
    await run('add', '.');
    await run('commit', '-qm', 'First');
    await writeFile(join(repo, 'value.ts'), 'const value = 2;\n');
    await run('commit', '-qam', 'Second');
    const head = await run('rev-parse', 'HEAD');
    const config = await readFile(join(repo, '.git/config'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    const launch = () =>
      electron.launch({
        chromiumSandbox: true,
        args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
        env,
      });
    app = await launch();
    let work = await app.firstWindow();
    await expect(work.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await work.evaluate(openTrustedFixture, repo)).ok).toBe(true);
    await work.reload();
    const splitter = work.getByRole('separator', { name: 'Resize sidebar', exact: true });
    await splitter.focus();
    await splitter.press('ArrowRight');
    await expect(splitter).toHaveAttribute('aria-valuenow', '264');
    await work.getByRole('button', { name: 'Work', exact: true }).click();
    await work.getByRole('menuitem', { name: 'Save Current Layout', exact: true }).click();
    await splitter.focus();
    await splitter.press('ArrowRight');
    await work.getByRole('button', { name: 'Work', exact: true }).click();
    await work.getByRole('menuitem', { name: 'Restore Saved Layout', exact: true }).click();
    await expect(splitter).toHaveAttribute('aria-valuenow', '264');
    await work.getByRole('button', { name: 'Work', exact: true }).click();
    await work.getByRole('menuitem', { name: 'Configure Workspaces…', exact: true }).click();
    const dialog = work.getByRole('dialog', { name: 'Workspaces', exact: true });
    await dialog.getByRole('button', { name: 'New workspace', exact: true }).click();
    await dialog.getByLabel('Workspace name').fill('Home');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await dialog.getByRole('button', { name: 'Home', exact: true }).click();
    await work.screenshot({ path: 'test-results/p12-workspaces-light.png' });
    const next = app.waitForEvent('window');
    await dialog.getByRole('button', { name: 'Open in New Window', exact: true }).click();
    const home = await next;
    await expect(home.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await home.evaluate(() => window.desktop!.repository.listOpen())).ok).toBe(true);
    await expect(home.getByRole('tab', { name: /Café project/ })).toHaveCount(0);
    expect((await home.evaluate(openTrustedFixture, repo)).ok).toBe(true);
    await home.reload();
    await expect(home.getByRole('separator', { name: 'Resize sidebar', exact: true })).toHaveAttribute(
      'aria-valuenow',
      '248',
    );
    await home.getByRole('button', { name: 'Show repository list', exact: true }).click();
    await expect(home.getByRole('listbox', { name: 'Repository list', exact: true })).toBeVisible();
    await expect(work.getByRole('listbox', { name: 'Repository list', exact: true })).toHaveCount(0);
    await home.getByRole('tab', { name: /Café project/ }).click({ button: 'right' });
    await home.getByRole('menuitem', { name: 'Tab Color', exact: true }).hover();
    await home.getByRole('menuitemradio', { name: 'Blue', exact: true }).click();
    await expect(home.getByRole('tab', { name: /Café project/ })).toHaveAttribute('data-color', 'blue');
    await expect(work.getByRole('tab', { name: /Café project/ })).toHaveAttribute('data-color', 'none');
    await home.bringToFront();
    await expect(home.getByRole('menu')).toHaveCount(0);
    await home.keyboard.press('Control+,');
    const preferences = home.getByRole('dialog', { name: 'Preferences', exact: true });
    await preferences.getByLabel('Appearance').selectOption('dark');
    await preferences.getByLabel('Author avatars').selectOption('hidden');
    await preferences.getByLabel('Disable syntax highlighting').check();
    await preferences.getByLabel('Sort commits').selectOption('date');
    await home.screenshot({ path: 'test-results/p12-preferences-dark.png' });
    await expect(work.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await expect(work.locator('.app')).toHaveAttribute('data-avatars', 'hidden');
    await preferences.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await preferences.getByLabel('Quick Launch shortcut', { exact: true }).press('Control+Alt+k');
    await preferences.getByLabel('New Tab shortcut', { exact: true }).press('Control+Alt+k');
    await expect(preferences.getByRole('alert')).toContainText('already assigned');
    await home.screenshot({ path: 'test-results/p12-shortcuts-dark.png' });
    await preferences.getByRole('button', { name: 'Close', exact: true }).click();
    await home.keyboard.press('Control+Alt+k');
    await expect(home.getByRole('dialog', { name: 'Quick Launch', exact: true })).toBeVisible();
    await home.keyboard.press('Escape');
    await work.bringToFront();
    await work.keyboard.press('Control+Alt+k');
    await expect(work.getByRole('dialog', { name: 'Quick Launch', exact: true })).toBeVisible();
    await work.keyboard.press('Escape');
    // Close one main owner while the same repository remains usable in the other window.
    await work.close();
    for (let cycle = 0; cycle < 3; cycle++) {
      const opened = app.waitForEvent('window');
      expect(
        await home.evaluate(() => window.desktop!.workspace.open({ id: 'default', newWindow: true })),
      ).toMatchObject({ ok: true });
      const other = await opened;
      await expect(other.getByRole('tab', { name: /Café project/ })).toBeVisible();
      await other.reload();
      await expect(other.getByRole('separator', { name: 'Resize sidebar', exact: true })).toHaveAttribute(
        'aria-valuenow',
        '264',
      );
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
      await other.close();
      await expect
        .poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
        .toBe(1);
    }
    await home.bringToFront();
    await home.keyboard.press('Control+1');
    await home.getByTestId('commit-subject').fill('Draft retained across restart');
    await home.setViewportSize({ width: 880, height: 600 });
    await home.keyboard.press('Control+,');
    await expect(preferences).toBeVisible();
    expect(await preferences.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await home.screenshot({ path: 'test-results/p12-preferences-narrow.png' });
    await home.keyboard.press('Escape');
    await app.close();
    app = await launch();
    work = await app.firstWindow();
    await expect(work.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
    await expect(work.getByRole('tab', { name: /Café project/ })).toHaveAttribute('data-color', 'blue');
    await expect(work.getByRole('listbox', { name: 'Repository list', exact: true })).toBeVisible();
    await expect(work.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await expect(work.getByRole('tab', { name: 'Commit', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await work.keyboard.press('Control+1');
    await expect(work.getByTestId('commit-subject')).toHaveValue('Draft retained across restart');
    await work.keyboard.press('Control+Alt+k');
    await expect(work.getByRole('dialog', { name: 'Quick Launch', exact: true })).toBeVisible();
    await work.keyboard.press('Escape');
    expect(await run('rev-parse', 'HEAD')).toBe(head);
    expect(await run('status', '--porcelain')).toBe('');
    expect(await readFile(join(repo, '.git/config'))).toEqual(config);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('P12 embedded editors, default historical diff shortcut, background cancellation and reviewed Commit and Push', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p12-tools-'));
  const cwd = join(root, 'repository');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(cwd);
    const git = new GitRunner();
    const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'P12');
    await run('config', 'user.email', 'p12@example.test');
    await writeFile(join(cwd, 'value.txt'), 'one\n');
    await writeFile(join(cwd, 'other.txt'), 'other historical content\n');
    await run('add', '.');
    await run('commit', '-qm', 'First');
    await writeFile(join(cwd, 'value.txt'), 'two\n');
    await run('commit', '-qam', 'Second');
    const remote = join(root, 'remote.git');
    await run('init', '--bare', remote);
    await run('remote', 'add', 'origin', remote);
    await run('push', '-u', 'origin', 'main');
    const before = await run('rev-parse', 'HEAD');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await page.keyboard.press('Control+,');
    const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
    await preferences.getByRole('button', { name: 'Integration', exact: true }).click();
    const tools = preferences.getByRole('region', { name: 'External Tools', exact: true });
    await tools.getByLabel('Name', { exact: true }).fill('Exact Revision');
    await tools.getByLabel('Path', { exact: true }).fill(process.execPath);
    await tools
      .getByLabel('Arguments (JSON array)')
      .fill(
        JSON.stringify([
          '-e',
          "process.stdout.write(require('node:fs').readFileSync(process.argv[1],'utf8'))",
          '$LOCAL',
        ]),
      );
    await tools.getByLabel('Use as default').check();
    await tools.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tools.getByRole('button', { name: 'Exact Revision', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/p12-integration-light.png' });
    await preferences.getByRole('button', { name: 'Custom Commands', exact: true }).click();
    const commands = preferences.getByRole('region', { name: 'Custom Commands', exact: true });
    await commands.getByRole('button', { name: 'Add', exact: true }).click();
    await commands.getByLabel('Name', { exact: true }).fill('Background task');
    await commands.getByLabel('Script', { exact: true }).fill("printf 'started\\n'; sleep 30");
    await commands.getByLabel('Wait for Exit').uncheck();
    await commands.getByLabel('Always Show Output').uncheck();
    await commands.getByLabel('Enable this command').check();
    await page.screenshot({ path: 'test-results/p12-commands-light.png' });
    await commands.getByRole('button', { name: 'Save', exact: true }).click();
    await preferences.getByRole('button', { name: 'General', exact: true }).click();
    await preferences.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('history-commit').filter({ hasText: 'First' }).click();
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.locator('.commit-details').getByText('value.txt', { exact: true }).first().click();
    await page.keyboard.press('Control+d');
    const viewer = page.getByRole('dialog', { name: 'Exact Revision', exact: true });
    await viewer.getByRole('button', { name: 'Launch Tool', exact: true }).click();
    await expect(viewer.getByRole('status')).toHaveText('Command completed.');
    await expect(viewer.locator('.external-tool-output')).toContainText('one');
    await viewer.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await readFile(join(cwd, 'value.txt'), 'utf8')).toBe('two\n');
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    await page.getByTestId('revision-tree-entry').filter({ hasText: 'other.txt' }).click();
    await page.keyboard.press('Control+d');
    await expect(viewer).toContainText('other.txt');
    await viewer.getByRole('button', { name: 'Launch Tool', exact: true }).click();
    await expect(viewer.getByRole('status')).toHaveText('Command completed.');
    await expect(viewer.locator('.external-tool-output')).toContainText('other historical content');
    await viewer.getByRole('button', { name: 'Close', exact: true }).click();
    await page.keyboard.press('Control+p');
    const quick = page.getByRole('dialog', { name: 'Quick Launch', exact: true });
    await quick.getByRole('combobox').fill('Background task');
    await quick.getByRole('combobox').press('Enter');
    const command = page.getByRole('dialog', { name: 'Background task', exact: true });
    await command.getByRole('button', { name: 'Review Command', exact: true }).click();
    await command.getByRole('button', { name: 'Run Command', exact: true }).click();
    await expect(command).toHaveCount(0);
    await page.getByTestId('toolbar-workspace').click();
    await page.getByRole('menuitem', { name: 'Configure Workspaces…', exact: true }).click();
    const workspaces = page.getByRole('dialog', { name: 'Workspaces', exact: true });
    await workspaces.getByRole('button', { name: 'New workspace', exact: true }).click();
    await workspaces.getByLabel('Workspace name').fill('Later');
    await workspaces.getByRole('button', { name: 'Create', exact: true }).click();
    await workspaces.getByRole('button', { name: 'Switch Workspace', exact: true }).click();
    await expect(workspaces.getByRole('alert')).toContainText('Wait for running operations');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await workspaces.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('toolbar-activity').click();
    await page
      .getByTestId('activity')
      .getByRole('button', { name: 'Cancel Custom command', exact: true })
      .click();
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.desktop!.repository.listOperations());
        return result.ok && result.value.find((operation) => operation.kind === 'custom-command')?.status;
      })
      .toBe('cancelled');
    await page.keyboard.press('Escape');
    await writeFile(join(cwd, 'value.txt'), 'three\n');
    await run('add', '.');
    await page.reload();
    await expect(page.getByRole('button', { name: /Local Changes/ })).toBeVisible();
    await page.keyboard.press('Control+1');
    await page.getByTestId('commit-subject').fill('P12 commit');
    await expect(page.getByTestId('commit-submit')).toBeEnabled();
    await page.getByTestId('commit-subject').press('Control+Shift+Enter');
    const push = page.getByRole('dialog', { name: 'Push', exact: true });
    await expect(push).toBeVisible();
    expect(await run('rev-parse', 'HEAD')).not.toBe(before);
    expect((await git.run(['rev-parse', 'refs/heads/main'], { cwd: remote })).stdout.trim()).toBe(before);
    await push.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await git.run(['rev-parse', 'refs/heads/main'], { cwd: remote })).stdout.trim()).toBe(before);
    expect(await run('status', '--porcelain')).toBe('');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
