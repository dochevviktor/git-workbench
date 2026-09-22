import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { pngChunk, pngFixture } from '../helpers/image-fixture';

// eslint-disable-next-line no-empty-pattern
test('F27 image modes, alpha, fallback, historical switching and popup share a bounded read-only viewer', async ({}, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-images-e2e-'));
  const repository = join(root, 'repository');
  await mkdir(repository);
  const git = new GitRunner();
  const run = (args: string[]) => git.run(args, { cwd: repository });
  let application: ElectronApplication | undefined;
  try {
    await run(['init', '-q', '--initial-branch=main']);
    await run(['config', 'user.name', 'Image Test']);
    await run(['config', 'user.email', 'image@test.invalid']);
    await writeFile(join(repository, 'blocks.png'), pngFixture());
    await writeFile(join(repository, 'small.png'), pngFixture(60, 40));
    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 1, 2]));
    await run(['add', '.']);
    await run(['commit', '-qm', 'Original images']);
    await writeFile(join(repository, 'blocks.png'), pngFixture(160, 120, true));
    await writeFile(join(repository, 'small.png'), pngFixture(90, 40, true));
    await run(['add', '.']);
    await run(['commit', '-qm', 'Changed images']);
    await writeFile(join(repository, 'blocks.png'), pngFixture());
    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 3, 4, 5]));
    const png = pngFixture();
    await writeFile(
      join(repository, 'corrupt.png'),
      Buffer.concat([
        png.subarray(0, 33),
        pngChunk('IDAT', Buffer.from('invalid compressed data')),
        png.subarray(-12),
      ]),
    );
    const huge = Buffer.from(png);
    huge.writeUInt32BE(9000, 16);
    await writeFile(join(repository, 'large.png'), huge);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const jpeg = await application.evaluate(
      ({ nativeImage }, encoded) =>
        nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toJPEG(90).toString('base64'),
      png.toString('base64'),
    );
    await writeFile(join(repository, 'photo.jpg'), Buffer.from(jpeg, 'base64'));
    const baseline = await Promise.all([
      run(['status', '--porcelain=v2']),
      run(['ls-files', '--stage']),
      run(['show-ref']),
      run(['reflog', '--all']),
    ]);
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
    const opened = await page.evaluate(openTrustedFixture, repository);
    expect(opened.ok).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    const select = async (path: string) =>
      page
        .getByTestId('working-changes-unstaged')
        .getByTestId('working-change')
        .filter({ hasText: path })
        .click();
    await select('blocks.png');
    const viewer = page.getByTestId('image-diff-viewer');
    await expect(viewer.getByRole('img', { name: 'Old image', exact: true })).toBeVisible();
    await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Side-by-Side', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.screenshot({ path: testInfo.outputPath('f27-side-by-side-light.png') });
    const pixel = () =>
      viewer
        .locator('.image-composite-frame canvas')
        .evaluate((element) =>
          Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(40, 40, 1, 1).data),
        );
    await viewer.getByRole('button', { name: 'Swipe', exact: true }).click();
    const divider = viewer.getByRole('button', { name: 'Drag swipe divider' });
    await divider.focus();
    await page.keyboard.press('Home');
    await expect.poll(pixel).toEqual([195, 25, 90, 255]);
    await page.keyboard.press('End');
    await expect.poll(pixel).toEqual([225, 90, 70, 128]);
    const bounds = await viewer.locator('.image-composite-frame').boundingBox();
    if (!bounds) throw new Error('Missing image frame');
    await divider.hover();
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + 40);
    await page.mouse.up();
    await expect(viewer.getByRole('slider', { name: 'Divider' })).toHaveValue(/6[0-9]/u);
    await page.screenshot({ path: testInfo.outputPath('f27-swipe-light.png') });
    await viewer.getByRole('button', { name: 'Onion Skin', exact: true }).click();
    const opacity = viewer.getByRole('slider', { name: 'New image opacity' });
    await opacity.fill('0');
    await expect.poll(pixel).toEqual([225, 90, 70, 128]);
    await opacity.fill('100');
    await expect.poll(pixel).toEqual([195, 25, 90, 255]);
    await opacity.fill('50');
    await expect.poll(async () => (await pixel())[3]).toBeGreaterThan(128);
    await expect.poll(async () => (await pixel())[3]).toBeLessThan(255);
    await page.screenshot({ path: testInfo.outputPath('f27-onion-light.png') });
    await viewer.getByRole('button', { name: 'Pixel', exact: true }).click();
    await expect.poll(pixel).toEqual([235, 30, 135, 255]);
    await expect(viewer.locator('.image-pixel-summary')).toContainText('changed pixels');
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.screenshot({ path: testInfo.outputPath('f27-pixel-dark.png') });
    await page.getByRole('button', { name: 'Open diff popup', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Diff popup', exact: true });
    await expect(popup.getByRole('img', { name: 'Old image', exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'Onion Skin', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Pixel', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await select('binary.bin');
    await expect(viewer).toContainText('4 bytes (4 B)');
    await expect(viewer.getByRole('button', { name: 'Pixel', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('f27-binary-dark.png') });
    await select('corrupt.png');
    await expect(viewer.getByRole('alert')).toContainText('could not be decoded');
    await expect(viewer.getByRole('button', { name: 'Swipe', exact: true })).toBeDisabled();
    await select('large.png');
    await expect(viewer).toContainText('Preview exceeds');
    await select('photo.jpg');
    await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    await expect(viewer).toContainText('Not present');
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByTestId('commit-change').filter({ hasText: 'blocks.png' }).click();
    await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    await expect(viewer).toContainText('160 × 120 px');
    await page.getByTestId('commit-change').filter({ hasText: 'small.png' }).click();
    await expect(viewer).toContainText('90 × 40 px');
    await expect(viewer).not.toContainText('160 × 120 px');
    await viewer.getByRole('button', { name: 'Pixel', exact: true }).click();
    await expect(viewer.locator('.image-pixel-summary')).toContainText('changed pixels');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 700));
    await page.screenshot({ path: testInfo.outputPath('f27-dimensions-small-window.png') });
    expect(errors).toEqual([]);
    const after = await Promise.all([
      run(['status', '--porcelain=v2']),
      run(['ls-files', '--stage']),
      run(['show-ref']),
      run(['reflog', '--all']),
    ]);
    expect(after.map((result) => result.stdout)).toEqual(baseline.map((result) => result.stdout));
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
