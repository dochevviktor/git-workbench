import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { cpus, platform, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function historyFixture(directory: string, count: number, fileCount: number) {
  const git = new GitRunner();
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: directory });
  const source: string[] = [];
  const inert = '<script>globalThis.p03Executed = true</script>\n';
  for (let index = 1; index <= count; index++) {
    const topic = index % 100 === 99;
    const message = `Commit ${index}`;
    source.push(
      `commit refs/heads/${topic ? 'topic' : 'main'}\nmark :${index}\ncommitter History Author <history@test.invalid> ${1_700_000_000 + index} +0000\ndata ${message.length}\n${message}\n`,
    );
    if (topic) source.push(`from :${index - 1}\n`);
    if (index % 100 === 0) source.push(`merge :${index - 1}\n`);
    if (index === 1)
      for (let file = 0; file < fileCount; file++) {
        source.push(
          `M 100644 inline file-${String(file).padStart(5, '0')}.txt\ndata ${Buffer.byteLength(inert)}\n${inert}\n`,
        );
      }
    if (count < 1_000) {
      const content = `Revision ${index}\n`;
      source.push(`M 100644 inline note.txt\ndata ${content.length}\n${content}\n`);
    }
    source.push('\n');
    if (index % 100 === 0) source.push(`reset refs/heads/milestone/${index}\nfrom :${index}\n\n`);
  }
  source.push('reset refs/tags/root\nfrom :1\n\n');
  await git.run(['fast-import', '--quiet'], { cwd: directory, stdin: source.join(''), timeoutMs: 120_000 });
  await git.run(['reset', '--hard', 'main'], { cwd: directory });
  const head = (await git.run(['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  const root = (await git.run(['rev-parse', 'refs/tags/root'], { cwd: directory })).stdout.trim();
  return { git, head, root };
}

async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  const app = await electron.launch({
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
    env,
  });
  const page = await app.firstWindow();
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
  return { app, page };
}

async function painted(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test('P03 hash search, recent queries, inline changes, retained collapse selection and paged revision trees', async () => {
  const info = test.info();
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-p03-'));
  let app: ElectronApplication | undefined;
  try {
    const repo = join(directory, 'repository');
    await mkdir(repo);
    const { git, head, root } = await historyFixture(repo, 425, 5_101);
    const launched = await launch(join(directory, 'profile'));
    app = launched.app;
    const page = launched.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    expect((await page.evaluate(openTrustedFixture, repo)).ok).toBe(true);
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await page.getByRole('button', { name: 'Expand changes to note.txt', exact: true }).click();
    await expect(page.locator('.inline-commit-diff')).toContainText('Revision 425');
    await page.getByRole('button', { name: 'Collapse changes to note.txt', exact: true }).click();
    await page.getByRole('button', { name: 'Expand All', exact: true }).click();
    await expect(page.locator('.inline-commit-diff')).toContainText('Revision 425');
    await page.locator('.inline-commit-diff').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('p03-inline-light.png') });
    await page.getByRole('button', { name: 'Collapse All', exact: true }).click();

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Commit Message', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Commit SHA', exact: true }).click();
    const input = page.getByRole('searchbox', { name: 'Search commits' });
    await input.fill(root.slice(0, 10).toUpperCase());
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result')).toHaveCount(1);
    await page.getByTestId('commit-search-result').click();
    await expect(page.locator('.history-full-hash')).toHaveText(root);
    await page.locator('.commit-list-scroll').evaluate((element) => {
      element.scrollTop = 0;
    });
    await painted(page);
    const anchorRow = page.getByTestId('history-commit').first();
    const anchorId = await anchorRow.getAttribute('data-commit-id');
    const anchorY = (await anchorRow.boundingBox())!.y;
    const loadedCount = Number(await anchorRow.getAttribute('aria-setsize'));
    await page.getByRole('button', { name: 'Load newer commits', exact: true }).click();
    const retainedRow = page.locator(`[data-commit-id="${anchorId}"]`);
    await expect(retainedRow).toHaveAttribute('aria-setsize', String(loadedCount + 100));
    await expect(retainedRow).toBeInViewport();
    expect(Math.abs((await retainedRow.boundingBox())!.y - anchorY)).toBeLessThan(2);
    // An anchored page must support keyboard traversal into the adjacent newer page.
    const ordered = (await git.run(['rev-list', '--all', '--topo-order'], { cwd: repo })).stdout
      .trim()
      .split('\n');
    const firstRow = page.getByTestId('history-commit').first();
    const firstId = await firstRow.getAttribute('data-commit-id');
    const previousId = ordered[ordered.indexOf(firstId!) - 1]!;
    await firstRow.click();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.history-full-hash')).toHaveText(previousId);
    await page.getByTestId('commit-search-result').click();
    await expect(page.locator('.history-full-hash')).toHaveText(root);
    await page.getByRole('button', { name: 'Branches', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(input).toHaveValue(root.slice(0, 10).toUpperCase());
    await page.getByRole('button', { name: 'Clear commit search', exact: true }).click();
    await page.getByRole('button', { name: 'Recent searches', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(root.slice(0, 10).toUpperCase(), 'u') }).click();
    await expect(page.getByTestId('commit-search-result')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear commit search', exact: true }).click();

    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    const tree = page.getByRole('tree', { name: 'Files at revision' });
    await expect(page.getByTestId('revision-tree-entry').first()).toBeVisible();
    expect(await page.getByTestId('revision-tree-entry').count()).toBeLessThan(100);
    await tree.focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('revision-tree-more')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('revision-tree-more')).toHaveCount(0);
    await tree.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp'); // note.txt follows the final numbered file.
    await expect(page.getByTestId('revision-blob')).toContainText('globalThis.p03Executed');
    expect(await page.evaluate(() => 'p03Executed' in globalThis)).toBe(false);
    await page.screenshot({ path: info.outputPath('p03-tree-light.png') });
    await page.getByRole('button', { name: 'Local Changes', exact: true }).click();
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'File Tree', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('revision-blob')).toContainText('globalThis.p03Executed');
    await expect(tree.getByRole('treeitem', { name: 'file-05100.txt', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Commit', exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Commits', exact: true });
    await list.focus();
    await page.keyboard.press('Home');
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await expect(page.locator('.commit-row.selected')).toBeInViewport();
    const merge = page.getByTestId('history-commit').filter({ hasText: 'Commit 400' });
    await merge.click();
    const parents = await git.run(['show', '-s', '--format=%P', 'refs/heads/milestone/400'], { cwd: repo });
    const secondParent = parents.stdout.trim().split(' ')[1]!;
    await page.locator('.details-parents button').nth(1).click();
    await expect(page.locator('.history-full-hash')).toHaveText(secondParent);
    // Use a graph context target separate from selection; collapse must retain the selected commit.
    await merge.locator('.commit-subject').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Collapse All', exact: true }).click();
    await expect(page.locator('.commit-row.selected')).toHaveAttribute('data-commit-id', secondParent);
    await expect(page.locator('.history-full-hash')).toHaveText(secondParent);
    await page.keyboard.press('Control+0');
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await expect(page.getByTestId('commit-file')).toContainText('note.txt');
    await page.screenshot({ path: info.outputPath('p03-history-dark.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(880, 600));
    await painted(page);
    await page.screenshot({ path: info.outputPath('p03-history-small.png') });
    expect(errors).toEqual([]);
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()).toBe(head);
    expect((await git.run(['status', '--porcelain'], { cwd: repo })).stdout).toBe('');
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await expect(page.getByRole('tab', { name: 'Commit', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('P03 Electron cold/warm paint, navigation and memory budgets at 100k commits and 1k refs', async () => {
  const info = test.info();
  test.skip(process.env.P03_BENCHMARK !== '1', 'Run explicitly with P03_BENCHMARK=1.');
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'git-workbench-p03-scale-'));
  let app: ElectronApplication | undefined;
  try {
    const repo = join(directory, 'repository');
    await mkdir(repo);
    const { git, head, root } = await historyFixture(repo, 100_000, 5_101);
    const launched = await launch(join(directory, 'profile'));
    app = launched.app;
    const page = launched.page;
    const baselineMemory = await app.evaluate(({ app: application }) =>
      application.getAppMetrics().reduce((total, metric) => total + metric.memory.workingSetSize, 0),
    );
    const opened = await page.evaluate(openTrustedFixture, repo);
    expect(opened.ok).toBe(true);
    const coldStart = performance.now();
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await painted(page);
    const coldPaintMs = performance.now() - coldStart;
    await page.evaluate(() => {
      performance.clearMarks('p03-refreshed');
      let started = false;
      const observer = new MutationObserver(() => {
        const busy = document.querySelector('.history-view')?.getAttribute('aria-busy') === 'true';
        if (busy) started = true;
        else if (started) {
          performance.mark('p03-refreshed');
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector('.history-view')!, {
        attributes: true,
        attributeFilter: ['aria-busy'],
      });
    });
    const warmStart = performance.now();
    await page.keyboard.press('F5');
    await page.waitForFunction(() => performance.getEntriesByName('p03-refreshed').length > 0);
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await painted(page);
    const warmPaintMs = performance.now() - warmStart;
    const list = page.getByRole('listbox', { name: 'Commits', exact: true });
    await list.focus();
    const arrowStart = performance.now();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.commit-row.selected')).not.toHaveAttribute('data-commit-id', head);
    await painted(page);
    const selectionMs = performance.now() - arrowStart;
    const endStart = performance.now();
    await page.keyboard.press('End');
    await expect(page.locator('.history-full-hash')).toHaveText(root);
    await painted(page);
    const endMs = performance.now() - endStart;
    await page.keyboard.press('Home');
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    for (const count of [200, 300, 400]) {
      await page.locator('.commit-list-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.getByTestId('history-commit').first()).toHaveAttribute('aria-setsize', String(count));
    }
    const commitRows = await page.getByTestId('history-commit').count();
    await page.getByRole('treeitem', { name: 'milestone', exact: true }).dblclick();
    const referenceRows = await page.getByRole('tree', { name: 'References' }).getByRole('treeitem').count();
    const treeStart = performance.now();
    await page.getByRole('tab', { name: 'File Tree', exact: true }).click();
    await expect(page.getByTestId('revision-tree-entry').first()).toBeVisible();
    await painted(page);
    const treePaintMs = performance.now() - treeStart;
    const treeRows = await page.getByTestId('revision-tree-entry').count();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Commit Message', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Commit SHA', exact: true }).click();
    const input = page.getByRole('searchbox', { name: 'Search commits' });
    const hashStart = performance.now();
    await input.fill(root.slice(0, 10));
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result')).toHaveCount(1);
    await painted(page);
    const hashSearchMs = performance.now() - hashStart;
    await page.getByRole('button', { name: 'Commit SHA', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Commit Message', exact: true }).click();
    await input.fill('Commit');
    await input.press('Enter');
    await expect(page.getByTestId('commit-search-result').first()).toHaveAttribute('aria-setsize', '50');
    for (const count of [100, 150, 200, 250]) {
      await page.locator('.commit-search-results').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.getByTestId('commit-search-result').first()).toHaveAttribute(
        'aria-setsize',
        String(count),
      );
    }
    const searchRows = await page.getByTestId('commit-search-result').count();
    const memory = await app.evaluate(({ app: application }) =>
      application
        .getAppMetrics()
        .map((metric) => ({ type: metric.type, workingSetMiB: metric.memory.workingSetSize / 1024 })),
    );
    const cdp = await page.context().newCDPSession(page);
    const heap = await cdp.send('Runtime.getHeapUsage');
    await cdp.detach();
    const report = {
      platform: platform(),
      cpu: cpus()[0]?.model,
      totalMemoryGiB: totalmem() / 1024 ** 3,
      commits: Number((await git.run(['rev-list', '--all', '--count'], { cwd: repo })).stdout.trim()),
      refs: (await git.run(['for-each-ref', '--format=%(refname)'], { cwd: repo })).stdout.trim().split('\n')
        .length,
      coldPaintMs,
      warmPaintMs,
      selectionMs,
      endMs,
      treePaintMs,
      commitRows,
      referenceRows,
      treeRows,
      searchRows,
      hashSearchMs,
      rendererHeapMiB: heap.usedSize / 1024 ** 2,
      memory,
      processGrowthMiB: memory.reduce((sum, entry) => sum + entry.workingSetMiB, 0) - baselineMemory / 1024,
    };
    console.info(JSON.stringify(report));
    await info.attach('p03-browser-performance', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    await page.screenshot({ path: info.outputPath('p03-scale.png') });
    expect(report.commits).toBe(100_000);
    expect(report.refs).toBeGreaterThanOrEqual(1_000);
    // Set before the first run: local software-rendered Electron, cold app read / warm OS cache.
    expect(coldPaintMs).toBeLessThan(5_000);
    expect(warmPaintMs).toBeLessThan(2_500);
    expect(selectionMs).toBeLessThan(250);
    expect(endMs).toBeLessThan(3_000);
    expect(treePaintMs).toBeLessThan(3_000);
    expect(hashSearchMs).toBeLessThan(3_000);
    expect(Math.max(commitRows, referenceRows, treeRows, searchRows)).toBeLessThan(150);
    expect(report.rendererHeapMiB).toBeLessThan(128);
    expect(report.processGrowthMiB).toBeLessThan(512);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
