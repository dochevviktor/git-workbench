import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function launch() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p05-ui-'));
  const cwd = join(root, 'repository');
  const bare = join(root, 'hub.git');
  await mkdir(cwd);
  const runner = new GitRunner();
  const git = async (args: string[], path = cwd) => (await runner.run(args, { cwd: path })).stdout.trim();
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'P05 Author']);
  await git(['config', 'user.email', 'p05@example.invalid']);
  await writeFile(join(cwd, 'readme.txt'), 'base\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'Baseline']);
  await git(['init', '--bare', '-b', 'main', bare]);
  await git(['remote', 'add', 'origin', bare]);
  await git(['push', 'origin', 'main']);
  await git(['branch', 'topic']);
  await git(['tag', 'lightweight']);
  await git(['tag', '-a', '-m', '', 'annotated']);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  let app: ElectronApplication;
  try {
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await page.evaluate(() => window.desktop!.repository.setAutomaticFetch({ enabled: false }));
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 820));
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    return {
      root,
      cwd,
      bare,
      git,
      app,
      page,
      close: async () => {
        await app.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

test('P05 compact Fetch/Push, optional tracking, all tags, combined remote edit and empty-message tag push', async () => {
  const f = await launch();
  const { page } = f;
  try {
    const dialog = page.getByTestId('reference-dialog');
    await page.getByTestId('toolbar-fetch').click();
    await page.screenshot({ path: test.info().outputPath('p05-fetch-light.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByTestId('toolbar-push').click();
    await page.screenshot({ path: test.info().outputPath('p05-push-light.png') });
    // Reproducible visual audit of the previously built app before rebuilding this change.
    if (process.env.P05_BASELINE === '1') return;
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(500);
    const icon = (await dialog.locator('.reference-dialog-mark').boundingBox())!;
    const title = (await dialog.getByRole('heading', { name: 'Push', exact: true }).boundingBox())!;
    expect(icon.x + icon.width).toBeLessThan(title.x);
    await expect(
      dialog.getByRole('checkbox', { name: 'Create tracking reference', exact: true }),
    ).toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Create tracking reference', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Push all tags', exact: true }).check();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => f.git(['tag', '--list'], f.bare)).toBe('annotated\nlightweight');
    expect(await f.git(['config', '--get', 'branch.main.remote']).catch(() => '')).toBe('');
    await expect(page.getByTestId('toolbar-push')).toBeEnabled();
    await page.getByTestId('toolbar-push').click();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect.poll(() => f.git(['config', '--get', 'branch.main.remote']).catch(() => '')).toBe('origin');
    await page.keyboard.press('Escape');

    await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remotes…', exact: true }).click();
    await dialog.getByRole('button', { name: 'Edit…', exact: true }).click();
    await expect(dialog.getByTestId('reference-dialog-submit')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(dialog.locator('.connection-succeeded')).toContainText('Connection succeeded');
    await page.screenshot({ path: test.info().outputPath('p05-edit-remote-light.png') });
    await dialog.getByTestId('remote-name').fill('team');
    await dialog.getByTestId('remote-url').fill(`file://${f.bare}`);
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog.getByTestId('remote-list')).toContainText('team');
    expect(await f.git(['remote', 'get-url', 'team'])).toBe(`file://${f.bare}`);
    expect(await f.git(['config', '--get', 'branch.main.remote'])).toBe('team');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expect(dialog).toContainText('Create Tag');
    await dialog.getByTestId('reference-name').fill('release-p05');
    await page.screenshot({ path: test.info().outputPath('p05-tag-light.png') });
    await dialog.getByRole('checkbox', { name: 'Push', exact: true }).check();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => f.git(['cat-file', '-t', 'refs/tags/release-p05'], f.bare).catch(() => ''))
      .toBe('tag');
    expect(await f.git(['for-each-ref', '--format=%(contents)', 'refs/tags/release-p05'])).toBe('');
    expect(await f.git(['status', '--porcelain'])).toBe('');
    await page.keyboard.press('Escape');
    const tree = page.getByRole('tree', { name: 'References', exact: true });
    const tags = tree.getByRole('treeitem', { name: 'Tags', exact: true });
    await expect(tags).toHaveAttribute('aria-expanded', /^(?:true|false)$/u);
    if ((await tags.getAttribute('aria-expanded')) === 'false') await tags.click();
    const tag = tree.getByRole('treeitem', { name: 'release-p05', exact: true });
    await tag.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show Tag Details…', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Tag Details', exact: true });
    await expect(details.getByRole('textbox', { name: 'Tag message' })).toHaveValue(/P05 Author/u);
    await page.screenshot({ path: test.info().outputPath('p05-tag-details.png') });
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await tag.click();
    await tag.press('Delete');
    await expect(dialog).toContainText('Delete Tag');
    await page.screenshot({ path: test.info().outputPath('p05-tag-delete.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.git(['cat-file', '-t', 'release-p05'])).toBe('tag');
    await page.keyboard.press('ControlOrMeta+n');
    const clone = page.getByRole('dialog', { name: 'Clone', exact: true });
    await clone.locator('#clone-url').fill(`file://${f.bare}`);
    await clone.locator('#clone-parent').fill(f.root);
    await clone.locator('#clone-name').fill('cancelled-clone');
    await clone.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(clone.locator('.connection-succeeded')).toContainText('Connection succeeded');
    await page.screenshot({ path: test.info().outputPath('p05-clone-light.png') });
    await clone.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(access(join(f.root, 'cancelled-clone'))).rejects.toMatchObject({ code: 'ENOENT' });
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await page.getByTestId('toolbar-fetch').click();
    await page.screenshot({ path: test.info().outputPath('p05-fetch-dark.png') });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(880, 600));
    await page.screenshot({ path: test.info().outputPath('p05-fetch-small.png') });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
  } finally {
    await f.close();
  }
});

test('P05 fast-forward-only refusal and dirty rebase Pull keep recoverable work and explicit destinations', async () => {
  test.skip(process.env.P05_BASELINE === '1', 'Capture the original dialogs only.');
  const f = await launch();
  const { page } = f;
  try {
    await f.git(['branch', '--set-upstream-to=origin/main', 'main']);
    await f.git(['commit', '--allow-empty', '-m', 'Local ahead']);
    const local = await f.git(['rev-parse', 'HEAD']);
    const peer = join(f.root, 'peer');
    await f.git(['clone', f.bare, peer]);
    await f.git(['config', 'user.name', 'Peer'], peer);
    await f.git(['config', 'user.email', 'peer@example.invalid'], peer);
    await f.git(['commit', '--allow-empty', '-m', 'Remote ahead'], peer);
    await f.git(['push', 'origin', 'main'], peer);
    const remote = await f.git(['rev-parse', 'main'], f.bare);
    await page.keyboard.press('F5');
    await expect(page.getByTestId('history-commit').first()).toContainText('Local ahead');
    await page.getByTestId('toolbar-pull').click();
    const dialog = page.getByTestId('reference-dialog');
    await expect(dialog.getByTestId('pull-into')).toHaveText('main');
    await dialog.locator('summary', { hasText: 'Options' }).click();
    await dialog.getByRole('checkbox', { name: 'Fast-forward only', exact: true }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Rebase instead of merge' })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('p05-pull-ff.png') });
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(page.getByTestId('activity')).toContainText('fast-forward pull is not possible');
    expect(await f.git(['rev-parse', 'HEAD'])).toBe(local);
    await page.keyboard.press('Escape');
    await writeFile(join(f.cwd, 'readme.txt'), 'saved local edit\n');
    await page.keyboard.press('F5');
    await expect(page.getByRole('button', { name: 'Local Changes (1)', exact: true })).toBeVisible();
    await page.getByTestId('toolbar-pull').click();
    await dialog.getByRole('checkbox', { name: 'Rebase instead of merge' }).check();
    await dialog.getByRole('checkbox', { name: 'Stash and reapply local changes' }).check();
    await page.screenshot({ path: test.info().outputPath('p05-pull-rebase.png') });
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(page.getByTestId('activity')).toContainText('Pulled changes with rebase');
    expect(await f.git(['rev-parse', 'HEAD^'])).toBe(remote);
    expect(await f.git(['diff'])).toContain('+saved local edit');
    expect(await f.git(['diff', '--cached'])).toBe('');
    expect(await f.git(['rev-parse', 'main'], f.bare)).toBe(remote);
    expect(await f.git(['stash', 'list'])).toContain('Git Workbench recovery');
  } finally {
    await f.close();
  }
});

test('P05 force preview refuses a moved remote after fetch, and stale-branch batch review protects current branch', async () => {
  test.skip(process.env.P05_BASELINE === '1', 'Capture the original dialogs only.');
  const f = await launch();
  const { page } = f;
  try {
    await f.git(['commit', '--allow-empty', '-m', 'Local work']);
    await page.keyboard.press('F5');
    await expect(page.getByTestId('history-commit').first()).toContainText('Local work');
    await page.getByTestId('toolbar-push').click();
    const dialog = page.getByTestId('reference-dialog');
    await dialog.getByTestId('push-force').check();
    await dialog.getByRole('button', { name: 'Review Force Push', exact: true }).click();
    await expect(dialog.getByTestId('push-review')).toContainText('0 remote commits');
    await page.screenshot({ path: test.info().outputPath('p05-force-review.png') });
    const peer = join(f.root, 'peer');
    await f.git(['clone', f.bare, peer]);
    await f.git(['config', 'user.name', 'Peer'], peer);
    await f.git(['config', 'user.email', 'peer@example.invalid'], peer);
    await f.git(['commit', '--allow-empty', '-m', 'Remote work'], peer);
    await f.git(['push', 'origin', 'main'], peer);
    const remote = await f.git(['rev-parse', 'main'], f.bare);
    await f.git(['fetch', 'origin']);
    await dialog.getByRole('button', { name: 'Force Push with Lease', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('activity')).toContainText('lease check refused');
    expect(await f.git(['rev-parse', 'main'], f.bare)).toBe(remote);
    await page.keyboard.press('Escape');
    await f.git(['branch', 'stale-a']);
    await f.git(['branch', 'stale-b']);
    await f.git(['push', '-u', 'origin', 'stale-a', 'stale-b']);
    await f.git(['push', 'origin', '--delete', 'stale-a', 'stale-b']);
    await page.keyboard.press('F5');
    const tree = page.getByRole('tree', { name: 'References', exact: true });
    await expect(tree.locator('[role="treeitem"][title="refs/heads/stale-a"]')).toBeVisible();
    await tree.getByRole('treeitem', { name: 'Branches', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select Stale Local Branches…', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: /stale-a/u })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /main/u })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('p05-stale-branches.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.git(['branch', '--format=%(refname)'])).toContain('refs/heads/stale-a');
    await tree.getByRole('treeitem', { name: 'Branches', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select Stale Local Branches…', exact: true }).click();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => f.git(['branch', '--format=%(refname)']))
      .toBe('refs/heads/main\nrefs/heads/topic');
    await page.keyboard.press('Escape');
    const topic = tree.getByRole('treeitem', { name: 'topic', exact: true });
    await topic.click();
    await topic.press('F2');
    await expect(dialog).toContainText('Rename Local Branch');
    expect(
      await dialog
        .getByTestId('reference-name')
        .evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart!, input.selectionEnd!)),
    ).toBe('topic');
    await expect(dialog.getByTestId('reference-dialog-submit')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('p05-rename.png') });
  } finally {
    await f.close();
  }
});
