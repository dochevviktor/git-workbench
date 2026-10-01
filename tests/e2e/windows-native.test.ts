import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

test('Windows native controls, CRLF commit, profile restart and OS encryption', async () => {
  test.skip(process.platform !== 'win32', 'Exercises native Windows behavior.');
  const root = await mkdtemp(join(tmpdir(), 'workbench-windows-'));
  const cwd = join(root, 'Café repository with spaces');
  const profile = join(root, 'profile');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
  const launch = () =>
    electron.launch({
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    });
  let application: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await mkdir(cwd);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'Windows Fixture');
    await run('config', 'user.email', 'windows@example.test');
    await run('config', 'core.autocrlf', 'true');
    await writeFile(join(cwd, 'hello.txt'), 'initial\r\n');
    await run('add', '.');
    await run('commit', '--no-gpg-sign', '-qm', 'Initial Windows revision');
    application = await launch();
    let page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(await run('rev-parse', 'HEAD'));

    // Native state transitions are observed, not mocked window methods.
    await page.getByRole('button', { name: 'Maximize', exact: true }).click();
    await expect
      .poll(() =>
        application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect
      .poll(() =>
        application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
      )
      .toBe(false);
    const bounds = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const area = screen.getPrimaryDisplay().workArea;
      const target = {
        x: area.x + 20,
        y: area.y + 20,
        width: Math.min(1000, area.width - 40),
        height: Math.min(700, area.height - 40),
      };
      window.setBounds(target);
      return target;
    });
    await expect
      .poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()))
      .toEqual(bounds);
    await page.getByRole('button', { name: 'Minimize', exact: true }).click();
    await expect
      .poll(() =>
        application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()),
      )
      .toBe(true);
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.restore();
    });
    await expect
      .poll(() =>
        application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()),
      )
      .toBe(false);
    // Restore completes asynchronously on Windows; focusing a still-minimized window can be ignored.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus());
    await expect
      .poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocused()))
      .toBe(true);

    await writeFile(join(cwd, 'hello.txt'), 'initial\r\ncommitted on Windows\r\n');
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByTestId('working-changes-unstaged').getByTestId('working-change')).toHaveCount(1);
    await page.getByTestId('working-unstaged-action').click();
    await expect(page.getByTestId('working-changes-staged').getByTestId('working-change')).toHaveCount(1);
    await page.getByTestId('commit-subject').fill('Native Windows commit');
    await page.getByTestId('commit-submit').click();
    await expect.poll(() => run('log', '-1', '--format=%s')).toBe('Native Windows commit');
    expect(await run('status', '--porcelain')).toBe('');
    expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('initial\r\ncommitted on Windows\r\n');
    expect((await git.run(['show', 'HEAD:hello.txt'], { cwd })).stdout).toBe(
      'initial\ncommitted on Windows\n',
    );
    expect(
      await application.evaluate(({ safeStorage }) => {
        const value = 'synthetic Windows encryption probe';
        return (
          safeStorage.isEncryptionAvailable() &&
          safeStorage.decryptString(safeStorage.encryptString(value)) === value
        );
      }),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath('windows-native.png') });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(
      page.getByRole('tab', { name: /Café repository with spaces, Clean working tree/u }),
    ).toBeVisible();
    await expect(page.locator('.history-full-hash')).toHaveText(await run('rev-parse', 'HEAD'));
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
