import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F26 start, mark, skip, restart, abort and first bad outcome', async () => {
  const testInfo = test.info();
  const root = await mkdtemp(join(tmpdir(), 'workbench-f26-e2e-'));
  const cwd = join(root, 'repo');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  const launch = () =>
    electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await mkdir(cwd);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'F26 Author');
    await run('config', 'user.email', 'f26@example.test');
    const commits: string[] = [];
    for (let index = 0; index < 9; index++) {
      await writeFile(join(cwd, 'value.txt'), `${index}\n`);
      await run('add', '.');
      await run('commit', '-qm', `Step ${index}`);
      commits.push(await run('rev-parse', 'HEAD'));
    }
    const originalRefs = await run('show-ref');
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    const start = async () => {
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Bisect', exact: true })).toBeEnabled();
      await page.getByRole('menuitem', { name: 'Bisect', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Bisect', exact: true })).toBeVisible();
    };
    const markRange = async () => {
      const banner = page.getByRole('region', { name: 'Bisect', exact: true });
      await expect(banner.getByRole('button', { name: 'Good', exact: true })).toBeDisabled();
      await banner.getByRole('button', { name: 'Bad', exact: true }).click();
      await expect(banner.locator('.bisect-range')).toContainText(commits[8]!.slice(0, 7));
      await page.locator(`[data-commit-id="${commits[0]}"]`).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Checkout Commit…', exact: true }).click();
      await page.getByTestId('reference-dialog-submit').click();
      await expect(page.getByTestId('reference-dialog')).toHaveCount(0);
      await expect(banner.getByRole('button', { name: 'Good', exact: true })).toBeEnabled();
      await banner.getByRole('button', { name: 'Good', exact: true }).click();
      await expect.poll(() => run('rev-parse', 'HEAD')).toBe(commits[4]);
      await expect(banner.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
    };
    await start();
    await markRange();
    await page.screenshot({ path: testInfo.outputPath('bisect-midpoint.png') });
    await page
      .getByRole('region', { name: 'Bisect', exact: true })
      .getByRole('button', { name: 'Skip', exact: true })
      .click();
    await expect.poll(() => run('bisect', 'log')).toContain(`git bisect skip ${commits[4]}`);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const banner = page.getByRole('region', { name: 'Bisect', exact: true });
    await expect(banner).toContainText('Skipped:');
    await banner.getByRole('button', { name: 'Abort', exact: true }).click();
    await expect(banner).toHaveCount(0);
    expect(await run('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await run('show-ref')).toBe(originalRefs);
    await start();
    await markRange();
    for (let step = 0; step < 8; step++) {
      if ((await banner.textContent())?.includes('First bad commit:')) break;
      const current = await run('rev-parse', 'HEAD');
      const value = Number(await readFile(join(cwd, 'value.txt'), 'utf8'));
      await banner.getByRole('button', { name: value >= 5 ? 'Bad' : 'Good', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await run('rev-parse', 'HEAD')) !== current ||
            (await banner.textContent())?.includes('First bad commit:'),
        )
        .toBe(true);
    }
    await expect(banner).toContainText('First bad commit:');
    await expect(banner).toContainText(commits[5]!.slice(0, 7));
    await page.screenshot({ path: testInfo.outputPath('bisect-result.png') });
    await banner.getByRole('button', { name: 'Abort', exact: true }).click();
    await expect(banner).toHaveCount(0);
    expect(await run('show-ref')).toBe(originalRefs);
    expect(await run('status', '--porcelain')).toBe('');
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      await test
        .info()
        .attach('bisect-state', { body: await page.locator('body').innerText(), contentType: 'text/plain' });
    }
    throw error;
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
