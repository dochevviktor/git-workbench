import { openTrustedFixture } from './trusted-fixture';
import { launchOptions } from './launch-options';
import { chooseCommand } from './choose-command';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F32 editor, reviewed execution, input forms, sharing, failure, cancellation and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f32-e2e-'));
  const cwd = join(root, "Café ' repository");
  const profile = join(root, 'profile');
  const sharedPath = join(root, 'shared.json');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(cwd);
    const git = new GitRunner();
    const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'F32 E2E');
    await run('config', 'user.email', 'f32@example.test');
    await writeFile(join(cwd, 'value.txt'), 'baseline\n');
    await run('add', '.');
    await run('commit', '-qm', 'Baseline');
    const before = await run('show-ref');
    const tree = await run('write-tree');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    const launch = () => electron.launch(launchOptions(profile, env));
    app = await launch();
    await app.evaluate(({ dialog, shell }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      shell.openExternal = async (url) => {
        (globalThis as unknown as { commandUrl: string }).commandUrl = url;
      };
    }, sharedPath);
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const manager = page.getByRole('dialog', { name: 'Custom Commands', exact: true });
    const openManager = async () => {
      await chooseCommand(page, 'Custom Commands…');
      await expect(manager).toBeVisible();
    };
    await openManager(); // No repository is needed to author commands.
    await manager.getByRole('button', { name: 'Add', exact: true }).click();
    await manager.getByLabel('Name', { exact: true }).fill('Read-only Status');
    await manager
      .getByLabel('Script', { exact: true })
      .fill('git status --short --branch\ngit rev-parse --short HEAD');
    await manager.getByLabel('Enable this command').check();
    await expect(manager).toBeInViewport({ ratio: 1 });
    expect((await manager.boundingBox())!.width).toBeLessThanOrEqual(1040);
    await page.screenshot({ path: 'test-results/f32-editor-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: 'test-results/f32-editor-dark.png' });
    await page.setViewportSize({ width: 780, height: 650 });
    expect(await manager.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/f32-editor-narrow.png' });
    await expect(manager).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.emulateMedia({ colorScheme: 'light' });
    await manager.getByRole('button', { name: 'Save', exact: true }).click();
    await manager.getByRole('button', { name: 'Close', exact: true }).click();
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Branch', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const openCommand = async (name: string) => {
      await chooseCommand(page, name);
    };
    await openCommand('Read-only Status');
    const output = page.getByRole('dialog', { name: 'Read-only Status', exact: true });
    await output.getByRole('button', { name: 'Review Command', exact: true }).click();
    await expect(output).toContainText(cwd);
    await output.getByRole('button', { name: 'Run Command', exact: true }).click();
    await expect(output.getByRole('status')).toHaveText('Command completed.');
    await expect(output.getByLabel('Details')).toHaveValue(/## main/u);
    await page.screenshot({ path: 'test-results/f32-output-light.png' });
    await output.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await run('show-ref')).toBe(before);
    expect(await run('write-tree')).toBe(tree);
    expect(await run('status', '--porcelain')).toBe('');
    await openManager();
    await manager.getByRole('button', { name: 'Read-only Status repository · Enabled' }).click();
    await manager.getByRole('button', { name: 'Export…' }).click();
    await expect
      .poll(async () => (await readFile(sharedPath, 'utf8')).includes('git-workbench-custom-commands'))
      .toBe(true);
    await manager.getByRole('button', { name: 'Import…' }).click();
    await expect(
      manager.getByRole('button', { name: 'Read-only Status repository · Disabled' }),
    ).toBeVisible();
    await manager.getByRole('button', { name: 'Read-only Status repository · Disabled' }).click();
    await manager.getByRole('button', { name: 'Remove', exact: true }).click();
    await manager.getByRole('button', { name: 'Keep Command' }).click();
    await manager.getByRole('button', { name: 'Remove', exact: true }).click();
    await manager.getByRole('button', { name: 'Confirm Remove' }).click();
    await expect(manager.getByRole('button', { name: 'Read-only Status repository · Disabled' })).toHaveCount(
      0,
    );
    await manager.getByRole('button', { name: 'Add', exact: true }).click();
    await manager.getByLabel('Name', { exact: true }).fill('Echo Input');
    await manager.getByLabel('Script', { exact: true }).fill('printf "%s" "$GW_INPUT_1"');
    await manager.getByRole('button', { name: 'Add Input', exact: true }).click();
    await manager.getByLabel('Input 1 label').fill('Message');
    await manager.getByLabel('Enable this command').check();
    await manager.getByRole('button', { name: 'Save', exact: true }).click();
    await manager.getByRole('button', { name: 'Close', exact: true }).click();
    await openCommand('Echo Input');
    const echo = page.getByRole('dialog', { name: 'Echo Input', exact: true });
    await echo.getByRole('button', { name: 'Review Command' }).click();
    await expect(echo.getByRole('alert')).toContainText('required');
    await echo.getByLabel('Message *', { exact: true }).fill('日本; $(touch injected)');
    await echo.getByRole('button', { name: 'Review Command' }).click();
    await expect(echo.getByRole('button', { name: 'Run Command' })).toBeEnabled();
    await page.screenshot({ path: 'test-results/f32-form-preview.png' });
    await echo.getByRole('button', { name: 'Run Command' }).click();
    await expect(echo.getByLabel('Details')).toHaveValue('日本; $(touch injected)');
    await echo.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await run('status', '--porcelain')).toBe('');
    // Exercise nonzero and cancellation with real saved definitions and the visible run dialog.
    for (const [name, script, cancel] of [
      ['Failure', 'printf failure >&2; exit 9', false],
      ['Slow command', 'sleep 30', true],
    ] as const) {
      await openManager();
      await manager.getByRole('button', { name: 'Add', exact: true }).click();
      await manager.getByLabel('Name', { exact: true }).fill(name);
      await manager.getByLabel('Script', { exact: true }).fill(script);
      await manager.getByLabel('Enable this command').check();
      await manager.getByRole('button', { name: 'Save', exact: true }).click();
      await manager.getByRole('button', { name: 'Close', exact: true }).click();
      await openCommand(name);
      const dialog = page.getByRole('dialog', { name, exact: true });
      await dialog.getByRole('button', { name: 'Review Command' }).click();
      await dialog.getByRole('button', { name: 'Run Command' }).click();
      if (cancel) {
        await dialog.getByRole('button', { name: 'Cancel Command' }).click();
        await expect(dialog.getByRole('status')).toContainText(/cancel/iu);
        await expect(dialog.getByRole('button', { name: 'Cancel Command' })).toHaveCount(0);
      } else await expect(dialog.getByRole('status')).toContainText('status 9');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await openManager();
    await manager.getByRole('button', { name: 'Add', exact: true }).click();
    await manager.getByLabel('Name', { exact: true }).fill('Open Project');
    await manager.getByLabel('Action', { exact: true }).selectOption('url');
    await manager.getByLabel('URL', { exact: true }).fill('https://example.test/?repo=${repo:name}');
    await manager.getByLabel('Enable this command').check();
    await manager.getByRole('button', { name: 'Save', exact: true }).click();
    await manager.getByRole('button', { name: 'Close', exact: true }).click();
    await openCommand('Open Project');
    const urlDialog = page.getByRole('dialog', { name: 'Open Project', exact: true });
    await urlDialog.getByRole('button', { name: 'Review Command' }).click();
    await urlDialog.getByRole('button', { name: 'Run Command' }).click();
    await expect(urlDialog.getByRole('status')).toHaveText('Opened in the system browser.');
    const openedUrl = new URL(
      await app.evaluate(() => (globalThis as unknown as { commandUrl: string }).commandUrl),
    );
    expect(openedUrl.origin).toBe('https://example.test');
    expect(openedUrl.searchParams.get('repo')).toBe("Café ' repository");
    await urlDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await openManager();
    await manager.getByRole('button', { name: 'Read-only Status repository · Enabled' }).click();
    await manager.getByLabel('Action', { exact: true }).selectOption('process');
    await manager.getByLabel('Executable', { exact: true }).fill(process.execPath);
    await manager
      .getByLabel('Arguments (JSON array)', { exact: true })
      .fill(JSON.stringify(['-e', 'process.stdout.write(process.argv[1])', '--', '${repo:path}']));
    await manager.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(manager.getByLabel('Executable', { exact: true })).toHaveCount(0);
    await manager.getByRole('button', { name: 'Close', exact: true }).click();
    await openCommand('Read-only Status');
    await output.getByRole('button', { name: 'Review Command' }).click();
    await output.getByRole('button', { name: 'Run Command' }).click();
    await expect(output.getByLabel('Details')).toHaveValue(cwd);
    await output.getByRole('button', { name: 'Close', exact: true }).click();
    await app.close();
    app = await launch();
    const restarted = await app.firstWindow();
    await expect(restarted.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const list = await restarted.evaluate(async () => window.desktop!.customCommands.list());
    expect(list.ok && list.value.map((item) => item.name)).toEqual([
      'Read-only Status',
      'Echo Input',
      'Failure',
      'Slow command',
      'Open Project',
    ]);
    const jobs = await restarted.evaluate(async () => window.desktop!.repository.listOperations());
    expect(jobs.ok && jobs.value.filter((item) => item.kind === 'custom-command')).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
