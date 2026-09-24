import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

test('P06 conflict presentation, restart and merge completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p06-ui-'));
  const cwd = join(root, 'work');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  let app: ElectronApplication | undefined;
  try {
    await mkdir(cwd);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'P06 Fixture');
    await run('config', 'user.email', 'p06@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'conflict.txt'), 'header\nbase\nfooter\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'Base');
    await run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(cwd, 'conflict.txt'), 'header\nfeature\nfooter\n');
    await run('commit', '--quiet', '-am', 'Feature value');
    await run('checkout', '--quiet', 'main');
    await writeFile(join(cwd, 'conflict.txt'), 'header\nmain\nfooter\n');
    await run('commit', '--quiet', '-am', 'Main value');
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'light';
    });
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    const captures = `test-results/p06-${process.env.P06_CAPTURE ?? 'after'}`;
    await page.getByRole('treeitem', { name: 'feature', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: "Merge 'feature' into 'main'…", exact: true }).click();
    await expect(page.getByTestId('reference-dialog-submit')).toBeEnabled();
    await page.screenshot({ path: `${captures}/merge.png` });
    await page.getByTestId('reference-dialog-submit').click();
    await expect.poll(() => run('ls-files', '--unmerged')).toContain('conflict.txt');
    await expect(page.getByTestId('working-changes')).toBeVisible();
    await page
      .getByTestId('working-changes-unstaged')
      .getByTestId('working-change')
      .filter({ hasText: 'conflict.txt' })
      .click();
    await expect(page.getByTestId('open-conflict-resolver')).toBeEnabled();
    await expect(page.getByTestId('conflict-preview')).toContainText("Merged 'feature'");
    await page.screenshot({ path: `${captures}/conflict.png` });
    await page.getByTestId('open-conflict-resolver').click();
    const resolver = page.getByTestId('conflict-resolver');
    await expect(resolver.getByTestId('conflict-theirs')).toContainText('feature');
    expect((await resolver.boundingBox())!.width).toBeGreaterThan(900);
    await expect(resolver.locator('.conflict-source').first().getByTestId('conflict-theirs')).toBeVisible();
    await expect(resolver.getByRole('button', { name: 'Resolve and Stage' })).toBeDisabled();
    await page.screenshot({ path: `${captures}/resolver.png` });
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.screenshot({ path: `${captures}/resolver-dark.png` });
    await page.setViewportSize({ width: 880, height: 600 });
    await expect(resolver.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await page.screenshot({ path: `${captures}/resolver-small.png` });
    await resolver.getByRole('button', { name: 'Cancel', exact: true }).click();
    await app.close();
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const reopened = await app.firstWindow();
    await expect(reopened.getByTestId('recovery-panel')).toContainText('merge');
    await reopened.getByRole('button', { name: /Local Changes/u }).click();
    await reopened
      .getByTestId('working-changes-unstaged')
      .getByTestId('working-change')
      .filter({ hasText: 'conflict.txt' })
      .click();
    await reopened.getByTestId('open-conflict-resolver').click();
    await reopened.getByTestId('conflict-result').fill('header\ncombined\nfooter\n');
    await reopened.getByRole('button', { name: 'Resolve and Stage', exact: true }).click();
    await expect.poll(() => run('ls-files', '--unmerged')).toBe('');
    await reopened.getByTestId('commit-submit').click();
    await expect.poll(() => run('status', '--porcelain')).toBe('');
    expect((await run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toHaveLength(2);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function uiFixture(kind: 'binary' | 'text' | 'lines' | 'multi') {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p06-ui-'));
  const cwd = join(root, 'work');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const file = (content: string | Buffer) => writeFile(join(cwd, 'value.txt'), content);
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'P06 UI');
  await run('config', 'user.email', 'p06-ui@example.test');
  await run('config', 'commit.gpgsign', 'false');
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n') + '\n';
  await file(
    kind === 'binary' ? Buffer.from([0, 1]) : kind === 'lines' || kind === 'multi' ? lines : 'base\n',
  );
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Base');
  if (kind !== 'lines') {
    await run('checkout', '--quiet', '-b', 'feature');
    await file(
      kind === 'binary'
        ? Buffer.from([0, 2])
        : kind === 'multi'
          ? lines.replace('line 2\n', 'feature 2\n').replace('line 22\n', 'feature 22\n')
          : 'feature\n',
    );
    await run('commit', '--quiet', '-am', 'Feature');
    await run('checkout', '--quiet', 'main');
    await file(
      kind === 'binary'
        ? Buffer.from([0, 3])
        : kind === 'multi'
          ? lines.replace('line 2\n', 'main 2\n').replace('line 22\n', 'main 22\n')
          : 'main\n',
    );
    await run('commit', '--quiet', '-am', 'Main');
  } else await file(lines.replace('line 2\n', 'selected\n').replace('line 22\n', 'remaining\n'));
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
  let app = await launch();
  const page = await app.firstWindow();
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
  expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
  await page.reload();
  await expect(page.getByTestId('history-commit').first()).toBeVisible();
  return {
    root,
    cwd,
    run,
    file,
    lines,
    page,
    restart: async () => {
      await app.close();
      app = await launch();
      return app.firstWindow();
    },
    close: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('P06 binary choices require an explicit decision and Abort Cancel preserves the conflict', async () => {
  const f = await uiFixture('binary');
  try {
    await f.run('merge', '--no-edit', 'feature').catch(() => undefined);
    const page = await f.restart();
    await expect(page.getByTestId('recovery-panel')).toContainText('Merging');
    await page.getByRole('button', { name: 'Abort merge…', exact: true }).click();
    const abort = page.getByRole('dialog', { name: 'Abort merge?', exact: true });
    const index = await f.run('ls-files', '--stage');
    await page.screenshot({ path: 'test-results/p06-after/abort.png' });
    await abort.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('ls-files', '--stage')).toBe(index);
    await page.getByTestId('recovery-panel').getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByTestId('working-change').filter({ hasText: 'value.txt' }).click();
    await expect(page.getByTestId('conflict-preview')).toContainText('Binary conflict');
    await page.getByTestId('open-conflict-resolver').click();
    const resolver = page.getByTestId('conflict-resolver');
    await expect(resolver.getByRole('button', { name: 'Resolve and Stage' })).toBeDisabled();
    await resolver.getByRole('button', { name: 'Use incoming', exact: true }).click();
    await page.screenshot({ path: 'test-results/p06-after/binary.png' });
    await resolver.getByRole('button', { name: 'Resolve and Stage' }).click();
    await expect.poll(() => f.run('ls-files', '--unmerged')).toBe('');
    expect(await readFile(join(f.cwd, 'value.txt'))).toEqual(Buffer.from([0, 2]));
    await page
      .getByTestId('recovery-panel')
      .getByRole('button', { name: 'Continue merge', exact: true })
      .click();
    await expect.poll(() => f.run('status', '--porcelain')).toBe('');
    expect((await f.run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('P06 stashes a hunk from Local Changes with a read-only Cancel', async () => {
  const f = await uiFixture('lines');
  const page = f.page;
  try {
    await page.getByRole('button', { name: /Local Changes/u }).click();
    await page.getByTestId('working-change').filter({ hasText: 'value.txt' }).click();
    await page.getByTestId('diff-content').getByText('selected', { exact: true }).hover();
    await page.getByTestId('diff-hunk-stash').first().click();
    const dialog = page.getByTestId('stash-dialog');
    await expect(dialog).toContainText('Selected hunk in value.txt');
    await page.screenshot({ path: 'test-results/p06-after/partial-stash.png' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('stash', 'list')).toBe('');
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toContain('selected');
    await page.getByTestId('diff-content').getByText('selected', { exact: true }).hover();
    await page.getByTestId('diff-hunk-stash').first().click();
    await dialog.getByPlaceholder('Stash message (optional)').fill('Selected hunk');
    await dialog.getByRole('button', { name: 'Save Stash', exact: true }).click();
    await expect.poll(() => f.run('stash', 'list')).toContain('Selected hunk');
    await expect
      .poll(() => readFile(join(f.cwd, 'value.txt'), 'utf8'))
      .toBe(f.lines.replace('line 22\n', 'remaining\n'));
    expect(await f.run('show', 'refs/stash:value.txt')).toBe(
      f.lines.replace('line 2\n', 'selected\n').trim(),
    );
  } finally {
    await f.close();
  }
});

test('P06 resumes an external rebase through the composer after restart', async () => {
  const f = await uiFixture('text');
  try {
    const feature = await f.run('rev-parse', 'feature');
    await f.run('rebase', 'feature').catch(() => undefined);
    await writeFile(join(f.cwd, 'note.txt'), 'untracked stays\n');
    const page = await f.restart();
    await expect(page.getByTestId('recovery-panel')).toContainText('Rebase');
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByTestId('working-change').filter({ hasText: 'value.txt' }).click();
    const preview = page.getByTestId('conflict-preview');
    await expect(preview).toContainText('Commit being replayed');
    await preview.getByRole('checkbox', { name: 'Select current version' }).uncheck();
    await preview.getByRole('button', { name: 'Choose Commit being replayed', exact: true }).click();
    await expect(page.getByTestId('commit-submit')).toHaveText('Continue Rebase');
    await expect(page.getByTestId('commit-submit')).toBeEnabled();
    await page.screenshot({ path: 'test-results/p06-after/rebase-continue.png' });
    await page.getByTestId('commit-submit').click();
    await expect.poll(() => f.run('branch', '--show-current')).toBe('main');
    expect(await f.run('show', '-s', '--format=%P', 'HEAD')).toBe(feature);
    expect(await readFile(join(f.cwd, 'note.txt'), 'utf8')).toBe('untracked stays\n');
  } finally {
    await f.close();
  }
});

test('P06 branch drag reviews and multi-region choices preserve surrounding lines', async () => {
  const f = await uiFixture('multi');
  const page = f.page;
  try {
    const feature = page.getByRole('treeitem', { name: 'feature', exact: true });
    const main = page.getByRole('treeitem', { name: 'main', exact: true });
    await main.dragTo(feature);
    await expect(page.getByRole('dialog', { name: 'Rebase Branch', exact: true })).toBeVisible();
    await page.getByTestId('reference-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('status', '--porcelain')).toBe('');
    await feature.dragTo(main);
    await expect(page.getByRole('dialog', { name: 'Merge Branch', exact: true })).toBeVisible();
    await page.getByTestId('reference-dialog-submit').click();
    await expect(page.getByTestId('working-changes')).toBeVisible();
    await page.getByTestId('working-change').filter({ hasText: 'value.txt' }).click();
    await page.getByTestId('open-conflict-resolver').click();
    const resolver = page.getByTestId('conflict-resolver');
    await expect(resolver).toContainText('0/2 conflict regions resolved');
    await resolver.getByRole('button', { name: 'Use incoming region', exact: true }).click();
    await expect(resolver).toContainText('1/2 conflict regions resolved');
    await resolver.getByRole('button', { name: 'Use both', exact: true }).click();
    await expect(resolver).toContainText('2/2 conflict regions resolved');
    await page.screenshot({ path: 'test-results/p06-after/multi-region.png' });
    await resolver.getByRole('button', { name: 'Resolve and Stage', exact: true }).click();
    await expect.poll(() => f.run('ls-files', '--unmerged')).toBe('');
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe(
      f.lines.replace('line 2\n', 'feature 2\n').replace('line 22\n', 'feature 22\nmain 22\n'),
    );
  } finally {
    await f.close();
  }
});
