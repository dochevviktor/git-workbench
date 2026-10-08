import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { launchOptions } from './launch-options';

test('P14 installed package preserves sandbox, attribution, icon and private renderer boundaries', async () => {
  const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
  test.skip(!executablePath, 'Requires a built package.');
  const profile = await mkdtemp(join(tmpdir(), 'workbench-p14-package-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  const app = await electron.launch(launchOptions(profile, env));
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const packageState = await app.evaluate(({ app: application, BrowserWindow }) => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const root = application.getAppPath();
      return {
        packaged: application.isPackaged,
        pid: BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
        sandboxDisabled: application.commandLine.hasSwitch('no-sandbox'),
        notice: fs.readFileSync(path.join(root, 'out/renderer/THIRD_PARTY_NOTICES.txt'), 'utf8'),
        packages: JSON.parse(
          fs.readFileSync(path.join(root, 'out/renderer/bundled-dependencies.json'), 'utf8'),
        ),
        iconBytes: fs.statSync(path.join(process.resourcesPath, 'icon.png')).size,
        electronLicense: fs.existsSync(path.join(process.resourcesPath, 'LICENSE.electron.txt')),
        chromiumLicense: fs.existsSync(path.join(process.resourcesPath, 'LICENSES.chromium.html')),
      };
    });
    expect(packageState).toMatchObject({
      packaged: true,
      sandboxDisabled: false,
      electronLicense: true,
      chromiumLicense: true,
    });
    expect(packageState.iconBytes).toBeGreaterThan(1000);
    expect(packageState.packages.map((entry: { name: string }) => entry.name).sort()).toEqual([
      'react',
      'react-dom',
      'scheduler',
      'zod',
    ]);
    expect(packageState.notice).toContain('MIT');
    const sandboxed = await app.evaluate(
      ({ app: application }, pid) =>
        application.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed,
      packageState.pid,
    );
    if (process.platform === 'win32') expect(sandboxed).toBe(true);
    let rendererSandbox: Record<string, boolean | undefined> = { sandboxed };
    if (process.platform === 'linux') {
      const status = await readFile(`/proc/${packageState.pid}/status`, 'utf8');
      expect(status).toMatch(/^NoNewPrivs:\s+1$/mu);
      expect(status).toMatch(/^Seccomp:\s+2$/mu);
      rendererSandbox = { sandboxed, noNewPrivileges: true, seccompFilter: true };
    }
    expect(
      await page.evaluate(() => ['require', 'process', 'ipcRenderer'].some((key) => key in window)),
    ).toBe(false);
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    await writeFile(
      test.info().outputPath('package-security.json'),
      JSON.stringify(
        {
          ...packageState,
          notice: undefined,
          rendererSandbox,
        },
        null,
        2,
      ),
    );
    await test.info().attach('package-security', {
      body: JSON.stringify(
        {
          ...packageState,
          notice: undefined,
          rendererSandbox,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
