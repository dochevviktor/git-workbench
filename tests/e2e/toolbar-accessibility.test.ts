import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { chooseCommand } from './choose-command';
import { launchOptions } from './launch-options';

test('toolbar commands retain accessible names and open settings at compact widths', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'workbench-toolbar-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    app = await electron.launch(launchOptions(profile, { ...env, ELECTRON_RENDERER_URL: '' }));
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const toolbar = page.getByRole('toolbar', { name: 'Repository commands' });
    for (const width of [1280, 1024, 780]) {
      await page.setViewportSize({ width, height: 820 });
      const quickLaunch = toolbar.getByTitle(/^Quick Launch \(/u);
      await expect(quickLaunch.locator('.toolbar-button-label')).toBeVisible({ visible: width > 1080 });
      await expect(quickLaunch).toHaveAccessibleName('Quick Launch');
      for (const label of ['Fetch', 'Pull', 'Push']) {
        const command = toolbar.getByRole('button', { name: label, exact: true });
        await expect(command).toBeVisible();
        await expect(command).toBeDisabled();
        await expect(command).toHaveAttribute('title', 'Open a repository first.');
      }
      // These commands are available before opening a repository, including in packaged native apps.
      for (const label of ['Custom Commands', 'External Tools', 'AI Integration']) {
        await chooseCommand(page, `${label}…`);
        const dialog = page.getByRole('dialog', { name: label, exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      }
    }
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
