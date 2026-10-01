import { processState } from '../platform';
import { access, readFile, copyFile, chmod, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { operationFixture } from '../operation-fixture';
import { openTrustedFixture } from './trusted-fixture';

test('P01 repeated quit drains a running Git hook before exiting', async () => {
  const f = await operationFixture();
  let app: ElectronApplication | undefined;
  try {
    const marker = join(f.root, 'hook-pid');
    const hook = join(f.cwd, '.git', 'hooks', 'pre-commit');
    await copyFile(resolve('tests/fixtures/operation-process.ts'), hook);
    await chmod(hook, 0o700);
    await writeFile(join(f.cwd, 'pending.txt'), 'pending\n');
    await f.run('add', '--', 'pending.txt');
    const before = await f.run('rev-parse', 'HEAD');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    env.GIT_WORKBENCH_FIXTURE_WAIT_MARKER = marker;
    app = await electron.launch({
      chromiumSandbox: true,
      args: [
        '.',
        `--user-data-dir=${join(f.root, 'quit-profile')}`,
        '--ozone-platform=headless',
        '--disable-gpu',
      ],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    const accepted = await page.evaluate(async (id) => {
      const context = await window.desktop!.repository.getCommitContext({ id });
      if (!context.ok) throw new Error(context.error.message);
      return window.desktop!.repository.commit({
        id,
        snapshot: context.value.snapshot,
        subject: 'Interrupted fixture',
        body: '',
        amend: false,
        skipHooks: false,
      });
    }, opened.value.id);
    expect(accepted).toMatchObject({ ok: true, value: { status: 'running' } });
    await expect
      .poll(() =>
        access(marker).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    const pid = Number(await readFile(marker, 'utf8'));
    const exited = new Promise<void>((resolve) => app!.process().once('exit', () => resolve()));
    await app.evaluate(({ app }) => {
      app.quit();
      app.quit();
    });
    await exited;
    app = undefined;
    await expect.poll(() => processState(pid)).toMatch(/^(?:Z|gone)$/u);
    expect(await f.run('rev-parse', 'HEAD')).toBe(before);
    expect(await f.run('diff', '--cached', '--name-only')).toBe('pending.txt');
  } finally {
    await app?.close();
    await f.cleanup();
  }
});

test('P01 trust, queryable cancellation and Fork Activity layout', async () => {
  const f = await operationFixture();
  let app: ElectronApplication | undefined;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  const launch = () =>
    electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(f.root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate((path) => window.desktop!.repository.open({ path }), f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    const id = opened.value.id;
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    await page.getByRole('button', { name: 'Trust Repository…', exact: true }).click();
    const trust = page.getByRole('dialog', { name: 'Trust Repository', exact: true });
    await expect(trust).toContainText('Git hooks, filters, credential helpers');
    await page.screenshot({ path: 'test-results/p01-trust-light.png' });
    await trust.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(
      await page.evaluate(
        (id) =>
          window.desktop!.repository.getWorkingChanges({ id, includeUntracked: true, includeIgnored: false }),
        id,
      ),
    ).toMatchObject({ ok: false, error: { code: 'REPOSITORY_UNTRUSTED' } });
    await page.getByRole('button', { name: 'Trust Repository…', exact: true }).click();
    await trust.getByRole('button', { name: 'Trust Repository', exact: true }).click();
    await expect(page.getByTestId('repository-trust')).toHaveCount(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    await expect(page.getByTestId('repository-trust')).toHaveCount(0);
    const marker = join(f.root, 'running');
    const accepted = await page.evaluate(
      async ({ id, executable, script, marker }) => {
        const saved = await window.desktop!.customCommands.save({
          definition: {
            name: 'P01 cancellable operation',
            target: 'repository',
            action: { kind: 'process', executable, args: [script, 'wait', marker] },
            fields: [],
          },
          enabled: true,
        });
        if (!saved.ok) throw new Error(saved.error.message);
        const preview = await window.desktop!.customCommands.preview({
          commandId: saved.value[0]!.id,
          context: { repositoryId: id, target: 'repository', value: '' },
          inputs: [],
        });
        if (!preview.ok) throw new Error(preview.error.message);
        return window.desktop!.customCommands.run({ token: preview.value.token });
      },
      { id, executable: process.execPath, script: resolve('tests/fixtures/operation-process.ts'), marker },
    );
    if (!accepted.ok) throw new Error(accepted.error.message);
    await expect
      .poll(() =>
        access(marker).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await page.getByTestId('toolbar-activity').click();
    const activity = page.getByTestId('activity');
    await expect(activity).toBeVisible();
    await expect(page.getByTestId('activity-output')).toContainText('Waiting for cancellation.');
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.screenshot({ path: 'test-results/p01-activity-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: 'test-results/p01-activity-dark.png' });
    await page.getByRole('tab', { name: 'All', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'User', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowRight');
    await expect(activity).toContainText('No automatic fetches');
    await page.getByRole('tab', { name: 'All', exact: true }).click();
    await page.setViewportSize({ width: 880, height: 600 });
    // Native Windows resizing can still be delivering layout frames when the CDP call returns.
    await expect(async () => {
      const bounds = await activity.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(880);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
    }).toPass({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/p01-activity-narrow.png' });
    await page.keyboard.press('Escape');
    await expect(activity).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    const running = await page.evaluate(() => window.desktop!.repository.listOperations());
    expect(running).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ id: accepted.value.id, status: 'running' })],
    });
    await page.getByTestId('toolbar-activity').click();
    await activity.getByRole('button', { name: 'Cancel Custom command', exact: true }).click();
    await expect(activity).toContainText('Cancelling');
    await expect(activity.getByTestId('activity-row')).toContainText('Cancelled');
    const pid = Number(await readFile(marker, 'utf8'));
    await expect.poll(() => processState(pid)).toMatch(/^(?:Z|gone)$/u);
    await page.screenshot({ path: 'test-results/p01-activity-cancelled.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Repository settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Repository Settings', exact: true });
    await settings.getByRole('button', { name: 'Revoke Trust', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Trust Repository…', exact: true })).toBeVisible();
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
