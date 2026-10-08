import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { launchOptions } from './launch-options';

// AppRun's disabling flag is Linux-specific. Windows creates its alternate sandbox desktop before
// application JavaScript; injecting --no-sandbox there skips setup that enableSandbox cannot redo.
const launches = process.platform === 'linux' ? ['native', 'AppImage disabling flag'] : ['native'];
for (const launch of launches)
  test(`enforces the renderer sandbox (${launch})`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'workbench-sandbox-'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    const options = launchOptions(profile, { ...env, ELECTRON_RENDERER_URL: '' });
    const app = await electron.launch({
      ...options,
      args: [...options.args!, ...(launch === 'AppImage disabling flag' ? ['--no-sandbox'] : [])],
    });
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
      const state = await app.evaluate(({ app, BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]!.webContents;
        const pid = contents.getOSProcessId();
        return {
          pid,
          disabled: app.commandLine.hasSwitch('no-sandbox'),
          enabled: app.commandLine.hasSwitch('enable-sandbox'),
          sandboxed: app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed,
        };
      });
      expect(state).toMatchObject({
        disabled: false,
        enabled: true,
      });
      if (process.platform === 'linux') {
        const status = await readFile(`/proc/${state.pid}/status`, 'utf8');
        expect(status).toMatch(/^NoNewPrivs:\s+1$/mu);
        expect(status).toMatch(/^Seccomp:\s+2$/mu);
      } else if (process.platform === 'win32') expect(state.sandboxed).toBe(true);
      expect(
        await page.evaluate(() => ['require', 'process', 'ipcRenderer'].some((key) => key in window)),
      ).toBe(false);
    } finally {
      await app.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
