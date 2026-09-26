import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p08-ui-'));
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'Investigation Author');
  await run('config', 'user.email', 'investigation@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await run('config', 'core.autocrlf', 'false');
  const commit = async (subject: string) => {
    await run('add', '-A');
    await run('commit', '-qm', subject);
    return run('rev-parse', 'HEAD');
  };
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
  return { root, cwd, git, run, commit, launch };
}

test('P08 directory and selected-code history, compact blame navigation and exact historical Save As', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    await mkdir(join(f.cwd, 'old'));
    await writeFile(join(f.cwd, 'old/code.txt'), 'Alpha\nBeta\nGamma\nDelta\nEpsilon\n');
    await f.commit('Create original file');
    await writeFile(join(f.cwd, 'old/code.txt'), 'Alpha\nBeta revised\nGamma\nDelta\nEpsilon\n');
    await f.commit('Edit selected code');
    await f.run('mv', 'old', 'source');
    await f.commit('Move source directory');
    await writeFile(join(f.cwd, 'source/code.txt'), 'Alpha\nBeta revised\nGamma\nDelta\nEdit elsewhere\n');
    await writeFile(join(f.cwd, 'source/second.txt'), 'Second file\r\n');
    const head = await f.commit('Update other lines');
    const before = await f.run('ls-files', '--stage');
    app = await f.launch();
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    const folder = page.getByRole('treeitem', { name: 'source', exact: true });
    await folder.click({ button: 'right' });
    const historyWindow = app.waitForEvent('window');
    await page.getByRole('menuitem', { name: 'History…', exact: true }).click();
    const history = await historyWindow;
    await expect(history.getByTestId('file-history-revision')).toHaveCount(4);
    await history.getByRole('combobox', { name: 'Historical changed file' }).selectOption('1');
    await expect(history.getByTestId('diff-content')).toContainText('Second file');
    await history.screenshot({ path: test.info().outputPath('directory-history-light.png') });
    const destination = join(f.root, 'historical.txt');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, destination);
    await history.getByRole('button', { name: 'Save As…', exact: true }).click();
    await expect.poll(async () => readFile(destination, 'utf8').catch(() => '')).toBe('Second file\r\n');
    const [selectedFileDetails] = await Promise.all([
      app.waitForEvent('window'),
      history.getByRole('button', { name: 'Open Commit Details', exact: true }).click(),
    ]);
    await expect(selectedFileDetails.getByTestId('commit-change-preview')).toContainText('source/second.txt');
    await selectedFileDetails.close();
    await history.getByTestId('file-history-revision').last().click();
    await expect(history.locator('.file-history-diff-path')).toHaveText('old/code.txt');
    await expect(history.getByTestId('diff-content')).toContainText('Beta');
    await history.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await history.setViewportSize({ width: 760, height: 600 });
    await expect(history.getByRole('button', { name: 'Save As…', exact: true })).toBeInViewport();
    await history.screenshot({ path: test.info().outputPath('directory-history-dark-narrow.png') });
    await history.close();

    await folder.dblclick();
    await page.getByRole('treeitem', { name: 'code.txt', exact: true }).click();
    const code = page.getByTestId('revision-blob');
    await expect(code).toContainText('Beta revised');
    await code.evaluate((element) => {
      const node = element.firstChild!;
      const range = document.createRange();
      range.setStart(node, 6);
      range.setEnd(node, 18);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await code.click({ button: 'right', position: { x: 45, y: 30 } });
    await expect(
      page.getByRole('menuitem', { name: 'History for Selected Lines…', exact: true }),
    ).toBeEnabled();
    const linesWindow = app.waitForEvent('window');
    await page.getByRole('menuitem', { name: 'History for Selected Lines…', exact: true }).click();
    const lines = await linesWindow;
    await expect(lines.getByTestId('file-history-revision')).toHaveCount(2);
    await expect(lines.locator('.file-inspector-path')).toContainText('Lines 2–2');
    await expect(lines.getByTestId('file-history-revision').first()).toContainText('Edit selected code');
    await lines.screenshot({ path: test.info().outputPath('selected-code-history.png') });
    await lines.close();

    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByTestId('commit-change').filter({ hasText: 'code.txt' }).click();
    for (const [text, count] of [
      ['Edit elsewhere', 2],
      ['Epsilon', 1],
    ] as const) {
      const source = page.getByTestId('diff-line').filter({ hasText: text }).locator('code');
      await source.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await source.click({ button: 'right', position: { x: 20, y: 8 } });
      const action = page.getByRole('menuitem', { name: 'History for Selected Lines…', exact: true });
      await expect(action).toBeEnabled();
      const [selected] = await Promise.all([app.waitForEvent('window'), action.click()]);
      await expect(selected.getByTestId('file-history-revision')).toHaveCount(count);
      await expect(selected.locator('.file-inspector-path')).toContainText('Lines 5–5');
      await selected.close();
    }
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();

    const blameWindow = app.waitForEvent('window');
    await page.getByRole('treeitem', { name: 'code.txt', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Blame / Timeline', exact: true }).click();
    const blame = await blameWindow;
    await expect(blame.getByTestId('blame-line')).toHaveCount(5);
    expect((await blame.getByTestId('blame-line').first().boundingBox())!.height).toBeLessThanOrEqual(22);
    await expect(blame.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    await expect(blame.getByRole('button', { name: 'Forward', exact: true })).toBeDisabled();
    await blame.getByRole('combobox', { name: 'Blame revision' }).selectOption('2');
    await expect(blame.locator('.file-inspector-path')).toContainText('old/code.txt');
    await blame.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(blame.locator('.file-inspector-path')).toContainText('source/code.txt');
    await blame.getByRole('button', { name: 'Forward', exact: true }).click();
    await expect(blame.locator('.file-inspector-path')).toContainText('old/code.txt');
    await blame.getByRole('button', { name: 'Back', exact: true }).click();
    await blame.screenshot({ path: test.info().outputPath('blame-light.png') });
    const detailsWindow = app.waitForEvent('window');
    await blame.getByRole('button', { name: / · Edit selected code$/u }).click();
    const details = await detailsWindow;
    await expect(details.getByTestId('commit-inspector')).toBeVisible();
    await expect(details.getByTestId('commit-change-preview')).toContainText('old/code.txt');
    await details.close();
    await blame.close();
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect(await f.run('ls-files', '--stage')).toBe(before);
    expect(await f.run('status', '--porcelain')).toBe('');
  } catch (error) {
    if (app)
      await test.info().attach('investigation-state', {
        body: await (await app.firstWindow()).locator('body').innerText(),
        contentType: 'text/plain',
      });
    throw error;
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P08 mailbox preflight and merge-parent patch export preserve reviewed Git state', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    await writeFile(join(f.cwd, 'file.txt'), 'base\r\n');
    const base = await f.commit('Base');
    await writeFile(join(f.cwd, 'file.txt'), 'one\r\n');
    await f.commit('Mailed one');
    await writeFile(join(f.cwd, 'file.txt'), 'two\r\n');
    await f.commit('Mailed two');
    const mailedTree = await f.run('rev-parse', 'HEAD^{tree}');
    const mailbox = (await f.git.run(['format-patch', '--stdout', '-2'], { cwd: f.cwd })).stdout;
    await f.run('reset', '--hard', base);
    app = await f.launch();
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, f.cwd)).ok).toBe(true);
    await page.reload();
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), mailbox);
    const importPatch = async () => {
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Repository', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Apply Patch from Clipboard…', exact: true }).click();
    };
    await importPatch();
    const dialog = page.getByRole('dialog', { name: 'Apply Patch', exact: true });
    await expect(dialog.getByRole('status')).toContainText('2 patches');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('status', '--porcelain')).toBe('');
    await importPatch();
    await expect(dialog.getByRole('status')).toContainText('2 patches');
    await page.screenshot({ path: test.info().outputPath('mailbox-preflight.png') });
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await f.run('write-tree')).toBe(mailedTree);
    expect(await f.run('rev-parse', 'HEAD')).toBe(base);
    expect(await readFile(join(f.cwd, 'file.txt'), 'utf8')).toBe('two\r\n');
    await f.commit('Applied mailbox');
    await f.run('checkout', '-qb', 'side');
    await writeFile(join(f.cwd, 'side.txt'), 'side\n');
    await f.commit('Side change');
    await f.run('checkout', 'main');
    await writeFile(join(f.cwd, 'main.txt'), 'main\n');
    await f.commit('Main change');
    await f.run('merge', '--no-ff', '-m', 'Merge for export', 'side');
    const merge = await f.run('rev-parse', 'HEAD');
    await page.keyboard.press('F5');
    await page
      .locator(`[data-testid="history-commit"][data-commit-id="${merge}"]`)
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save as Patch…', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Create Patch', exact: true });
    await exportDialog.getByRole('combobox', { name: 'Patch parent' }).selectOption('2');
    await exportDialog.getByRole('combobox', { name: 'Patch destination' }).selectOption('clipboard');
    await page.screenshot({ path: test.info().outputPath('merge-parent-export.png') });
    await exportDialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(exportDialog).toHaveCount(0);
    const exported = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(exported).toBe(
      (
        await f.git.run(['diff', '--binary', '--full-index', '--find-renames', `${merge}^2`, merge, '--'], {
          cwd: f.cwd,
        })
      ).stdout,
    );
    expect(await f.run('rev-parse', 'HEAD')).toBe(merge);
    expect(await f.run('status', '--porcelain')).toBe('');
  } catch (error) {
    if (app)
      await test.info().attach('patch-state', {
        body: await (await app.firstWindow()).locator('body').innerText(),
        contentType: 'text/plain',
      });
    throw error;
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('P08 lost commits recover to named branch and annotated tag while the checkout stays intact', async () => {
  const f = await fixture();
  let app: ElectronApplication | undefined;
  try {
    await writeFile(join(f.cwd, 'file.txt'), 'base\n');
    const base = await f.commit('Base');
    await writeFile(join(f.cwd, 'file.txt'), 'lost\n');
    const lost = await f.commit('Lost work');
    await f.run('reset', '--hard', base);
    app = await f.launch();
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, f.cwd)).ok).toBe(true);
    await page.reload();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show Lost Commits (Reflog)', exact: true }).click();
    const row = page.locator(`[data-testid="history-commit"][data-commit-id="${lost}"]`);
    await expect(row).toHaveClass(/dimmed/u);
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Branch…', exact: true }).click();
    const dialog = page.getByTestId('reference-dialog');
    await dialog.getByTestId('reference-name').fill('recovered/work');
    await dialog.getByTestId('reference-checkout').uncheck();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => f.run('rev-parse', 'refs/heads/recovered/work')).toBe(lost);
    if (await page.getByTestId('activity').isVisible()) await page.getByTestId('toolbar-activity').click();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Tag…', exact: true }).click();
    await dialog.getByTestId('reference-name').fill('recovered-tag');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => f.run('rev-parse', 'refs/tags/recovered-tag^{}')).toBe(lost);
    expect(await f.run('cat-file', '-t', 'refs/tags/recovered-tag')).toBe('tag');
    if (await page.getByTestId('activity').isVisible()) await page.getByTestId('toolbar-activity').click();
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await expect(page.getByTestId('reflog-banner')).toHaveCount(0);
    await expect(row)
      .toBeVisible()
      .catch(async (error: unknown) => {
        await test.info().attach('reflog-exit-state', {
          body: await page.locator('body').innerText(),
          contentType: 'text/plain',
        });
        await test.info().attach('reflog-exit-data', {
          body: JSON.stringify(
            await page.evaluate(async () => {
              const open = await window.desktop!.repository.listOpen();
              if (!open.ok || !open.value[0]) return open;
              return window.desktop!.repository.getHistory({ id: open.value[0].id, offset: 0, limit: 100 });
            }),
          ),
          contentType: 'application/json',
        });
        throw error;
      });
    expect(await f.run('rev-parse', 'HEAD')).toBe(base);
    expect(await f.run('symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await readFile(join(f.cwd, 'file.txt'), 'utf8')).toBe('base\n');
    expect(await f.run('status', '--porcelain')).toBe('');
    await page.screenshot({ path: test.info().outputPath('named-reflog-recovery.png') });
  } catch (error) {
    if (app)
      await test.info().attach('recovery-state', {
        body: await (await app.firstWindow()).locator('body').innerText(),
        contentType: 'text/plain',
      });
    throw error;
  } finally {
    await app?.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
