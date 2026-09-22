import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * The Electron test runs on Ozone's headless platform by default: it needs no display server and never
 * opens a window on the desktop running it. Set `ELECTRON_TEST_OZONE_PLATFORM` to `x11` or `wayland` to
 * watch it on a real display, and `ELECTRON_TEST_DISABLE_GPU=1` there when that display is software
 * rendered.
 */
const ozonePlatform = process.env.ELECTRON_TEST_OZONE_PLATFORM || 'headless';
const headless = ozonePlatform === 'headless';

function launchEnvironment(): Record<string, string> {
  // Without a display in the environment, no fallback can put a window on a real screen.
  const withheld = headless ? ['DISPLAY', 'WAYLAND_DISPLAY'] : [];
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !withheld.includes(key)) environment[key] = value;
  }
  environment.ELECTRON_RENDERER_URL = '';
  return environment;
}

/** Reads Git state for an assertion; a command that cannot answer yet reports an empty string. */
async function gitText(git: GitRunner, cwd: string, args: readonly string[]): Promise<string> {
  try {
    return (await git.run(args, { cwd })).stdout.trim();
  } catch {
    return '';
  }
}

async function waitForDesktop(page: Page) {
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
}

async function chooseMenu(
  page: Page,
  menu: string,
  item: string,
  role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox' = 'menuitem',
) {
  await page.getByRole('menubar').getByRole('menuitem', { name: menu, exact: true }).click();
  await page.getByRole(role, { name: item, exact: true }).click();
}

test('production build loads its isolated preload and renderer', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'git-workbench-test-'));
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-repository-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-tab-'));
  // The remote lives outside the scanned source directory, which must keep finding one repository.
  const remoteRoot = await mkdtemp(join(tmpdir(), 'git-workbench-e2e-remote-'));
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
        `--ozone-platform=${ozonePlatform}`,
        ...(headless || process.env.ELECTRON_TEST_DISABLE_GPU === '1' ? ['--disable-gpu'] : []),
      ],
      env: launchEnvironment(),
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
    expect(bridge.keys).toEqual([
      'customCommands',
      'externalTools',
      'hosting',
      'app',
      'window',
      'edit',
      'clipboard',
      'repository',
    ]);
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
    // Give the fixture its own identity so the commit composer does not depend on the host's config.
    await fixtureGit.run(['config', 'user.name', 'History Author'], { cwd: fixtureRepository });
    await fixtureGit.run(['config', 'user.email', 'history@example.test'], { cwd: fixtureRepository });
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
    const rowMenu = page.getByRole('menu', { name: /^Commit / });
    await rowMenu.getByRole('menuitem', { name: 'Collapse All', exact: true }).click();
    await expect(featureOneRow).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Feature branch commit 1' })).toBeVisible();

    await mergeRow.click({ button: 'right' });
    await expect(rowMenu.getByRole('menuitem', { name: /^Expand(?! All)/u })).toBeVisible();
    await expect(rowMenu.getByRole('menuitem', { name: 'Expand All', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    // Right-clicking the graph itself opens the compact graph menu.
    await mergeRow.click({ button: 'right', position: { x: 8, y: 12 } });
    const graphMenu = page.getByRole('menu', { name: /^Graph / });
    await expect(graphMenu.getByRole('menuitem', { name: /^Expand(?! All)/u })).toBeVisible();
    await expect(graphMenu.getByRole('menuitem', { name: 'New Branch…' })).toHaveCount(0);
    await graphMenu.getByRole('menuitem', { name: 'Expand All', exact: true }).click();
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
    await expect(page.getByText("Filtered by: 'feature/graph'", { exact: true })).toBeVisible();
    await expect(page.getByTestId('history-commit')).toHaveCount(3);
    await expect(page.getByText('Merge feature graph', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
    await expect(page.getByTestId('history-commit')).toHaveCount(5);

    // F06: the sidebar search panel runs a literal, backend-paged commit-message search. Its results stay
    // separate from the commit list, and choosing one selects that commit in the unfiltered list.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const commitSearch = page.getByRole('searchbox', { name: 'Search commits' });
    const searchResults = page.getByTestId('commit-search-result');
    await commitSearch.fill('Feature branch commit 2');
    await expect(searchResults).toHaveCount(1);
    await expect(searchResults).toContainText('Feature branch commit 2');
    await expect(page.getByTestId('history-commit')).toHaveCount(5);
    await searchResults.click();
    await expect(page.locator('.commit-row.selected')).toContainText('Feature branch commit 2');
    await expect(page.getByRole('heading', { name: 'Feature branch commit 2' })).toBeVisible();
    await commitSearch.fill('Feature [branch]');
    await expect(page.getByText('No commits match “Feature [branch]”.', { exact: true })).toBeVisible();
    await commitSearch.fill('');
    await expect(searchResults).toHaveCount(0);
    await page.getByRole('button', { name: 'Branches', exact: true }).click();

    await page.getByTestId('history-commit').filter({ hasText: 'First history commit' }).click();
    await expect(page.getByRole('heading', { name: 'First history commit' })).toBeVisible();
    await expect(page.locator('.history-full-hash')).toHaveText(/^[0-9a-f]{40}$/u);

    // F07: committed changes and the revision tree are read through named preload capabilities.
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await expect(page.getByTestId('commit-changes')).toBeVisible();
    await expect(page.getByTestId('commit-change')).toHaveCount(1);
    await expect(page.getByTestId('commit-change')).toContainText('history.txt');
    await page.getByTestId('commit-change').filter({ hasText: 'history.txt' }).click();
    await expect(page.getByTestId('diff-content').locator('.diff-cell.add')).toContainText(
      'First history commit',
    );
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
    // F12 enables the branch, tag, and checkout entries; F19 history operations are available when a branch is checked out.
    await expect(commitMenu.getByRole('menuitem', { name: 'Checkout Commit…' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(commitMenu.getByRole('menuitem', { name: 'Cherry-pick Commit…' })).not.toHaveAttribute(
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
    await expect(page.getByTestId('working-changes')).toBeVisible();
    await page.getByRole('button', { name: 'All Commits' }).click();
    await expect(page.getByTestId('history-commit')).toHaveCount(5);

    // F08: working-tree status exposes separate staged/unstaged and visibility sections.
    await writeFile(join(fixtureRepository, 'partial.txt'), 'staged\n', 'utf8');
    await fixtureGit.run(['add', '--', 'partial.txt'], { cwd: fixtureRepository });
    await writeFile(join(fixtureRepository, 'partial.txt'), 'staged\nunstaged\n', 'utf8');
    await writeFile(join(fixtureRepository, 'untracked.txt'), 'untracked\n', 'utf8');
    await writeFile(join(fixtureRepository, '.gitignore'), 'ignored.txt\n', 'utf8');
    await writeFile(join(fixtureRepository, 'ignored.txt'), 'ignored\n', 'utf8');
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByTestId('working-changes')).toBeVisible();
    const stagedFiles = page.getByTestId('working-changes-staged');
    const unstagedFiles = page.getByTestId('working-changes-unstaged');
    await expect(stagedFiles).toContainText('partial.txt');
    await expect(unstagedFiles).toContainText('partial.txt');
    await expect(unstagedFiles).toContainText('untracked.txt');
    await expect(unstagedFiles.getByTestId('working-change').filter({ hasText: 'ignored.txt' })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Local changes options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show Ignored Files', exact: true }).click();
    await expect(unstagedFiles).toContainText('ignored.txt');
    await page.getByRole('button', { name: 'Local changes options', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'View as List', exact: true }).click();
    await expect(unstagedFiles.locator('.file-change-columns')).toBeVisible();
    await unstagedFiles.getByTestId('working-change').filter({ hasText: 'untracked.txt' }).click();
    const untrackedPreview = page.getByTestId('working-change-preview');
    await expect(untrackedPreview).toContainText('untracked.txt');
    await expect(untrackedPreview.getByRole('img', { name: 'Untracked' })).toBeVisible();

    // F09: a selected working-tree file loads a real patch with split mode, literal search, and
    // optional whitespace markers. The controls stay in the renderer; Git receives only the named target.
    await writeFile(join(fixtureRepository, 'history.txt'), 'First history commit  \n', 'utf8');
    const diffFile = unstagedFiles.getByTestId('working-change').filter({ hasText: 'history.txt' });
    await expect(diffFile).toBeVisible({ timeout: 10_000 });
    await diffFile.click();
    await expect(page.getByTestId('diff-viewer')).toBeVisible();
    await expect(page.getByTestId('diff-content').locator('.diff-cell.add')).toContainText(
      'First history commit',
    );
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(page.locator('.diff-body.split')).toBeVisible();
    const diffSearch = page.getByRole('searchbox', { name: 'Search diff' });
    await diffSearch.fill('history');
    await expect(page.getByText(/^\d+ \/ \d+$/u)).toBeVisible();
    await page.getByRole('button', { name: 'Diff options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show hidden characters', exact: true }).click();
    await expect(page.getByTestId('diff-content')).toContainText('··');

    // F10: file/hunk/line actions use a fresh backend snapshot and update both change panes.
    await unstagedFiles.getByTestId('working-change').filter({ hasText: 'partial.txt' }).click();
    await page.getByRole('button', { name: 'Unified', exact: true }).click();
    await page
      .getByTestId('diff-change-region')
      .first()
      .hover({ position: { x: 120, y: 4 } });
    await expect(page.getByTestId('diff-hunk-stage').first()).toBeVisible();
    await page.getByTestId('diff-hunk-stage').first().click();
    await expect(unstagedFiles.getByTestId('working-change').filter({ hasText: 'partial.txt' })).toHaveCount(
      0,
    );
    await expect(stagedFiles.getByTestId('working-change').filter({ hasText: 'partial.txt' })).toBeVisible();
    await stagedFiles.getByTestId('working-change').filter({ hasText: 'partial.txt' }).click();
    await page
      .getByTestId('diff-change-region')
      .first()
      .hover({ position: { x: 120, y: 4 } });
    await expect(page.getByTestId('diff-hunk-unstage').first()).toBeVisible();
    await page.getByTestId('diff-hunk-unstage').first().click();
    await expect(stagedFiles.getByTestId('working-change').filter({ hasText: 'partial.txt' })).toHaveCount(0);
    await expect(
      unstagedFiles.getByTestId('working-change').filter({ hasText: 'partial.txt' }),
    ).toBeVisible();

    // Ctrl+click selects several files, and the pane button acts on that selection alone.
    await writeFile(join(fixtureRepository, 'multi-one.txt'), 'one\n', 'utf8');
    await writeFile(join(fixtureRepository, 'multi-two.txt'), 'two\n', 'utf8');
    await writeFile(join(fixtureRepository, 'multi-three.txt'), 'three\n', 'utf8');
    await expect(
      unstagedFiles.getByTestId('working-change').filter({ hasText: 'multi-three.txt' }),
    ).toBeVisible({
      timeout: 10_000,
    });
    // The captured post-action selection remains in the source pane, so this is a selected-file action.
    await expect(page.getByTestId('working-unstaged-action')).toHaveText('Stage');
    await unstagedFiles.getByTestId('working-change').filter({ hasText: 'multi-one.txt' }).click();
    await unstagedFiles
      .getByTestId('working-change')
      .filter({ hasText: 'multi-three.txt' })
      .click({ modifiers: ['ControlOrMeta'] });
    await expect(page.getByTestId('working-unstaged-action')).toHaveText('Stage');
    await page.getByTestId('working-unstaged-action').click();
    await expect(
      stagedFiles.getByTestId('working-change').filter({ hasText: 'multi-one.txt' }),
    ).toBeVisible();
    await expect(
      stagedFiles.getByTestId('working-change').filter({ hasText: 'multi-three.txt' }),
    ).toBeVisible();
    await expect(
      unstagedFiles.getByTestId('working-change').filter({ hasText: 'multi-two.txt' }),
    ).toBeVisible();
    await expect(stagedFiles.getByTestId('working-change').filter({ hasText: 'multi-two.txt' })).toHaveCount(
      0,
    );
    await stagedFiles.getByTestId('working-change').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTestId('working-staged-action').click();
    await expect(stagedFiles.getByTestId('working-change')).toHaveCount(0);

    await writeFile(join(fixtureRepository, 'line-selection.txt'), 'before\nkeep\nafter\n', 'utf8');
    await fixtureGit.run(['add', '--', 'line-selection.txt'], { cwd: fixtureRepository });
    await fixtureGit.run([...author, 'commit', '--quiet', '-m', 'line selection base'], {
      cwd: fixtureRepository,
    });
    await writeFile(join(fixtureRepository, 'line-selection.txt'), 'selected\nkeep\nafter\n', 'utf8');
    await expect(
      unstagedFiles.getByTestId('working-change').filter({ hasText: 'line-selection.txt' }),
    ).toBeVisible({ timeout: 10_000 });
    await unstagedFiles.getByTestId('working-change').filter({ hasText: 'line-selection.txt' }).click();
    await expect(page.locator('.diff-body.unified').getByTestId('diff-line-select')).toHaveCount(2);
    await page.locator('.diff-body.unified .diff-cell.add input').check();
    await expect(page.getByTestId('diff-selection-stage')).toBeVisible();
    await page.getByTestId('diff-selection-stage').click();
    await expect(
      stagedFiles.getByTestId('working-change').filter({ hasText: 'line-selection.txt' }),
    ).toBeVisible();

    const discardBase = Array.from({ length: 16 }, (_, index) => `line-${index + 1}`).join('\n') + '\n';
    await writeFile(join(fixtureRepository, 'discard.txt'), discardBase, 'utf8');
    await fixtureGit.run(['add', '--', 'discard.txt'], { cwd: fixtureRepository });
    await fixtureGit.run([...author, 'commit', '--quiet', '-m', 'discard base'], { cwd: fixtureRepository });
    const discardChanged = discardBase.replace('line-2', 'discarded-2').replace('line-14', 'kept-14');
    await writeFile(join(fixtureRepository, 'discard.txt'), discardChanged, 'utf8');
    await expect(unstagedFiles.getByTestId('working-change').filter({ hasText: 'discard.txt' })).toBeVisible({
      timeout: 10_000,
    });
    await unstagedFiles.getByTestId('working-change').filter({ hasText: 'discard.txt' }).click();
    await expect(page.getByTestId('diff-hunk-discard')).toHaveCount(2);
    await page
      .getByTestId('diff-change-region')
      .first()
      .hover({ position: { x: 120, y: 4 } });
    await page.getByTestId('diff-hunk-discard').first().click();
    await page
      .getByRole('dialog', { name: 'Discard changes' })
      .getByRole('button', { name: 'Discard', exact: true })
      .click();
    await expect
      .poll(() => readFile(join(fixtureRepository, 'discard.txt'), { encoding: 'utf8' }))
      .toBe(discardBase.replace('line-14', 'kept-14'));
    await writeFile(join(fixtureRepository, 'long-line.txt'), 'base\n', 'utf8');
    await fixtureGit.run(['add', '--', 'long-line.txt'], { cwd: fixtureRepository });
    await fixtureGit.run([...author, 'commit', '--quiet', '-m', 'long line base'], {
      cwd: fixtureRepository,
    });
    await writeFile(join(fixtureRepository, 'long-line.txt'), `long-${'x'.repeat(2_000)}\n`, 'utf8');
    await expect(
      unstagedFiles.getByTestId('working-change').filter({ hasText: 'long-line.txt' }),
    ).toBeVisible({
      timeout: 10_000,
    });
    // The background status refresh can move rows between the click and its effect, so retry the
    // selection instead of assuming one click always lands on the intended row.
    await expect(async () => {
      await unstagedFiles.getByTestId('working-change').filter({ hasText: 'long-line.txt' }).click();
      await page
        .getByTestId('diff-change-region')
        .first()
        .hover({ position: { x: 120, y: 4 } });
      await expect(page.getByTestId('diff-hunk-stage').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    const diffLayout = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('[data-testid="diff-content"]');
      const header = body?.querySelector<HTMLElement>('.diff-hunk-highlight');
      if (!body || !header) throw new Error('Diff layout missing');
      return {
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        headerClientWidth: header.clientWidth,
      };
    });
    expect(diffLayout.bodyScrollWidth).toBeGreaterThan(diffLayout.bodyClientWidth);
    expect(diffLayout.headerClientWidth).toBeLessThanOrEqual(diffLayout.bodyClientWidth);
    await page.getByTestId('diff-content').evaluate((element) => {
      const body = element as HTMLElement;
      body.scrollLeft = body.scrollWidth;
    });
    const stickyAction = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('[data-testid="diff-content"]');
      const action = body?.querySelector<HTMLElement>('[data-testid="diff-hunk-stage"]');
      if (!body || !action) throw new Error('Sticky diff action missing');
      const bodyRect = body.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      return {
        bodyLeft: bodyRect.left,
        bodyRight: bodyRect.right,
        actionLeft: actionRect.left,
        actionRight: actionRect.right,
      };
    });
    expect(stickyAction.actionLeft).toBeGreaterThanOrEqual(stickyAction.bodyLeft - 1);
    expect(stickyAction.actionRight).toBeLessThanOrEqual(stickyAction.bodyRight + 1);
    await page.screenshot({ path: 'test-results/f10-changes.png' });

    // F11: the composer commits the staged set, amends it, and surfaces a failing hook.
    const composer = page.getByTestId('commit-composer');
    await expect(composer.getByTestId('commit-submit')).toHaveText('Commit');
    await expect(async () => {
      await unstagedFiles.getByTestId('working-change').filter({ hasText: 'history.txt' }).click();
      await page
        .getByTestId('diff-change-region')
        .first()
        .hover({ position: { x: 120, y: 4 } });
      await expect(page.getByTestId('diff-hunk-stage').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByTestId('diff-hunk-stage').first().click();
    await expect(stagedFiles.getByTestId('working-change').filter({ hasText: 'history.txt' })).toBeVisible();
    await expect(composer.getByTestId('commit-submit')).toHaveText('Commit 1 File');
    const composerSubject = 'Commit from the composer';
    await composer.getByTestId('commit-subject').fill(composerSubject);
    await composer.getByTestId('commit-description').fill('Body written in the composer.');
    await expect(composer.locator('.composer-counter')).toHaveText(String(50 - composerSubject.length));
    await composer.getByTestId('commit-submit').click();
    await expect(stagedFiles.getByTestId('working-change')).toHaveCount(0);
    await expect
      .poll(async () =>
        (await fixtureGit.run(['log', '-1', '--format=%B'], { cwd: fixtureRepository })).stdout.trim(),
      )
      .toBe('Commit from the composer\n\nBody written in the composer.');
    const committedCount = (
      await fixtureGit.run(['rev-list', '--count', 'HEAD'], { cwd: fixtureRepository })
    ).stdout.trim();

    await composer.getByTestId('commit-amend').check();
    await expect(composer.getByTestId('commit-subject')).toHaveValue(composerSubject);
    // Amend previews the commit's own files in the staged pane without resetting anything.
    await expect(page.getByTestId('amend-note')).toBeVisible();
    await expect(stagedFiles.getByTestId('working-change').filter({ hasText: 'history.txt' })).toBeVisible();
    expect(
      (await fixtureGit.run(['rev-list', '--count', 'HEAD'], { cwd: fixtureRepository })).stdout.trim(),
    ).toBe(committedCount);
    expect(
      (await fixtureGit.run(['diff', '--cached', '--name-only'], { cwd: fixtureRepository })).stdout.trim(),
    ).toBe('');
    await composer.getByTestId('commit-subject').fill('Amended from the composer');
    // The button counts what the amended commit would contain, not just what is staged now.
    await expect(composer.getByTestId('commit-submit')).toHaveText('Amend Last Commit');
    await composer.getByTestId('commit-submit').click();
    await expect
      .poll(async () =>
        (await fixtureGit.run(['log', '-1', '--format=%s'], { cwd: fixtureRepository })).stdout.trim(),
      )
      .toBe('Amended from the composer');
    expect(
      (await fixtureGit.run(['rev-list', '--count', 'HEAD'], { cwd: fixtureRepository })).stdout.trim(),
    ).toBe(committedCount);
    await expect(composer.getByTestId('commit-amend')).not.toBeChecked();

    const hookPath = join(fixtureRepository, '.git', 'hooks', 'pre-commit');
    await writeFile(hookPath, '#!/bin/sh\necho "hook refused this commit"\nexit 1\n', 'utf8');
    await chmod(hookPath, 0o755);
    await expect(async () => {
      await unstagedFiles.getByTestId('working-change').filter({ hasText: 'long-line.txt' }).click();
      await page
        .getByTestId('diff-change-region')
        .first()
        .hover({ position: { x: 120, y: 4 } });
      await expect(page.getByTestId('diff-hunk-stage').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByTestId('diff-hunk-stage').first().click();
    await expect(
      stagedFiles.getByTestId('working-change').filter({ hasText: 'long-line.txt' }),
    ).toBeVisible();
    await composer.getByTestId('commit-subject').fill('Blocked by the hook');
    await composer.getByTestId('commit-description').fill('');
    await composer.getByTestId('commit-submit').click();
    await expect(page.getByTestId('commit-failure')).toContainText('hook refused this commit');
    expect(
      (await fixtureGit.run(['log', '-1', '--format=%s'], { cwd: fixtureRepository })).stdout.trim(),
    ).toBe('Amended from the composer');
    await page.getByRole('button', { name: 'Commit Without Hooks' }).click();
    await expect
      .poll(async () =>
        (await fixtureGit.run(['log', '-1', '--format=%s'], { cwd: fixtureRepository })).stdout.trim(),
      )
      .toBe('Blocked by the hook');
    await rm(hookPath, { force: true });

    // Recent messages reuse a previous commit message. Wait for the committed state to settle first,
    // because a reloaded context reorders the list.
    await expect(composer.getByTestId('commit-subject')).toHaveValue('');
    await expect(composer.getByTestId('commit-submit')).toHaveText('Commit');
    await page.getByRole('button', { name: 'Recent commit messages' }).click();
    await page.getByRole('menuitem', { name: 'Blocked by the hook', exact: true }).click();
    await expect(composer.getByTestId('commit-subject')).toHaveValue('Blocked by the hook');
    await composer.getByTestId('commit-subject').fill('');
    await page.screenshot({ path: 'test-results/f11-commit.png' });

    // F12: branches and tags are created, checked out, and deleted through the validated capability.
    await page.getByRole('button', { name: 'All Commits' }).click();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    const referenceTree = page.getByRole('tree', { name: 'References' });
    const referenceDialog = page.getByTestId('reference-dialog');
    const branchNames = async () =>
      (
        await fixtureGit.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
          cwd: fixtureRepository,
        })
      ).stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const currentBranch = async () =>
      (await fixtureGit.run(['symbolic-ref', '--short', 'HEAD'], { cwd: fixtureRepository })).stdout.trim();

    await page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    await page.getByRole('menu', { name: 'Branch' }).getByRole('menuitem', { name: 'New Branch…' }).click();
    await expect(referenceDialog).toBeVisible();
    await referenceDialog.getByTestId('reference-name').fill('e2e-branch');
    await expect(referenceDialog.getByTestId('reference-checkout')).not.toBeChecked();
    await referenceDialog.getByTestId('reference-checkout').check();
    await referenceDialog.getByTestId('reference-dialog-submit').click();
    await expect(referenceDialog).toHaveCount(0);
    await expect.poll(currentBranch).toBe('e2e-branch');
    await expect(page.getByTestId('reference-status')).toContainText("Created and checked out 'e2e-branch'.");

    // A name already in use is explained in the dialog, and the create button stays unavailable.
    await page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    await page.getByRole('menu', { name: 'Branch' }).getByRole('menuitem', { name: 'New Branch…' }).click();
    await referenceDialog.getByTestId('reference-name').fill('e2e-branch');
    await expect(page.getByTestId('reference-dialog-warning')).toContainText(
      "Branch 'e2e-branch' already exists",
    );
    await expect(referenceDialog.getByTestId('reference-dialog-submit')).toBeDisabled();
    await page.screenshot({ path: 'test-results/f12-new-branch-dialog.png' });
    await referenceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(referenceDialog).toHaveCount(0);
    expect(await branchNames()).not.toContain('e2e-branch-duplicate');

    // A tag comes from the commit menu; this route creates annotated objects with or without a message.
    await page.getByTestId('history-commit').first().click({ button: 'right' });
    await page
      .getByRole('menu', { name: /^Commit / })
      .getByRole('menuitem', { name: 'New Tag…' })
      .click();
    await expect(referenceDialog).toBeVisible();
    await referenceDialog.getByTestId('reference-name').fill('v1.0-e2e');
    await referenceDialog.getByTestId('reference-message').fill('Tagged by the end-to-end test');
    await referenceDialog.getByTestId('reference-dialog-submit').click();
    await expect(referenceDialog).toHaveCount(0);
    await expect
      .poll(async () => (await fixtureGit.run(['tag', '--list'], { cwd: fixtureRepository })).stdout.trim())
      .toBe('v1.0-e2e');
    expect(
      (
        await fixtureGit.run(['cat-file', '-t', 'refs/tags/v1.0-e2e'], { cwd: fixtureRepository })
      ).stdout.trim(),
    ).toBe('tag');
    // Tags start collapsed, and the section only becomes expandable once the new tag has loaded, so
    // retry the toggle instead of assuming one click lands after the refresh.
    const tagItem = referenceTree.getByRole('treeitem', { name: 'v1.0-e2e', exact: true });
    await expect(async () => {
      if ((await tagItem.count()) === 0) {
        await referenceTree.getByRole('treeitem', { name: 'Tags', exact: true }).click();
      }
      await expect(tagItem).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.screenshot({ path: 'test-results/f12-branches.png' });

    // The sidebar checks the previous branch out again; the branch already on HEAD cannot be checked out.
    await referenceTree.getByRole('treeitem', { name: 'e2e-branch', exact: true }).click({ button: 'right' });
    await expect(
      page.getByRole('menu', { name: 'e2e-branch' }).getByRole('menuitem', { name: /^Checkout /u }),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await referenceTree.getByRole('treeitem', { name: mainBranch, exact: true }).click({ button: 'right' });
    await page
      .getByRole('menu', { name: mainBranch })
      .getByRole('menuitem', { name: `Checkout '${mainBranch}'`, exact: true })
      .click();
    await expect(referenceDialog.getByRole('radio', { name: "Don't change", exact: true })).toBeChecked();
    await expect(
      referenceDialog.getByRole('radio', { name: 'Stash and reapply', exact: true }),
    ).toBeVisible();
    await expect(referenceDialog.getByRole('radio', { name: 'Discard', exact: true })).toBeVisible();
    await referenceDialog.getByTestId('reference-dialog-submit').click();
    await expect.poll(currentBranch).toBe(mainBranch);
    // Wait for the sidebar to agree before opening the menu: its entries read the loaded references.
    await expect(referenceTree.getByRole('treeitem', { name: mainBranch, exact: true })).toHaveClass(
      /current/u,
    );

    // Deleting the merged branch removes only that reference.
    await referenceTree.getByRole('treeitem', { name: 'e2e-branch', exact: true }).click({ button: 'right' });
    await page
      .getByRole('menu', { name: 'e2e-branch' })
      .getByRole('menuitem', { name: "Delete 'e2e-branch'…", exact: true })
      .click();
    await expect(referenceDialog).toBeVisible();
    await referenceDialog.getByTestId('reference-dialog-submit').click();
    await expect(referenceDialog).toHaveCount(0);
    await expect.poll(branchNames).not.toContain('e2e-branch');
    expect(await branchNames()).toContain(mainBranch);
    await expect(page.getByTestId('reference-status')).toContainText("Deleted branch 'e2e-branch'.");
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByTestId('reference-status')).toHaveCount(0);

    // F13: remotes, push, fetch, and pull run as background operations with progress and output.
    const remotePath = join(remoteRoot, 'origin.git');
    // The bare remote starts on the same branch name, so a clone of it checks that branch out.
    await fixtureGit.run(['init', '--quiet', '--bare', `--initial-branch=${mainBranch}`, remotePath], {
      cwd: remoteRoot,
    });
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remotes…', exact: true }).click();
    const networkDialog = page.getByTestId('reference-dialog');
    await expect(networkDialog).toBeVisible();
    await networkDialog.getByTestId('remote-name').fill('origin');
    await networkDialog.getByTestId('remote-url').fill(remotePath);
    await networkDialog.getByTestId('reference-dialog-submit').click();
    await expect(networkDialog.getByTestId('remote-list')).toContainText('origin');
    await networkDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(networkDialog).toHaveCount(0);
    await expect.poll(() => gitText(fixtureGit, fixtureRepository, ['remote'])).toBe('origin');

    // Push the current branch; the dialog sets the upstream because the branch has none yet.
    await page.getByTestId('toolbar-push').click();
    await expect(networkDialog).toBeVisible();
    await expect(networkDialog.getByTestId('push-branches')).toContainText(mainBranch);
    await networkDialog.getByTestId('reference-dialog-submit').click();
    await expect(networkDialog).toHaveCount(0);
    await expect
      .poll(() => gitText(fixtureGit, remotePath, ['rev-parse', `refs/heads/${mainBranch}`]), {
        timeout: 20_000,
      })
      .toBe(await gitText(fixtureGit, fixtureRepository, ['rev-parse', mainBranch]));
    await expect
      .poll(
        () =>
          gitText(fixtureGit, fixtureRepository, ['rev-parse', '--abbrev-ref', `${mainBranch}@{upstream}`]),
        { timeout: 10_000 },
      )
      .toBe(`origin/${mainBranch}`);

    // The activity panel records the command that ran and its output.
    await expect(page.getByTestId('activity')).toBeVisible();
    await expect(page.getByTestId('activity-tab-all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('activity-row').first()).toContainText(/Push/u);
    await expect(page.getByTestId('activity-output')).toContainText(/origin|main|master/u);
    await page.getByTestId('activity-tab-user').click();
    await expect(page.getByTestId('activity-row').first()).toContainText(/Push/u);
    await page.getByTestId('activity-tab-background').click();
    await expect(page.getByText('No automatic fetches have run yet.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('activity')).toHaveCount(0);

    // A commit made elsewhere is brought back by a fetch and then fast-forwarded by a pull.
    const clonePath = join(remoteRoot, 'clone');
    await fixtureGit.run(['clone', '--quiet', remotePath, clonePath], { cwd: remoteRoot });
    await commitFile(fixtureGit, clonePath, 'remote.txt', 'Commit made on the remote');
    await fixtureGit.run(['push', '--quiet', 'origin', mainBranch], { cwd: clonePath });

    await page.getByTestId('toolbar-fetch').click();
    await expect(networkDialog).toBeVisible();
    await networkDialog.getByTestId('reference-dialog-submit').click();
    await expect(networkDialog).toHaveCount(0);
    await expect
      .poll(
        () => gitText(fixtureGit, fixtureRepository, ['rev-parse', `refs/remotes/origin/${mainBranch}`]),
        { timeout: 20_000 },
      )
      .toBe(await gitText(fixtureGit, clonePath, ['rev-parse', mainBranch]));
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('toolbar-pull')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('toolbar-pull').click();
    await expect(networkDialog.getByTestId('pull-into')).toHaveText(mainBranch);
    await expect(networkDialog.getByRole('checkbox', { name: 'Rebase instead of merge' })).toBeVisible();
    await expect(
      networkDialog.getByRole('checkbox', { name: 'Stash and reapply local changes' }),
    ).toBeVisible();
    await networkDialog.getByTestId('reference-dialog-submit').click();
    await expect
      .poll(() => gitText(fixtureGit, fixtureRepository, ['log', '-1', '--format=%s']), { timeout: 20_000 })
      .toBe('Commit made on the remote');
    await expect(page.getByTestId('reference-status')).toContainText(/Pull/u);
    await page.screenshot({ path: 'test-results/f13-network.png' });
    await page.keyboard.press('Escape');

    const secondInitialized = await page.evaluate(async (path) => {
      if (!window.desktop) throw new Error('Desktop API missing');
      return window.desktop.repository.initialize({ path, bare: false });
    }, secondRepository);
    expect(secondInitialized).toMatchObject({ ok: true, value: { path: secondRepository, bare: false } });
    await page.reload();
    await waitForDesktop(page);
    await expect(page.getByRole('tab', { name: /sample, Uncommitted changes/u })).toBeVisible();
    await expect(page.getByRole('tab', { name: /second, Clean working tree/u })).toBeVisible();
    await writeFile(join(secondRepository, 'dirty\nfile.txt'), 'uncommitted\n', 'utf8');
    await expect(page.getByRole('tab', { name: /second, Uncommitted changes/u })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('tab', { name: /second, Uncommitted changes/u }).getByTestId('tab-dirty-indicator'),
    ).toBeVisible();
    await expect(page.locator('.workspace-tabs.horizontal')).toBeVisible();
    if (platform !== 'darwin') {
      await chooseMenu(page, 'View', 'Show Repository List', 'menuitemcheckbox');
      await expect(page.locator('.workspace-tabs.vertical')).toBeVisible();
      await expect(page.locator('.workspace-tabs.horizontal')).toBeVisible();
      await chooseMenu(page, 'View', 'Show Repository List', 'menuitemcheckbox');
      await expect(page.locator('.workspace-tabs.vertical')).toHaveCount(0);
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
      await rm(remoteRoot, { recursive: true, force: true });
    }
  }
});
