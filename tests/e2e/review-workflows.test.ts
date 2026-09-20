import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

function environment(): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  result.ELECTRON_RENDERER_URL = '';
  return result;
}

async function open(application: ElectronApplication, cwd: string): Promise<Page> {
  const page = await application.firstWindow();
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
  const result = await page.evaluate(async (path) => window.desktop!.repository.open({ path }), cwd);
  expect(result.ok).toBe(true);
  await page.reload();
  await expect(page.getByTestId('history-commit').first()).toBeVisible();
  return page;
}

async function theme(page: Page, name: 'Light' | 'Dark') {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

test('review branch workflows preserve intent, refresh diffs and fit the supported window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-review-ui-'));
  const cwd = join(root, 'work');
  const remote = join(root, 'origin.git');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'UI Review');
    await run('config', 'user.email', 'review@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'base.txt'), 'base\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'base');
    await run('init', '--quiet', '--bare', '--initial-branch=main', remote);
    await run('remote', 'add', 'origin', remote);
    await run('push', '--quiet', '--set-upstream', 'origin', 'main');
    await run('checkout', '--quiet', '-b', 'topic');
    await run('branch', '--set-upstream-to=origin/main', 'topic');
    await writeFile(join(cwd, 'local.txt'), 'local commit\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'local');
    await run('branch', 'new-branch');
    await writeFile(join(cwd, 'base.txt'), 'first draft\n');
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await open(application, cwd);

    await page.getByRole('button', { name: /Local Changes/u }).click();
    await page
      .getByTestId('working-changes-unstaged')
      .getByTestId('working-change')
      .filter({ hasText: 'base.txt' })
      .click();
    await expect(page.getByTestId('diff-content')).toContainText('first draft');
    await writeFile(join(cwd, 'base.txt'), 'second draft\n');
    await page.keyboard.press('F5');
    await expect(page.getByTestId('diff-content')).toContainText('second draft');
    await writeFile(join(cwd, 'base.txt'), 'third draft\n');
    await expect(page.getByTestId('diff-content')).toContainText('third draft', { timeout: 12000 });

    // Different local/upstream names plus a selected branch that has no upstream.
    await page.getByTestId('toolbar-push').click();
    const dialog = page.getByTestId('reference-dialog');
    await expect(
      dialog.getByRole('textbox', { name: 'Destination branch for topic', exact: true }),
    ).toHaveValue('main');
    await dialog.getByRole('checkbox', { name: 'Push new-branch', exact: true }).check();
    await page.screenshot({ path: 'test-results/review-push.png' });
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await git.run(['rev-parse', 'refs/heads/main'], { cwd: remote })).stdout.trim())
      .toBe(await run('rev-parse', 'refs/heads/topic'));
    await expect
      .poll(() => run('rev-parse', '--abbrev-ref', 'new-branch@{upstream}').catch(() => ''))
      .toBe('origin/new-branch');
    expect(await run('rev-parse', '--abbrev-ref', 'topic@{upstream}')).toBe('origin/main');
    expect(
      (
        await git.run(['for-each-ref', '--format=%(refname)', 'refs/heads/topic'], { cwd: remote })
      ).stdout.trim(),
    ).toBe('');
    await page.keyboard.press('Escape');

    await theme(page, 'Dark');
    const main = page.getByRole('treeitem', { name: /^main(?:\s|$)/u }).first();
    await main.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'main', exact: true });
    await expect(
      menu.getByRole('menuitem', { name: "Fast-Forward to 'origin/main'", exact: true }),
    ).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: "Pull 'origin/main'…", exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: "Push to 'origin'…", exact: true })).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: "Create Pull Request on 'origin'…", exact: true }),
    ).toBeVisible();
    await menu.getByRole('menuitem', { name: "Pull 'origin/main'…", exact: true }).click();
    await expect(dialog).toContainText("Check out 'main', then pull remote changes into it");
    await expect(dialog.getByTestId('pull-into')).toHaveText('main');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await run('branch', '--show-current')).toBe('topic');
    await main.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: "Checkout 'main'", exact: true }).click();
    await expect(dialog.getByRole('radio', { name: "Don't change", exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await run('branch', '--show-current')).toBe('topic');
    expect(await readFile(join(cwd, 'base.txt'), 'utf8')).toBe('third draft\n');

    await main.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: "Checkout 'main'", exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Stash and reapply', exact: true })).toBeEnabled();
    await dialog.getByRole('radio', { name: 'Stash and reapply', exact: true }).check();
    await page.screenshot({ path: 'test-results/review-checkout-dark.png' });
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('branch', '--show-current')).toBe('main');
    expect(await readFile(join(cwd, 'base.txt'), 'utf8')).toBe('third draft\n');

    await theme(page, 'Light');
    const beforePull = await run('rev-parse', 'HEAD');
    await page.getByTestId('toolbar-pull').click();
    await expect(dialog.getByTestId('network-remote')).toHaveValue('origin');
    await expect(dialog.getByTestId('pull-branch')).toHaveValue('main');
    await expect(dialog.getByTestId('pull-into')).toHaveText('main');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await run('rev-parse', 'HEAD')).toBe(beforePull);
    await page.getByTestId('toolbar-pull').click();
    await dialog.getByRole('checkbox', { name: 'Rebase instead of merge', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Stash and reapply local changes', exact: true }).check();
    await page.screenshot({ path: 'test-results/review-pull-light.png' });
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('rev-parse', 'HEAD')).toBe(await run('rev-parse', 'refs/heads/topic'));
    await expect(page.getByTestId('reference-status')).toContainText('Pull');
    expect(await readFile(join(cwd, 'base.txt'), 'utf8')).toBe('third draft\n');

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 600));
    const activity = page.getByTestId('activity');
    await expect(activity).toBeVisible();
    const bounds = await activity.evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: window.innerWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    await activity.getByRole('option').first().focus();
    await page.keyboard.press('End');
    await expect(activity.getByRole('option').last()).toBeFocused();
    await expect(activity.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(activity.getByRole('option').first()).toBeFocused();
    await page.evaluate(() => window.desktop!.window.command({ action: 'zoom-in' }));
    await expect
      .poll(() => activity.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth))
      .toBe(true);
    await page.evaluate(() => window.desktop!.window.command({ action: 'reset-zoom' }));
    await page.screenshot({ path: 'test-results/review-activity-minimum.png' });
    await page.keyboard.press('Escape');

    // A browser handoff is captured in the main process; the test never opens a real browser.
    await run('remote', 'add', 'github', 'https://github.com/example/review-fixture.git');
    await run('update-ref', 'refs/remotes/github/main', await run('rev-parse', 'HEAD'));
    await page.keyboard.press('F5');
    await expect(async () => {
      await page.keyboard.press('Escape');
      await main.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Tracking', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Set Upstream…', exact: true }).click();
      await expect(
        dialog.getByTestId('reference-upstream').locator('option[value="refs/remotes/github/main"]'),
      ).toHaveCount(1);
    }).toPass({ timeout: 10000 });
    await dialog.getByTestId('reference-upstream').selectOption('refs/remotes/github/main');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('config', 'branch.main.remote')).toBe('github');
    await application.evaluate(({ shell }) => {
      Object.assign(globalThis, { reviewedBrowserUrls: [] as string[] });
      shell.openExternal = async (url: string) => {
        (globalThis as { reviewedBrowserUrls?: string[] }).reviewedBrowserUrls!.push(url);
      };
    });
    await expect(async () => {
      await page.keyboard.press('Escape');
      await main.click({ button: 'right' });
      await expect(
        page.getByRole('menuitem', { name: "Create Pull Request on 'github'…", exact: true }),
      ).toBeVisible();
    }).toPass({ timeout: 10000 });
    await page.getByRole('menuitem', { name: "Create Pull Request on 'github'…", exact: true }).click();
    await expect
      .poll(() =>
        application!.evaluate(() => (globalThis as { reviewedBrowserUrls?: string[] }).reviewedBrowserUrls),
      )
      .toEqual(['https://github.com/example/review-fixture/compare/main?expand=1']);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('F15 saves a selected working file as a named stash from its context menu', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-stash-ui-'));
  const cwd = join(root, 'work');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(cwd);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'Stash UI');
    await run('config', 'user.email', 'stash-ui@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'selected.txt'), 'base selected\n');
    await writeFile(join(cwd, 'other.txt'), 'base other\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'base');
    await writeFile(join(cwd, 'selected.txt'), 'selected change\n');
    await writeFile(join(cwd, 'other.txt'), 'other change\n');

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await open(application, cwd);
    await page.getByRole('button', { name: /Local Changes/u }).click();
    const selected = page.getByTestId('working-changes-unstaged').getByTestId('working-change').filter({
      hasText: 'selected.txt',
    });
    await selected.click({ button: 'right' });
    const menu = page.getByRole('menu').last();
    await menu.getByRole('menuitem', { name: 'Stash File…', exact: true }).click();
    const dialog = page.getByTestId('stash-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill('selected from UI');
    await dialog.getByRole('button', { name: 'Save Stash', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => readFile(join(cwd, 'selected.txt'), 'utf8')).toBe('base selected\n');
    expect(await readFile(join(cwd, 'other.txt'), 'utf8')).toBe('other change\n');
    await page.getByRole('treeitem', { name: 'Stashes', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: /stash@\{0\}: selected from UI/u })).toBeVisible();
    await expect(page.getByTestId('reference-status')).toContainText('stash');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('F16 starts ordinary merge and rebase jobs from branch menus', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-merge-rebase-ui-'));
  const cwd = join(root, 'work');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(cwd);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'Merge Rebase UI');
    await run('config', 'user.email', 'merge-rebase-ui@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'base.txt'), 'base\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'base');
    const base = await run('rev-parse', 'HEAD');
    await run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(cwd, 'feature.txt'), 'feature\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'feature');
    await run('checkout', '--quiet', 'main');
    await writeFile(join(cwd, 'main.txt'), 'main\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'main');
    await run('checkout', '--quiet', '-b', 'rebase-target', base);
    await writeFile(join(cwd, 'target.txt'), 'target\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'target');
    await run('checkout', '--quiet', '-b', 'rebase-topic', base);
    await writeFile(join(cwd, 'topic.txt'), 'topic\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'topic');
    await run('checkout', '--quiet', 'main');

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await open(application, cwd);

    await page.getByRole('treeitem', { name: 'feature', exact: true }).click({ button: 'right' });
    const featureMenu = page.getByRole('menu', { name: 'feature', exact: true });
    await featureMenu.getByRole('menuitem', { name: "Merge 'feature' into 'main'…", exact: true }).click();
    const dialog = page.getByTestId('reference-dialog');
    await expect(dialog.getByRole('heading', { name: 'Merge Branch', exact: true })).toBeVisible();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await run('rev-list', '-1', '--parents', 'HEAD')).split(' ').length)
      .toBe(3);
    expect(await run('show', 'HEAD:feature.txt')).toBe('feature');

    await run('checkout', '--quiet', 'rebase-topic');
    await page.keyboard.press('F5');
    await expect(page.getByRole('treeitem', { name: 'rebase-target', exact: true })).toBeVisible();
    await page.getByRole('treeitem', { name: 'rebase-target', exact: true }).click({ button: 'right' });
    const rebaseMenu = page.getByRole('menu', { name: 'rebase-target', exact: true });
    await rebaseMenu
      .getByRole('menuitem', { name: "Rebase 'rebase-topic' on 'rebase-target'…", exact: true })
      .click();
    await expect(dialog.getByRole('heading', { name: 'Rebase Branch', exact: true })).toBeVisible();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('log', '-2', '--format=%s')).toBe('topic\ntarget');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('F18 opens and executes the reviewed interactive rebase plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-interactive-rebase-ui-'));
  const cwd = join(root, 'work');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(cwd);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'Interactive Rebase UI');
    await run('config', 'user.email', 'interactive-rebase-ui@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'base.txt'), 'base\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'Base');
    const base = await run('rev-parse', 'HEAD');
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await writeFile(join(cwd, `${name.toLowerCase()}.txt`), `${name}\n`);
      await run('add', '--all');
      await run('commit', '--quiet', '-m', `Add ${name}`);
    }

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await open(application, cwd);
    const baseRow = page.locator(`[data-testid="history-commit"][data-commit-id="${base}"]`);
    await baseRow.click({ button: 'right' });
    const menu = page.getByRole('menu').last();
    await menu.getByRole('menuitem', { name: 'Interactive Rebase', exact: true }).hover();
    const rebaseMenu = page.getByRole('menu', { name: 'Interactive Rebase', exact: true });
    await rebaseMenu.getByRole('menuitem', { name: "Rebase 'main' to Here…", exact: true }).click();
    const dialog = page.getByTestId('reference-dialog');
    await expect(dialog.getByRole('heading', { name: 'Interactive Rebase', exact: true })).toBeVisible();
    await expect(dialog.getByTestId('interactive-rebase-row')).toHaveCount(3);
    await expect(dialog.getByTestId('interactive-rebase-plan')).toContainText('Add Gamma');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => run('branch', '--show-current')).toBe('main');
    expect(await run('log', '--format=%s', '--reverse', `${base}..HEAD`)).toBe(
      'Add Alpha\nAdd Beta\nAdd Gamma',
    );
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a checkout hook outlives the control deadline without overwriting another tab or dialog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-review-slow-'));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const entered = join(root, 'hook-entered');
  const release = join(root, 'hook-release');
  const git = new GitRunner();
  const run = async (cwd: string, ...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    for (const cwd of [first, second]) {
      await mkdir(cwd);
      await run(cwd, 'init', '--quiet', '--initial-branch=main');
      await run(cwd, 'config', 'user.name', 'Slow UI Fixture');
      await run(cwd, 'config', 'user.email', 'slow@example.test');
      await run(cwd, 'config', 'commit.gpgsign', 'false');
      await writeFile(join(cwd, 'base.txt'), `${cwd}\n`);
      await run(cwd, 'add', '--all');
      await run(cwd, 'commit', '--quiet', '-m', cwd === first ? 'first fixture' : 'second fixture');
    }
    await run(first, 'branch', 'topic');
    // Git requires an extensionless executable hook; its contents are generated from TypeScript.
    const hookSource = `import { existsSync, writeFileSync } from 'node:fs';
      const marker: string = ${JSON.stringify(entered)};
      writeFileSync(marker, 'entered');
      while (!existsSync(${JSON.stringify(release)})) await new Promise<void>((resolve) => setTimeout(resolve, 20));`;
    await writeFile(
      join(first, '.git', 'hooks', 'post-checkout'),
      `#!/usr/bin/env node\n${stripTypeScriptTypes(hookSource)}\n`,
      { mode: 0o755 },
    );
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    await open(application, first);
    const page = await open(application, second);
    await page.getByRole('tab', { name: /^first, /u }).click();
    await expect(page.getByTestId('history-commit').first()).toContainText('first fixture');
    await page.getByRole('treeitem', { name: 'topic', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: "Checkout 'topic'", exact: true }).click();
    const dialog = page.getByTestId('reference-dialog');
    // Captured clean checkout starts immediately; only dirty or detached checkout needs a dialog.
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => readFile(entered, 'utf8').catch(() => '')).toBe('entered');
    // This intentionally crosses the old 15-second preload deadline while the real hook is still running.
    await page.waitForTimeout(16000);
    await expect(page.getByTestId('toolbar-progress')).toBeVisible();
    await expect(page.getByText('The application did not respond in time.', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^second, /u }).click();
    await expect(page.getByTestId('history-commit').first()).toContainText('second fixture');
    await page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Branch', exact: true })
      .getByRole('menuitem', { name: 'New Tag…', exact: true })
      .click();
    await dialog.getByTestId('reference-name').fill('second-tag');
    await writeFile(release, 'release');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await window.desktop!.repository.listOperations();
          return result.ok
            ? result.value
                .filter((operation) => operation.kind === 'reference')
                .every((operation) => operation.status !== 'running')
            : false;
        }),
      )
      .toBe(true);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('reference-name')).toHaveValue('second-tag');
    await expect(page.getByTestId('history-commit').first()).toContainText('second fixture');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    expect(await run(second, 'tag', '--list')).toBe('second-tag');
    expect(await run(first, 'tag', '--list')).toBe('');
  } finally {
    await writeFile(release, 'release');
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
