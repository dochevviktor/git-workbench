import { openTrustedFixture } from './trusted-fixture';
import { chmod, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { patchFixture } from '../patch-fixture';

test('F36 file and clipboard patch preview, Cancel, staged apply, invalid input and export', async () => {
  const f = await patchFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    const gate = join(f.root, 'diff-gate');
    const wrapper = join(f.root, 'gated-git.ts');
    await copyFile(resolve('tests/fixtures/gated-git.ts'), wrapper);
    await chmod(wrapper, 0o700);
    env.GIT_EXECUTABLE = wrapper;
    env.GIT_WORKBENCH_REAL_GIT = (await f.git.version()).executable;
    env.GIT_WORKBENCH_TEST_GIT_GATE = gate;
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(f.root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, f.path);
    const menu = async (name: string) => {
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };
    const before = await f.snapshot();
    await menu('Apply Patch…');
    const dialog = page.getByRole('dialog', { name: 'Apply Patch', exact: true });
    await expect(dialog.getByRole('status')).toContainText('without conflicts');
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'light';
    });
    await page.screenshot({ path: test.info().outputPath('f36-preflight-light.png') });
    expect(await f.snapshot()).toEqual(before);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.snapshot()).toEqual(before);
    await menu('Apply Patch…');
    await expect(dialog.getByRole('status')).toContainText('without conflicts');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await f.run('ls-files', '--stage')).toBe(f.index);
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.run('diff')).toBe('');

    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await page
      .getByTestId('working-changes-staged')
      .getByTestId('working-change')
      .filter({ hasText: 'change.txt' })
      .click();
    const content = page.getByTestId('diff-content');
    await expect(content).toContainText('after');
    await expect(content).toHaveAttribute('aria-busy', 'false');
    const displayed = await page.evaluate(
      async (id) =>
        window.desktop!.repository.getDiff({
          id,
          target: { kind: 'working', area: 'staged', path: 'change.txt', previousPath: null },
          whitespace: 'normal',
        }),
      opened.value.id,
    );
    if (!displayed.ok) throw new Error(displayed.error.message);
    // Hold a same-target refresh while the user copies the visible patch. This deterministically
    // reproduces the old disabled-menu race without relying on a fast or slow machine.
    await writeFile(gate, JSON.stringify({ command: 'diff', argument: 'change.txt', phase: 'before' }));
    try {
      await page.keyboard.press('F5');
      await expect.poll(() => readFile(`${gate}.waiting`, 'utf8').catch(() => '')).toBe('diff:before');
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await content.click({ button: 'right' });
      const copy = page.getByRole('menuitem', { name: 'Copy as Patch', exact: true });
      await expect(copy).toBeEnabled();
      await copy.click();
      await expect
        .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(displayed.value.content);
    } finally {
      await rm(gate, { force: true });
    }
    await expect(content).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();

    await f.run('reset', '--hard', 'HEAD');
    await app.evaluate(async ({ clipboard }, content) => {
      await clipboard.writeText(content);
    }, f.bytes.toString('utf8'));
    await page.locator('.app').click({ position: { x: 550, y: 12 } });
    await page.keyboard.press('ControlOrMeta+v');
    await expect(dialog.getByRole('status')).toContainText('without conflicts');
    await expect(dialog.getByLabel('Patch location')).toHaveValue('Clipboard');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await f.run('ls-files', '--stage')).toBe(f.index);
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText('not a patch');
    });
    await menu('Apply Patch from Clipboard…');
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText(/valid patches|valid patch/i);
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.setViewportSize({ width: 760, height: 640 });
    await page.screenshot({ path: test.info().outputPath('f36-invalid-narrow-dark.png') });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await f.run('commit', '-qm', 'Mixed changes');
    await page.keyboard.press('F5');
    const row = page.getByTestId('history-commit').filter({ hasText: 'Mixed changes' });
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save as Patch…', exact: true }).click();
    const exporting = page.getByRole('dialog', { name: 'Create Patch', exact: true });
    await page.screenshot({ path: test.info().outputPath('f36-export-dark.png') });
    await exporting.getByLabel('Patch destination').selectOption('clipboard');
    await exporting.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(exporting).toHaveCount(0);
    const copied = await app.evaluate(async ({ clipboard }) => clipboard.readText());
    expect(copied).toContain('Subject: [PATCH] Mixed changes');
    expect(copied).toContain('rename from old name.txt');
    const destination = join(f.root, 'export.patch');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, destination);
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save as Patch…', exact: true }).click();
    await exporting.getByRole('button', { name: 'Save…', exact: true }).click();
    await expect(exporting).toHaveCount(0);
    expect(await readFile(destination, 'utf8')).toBe(copied);
    await writeFile(f.path, copied);
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
