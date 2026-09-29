import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { bmpFixture, gifFixture, pngFixture, svgFixture, tgaFixture } from '../helpers/image-fixture';
import { openTrustedFixture } from './trusted-fixture';
import { lfsPointer } from '../helpers/lfs-fixture';

test('P10 sandboxed formats, SVG source, zoom and inert failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p10-formats-'));
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = (args: string[]) => git.run(args, { cwd });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await run(['init', '-q', '-b', 'main']);
    await run(['config', 'user.name', 'Images']);
    await run(['config', 'user.email', 'image@example.invalid']);
    await writeFile(join(cwd, 'shape.svg'), svgFixture());
    const cachedImage = async (bytes: Buffer) => {
      const oid = createHash('sha256').update(bytes).digest('hex');
      const directory = join(cwd, '.git/lfs/objects', oid.slice(0, 2), oid.slice(2, 4));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, oid), bytes);
      await writeFile(join(cwd, 'cached.png'), lfsPointer(bytes));
    };
    await cachedImage(pngFixture());
    await run(['add', '.']);
    await run(['commit', '-qm', 'SVG original']);
    await cachedImage(pngFixture(160, 120, true));
    await run(['add', 'cached.png']);
    await run(['commit', '-qm', 'Cached LFS images']);
    await writeFile(join(cwd, 'shape.svg'), svgFixture('#ee4433'));
    await writeFile(join(cwd, 'bitmap.bmp'), bmpFixture());
    await writeFile(join(cwd, 'raster.tga'), tgaFixture(true));
    await writeFile(join(cwd, 'first.gif'), gifFixture());
    await writeFile(
      join(cwd, 'unsafe.svg'),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="https://example.invalid/never"/><script>window.P10_LEAK=true</script></svg>',
      ),
    );
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
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().startsWith('https:')) requests.push(request.url());
    });
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const webp = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', 1).split(',')[1]!;
    }, pngFixture().toString('base64'));
    await writeFile(join(cwd, 'photo.webp'), Buffer.from(webp, 'base64'));
    const status = (await run(['status', '--porcelain=v2'])).stdout;
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/ }).click();
    const viewer = page.getByTestId('image-diff-viewer');
    const select = async (path: string) => {
      await page.getByTestId('working-change').filter({ hasText: path }).first().click();
      await expect(viewer).toBeVisible();
    };
    await select('shape.svg');
    await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    expect(
      await viewer
        .getByRole('img', { name: 'New image', exact: true })
        .evaluate((node) => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data]),
    ).toEqual([238, 68, 51, 255]);
    await viewer.getByRole('button', { name: 'Pixel', exact: true }).click();
    await expect(viewer).toContainText('changed pixels');
    await viewer.getByRole('combobox', { name: 'Image zoom' }).selectOption('4');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(880, 600));
    const viewport = viewer.getByLabel('Image viewport');
    await expect.poll(() => viewport.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    const viewportBounds = await viewport.boundingBox();
    if (!viewportBounds) throw new Error('Image viewport is missing.');
    await page.mouse.move(viewportBounds.x + viewportBounds.width * 0.8, viewportBounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(viewportBounds.x + viewportBounds.width * 0.2, viewportBounds.y + 100);
    await page.mouse.up();
    expect(await viewport.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('p10-svg-pixel-zoom-light.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 820));
    await page.getByRole('button', { name: 'Show source diff', exact: true }).click();
    await expect(page.getByTestId('diff-viewer')).toContainText('Show image comparison');
    await page.getByRole('button', { name: 'Show image comparison', exact: true }).click();
    for (const path of ['bitmap.bmp', 'raster.tga', 'first.gif', 'photo.webp']) {
      await select(path);
      await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    }
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.screenshot({ path: test.info().outputPath('p10-webp-dark.png') });
    await select('unsafe.svg');
    await expect(viewer).toContainText('No preview for this format');
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => 'P10_LEAK' in window)).toBe(false);
    expect((await run(['status', '--porcelain=v2'])).stdout).toBe(status);
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByTestId('commit-change').filter({ hasText: 'cached.png' }).click();
    await page
      .getByTestId('lfs-file-card')
      .getByRole('button', { name: 'Compare images', exact: true })
      .click();
    await expect(viewer.getByRole('img', { name: 'Old image', exact: true })).toBeVisible();
    await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Onion Skin', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('p10-lfs-image-onion-dark.png') });
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    await page.getByTestId('revision-tree-entry').filter({ hasText: 'shape.svg' }).click();
    await expect(viewer.getByRole('img', { name: 'New image', exact: true })).toBeVisible();
    expect(
      await viewer
        .getByRole('img', { name: 'New image', exact: true })
        .evaluate((node) => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data]),
    ).toEqual([35, 95, 165, 255]);
    expect((await run(['status', '--porcelain=v2'])).stdout).toBe(status);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
