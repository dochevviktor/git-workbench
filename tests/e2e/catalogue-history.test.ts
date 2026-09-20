import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('catalogue history navigation, search scopes, highlights and session state preserve Git checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-catalogue-history-'));
  const profile = await mkdtemp(join(tmpdir(), 'git-workbench-catalogue-history-profile-'));
  const second = await mkdtemp(join(tmpdir(), 'git-workbench-catalogue-second-'));
  const captures = process.env.HISTORY_CAPTURE_DIRECTORY ?? 'test-results';
  await mkdir(captures, { recursive: true });
  const git = new GitRunner();
  let application: ElectronApplication | undefined;
  try {
    await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: directory });
    const commands: string[] = [];
    for (let index = 1; index <= 350; index += 1) {
      const message = `Message ${index}`;
      const content = `needle[1] ${index}\n`;
      commands.push(
        `commit refs/heads/main\nmark :${index}\ncommitter Catalogue Author <catalogue@test.invalid> ${1_700_000_000 + index} +0000\ndata ${message.length}\n${message}\nM 100644 inline note[1].txt\ndata ${content.length}\n${content}\n`,
      );
    }
    commands.push('reset refs/heads/milestone/root\nfrom :1\n\n');
    commands.push(
      'commit refs/heads/other\ncommitter Other Author <other@test.invalid> 1700000400 +0000\ndata 9\nside-only\nfrom :1\n\n',
    );
    await git.run(['fast-import', '--quiet'], { cwd: directory, stdin: commands.join('') });
    await git.run(['reset', '--hard', 'main'], { cwd: directory });
    const head = (await git.run(['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
    const root = (
      await git.run(['rev-parse', 'refs/heads/milestone/root'], { cwd: directory })
    ).stdout.trim();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(async (path) => window.desktop!.repository.open({ path }), directory);
    expect(opened.ok).toBe(true);
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await page.screenshot({ path: join(captures, 'catalogue-history-before.png') });
    await page.getByRole('treeitem', { name: 'milestone', exact: true }).dblclick();
    await page.getByRole('treeitem', { name: 'root', exact: true }).click();
    await expect(page.locator('.history-full-hash')).toHaveText(root);
    await expect(page.getByText(/History from commit/u)).toBeVisible();
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await expect(page.getByTestId('diff-content')).toContainText('needle[1] 1');
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    await page.getByTestId('revision-tree-entry').filter({ hasText: 'note[1].txt' }).click();
    await expect(page.getByTestId('revision-blob')).toContainText('needle[1] 1');
    await git.run(['clone', '--quiet', '--local', directory, second], { cwd: profile });
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, second);
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Open Repository…/u }).click();
    await expect(page.getByRole('tab', { name: new RegExp(basename(second), 'u') })).toBeVisible();
    await page.getByRole('tab', { name: new RegExp(basename(directory), 'u') }).click();
    await expect(page.getByRole('tab', { name: 'File Tree', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('revision-blob')).toContainText('needle[1] 1');
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByRole('button', { name: /Local Changes/u }).click();
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('diff-content')).toContainText('needle[1] 1');
    const list = page.getByRole('listbox', { name: 'Commits', exact: true });
    await list.focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('history-commit').first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/History from commit/u)).toHaveCount(0);
    await list.focus();
    await page.keyboard.press('End');
    await expect(page.locator('.commit-row.selected')).toContainText('Message 1');
    await expect(page.locator('.commit-row.selected')).toHaveAttribute('data-commit-id', root);
    await list.focus();
    await page.keyboard.press('Home');
    for (const size of [200, 300]) {
      await page.locator('.commit-list-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.getByTestId('history-commit').first()).toHaveAttribute('aria-setsize', String(size));
    }
    expect(await page.getByTestId('history-commit').count()).toBeLessThan(100);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const input = page.getByRole('searchbox', { name: 'Search commits' });
    await input.fill('Message 25');
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result')).toHaveCount(11);
    await page
      .getByTestId('commit-search-result')
      .and(page.getByTitle('Message 25', { exact: true }))
      .click();
    await expect(page.locator('.commit-row.selected')).toContainText('Message 25');
    await expect(page.locator('.commit-row.selected .history-search-match')).toHaveText('Message 25');
    expect(await page.getByTestId('history-commit').count()).toBeGreaterThan(11);
    await page.getByRole('tab', { name: 'Commit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Message 25', exact: true })).toBeVisible();
    await expect(page.getByTestId('commit-file')).toContainText('note[1].txt');
    await page.screenshot({ path: join(captures, 'catalogue-history-search-light.png') });
    await page.getByRole('button', { name: 'Commit Message', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Author', exact: true }).click();
    await input.fill('Other Author');
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result')).toHaveCount(1);
    await page.getByRole('button', { name: 'Author', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Current Branch', exact: true }).click();
    await expect(page.getByTestId('commit-search-result')).toHaveCount(0);
    await expect(page.getByText('No commits match “Other Author”.')).toBeVisible();
    await page.getByRole('button', { name: 'Author', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Path', exact: true }).click();
    await input.fill('NOTE[1]');
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result').first()).toHaveAttribute('title', 'Message 350');
    await page.getByRole('button', { name: 'Path', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Diff Content', exact: true }).click();
    await input.fill('needle[1] 350');
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear commit search', exact: true }).click();
    await expect(page.locator('.commit-row.search-match')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('.details-panel')).toBeHidden();
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('.details-panel')).toBeVisible();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await page.screenshot({ path: join(captures, 'catalogue-history-dark.png') });
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim()).toBe(head);
    expect((await git.run(['symbolic-ref', '--short', 'HEAD'], { cwd: directory })).stdout.trim()).toBe(
      'main',
    );
    expect((await git.run(['status', '--porcelain'], { cwd: directory })).stdout).toBe('');
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await expect(page.getByRole('tab', { name: 'Commit', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  } finally {
    await application?.close();
    await rm(directory, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
