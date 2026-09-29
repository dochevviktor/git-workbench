import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p09-ui-'));
  const cwd = join(root, 'parent');
  const git = new GitRunner();
  const runAt = async (path: string, ...args: string[]) => (await git.run(args, { cwd: path })).stdout.trim();
  const run = (...args: string[]) => runAt(cwd, ...args);
  const init = async (path: string, filename = 'README.txt') => {
    await mkdir(path, { recursive: true });
    await runAt(path, 'init', '-q', '-b', 'main');
    await runAt(path, 'config', 'user.name', 'Topology Author');
    await runAt(path, 'config', 'user.email', 'topology@example.test');
    await runAt(path, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(path, filename), 'baseline\n');
    await runAt(path, 'add', '-A');
    await runAt(path, 'commit', '-qm', 'Module baseline');
  };
  await init(cwd);
  const launch = () =>
    electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key)),
        ),
        ELECTRON_RENDERER_URL: '',
      },
    });
  const open = async (app: ElectronApplication) => {
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    return { page, id: opened.value.id };
  };
  return { root, cwd, git, run, runAt, init, launch, open };
}

async function dark(page: Page) {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
}

test('P09 worktree identity, locking and exact removal review preserve Cancel and shared branches', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    await f.run('branch', 'feature');
    const head = await f.run('rev-parse', 'main');
    app = await f.launch();
    const { page } = await f.open(app);
    await page.getByRole('treeitem', { name: 'feature', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: "Create Worktree from 'feature'…", exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Checkout Branch as Worktree', exact: true });
    const linked = join(f.root, 'linked');
    await create.getByLabel('Location:').fill(linked);
    await page.screenshot({ path: test.info().outputPath('worktree-create-light.png') });
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(access(linked)).rejects.toThrow();
    await page.getByRole('treeitem', { name: 'feature', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: "Create Worktree from 'feature'…", exact: true }).click();
    await create.getByLabel('Location:').fill(linked);
    await create.getByTestId('reference-dialog-submit').click();
    await expect(page.getByRole('tab', { name: /^linked,/u })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.worktree-parent')).toBeVisible();
    const current = page.locator('.tree-row.worktree.current');
    await expect(current).toContainText('linked');
    await current.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Delete Worktree…', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByRole('menuitem', { name: 'Lock Worktree…', exact: true }).click();
    const lock = page.getByRole('dialog', { name: 'Lock Worktree', exact: true });
    await lock.getByLabel('Reason:').fill('Keep for review');
    await lock.getByTestId('reference-dialog-submit').click();
    await expect(lock).toHaveCount(0);
    await expect.poll(() => f.run('worktree', 'list', '--porcelain')).toContain('locked Keep for review');
    await page.screenshot({ path: test.info().outputPath('worktree-linked-light.png') });
    await page.getByRole('tab', { name: /^parent,/u }).click();
    await dark(page);
    await writeFile(join(linked, 'local.txt'), 'retain on Cancel\n');
    await page.keyboard.press('F5');
    const row = page.locator('.tree-row.worktree').filter({ hasText: 'linked' });
    await expect(row).toContainText('Dirty');
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Worktree…', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Remove Worktree', exact: true });
    await expect(remove).toContainText(linked);
    await expect(remove).toContainText('Keep for review');
    await expect(remove.getByTestId('reference-dialog-submit')).toBeDisabled();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 600));
    await page.screenshot({ path: test.info().outputPath('worktree-remove-dark-small.png') });
    const bounds = (await remove.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
    await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await readFile(join(linked, 'local.txt'), 'utf8')).toBe('retain on Cancel\n');
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Worktree…', exact: true }).click();
    await remove.getByRole('checkbox').check();
    await remove.getByTestId('reference-dialog-submit').click();
    await expect(remove).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^linked,/u })).toHaveCount(0);
    await expect(access(linked)).rejects.toThrow();
    expect(await f.run('rev-parse', 'main')).toBe(head);
    expect(await f.run('rev-parse', 'feature')).toBe(head);
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P09 submodule revision graph, nested scope and removal review use actual child state', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    const source = join(f.root, 'module-source');
    const deep = join(f.root, 'deep');
    await f.init(source, 'module.txt');
    await f.init(deep, 'nested.txt');
    await f.runAt(source, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', deep, 'nested');
    await f.runAt(source, 'commit', '-qam', 'Add nested child');
    await f.run('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'modules/demo');
    await f.run('commit', '-qam', 'Add module');
    await writeFile(join(source, 'module.txt'), 'next revision\n');
    await f.runAt(source, 'commit', '-qam', 'Module advance');
    await f.runAt(join(f.cwd, 'modules/demo'), 'fetch', '-q');
    await f.runAt(join(f.cwd, 'modules/demo'), 'checkout', '-q', 'origin/main');
    app = await f.launch();
    const { page, id } = await f.open(app);
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    const preview = page.getByTestId('submodule-preview');
    await expect(preview).toContainText('Module advance');
    await expect(preview).toContainText('1↑');
    await expect(preview.locator('.submodule-history-row')).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath('submodule-revisions-light.png') });
    await writeFile(join(f.cwd, 'modules/demo/module.txt'), 'dirty child\n');
    await expect(preview).toContainText('1 uncommitted file');
    await dark(page);
    await page.screenshot({ path: test.info().outputPath('submodule-dirty-dark.png') });
    await preview.getByRole('button', { name: 'Open Submodule', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^parent: demo,/u })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^parent,/u }).click();
    const references = page.getByRole('tree', { name: 'References', exact: true });
    await references.getByRole('treeitem', { name: 'modules', exact: true }).dblclick();
    const demo = references.locator('.tree-row.submodule').filter({ hasText: 'demo' });
    await demo.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove Submodule…', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Remove Submodule', exact: true });
    await expect(remove).toContainText(join(f.cwd, 'modules/demo'));
    await expect(remove).toContainText('modules/demo/module.txt');
    await expect(remove).toContainText('modules/demo/nested');
    await expect(remove.getByTestId('reference-dialog-submit')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('submodule-remove-dark.png') });
    await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await readFile(join(f.cwd, 'modules/demo/module.txt'), 'utf8')).toBe('dirty child\n');
    await f.runAt(join(f.cwd, 'modules/demo'), 'restore', 'module.txt');
    await page.keyboard.press('F5');
    await expect(preview).not.toContainText('1 uncommitted file');
    await preview.getByRole('button', { name: 'Update…', exact: true }).click();
    const update = page.getByRole('dialog', { name: 'Update Submodule', exact: true });
    await expect(update).toContainText('Fetch missing commits');
    await update.getByLabel('Include nested submodules recursively').check();
    await page.screenshot({ path: test.info().outputPath('submodule-update-scope-dark.png') });
    await update.getByTestId('reference-dialog-submit').click();
    await expect(update).toHaveCount(0);
    await expect
      .poll(async () => readFile(join(f.cwd, 'modules/demo/nested/nested.txt'), 'utf8').catch(() => ''))
      .toBe('baseline\n');
    const status = await page.evaluate(async (id) => window.desktop!.repository.getSubmodules({ id }), id);
    expect(status).toMatchObject({
      ok: true,
      value: {
        submodules: [
          expect.objectContaining({ path: 'modules/demo', detached: true }),
          expect.objectContaining({ path: 'modules/demo/nested', nested: true, initialized: true }),
        ],
      },
    });
    expect(await readFile(join(f.cwd, 'README.txt'), 'utf8')).toBe('baseline\n');
    await references.locator('.tree-row.submodule').filter({ hasText: 'demo' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove Submodule…', exact: true }).click();
    await remove.getByTestId('reference-dialog-submit').click();
    await expect(remove).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^parent: demo,/u })).toHaveCount(0);
    await expect(access(join(f.cwd, 'modules/demo'))).rejects.toThrow();
    expect(await readFile(join(f.cwd, 'README.txt'), 'utf8')).toBe('baseline\n');
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P09 Git-flow feature finish resumes after app restart and preserves production', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    const production = await f.run('rev-parse', 'main');
    app = await f.launch();
    let { page } = await f.open(app);
    await page.getByRole('button', { name: 'Git-flow', exact: true }).click();
    const initialize = page.getByRole('dialog', { name: 'Initialize Git-flow', exact: true });
    await initialize.getByLabel('Version tag prefix:').fill('v');
    await page.screenshot({ path: test.info().outputPath('gitflow-initialize-light.png') });
    await initialize.getByTestId('reference-dialog-submit').click();
    await expect(initialize).toHaveCount(0);
    await page.getByRole('button', { name: 'Git-flow', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'Start Feature', exact: true });
    await start.getByLabel('Name:').fill('conflict');
    await start.getByTestId('reference-dialog-submit').click();
    await expect(start).toHaveCount(0);
    await f.run('config', 'commit.gpgsign', 'false');
    await writeFile(join(f.cwd, 'README.txt'), 'feature\n');
    await f.run('commit', '-qam', 'Feature edit');
    await f.run('checkout', '-q', 'develop');
    await writeFile(join(f.cwd, 'README.txt'), 'develop\n');
    await f.run('commit', '-qam', 'Develop edit');
    await f.run('checkout', '-q', 'feature/conflict');
    await page.keyboard.press('F5');
    await expect(page.getByRole('button', { name: 'Git-flow menu', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Git-flow menu', exact: true }).click();
    await page.getByRole('menuitem', { name: "Finish Feature 'conflict'…", exact: true }).click();
    const finish = page.getByRole('dialog', { name: 'Finish Feature', exact: true });
    await expect(finish).toContainText('develop');
    await page.screenshot({ path: test.info().outputPath('gitflow-finish-light.png') });
    await finish.getByTestId('reference-dialog-submit').click();
    await expect(page.locator('.p09-flow-recovery')).toContainText('Resolve conflicts');
    await app.close();
    app = await f.launch();
    page = await app.firstWindow();
    await expect(page.locator('.p09-flow-recovery')).toContainText("'conflict'");
    await dark(page);
    await page.screenshot({ path: test.info().outputPath('gitflow-recovery-dark.png') });
    await writeFile(join(f.cwd, 'README.txt'), 'resolved\n');
    await f.run('add', 'README.txt');
    await page.keyboard.press('F5');
    const continueFlow = page.getByRole('button', { name: 'Continue Git-flow', exact: true });
    await expect(continueFlow).toBeEnabled();
    await continueFlow.click();
    await expect(page.locator('.p09-flow-recovery')).toHaveCount(0);
    expect(await f.run('branch', '--show-current')).toBe('develop');
    expect(await f.run('rev-parse', 'main')).toBe(production);
    expect(await f.run('branch', '--list', 'feature/conflict')).toBe('');
    expect(await readFile(join(f.cwd, 'README.txt'), 'utf8')).toBe('resolved\n');
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
