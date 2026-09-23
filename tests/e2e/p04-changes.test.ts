import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function dragText(page: Page, line: Locator) {
  const rect = await line.locator('code').evaluate((code) => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const box = range.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('P04 syntax, selected text staging/inverse, discard guard, commit failure and compact layouts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p04-'));
  const repository = join(root, 'repository');
  let application: ElectronApplication | undefined;
  try {
    await mkdir(join(repository, 'src'), { recursive: true });
    const git = new GitRunner();
    const run = async (...args: string[]) => (await git.run(args, { cwd: repository })).stdout;
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'P04 Author');
    await run('config', 'user.email', 'p04@example.test');
    const base =
      Array.from({ length: 80 }, (_, index) => `VALUE_${index + 1} = ${index + 1}`).join('\n') + '\n';
    const path = join(repository, 'src', 'demo.py');
    await writeFile(path, base);
    await writeFile(join(repository, '.gitignore'), 'ignored.txt\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'P04 base');
    const initialHead = await run('rev-parse', 'HEAD');
    const stagedText = base.replace('VALUE_10 = 10', 'VALUE_10 = 1000');
    await writeFile(path, stagedText);
    await run('add', '--', 'src/demo.py');
    const workingText = stagedText
      .replace('VALUE_40 = 40', 'VALUE_40 = 4000')
      .replace('VALUE_41 = 41', 'VALUE_41 = 4100')
      .replace('VALUE_60 = 60', 'VALUE_60 = 6000');
    await writeFile(path, workingText);
    await writeFile(join(repository, 'untracked.txt'), 'keep untracked\n');
    await writeFile(join(repository, 'ignored.txt'), 'keep ignored\n');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await expect
      .poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
      .toBe(true);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1380, 850));
    expect((await page.evaluate(openTrustedFixture, repository)).ok).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    const unstaged = page.getByTestId('working-changes-unstaged');
    const staged = page.getByTestId('working-changes-staged');
    const file = (pane: Locator) => pane.getByTestId('working-change').filter({ hasText: 'demo.py' });
    await file(unstaged).click();
    await expect(file(staged)).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.diff-cell.add')
          .filter({ hasText: 'VALUE_40 = 4000' })
          .locator('.syntax-number')
          .allTextContents(),
      )
      .toEqual(['40', '00']);
    await expect(page.getByTestId('commit-submit')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('p04-light.png') });
    await page.getByRole('button', { name: 'Increase diff context', exact: true }).click();
    await expect(page.locator('.diff-range-text').first()).toContainText('-36,10 +36,10');
    await page.getByRole('button', { name: 'Decrease diff context', exact: true }).click();
    await expect(page.locator('.diff-range-text').first()).toContainText('-37,8 +37,8');
    // A range ending at the next added line's first character must not select that line.
    await page.getByTestId('diff-content').evaluate((body) => {
      const [first, second] = body.querySelectorAll('.diff-cell.add code');
      const range = document.createRange();
      range.setStart(first!.firstChild!.firstChild!, 0);
      range.setEnd(second!.firstChild!.firstChild!, 0);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      first!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(page.locator('[data-testid="diff-line-select"]:checked')).toHaveCount(1);
    await dragText(page, page.locator('.diff-cell.add').filter({ hasText: 'VALUE_40 = 4000' }));
    await expect(page.getByTestId('diff-selection-stage')).toBeEnabled();
    await expect(page.getByTestId('diff-hunk-stage').first()).toHaveText('Stage selected lines');
    await page.getByTestId('diff-hunk-stage').first().click();
    await expect
      .poll(() => run('show', ':src/demo.py'))
      .toBe(stagedText.replace('VALUE_40 = 40\n', 'VALUE_40 = 40\nVALUE_40 = 4000\n'));
    await expect(unstaged.getByRole('tree')).toBeFocused();
    await expect(page.getByTestId('diff-selection-stage')).toHaveCount(0);
    expect(await readFile(path, 'utf8')).toBe(workingText);
    await file(staged).click();
    await dragText(page, page.locator('.diff-cell.add').filter({ hasText: 'VALUE_40 = 4000' }));
    await page.getByTestId('diff-selection-unstage').click();
    await expect.poll(() => run('show', ':src/demo.py')).toBe(stagedText);
    expect(await readFile(path, 'utf8')).toBe(workingText);
    await file(unstaged).click();
    await dragText(page, page.locator('.diff-cell.add').filter({ hasText: 'VALUE_40 = 4000' }));
    await page.getByTestId('diff-selection-discard').click();
    const discard = page.getByRole('dialog', { name: 'Discard changes', exact: true });
    await expect(discard.locator('pre')).toContainText('+VALUE_40 = 4000');
    await expect(discard.locator('pre')).not.toContainText('-VALUE_40 = 40');
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await readFile(path, 'utf8')).toBe(workingText);
    await page.getByTestId('diff-selection-discard').click();
    await expect(discard.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled();
    await writeFile(path, workingText + '# external edit after preview\n');
    await discard.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(discard.getByRole('alert')).toContainText('changed');
    expect(await readFile(path, 'utf8')).toBe(workingText + '# external edit after preview\n');
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('F5');
    await expect(page.getByTestId('diff-content')).toContainText('external edit after preview');
    await dragText(page, page.locator('.diff-cell.add').filter({ hasText: 'VALUE_40 = 4000' }));
    await page.getByTestId('diff-selection-discard').click();
    await discard.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(discard).toHaveCount(0);
    const afterDiscard = workingText.replace('VALUE_40 = 4000\n', '') + '# external edit after preview\n';
    expect(await readFile(path, 'utf8')).toBe(afterDiscard);
    expect(await run('show', ':src/demo.py')).toBe(stagedText);
    expect(await run('rev-parse', 'HEAD')).toBe(initialHead);
    await page.getByRole('button', { name: 'Local changes options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Hide Untracked Files' }).click();
    await expect(page.getByRole('button', { name: 'Local Changes (1)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Local changes options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show Ignored Files' }).click();
    await expect(unstaged).toContainText('ignored.txt');
    await expect(page.getByRole('button', { name: 'Local Changes (2)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Local changes options' }).click();
    await page.getByRole('menuitemradio', { name: 'View as List', exact: true }).click();
    await file(staged).click();
    const hook = join(repository, '.git', 'hooks', 'pre-commit');
    await writeFile(
      hook,
      `#!${process.execPath}\nprocess.stderr.write('P04 hook refused this commit\\n'); process.exit(1);\n`,
    );
    await chmod(hook, 0o755);
    await page.getByTestId('commit-subject').fill('Keep this draft');
    await page.getByTestId('commit-description').fill('A description with café and 漢字.');
    await page.getByTestId('commit-submit').click();
    await expect(page.getByTestId('commit-failure')).toContainText('P04 hook refused this commit');
    await expect(page.getByTestId('commit-subject')).toHaveValue('Keep this draft');
    await expect(page.getByTestId('commit-description')).toHaveValue('A description with café and 漢字.');
    await expect(file(staged)).toHaveAttribute('aria-selected', 'true');
    expect(await run('rev-parse', 'HEAD')).toBe(initialHead);
    expect(await run('show', ':src/demo.py')).toBe(stagedText);
    await page.screenshot({ path: test.info().outputPath('p04-hook-failure.png') });
    await page.getByTestId('commit-failure').getByRole('button', { name: 'Commit Without Hooks' }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('');
    expect(await run('show', 'HEAD:src/demo.py')).toBe(stagedText);
    expect(await run('diff', '--cached')).toBe('');
    expect(await readFile(path, 'utf8')).toBe(afterDiscard);
    await file(unstaged).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('p04-dark.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(880, 600));
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([880, 600]);
    const divider = page.getByRole('separator', { name: 'Resize local changes file list', exact: true });
    await divider.focus();
    for (let step = 0; step < 25; step++) await divider.press('ArrowRight');
    await expect(page.getByTestId('commit-amend')).toBeVisible();
    await expect(page.getByTestId('commit-submit')).toBeInViewport();
    expect(
      await page.locator('.changes-detail').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath('p04-narrow.png') });
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('p04-narrow-light.png') });
    expect(await readFile(join(repository, 'untracked.txt'), 'utf8')).toBe('keep untracked\n');
    expect(await readFile(join(repository, 'ignored.txt'), 'utf8')).toBe('keep ignored\n');
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
