import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-bisect-refresh-'));
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'Bisect Refresh');
  await run('config', 'user.email', 'bisect-refresh@example.test');
  await run('config', 'commit.gpgsign', 'false');
  const commits: string[] = [];
  for (let n = 0; n < 9; n++) {
    await writeFile(join(cwd, 'value.txt'), `${n}\n`);
    await run('add', '.');
    await run('commit', '-qm', `Step ${n}`);
    commits.push(await run('rev-parse', 'HEAD'));
  }
  const originalRefs = await run('show-ref');
  const wrapper = join(root, 'bisect-git.ts');
  await copyFile(resolve('tests/fixtures/bisect-git.ts'), wrapper);
  await chmod(wrapper, 0o700);
  const gate = join(root, 'read-gate');
  const app = await electron.launch({
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key)),
      ),
      ELECTRON_RENDERER_URL: '',
      GIT_EXECUTABLE: wrapper,
      GIT_WORKBENCH_REAL_GIT: (await git.version()).executable,
      GIT_WORKBENCH_BISECT_GATE: gate,
    },
  });
  const page = await app.firstWindow();
  const pause = async () => {
    await rm(`${gate}.waiting`, { force: true });
    await writeFile(gate, 'hold');
    await page.keyboard.press('F5');
    await expect.poll(() => readFile(`${gate}.waiting`, 'utf8').catch(() => '')).toBe('bisect read waiting');
  };
  const release = () => rm(gate, { force: true });
  const close = async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  };
  return { page, commits, run, originalRefs, pause, release, close, cwd };
}

async function holdPointer(page: Page, control: Locator) {
  await expect(control).toBeEnabled();
  const rect = await control.boundingBox();
  if (!rect) throw new Error('The Bisect action is not visible.');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
}

test('Bisect actions survive a refresh between mouse-down and click', async () => {
  const f = await fixture();
  try {
    await expect(f.page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await f.page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await f.page.reload();
    const duringRefresh = async (control: Locator) => {
      const menuItem = (await control.getAttribute('role')) === 'menuitem';
      await holdPointer(f.page, control);
      await f.pause();
      // An unchanged background read must not disable the pressed control and swallow mouse-up.
      await expect(control).toBeEnabled();
      await f.page.mouse.up();
      if (!menuItem) await expect(control).toBeDisabled();
      await f.release();
    };
    await f.page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
    await duringRefresh(f.page.getByRole('menuitem', { name: 'Bisect', exact: true }));
    const banner = f.page.getByRole('region', { name: 'Bisect', exact: true });
    await expect(banner).toBeVisible();
    await duringRefresh(banner.getByRole('button', { name: 'Bad', exact: true }));
    await expect(banner.locator('.bisect-range')).toContainText(f.commits[8]!.slice(0, 7));
    await f.run('checkout', '--detach', f.commits[0]!);
    await f.page.keyboard.press('F5');
    await expect(banner.locator('.bisect-summary')).toContainText(f.commits[0]!.slice(0, 7));
    await duringRefresh(banner.getByRole('button', { name: 'Good', exact: true }));
    await expect.poll(() => f.run('rev-parse', 'HEAD')).toBe(f.commits[4]);
    await expect(banner.locator('.bisect-summary')).toContainText(f.commits[4]!.slice(0, 7));
    await duringRefresh(banner.getByRole('button', { name: 'Skip', exact: true }));
    await expect.poll(() => f.run('bisect', 'log')).toContain(`git bisect skip ${f.commits[4]}`);
    await duringRefresh(banner.getByRole('button', { name: 'Abort', exact: true }));
    await expect(banner).toHaveCount(0);
    expect(await f.run('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await f.run('show-ref')).toBe(f.originalRefs);
    expect(await f.run('status', '--porcelain')).toBe('');
    const operations = await f.page.evaluate(() => window.desktop!.repository.listOperations());
    if (!operations.ok) throw new Error(operations.error.message);
    const bisect = operations.value.filter((operation) => operation.kind === 'bisect');
    expect(bisect.map((operation) => operation.title).sort()).toEqual([
      'Bisect: bad',
      'Bisect: good',
      'Bisect: reset',
      'Bisect: skip',
      'Bisect: start',
    ]);
    expect(bisect.every((operation) => operation.status === 'succeeded')).toBe(true);
  } finally {
    await f.close();
  }
});

test('Bisect rejects a changed checkout during refresh without classifying the new revision', async () => {
  const f = await fixture();
  try {
    await expect(f.page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await f.page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await f.page.reload();
    await f.page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
    const start = f.page.getByRole('menuitem', { name: 'Bisect', exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    const banner = f.page.getByRole('region', { name: 'Bisect', exact: true });
    await banner.getByRole('button', { name: 'Bad', exact: true }).click();
    await expect(banner.locator('.bisect-range')).toContainText(f.commits[8]!.slice(0, 7));
    await f.run('checkout', '--detach', f.commits[0]!);
    await f.page.keyboard.press('F5');
    await expect(banner.locator('.bisect-summary')).toContainText(f.commits[0]!.slice(0, 7));
    const beforeLog = await f.run('bisect', 'log');
    const good = banner.getByRole('button', { name: 'Good', exact: true });
    await holdPointer(f.page, good);
    await f.pause();
    await f.run('checkout', '--detach', f.commits[4]!);
    await expect(banner.locator('.bisect-summary')).toContainText(f.commits[0]!.slice(0, 7));
    await expect(good).toBeEnabled();
    await f.page.mouse.up();
    await f.release();
    await expect(banner.getByRole('alert')).toContainText('Bisect or the checkout changed');
    await expect(banner.locator('.bisect-summary')).toContainText(f.commits[4]!.slice(0, 7));
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.commits[4]);
    expect(await f.run('bisect', 'log')).toBe(beforeLog);
    const operations = await f.page.evaluate(() => window.desktop!.repository.listOperations());
    if (!operations.ok) throw new Error(operations.error.message);
    expect(
      operations.value.filter(
        (operation) => operation.kind === 'bisect' && operation.title === 'Bisect: good',
      ),
    ).toMatchObject([{ status: 'failed' }]);
    await banner.getByRole('button', { name: 'Abort', exact: true }).click();
    await expect(banner).toHaveCount(0);
    expect(await f.run('show-ref')).toBe(f.originalRefs);
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await f.close();
  }
});
