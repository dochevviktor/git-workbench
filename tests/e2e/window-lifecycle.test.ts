import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

const ozone = process.env.ELECTRON_TEST_OZONE_PLATFORM || 'headless';
function launchEnvironment() {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(ozone === 'headless' && ['DISPLAY', 'WAYLAND_DISPLAY'].includes(key)))
      environment[key] = value;
  }
  environment.ELECTRON_RENDERER_URL = '';
  return environment;
}

test('opens CLI and second-instance repositories without reload and restores window bounds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-launch-e2e-'));
  const profile = join(root, 'profile');
  const first = join(root, 'first');
  const second = join(root, '-second');
  const git = new GitRunner();
  await mkdir(first);
  await mkdir(second);
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: first });
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: second });
  const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
  const args = [
    ...(executablePath ? [] : ['.']),
    `--user-data-dir=${profile}`,
    `--ozone-platform=${ozone}`,
    ...(ozone === 'headless' || process.env.ELECTRON_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []),
  ];
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args: [...args, '--', first],
      env: launchEnvironment(),
    });
    let page = await application.firstWindow();
    const launch = await application.evaluate(() => ({ argv: process.argv, defaultApp: process.defaultApp }));
    await expect(
      page.getByRole('tab', { name: /first, Clean working tree/u }),
      JSON.stringify(launch),
    ).toBeVisible();
    await page.evaluate(() => {
      Object.assign(window, { launchTestMarker: 'retained' });
    });

    const secondArgs = [...args];
    if (!executablePath) secondArgs[0] = process.cwd();
    const child = spawn(application.process().spawnfile, [...secondArgs, '--', './-second'], {
      cwd: root,
      env: launchEnvironment(),
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Second instance did not exit.'));
      }, 15_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Second instance exited with ${code}.`));
      });
    });
    await expect(page.getByRole('tab', { name: /-second, Clean working tree/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await page.evaluate(() => (window as unknown as { launchTestMarker: string }).launchTestMarker),
    ).toBe('retained');
    const normalBounds = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const reported = screen.getPrimaryDisplay().workArea;
      const area =
        reported.width < 64 || reported.height < 64 ? { x: 0, y: 0, width: 1280, height: 820 } : reported;
      const bounds = {
        x: area.x,
        y: area.y,
        width: Math.min(1000, area.width),
        height: Math.min(700, area.height),
      };
      window.setBounds(bounds);
      return window.getNormalBounds();
    });
    await application.close();
    application = undefined;
    expect(JSON.parse(await readFile(join(profile, 'window-state.json'), 'utf8'))).toMatchObject({
      version: 1,
      bounds: normalBounds,
      maximized: false,
    });
    application = await electron.launch({
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args,
      env: launchEnvironment(),
    });
    page = await application.firstWindow();
    await expect(page.getByRole('tab', { name: /-second, Clean working tree/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const restoredGeometry = await application.evaluate(({ BrowserWindow, screen }) => ({
      bounds: BrowserWindow.getAllWindows()[0]!.getNormalBounds(),
      displays: screen.getAllDisplays().map((display) => display.workArea),
    }));
    expect(restoredGeometry.bounds, JSON.stringify(restoredGeometry)).toEqual(normalBounds);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
