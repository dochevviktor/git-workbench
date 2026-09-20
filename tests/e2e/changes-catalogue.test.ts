import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

// Playwright requires a destructured fixture argument even when this Electron scenario uses no fixtures.
// eslint-disable-next-line no-empty-pattern
test('catalogue Local Changes selection, full-file hunk focus, popup, discard and large diff', async ({}, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-catalogue-changes-'));
  const repository = join(root, 'repository');
  await mkdir(repository);
  const git = new GitRunner();
  const run = (args: readonly string[]) => git.run(args, { cwd: repository });
  const base =
    Array.from({ length: 300 }, (_, index) => `Line ${index + 1} original synthetic content`).join('\n') +
    '\n';
  let application: ElectronApplication | undefined;
  try {
    await run(['init', '--quiet', '--initial-branch=main']);
    await run(['config', 'user.name', 'Catalogue Author']);
    await run(['config', 'user.email', 'catalogue@example.test']);
    for (const [file, contents] of [
      ['long.txt', base],
      ['other.txt', 'Original other file\n'],
      ['large.txt', 'large before\n'],
      ['rename-old.txt', 'rename only\n'],
      ['wide.txt', 'old '.repeat(200) + '\n'],
    ] as const)
      await writeFile(join(repository, file), contents);
    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 1, 2]));
    await run(['add', '--all']);
    await run(['commit', '--quiet', '-m', 'Reference fixture']);
    await run(['mv', '--', 'rename-old.txt', 'rename-new.txt']);
    await writeFile(
      join(repository, 'long.txt'),
      base
        .replace('Line 20 original', 'Line 20 changed')
        .replace('Line 150 original', 'Line 150 changed')
        .replace('Line 270 original', 'Line 270 changed'),
    );
    await writeFile(join(repository, 'other.txt'), 'Changed other file\n');
    await writeFile(
      join(repository, 'large.txt'),
      Array.from({ length: 60000 }, (_, index) => `new line ${index}`).join('\n') + '\n',
    );
    await writeFile(join(repository, 'wide.txt'), 'new '.repeat(200) + '\n');
    await writeFile(join(repository, 'binary.bin'), Buffer.from([0, 3, 4, 5]));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (value !== undefined && key !== 'DISPLAY' && key !== 'WAYLAND_DISPLAY') env[key] = value;
    env.ELECTRON_RENDERER_URL = '';
    const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
    application = await electron.launch({
      chromiumSandbox: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ['.']),
        `--user-data-dir=${join(root, 'profile')}`,
        '--ozone-platform=headless',
        '--disable-gpu',
      ],
      env,
    });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await expect
      .poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
      .toBe(true);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1800, 1200));
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1800, 1200]);
    await page.evaluate(async (path) => {
      const result = await window.desktop!.repository.open({ path });
      if (!result.ok) throw new Error(result.error.message);
    }, repository);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    const unstaged = page.getByTestId('working-changes-unstaged');
    const staged = page.getByTestId('working-changes-staged');
    await unstaged.getByTestId('working-change').filter({ hasText: 'long.txt' }).click();
    await expect(page.getByTestId('diff-hunk-stage')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('catalogue-local-changes-before.png') });
    await page.getByRole('button', { name: 'Increase diff context', exact: true }).click();
    await expect(page.locator('.diff-context-controls')).toContainText('6');
    await page.getByRole('button', { name: 'Diff options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show Entire File', exact: true }).click();
    await expect(page.getByTestId('diff-content')).toContainText('Line 300 original');
    await expect(page.getByTestId('diff-hunk-stage')).toHaveCount(3);
    await page.getByTestId('diff-content').evaluate((element) => {
      const line = element.querySelector<HTMLElement>('[data-line-anchor="109"]');
      if (line) element.scrollTop += line.getBoundingClientRect().top - element.getBoundingClientRect().top;
    });
    const scrollBefore = await page.getByTestId('diff-content').evaluate((element) => element.scrollTop);
    await page.getByTestId('diff-hunk-stage').nth(1).click();
    await expect(staged.getByTestId('working-change').filter({ hasText: 'long.txt' })).toBeVisible();
    await expect(page.getByTestId('diff-hunk-stage')).toHaveCount(2);
    await expect
      .poll(async () => (await run(['show', ':long.txt'])).stdout)
      .toBe(base.replace('Line 150 original', 'Line 150 changed'));
    expect(
      Math.abs(
        (await page.getByTestId('diff-content').evaluate((element) => element.scrollTop)) - scrollBefore,
      ),
    ).toBeLessThan(60);
    await expect(unstaged.getByRole('tree')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('catalogue-local-changes-hunk-after.png') });
    await unstaged.getByTestId('working-change').filter({ hasText: 'other.txt' }).click();
    await unstaged.getByTestId('working-change').filter({ hasText: 'long.txt' }).click();
    await expect(page.getByTestId('diff-content')).toContainText('Line 300 original');
    expect(
      Math.abs(
        (await page.getByTestId('diff-content').evaluate((element) => element.scrollTop)) - scrollBefore,
      ),
    ).toBeLessThan(60);
    const secondRepository = join(root, 'anchor-other');
    await mkdir(secondRepository);
    await git.run(['init', '--quiet'], { cwd: secondRepository });
    await page.evaluate(async (path) => {
      const result = await window.desktop!.repository.open({ path });
      if (!result.ok) throw new Error(result.error.message);
    }, secondRepository);
    await page.keyboard.press('F5');
    await page.getByRole('tab', { name: /^anchor-other,/u }).click();
    await expect(page.getByTestId('working-changes')).toHaveCount(0);
    await page.getByRole('tab', { name: /^repository,/u }).click();
    await expect(page.getByTestId('diff-content')).toContainText('Line 300 original');
    expect(
      Math.abs(
        (await page.getByTestId('diff-content').evaluate((element) => element.scrollTop)) - scrollBefore,
      ),
    ).toBeLessThan(60);
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(unstaged.getByTestId('working-change').filter({ hasText: 'long.txt' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('diff-content')).toContainText('Line 300 original');
    expect(
      Math.abs(
        (await page.getByTestId('diff-content').evaluate((element) => element.scrollTop)) - scrollBefore,
      ),
    ).toBeLessThan(60);
    await page.getByRole('button', { name: 'Open diff popup', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Diff popup', exact: true });
    await expect(popup.locator('.diff-body')).toHaveClass(/split/u);
    await popup.getByRole('button', { name: 'Diff options', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Word Wrap' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await popup.getByRole('button', { name: 'Close', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(popup.locator('header')).toContainText('other.txt');
    await page.screenshot({ path: testInfo.outputPath('catalogue-diff-popup.png') });
    await page.keyboard.press('Space');
    await expect(popup).toHaveCount(0);
    await expect(unstaged.getByTestId('working-change').filter({ hasText: 'other.txt' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const beforeCancel = (await run(['diff', '--binary'])).stdout;
    await unstaged.getByTestId('working-change').filter({ hasText: 'other.txt' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Discard Changes…', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Discard changes', exact: true });
    await expect(discard.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('catalogue-discard-preview.png') });
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await run(['diff', '--binary'])).stdout).toBe(beforeCancel);
    await unstaged.getByRole('tree').focus();
    await page.keyboard.press('Delete');
    await discard.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(discard).toHaveCount(0);
    expect(await readFile(join(repository, 'other.txt'), 'utf8')).toBe('Original other file\n');
    expect((await run(['show', ':long.txt'])).stdout).toBe(
      base.replace('Line 150 original', 'Line 150 changed'),
    );
    await unstaged.getByTestId('working-change').filter({ hasText: 'large.txt' }).click();
    await expect(page.getByRole('button', { name: 'Load Diff', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Load Diff', exact: true }).click();
    await expect(page.getByTestId('diff-content')).toBeVisible();
    await expect(page.getByTestId('diff-line')).toHaveCount(600);
    await page.getByRole('searchbox', { name: 'Search diff', exact: true }).fill('new line 59999');
    await expect(page.locator('[data-diff-match-active="true"]')).toHaveText('new line 59999');
    await page.screenshot({ path: testInfo.outputPath('catalogue-large-diff.png') });
    await unstaged.getByTestId('working-change').filter({ hasText: 'binary.bin' }).click();
    await expect(page.locator('.binary-diff-cards')).toContainText('4 bytes');
    await unstaged.getByTestId('working-change').filter({ hasText: 'large.txt' }).click();
    await expect(page.getByRole('button', { name: 'Load Diff', exact: true })).toBeVisible();
    await unstaged.getByTestId('working-change').filter({ hasText: 'wide.txt' }).click();
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    const horizontalBefore = await page.getByTestId('diff-content').evaluate((element) => ({
      gutter: element.querySelector('.old .diff-line-number')!.getBoundingClientRect().left,
      old: element.querySelector('.old .diff-line-text')!.getBoundingClientRect().left,
      next: element.querySelector('.new .diff-line-text')!.getBoundingClientRect().left,
    }));
    await page.getByTestId('diff-content').evaluate((element) => {
      element.scrollLeft = 300;
    });
    await expect
      .poll(() =>
        page
          .getByTestId('diff-content')
          .evaluate((element) => element.querySelector('.old .diff-line-text')!.getBoundingClientRect().left),
      )
      .toBeLessThan(horizontalBefore.old - 250);
    const horizontalAfter = await page.getByTestId('diff-content').evaluate((element) => ({
      gutter: element.querySelector('.old .diff-line-number')!.getBoundingClientRect().left,
      next: element.querySelector('.new .diff-line-text')!.getBoundingClientRect().left,
    }));
    expect(horizontalAfter.gutter).toBe(horizontalBefore.gutter);
    expect(horizontalAfter.next).toBeLessThan(horizontalBefore.next - 250);
    await page.getByRole('button', { name: 'Unified', exact: true }).click();
    await page.getByRole('button', { name: 'Diff options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Word Wrap', exact: true }).click();
    await expect(page.getByTestId('diff-content')).toHaveClass(/wrap/u);
    await staged.getByTestId('working-change').filter({ hasText: 'rename-new.txt' }).click();
    await expect(page.getByText('No textual changes for this file.', { exact: true })).toBeVisible();
    await page.getByTestId('commit-subject').fill('Durable draft');
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Durable draft');
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Durable draft');
    const beforeAmend = (await run(['ls-files', '--stage'])).stdout;
    await page.getByTestId('commit-subject').fill('');
    await page.getByTestId('commit-amend').check();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Reference fixture');
    await expect(page.getByTestId('commit-submit')).toHaveText('Amend Last Commit');
    await page.getByTestId('commit-amend').uncheck();
    await expect(page.getByTestId('commit-subject')).toHaveValue('');
    expect((await run(['ls-files', '--stage'])).stdout).toBe(beforeAmend);
    await unstaged.getByTestId('working-change').filter({ hasText: 'long.txt' }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('catalogue-local-changes-dark.png') });
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
