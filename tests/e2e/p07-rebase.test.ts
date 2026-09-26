import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p07-ui-'));
  const cwd = join(root, 'work');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Rebase Author');
  await run('config', 'user.email', 'rebase@example.test');
  await run('config', 'commit.gpgsign', 'false');
  for (const name of ['Baseline', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']) {
    await writeFile(join(cwd, `${name.toLowerCase()}.txt`), `${name}\n`);
    await run('add', '--all');
    await run('commit', '--quiet', '-m', `Add ${name}`);
  }
  const base = await run('rev-parse', 'HEAD~6');
  const head = await run('rev-parse', 'HEAD');
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
  return { root, cwd, run, base, head, launch };
}

async function planDialog(page: Page, commitId: string, action = "Rebase 'main' to Here…") {
  await page
    .locator(`[data-testid="history-commit"][data-commit-id="${commitId}"]`)
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Interactive Rebase', exact: true }).hover();
  await page
    .getByRole('menu', { name: 'Interactive Rebase', exact: true })
    .getByRole('menuitem', { name: action, exact: true })
    .click();
  const dialog = page.getByTestId('reference-dialog');
  await expect(dialog.getByTestId('interactive-rebase-row').first()).toBeVisible();
  return dialog;
}

test('P07 plan presentation and Cancel preserve history', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    app = await f.launch();
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, f.cwd)).ok).toBe(true);
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'light';
    });
    const dialog = await planDialog(page, f.base);
    await expect(dialog.getByTestId('interactive-rebase-row')).toHaveCount(6);
    await expect(dialog.getByText('zeta.txt', { exact: true })).toBeVisible();
    expect(
      (await dialog.getByTestId('interactive-rebase-row').first().boundingBox())!.height,
    ).toBeLessThanOrEqual(24);
    await page.screenshot({ path: `test-results/p07-${process.env.P07_CAPTURE ?? 'after'}/plan.png` });
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.screenshot({ path: 'test-results/p07-after/plan-dark.png' });
    await page.setViewportSize({ width: 880, height: 600 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.25);
    });
    await expect(dialog.getByTestId('reference-dialog-submit')).toBeInViewport();
    await page.screenshot({ path: 'test-results/p07-after/plan-small-125.png' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P07 compact actions, combined message editing and dependent branch execution', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    await f.run('branch', 'gamma-tip', 'HEAD~3');
    app = await f.launch();
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, f.cwd)).ok).toBe(true);
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'light';
    });
    const dialog = await planDialog(page, f.base);
    const row = (name: string) =>
      dialog.getByTestId('interactive-rebase-row').filter({ hasText: `Add ${name}` });
    await row('Zeta').getByRole('button', { name: 'Action for Add Zeta' }).click();
    await page.getByRole('menuitem', { name: 'Move Down', exact: true }).click();
    await row('Zeta').press('Control+ArrowDown');
    await row('Epsilon').press('d');
    await row('Delta').press('r');
    await dialog
      .getByRole('textbox', { name: 'Commit subject', exact: true })
      .fill('Delta after reordered Zeta');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await row('Beta').press('f');
    await row('Gamma').press('s');
    await row('Alpha').press('r');
    await expect(dialog.getByRole('textbox', { name: 'Commit description' })).toHaveValue('Add Gamma');
    await dialog.getByRole('textbox', { name: 'Commit description' }).fill('Reviewed combined message');
    await page.screenshot({ path: 'test-results/p07-after/combined-message.png' });
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Update dependent branches' }).check();
    await dialog.getByRole('checkbox', { name: 'Backup current state with a temporary branch' }).check();
    await expect(dialog.getByTestId('rebase-dependent-branches')).toContainText('gamma-tip');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => f.run('log', '--format=%s', `${f.base}..HEAD`))
      .toBe('Delta after reordered Zeta\nAdd Zeta\nAdd Alpha');
    expect(await f.run('show', '-s', '--format=%B', 'HEAD~2')).toBe('Add Alpha\n\nReviewed combined message');
    expect(await f.run('rev-parse', 'gamma-tip')).toBe(await f.run('rev-parse', 'HEAD~2'));
    expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('epsilon.txt');
    expect(await f.run('status', '--porcelain')).toBe('');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rebase-backups')).toBeVisible();
    await page.getByTestId('rebase-backups').locator('summary').click();
    await expect(page.getByRole('button', { name: 'Inspect original history' })).toBeEnabled();
    expect(await f.run('for-each-ref', '--format=%(objectname)', 'refs/heads/rebase-backup/')).toBe(f.head);
    await page.getByRole('button', { name: 'Recover as branch…' }).click();
    await expect(page.getByTestId('reference-dialog')).toContainText('Original history before rebase');
    await page.getByTestId('reference-dialog').getByTestId('reference-name').fill('recovered-original');
    await page.getByTestId('reference-dialog-submit').click();
    await expect.poll(() => f.run('rev-parse', 'recovered-original').catch(() => '')).toBe(f.head);
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P07 Edit quick action survives restart at pause and after amendment', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    const gamma = await f.run('rev-parse', 'HEAD~3');
    const tree = await f.run('rev-parse', 'HEAD^{tree}');
    app = await f.launch();
    let page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, f.cwd)).ok).toBe(true);
    await page.reload();
    const dialog = await planDialog(page, gamma, 'Edit…');
    await expect(dialog.getByTestId('interactive-rebase-row').last()).toContainText('Edit');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(page.getByTestId('recovery-panel')).toContainText('Paused for Edit');
    expect(await f.run('branch', '--show-current')).toBe('');
    await app.close();
    app = await f.launch();
    page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Amend in Local Changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Amend in Local Changes' }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Add Gamma');
    expect(await f.run('status', '--porcelain')).toBe('');
    await page.screenshot({ path: 'test-results/p07-after/edit-pause.png' });
    await page.getByTestId('commit-subject').fill('Gamma amended in the UI');
    await page.getByTestId('commit-submit').click();
    await expect(page.getByTestId('commit-submit')).toHaveText('Continue Rebase');
    await app.close();
    app = await f.launch();
    page = await app.firstWindow();
    await expect(page.getByTestId('recovery-panel')).toContainText('Amendment saved');
    await page.getByRole('button', { name: 'Continue rebase', exact: true }).click();
    await expect.poll(() => f.run('branch', '--show-current')).toBe('main');
    expect(await f.run('rev-parse', 'HEAD^{tree}')).toBe(tree);
    expect(await f.run('show', '-s', '--format=%s', 'HEAD~3')).toBe('Gamma amended in the UI');
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P07 published-history warning, Reword cancellation, root and drag entry points', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    await f.run('update-ref', 'refs/remotes/origin/main', 'HEAD');
    app = await f.launch();
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, f.cwd)).ok).toBe(true);
    await page.reload();
    let dialog = await planDialog(page, f.head, 'Reword…');
    await expect(dialog.getByRole('textbox', { name: 'Commit subject' })).toHaveValue('Add Zeta');
    await dialog.getByRole('textbox', { name: 'Commit subject' }).fill('Unsaved draft');
    await dialog.getByRole('button', { name: 'Cancel message' }).click();
    await expect(dialog.getByTestId('interactive-rebase-row').first()).toContainText('Add Zeta');
    await expect(dialog.getByTestId('reference-dialog-submit')).toBeDisabled();
    await dialog
      .getByRole('checkbox', { name: 'I understand that published history will be rewritten' })
      .check();
    await expect(dialog.getByTestId('reference-dialog-submit')).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    dialog = await planDialog(page, f.base, "Rebase 'main' from Root…");
    await expect(dialog.getByTestId('interactive-rebase-row')).toHaveCount(7);
    const rows = dialog.getByTestId('interactive-rebase-row');
    const firstId = await rows.first().getAttribute('data-commit-id');
    await rows.first().dragTo(rows.nth(2));
    await expect(rows.nth(2)).toHaveAttribute('data-commit-id', firstId!);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
