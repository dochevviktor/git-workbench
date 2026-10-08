import { openTrustedFixture } from './trusted-fixture';
import { launchOptions } from './launch-options';
import { chooseCommand } from './choose-command';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F33 settings, historical diff, terminal, merge review, removal and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f33-e2e-'));
  const cwd = join(root, "Café ' repository");
  const profile = join(root, 'profile');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(cwd);
    const git = new GitRunner();
    const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'F33 UI');
    await run('config', 'user.email', 'f33@example.test');
    await run('config', 'core.autocrlf', 'false');
    await writeFile(join(cwd, 'value.txt'), 'base\n');
    await run('add', '.');
    await run('commit', '-qm', 'Base');
    const base = await run('rev-parse', 'HEAD');
    await writeFile(join(cwd, 'value.txt'), 'middle\n');
    await run('commit', '-qam', 'Middle');
    await writeFile(join(cwd, 'value.txt'), 'latest\n');
    await run('commit', '-qam', 'Latest');
    const before = await run('show-ref');
    const index = await run('write-tree');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    const launch = () => electron.launch(launchOptions(profile, env));
    app = await launch();
    await app.evaluate(({ dialog }, executable) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] });
    }, process.execPath);
    let page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const settings = () => page.getByRole('dialog', { name: 'External Tools', exact: true });
    const openSettings = async () => {
      await chooseCommand(page, 'External Tools…');
      await expect(settings()).toBeVisible();
    };
    await openSettings();
    await settings().getByLabel('Name', { exact: true }).fill('Historical Viewer');
    await settings().getByRole('button', { name: 'Browse…', exact: true }).click();
    await expect(settings().getByLabel('Path', { exact: true })).toHaveValue(process.execPath);
    await settings()
      .getByLabel('Arguments (JSON array)')
      .fill(
        JSON.stringify([
          '-e',
          "console.log(JSON.stringify(process.argv.slice(1).map(p=>require('node:fs').readFileSync(p,'utf8'))))",
          '$REMOTE',
          '$LOCAL',
        ]),
      );
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings().getByRole('button', { name: 'Historical Viewer', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/f33-settings-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: 'test-results/f33-settings-dark.png' });
    await page.setViewportSize({ width: 780, height: 650 });
    expect(await settings().evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/f33-settings-narrow.png' });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.emulateMedia({ colorScheme: 'light' });
    await settings().getByRole('button', { name: 'Add', exact: true }).click();
    await settings().getByLabel('Tool type').selectOption('terminal');
    await settings().getByLabel('Name', { exact: true }).fill('Repository Terminal');
    await settings().getByLabel('Path', { exact: true }).fill(process.execPath);
    await settings()
      .getByLabel('Arguments (JSON array)')
      .fill(JSON.stringify(['-e', 'console.log(process.cwd())']));
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await settings().getByRole('button', { name: 'Add', exact: true }).click();
    await settings().getByLabel('Tool type').selectOption('merge');
    await settings().getByLabel('Name', { exact: true }).fill('Review Merger');
    await settings().getByLabel('Path', { exact: true }).fill(process.execPath);
    await settings()
      .getByLabel('Arguments (JSON array)')
      .fill(
        JSON.stringify(['-e', "require('node:fs').writeFileSync(process.argv[1],'reviewed\\n')", '$MERGED']),
      );
    await settings().getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings().getByRole('button', { name: 'Review Merger', exact: true })).toBeVisible();
    await settings().getByRole('button', { name: 'Close', exact: true }).click();
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await page.getByTestId('history-commit').filter({ hasText: 'Middle' }).click();
    await page.locator('.commit-details').getByText('value.txt', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Diff in Historical Viewer…', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'Historical Viewer', exact: true });
    await viewer.getByRole('button', { name: 'Launch Tool' }).click();
    await expect(viewer.getByRole('status')).toHaveText('Command completed.');
    await expect(viewer).toContainText('["base\\n","middle\\n"]');
    await page.screenshot({ path: 'test-results/f33-historical-light.png' });
    await viewer.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await readFile(join(cwd, 'value.txt'), 'utf8')).toBe('latest\n');
    expect(await run('show-ref')).toBe(before);
    expect(await run('write-tree')).toBe(index);
    await chooseCommand(page, 'Open in Repository Terminal…');
    const terminal = page.getByRole('dialog', { name: 'Repository Terminal', exact: true });
    await terminal.getByRole('button', { name: 'Launch Tool' }).click();
    await expect(terminal.getByRole('status')).toHaveText('Command completed.');
    await expect(terminal).toContainText(cwd);
    await terminal.getByRole('button', { name: 'Close', exact: true }).click();
    await run('checkout', '-qb', 'side', base);
    await writeFile(join(cwd, 'value.txt'), 'side\n');
    await run('commit', '-qam', 'Side');
    await run('checkout', 'main');
    await expect(run('merge', 'side')).rejects.toThrow();
    const conflictBefore = await readFile(join(cwd, 'value.txt'), 'utf8');
    await page.reload();
    await page.getByRole('button', { name: /Local Changes/u }).click();
    await page
      .getByTestId('working-changes-unstaged')
      .getByTestId('working-change')
      .filter({ hasText: 'value.txt' })
      .click();
    await page.getByTestId('open-conflict-resolver').click();
    const resolver = page.getByTestId('conflict-resolver');
    await resolver.getByRole('button', { name: 'Merge in Review Merger…', exact: true }).click();
    const merger = page.getByRole('dialog', { name: 'Review Merger', exact: true });
    await merger.getByRole('button', { name: 'Launch Tool' }).click();
    await expect(merger.getByRole('button', { name: 'Review Merge Output' })).toBeVisible();
    expect(await readFile(join(cwd, 'value.txt'), 'utf8')).toBe(conflictBefore);
    expect(await run('ls-files', '-u')).not.toBe('');
    await merger.getByRole('button', { name: 'Review Merge Output' }).click();
    await expect(resolver.getByTestId('conflict-result')).toHaveValue('reviewed\n');
    await page.screenshot({ path: 'test-results/f33-merge-review.png' });
    await resolver.getByRole('button', { name: 'Resolve and Stage', exact: true }).click();
    await expect.poll(() => run('ls-files', '-u')).toBe('');
    expect(await readFile(join(cwd, 'value.txt'), 'utf8')).toBe('reviewed\n');
    const mergeHead = await run('rev-parse', 'HEAD');
    await page.getByTestId('commit-submit').click();
    await expect.poll(() => run('rev-parse', 'HEAD')).not.toBe(mergeHead);
    expect((await run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toHaveLength(2);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await openSettings();
    await settings().getByRole('button', { name: 'Historical Viewer', exact: true }).click();
    await settings().getByLabel('Name', { exact: true }).fill('Unsaved name');
    await page.keyboard.press('Escape');
    await openSettings();
    await expect(settings().getByRole('button', { name: 'Historical Viewer', exact: true })).toBeVisible();
    await settings().getByRole('button', { name: 'Historical Viewer', exact: true }).click();
    await settings().getByRole('button', { name: 'Remove…' }).click();
    await settings().getByRole('button', { name: 'Keep Tool' }).click();
    await expect(settings().getByRole('button', { name: 'Historical Viewer', exact: true })).toBeVisible();
    await settings().getByRole('button', { name: 'Remove…' }).click();
    await settings().getByRole('button', { name: 'Remove Tool', exact: true }).click();
    await expect(settings().getByRole('button', { name: 'Historical Viewer', exact: true })).toHaveCount(0);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
