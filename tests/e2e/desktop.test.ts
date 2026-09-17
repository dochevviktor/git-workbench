import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

const author = ['-c', 'user.name=History Author', '-c', 'user.email=history@example.test'];

async function commitFile(git: GitRunner, repository: string, file: string, message: string) {
  await writeFile(join(repository, file), `${message}\n`, { encoding: 'utf8', flag: 'a' });
  await git.run(['add', '--', file], { cwd: repository });
  await git.run([...author, 'commit', '--quiet', '-m', message], { cwd: repository });
}

async function waitForDesktop(page: Page) {
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
}

async function chooseMenu(
  page: Page,
  menu: string,
  item: string,
  role: 'menuitem' | 'menuitemradio' = 'menuitem',
) {
  await page.getByRole('menubar').getByRole('menuitem', { name: menu, exact: true }).click();
  await page.getByRole(role, { name: item, exact: true }).click();
}

test('production build loads its isolated preload and renderer', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'git-workbench-test-'));
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-repository-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-tab-'));
  const fixtureRepository = join(fixtureRoot, 'sample');
  const secondRepository = join(secondRoot, 'second');
  await mkdir(fixtureRepository);
  await mkdir(secondRepository);
  const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ['.']),
        `--user-data-dir=${profile}`,
        ...(process.env.ELECTRON_TEST_OZONE_PLATFORM
          ? [`--ozone-platform=${process.env.ELECTRON_TEST_OZONE_PLATFORM}`]
          : []),
        ...(process.env.ELECTRON_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []),
      ],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    });

    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await waitForDesktop(page);
    const bridge = await page.evaluate(async () => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return {
        info: await window.desktop.app.getInfo(),
        requireAvailable: 'require' in window,
        ipcAvailable: 'ipcRenderer' in window,
        keys: Object.keys(window.desktop),
      };
    });
    expect(bridge.requireAvailable).toBe(false);
    expect(bridge.ipcAvailable).toBe(false);
    expect(bridge.keys).toEqual(['app', 'window', 'edit', 'clipboard', 'repository']);
    expect(bridge.info).toMatchObject({ ok: true, value: { name: 'Git Workbench' } });
    const gitInfo = await page.evaluate(async () => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.getGitInfo();
    });
    expect(gitInfo).toMatchObject({ ok: true, value: { status: 'available' } });

    // The renderer draws the window chrome: title-bar menus and window controls.
    const platform = await application.evaluate(() => process.platform);
    await expect(page.getByTestId('titlebar')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Repository Manager' })).toBeVisible();
    if (platform !== 'darwin') {
      await expect(
        page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }),
      ).toBeVisible();
      // Record the main-process window calls instead of relying on a window manager, which headless
      // and forwarded X11 test displays may not provide.
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('Application window missing');
        const calls: string[] = [];
        Object.assign(globalThis, { windowControlCalls: calls });
        window.minimize = () => calls.push('minimize');
        window.maximize = () => calls.push('maximize');
      });
      await page.getByRole('button', { name: 'Minimize' }).click();
      await page.getByRole('button', { name: 'Maximize' }).click();
      await expect
        .poll(() =>
          application!.evaluate(() => (globalThis as { windowControlCalls?: string[] }).windowControlCalls),
        )
        .toEqual(['minimize', 'maximize']);
      await chooseMenu(page, 'View', 'Appearance');
      await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Help', exact: true }).click();
      await page.getByRole('menuitem', { name: 'About Git Workbench' }).click();
      await expect(page.getByRole('dialog', { name: 'Git Workbench' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    await page.reload();
    await waitForDesktop(page);
    const initialized = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.initialize({ path, bare: false });
    }, fixtureRepository);
    expect(initialized).toMatchObject({ ok: true, value: { path: fixtureRepository, bare: false } });
    if (!initialized.ok) throw new Error(initialized.error.message);
    await page.reload();
    await waitForDesktop(page);
    await expect(page.getByRole('tab', { name: /sample, Clean working tree/u })).toBeVisible();
    await expect(page.getByText('This repository has no commits yet.')).toBeVisible();

    // A merged feature branch exercises lanes that split from and join the main line.
    const fixtureGit = new GitRunner();
    await commitFile(fixtureGit, fixtureRepository, 'history.txt', 'First history commit');
    const mainBranch = (
      await fixtureGit.run(['symbolic-ref', '--short', 'HEAD'], { cwd: fixtureRepository })
    ).stdout.trim();
    await fixtureGit.run(['checkout', '--quiet', '-b', 'feature/graph'], { cwd: fixtureRepository });
    await commitFile(fixtureGit, fixtureRepository, 'feature.txt', 'Feature branch commit 1');
    await commitFile(fixtureGit, fixtureRepository, 'feature.txt', 'Feature branch commit 2');
    await fixtureGit.run(['checkout', '--quiet', mainBranch], { cwd: fixtureRepository });
    await commitFile(fixtureGit, fixtureRepository, 'main.txt', 'Main line commit');
    await fixtureGit.run(
      [...author, 'merge', '--quiet', '--no-ff', '-m', 'Merge feature graph', 'feature/graph'],
      {
        cwd: fixtureRepository,
      },
    );
    const head = (await fixtureGit.run(['rev-parse', 'HEAD'], { cwd: fixtureRepository })).stdout.trim();

    await page.reload();
    await waitForDesktop(page);
    await expect(page.getByTestId('history-commit')).toHaveCount(5);
    await expect(page.getByTestId('history-commit').first()).toContainText('Merge feature graph');
    await expect(page.locator('.commit-row.head')).toContainText('Merge feature graph');
    await expect(page.locator('path.graph-branch')).toHaveCount(1);
    await expect(page.locator('path.graph-join')).toHaveCount(1);
    await expect(page.locator('path.graph-branch')).toHaveAttribute('d', /A/u);

    // Collapse and expand the merge's secondary branch from its graph tip and keyboard focus.
    const mergeRow = page.getByTestId('history-commit').filter({ hasText: 'Merge feature graph' });
    const graphToggle = mergeRow.getByTestId('graph-toggle');
    await expect(graphToggle).toHaveAttribute('aria-label', 'Collapse merged branch');
    await graphToggle.click();
    await expect(graphToggle).toHaveAttribute('aria-label', 'Expand merged branch');
    await expect(page.getByText('Feature branch commit 1', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Feature branch commit 2', { exact: true })).toHaveCount(1);
    await page.getByRole('listbox', { name: 'Commits' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(graphToggle).toHaveAttribute('aria-label', 'Collapse merged branch');
    await expect(page.getByText('Feature branch commit 1', { exact: true })).toHaveCount(1);

    // A context-menu collapse keeps a selected hidden commit available in the details pane.
    const featureOneRow = page.getByTestId('history-commit').filter({ hasText: 'Feature branch commit 1' });
    await featureOneRow.click();
    await expect(page.getByRole('heading', { name: 'Feature branch commit 1' })).toBeVisible();
    await featureOneRow.click({ button: 'right' });
    const graphMenu = page.getByRole('menu', { name: /^Commit / });
    await graphMenu.getByRole('menuitem', { name: 'Collapse All Branches', exact: true }).click();
    await expect(featureOneRow).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Feature branch commit 1' })).toBeVisible();

    await mergeRow.click({ button: 'right' });
    await expect(graphMenu.getByRole('menuitem', { name: /^Expand Branch/u })).toBeVisible();
    await expect(graphMenu.getByRole('menuitem', { name: 'Expand All Branches', exact: true })).toBeVisible();
    await graphMenu.getByRole('menuitem', { name: 'Expand All Branches', exact: true }).click();
    await expect(page.getByTestId('history-commit')).toHaveCount(5);
    await expect(page.getByRole('treeitem', { name: 'graph' })).toHaveCount(0);
    await page.getByRole('treeitem', { name: 'feature' }).dblclick();
    await expect(page.getByRole('treeitem', { name: 'graph' })).toBeVisible();

    // F06: reference-scoped history uses the branch tip as a backend-owned Git revision.
    await page.getByRole('treeitem', { name: 'graph' }).click({ button: 'right' });
    const referenceMenu = page.getByRole('menu', { name: 'feature/graph' });
    await referenceMenu
      .getByRole('menuitem', { name: "Filter History to 'feature/graph'", exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Show all commits', exact: true })).toBeVisible();
    await expect(page.getByTestId('history-commit')).toHaveCount(3);
    await expect(page.getByText('Merge feature graph', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all commits', exact: true }).click();
    await expect(page.getByTestId('history-commit')).toHaveCount(5);

    // F06: commit-message search is literal and paged by the backend.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const commitSearch = page.getByRole('searchbox', { name: 'Search commits' });
    await commitSearch.fill('Feature branch commit 2');
    await expect(page.getByTestId('history-commit')).toHaveCount(1);
    await expect(page.getByTestId('history-commit')).toContainText('Feature branch commit 2');
    await commitSearch.fill('Feature [branch]');
    await expect(page.getByText('No commits match “Feature [branch]”.', { exact: true })).toBeVisible();
    await commitSearch.fill('');
    await expect(page.getByTestId('history-commit')).toHaveCount(5);

    await page.getByTestId('history-commit').filter({ hasText: 'First history commit' }).click();
    await expect(page.getByRole('heading', { name: 'First history commit' })).toBeVisible();
    await expect(page.locator('.history-full-hash')).toHaveText(/^[0-9a-f]{40}$/u);

    // F07: committed changes and the revision tree are read through named preload capabilities.
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await expect(page.getByTestId('commit-changes')).toBeVisible();
    await expect(page.getByTestId('commit-change')).toHaveCount(1);
    await expect(page.getByTestId('commit-change')).toContainText('history.txt');
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Files at revision' })).toBeVisible();
    const historyFile = page.getByTestId('revision-tree-entry').filter({ hasText: 'history.txt' });
    await expect(historyFile).toBeVisible();
    await historyFile.click();
    await expect(page.getByTestId('revision-blob')).toHaveText('First history commit\n');

    // Right click opens the renderer's context menu; copying uses the main-process clipboard.
    await page.getByTestId('history-commit').first().click({ button: 'right' });
    const commitMenu = page.getByRole('menu', { name: /^Commit / });
    await expect(commitMenu).toBeVisible();
    await expect(commitMenu.getByRole('menuitem', { name: 'Checkout Commit…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await commitMenu.getByRole('menuitem', { name: 'Copy Commit SHA' }).click();
    await expect(commitMenu).toHaveCount(0);
    await expect.poll(() => application!.evaluate(async ({ clipboard }) => clipboard.readText())).toBe(head);
    await page.getByTestId('history-commit').first().click({ button: 'right' });
    await expect(page.getByRole('menu', { name: /^Commit / })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByRole('heading', { name: 'Local Changes' })).toBeVisible();
    await page.getByRole('button', { name: 'All Commits' }).click();
    await expect(page.getByTestId('history-commit')).toHaveCount(5);

    const secondInitialized = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.initialize({ path, bare: false });
    }, secondRepository);
    expect(secondInitialized).toMatchObject({ ok: true, value: { path: secondRepository, bare: false } });
    await page.reload();
    await waitForDesktop(page);
    await expect(page.getByRole('tab', { name: /sample, Clean working tree/u })).toBeVisible();
    await expect(page.getByRole('tab', { name: /second, Clean working tree/u })).toBeVisible();
    await writeFile(join(secondRepository, 'dirty\nfile.txt'), 'uncommitted\n', 'utf8');
    await expect(page.getByRole('tab', { name: /second, Uncommitted changes/u })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('tab', { name: /second, Uncommitted changes/u })).toContainText('second*');
    await expect(page.locator('.workspace-tabs.horizontal')).toBeVisible();
    if (platform !== 'darwin') {
      await chooseMenu(page, 'View', 'Vertical Tabs', 'menuitemradio');
      await expect(page.locator('.workspace-tabs.vertical')).toBeVisible();
      await chooseMenu(page, 'View', 'Horizontal Tabs', 'menuitemradio');
      await expect(page.locator('.workspace-tabs.horizontal')).toBeVisible();
    }
    await page.getByRole('tab', { name: /second/u }).click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'second tab' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close second' }).click();
    await expect(page.getByRole('tab', { name: /second/u })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+T');
    await expect(page.getByRole('tab', { name: /second, Uncommitted changes/u })).toBeVisible();

    const manager = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.addSourceDirectory({ path });
    }, fixtureRoot);
    expect(manager).toMatchObject({
      ok: true,
      value: {
        sourceDirectories: [{ path: fixtureRoot, repositoryCount: 1 }],
        repositories: [{ path: fixtureRepository, kind: 'worktree' }],
      },
    });
    await page.reload();
    await waitForDesktop(page);
    await page.getByRole('button', { name: 'New tab' }).click();
    await expect(page.getByRole('heading', { name: 'Repository Manager' })).toBeVisible();
    await expect(page.getByTestId('manager-repository').filter({ hasText: 'sample' })).toBeVisible();
    await expect(
      page.evaluate(async (id) => {
        if (!window.desktop) throw new Error('Desktop API missing');
        return window.desktop.repository.close({ id });
      }, initialized.value.id),
    ).resolves.toMatchObject({ ok: true });
    await page.screenshot({ path: 'test-results/workspace.png' });
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      await application?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
    }
  }
});
