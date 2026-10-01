import { writeFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';
import { openTrustedFixture } from './trusted-fixture';

test('P14 browser startup, six concurrent worktree tabs and huge diff budgets', async () => {
  test.skip(process.env.P14_BENCHMARK !== '1', 'Explicit scale run: P14_BENCHMARK=1.');
  test.setTimeout(120_000);
  const f = await auditFixture();
  const { app, page } = f;
  const painted = () =>
    page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    );
  try {
    const baselineMemory = await app.evaluate(({ app: application }) =>
      application.getAppMetrics().reduce((sum, item) => sum + item.memory.workingSetSize, 0),
    );
    await writeFile(join(f.repo, 'huge.txt'), 'base\n');
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Large diff base');
    const head = await f.run('rev-parse', 'HEAD');
    expect((await page.evaluate(openTrustedFixture, f.repo)).ok).toBe(true);
    for (let index = 1; index <= 5; index++) {
      const linked = join(f.root, `linked-${index}`);
      await f.run('worktree', 'add', '-q', '-b', `linked-${index}`, linked);
      expect((await page.evaluate(openTrustedFixture, linked)).ok).toBe(true);
    }
    const restoreStart = performance.now();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Repository tabs' }).getByRole('tab')).toHaveCount(6);
    await page.getByRole('tab', { name: /^Café audit,/ }).click();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await painted();
    const restoreSixTabsMs = performance.now() - restoreStart;
    await writeFile(
      join(f.repo, 'huge.txt'),
      Array.from({ length: 60_000 }, (_, index) => `changed line ${index}\n`).join(''),
    );
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('working-change').filter({ hasText: 'huge.txt' })).toBeVisible();
    await page.getByTestId('working-change').filter({ hasText: 'huge.txt' }).click();
    const load = page.getByRole('button', { name: 'Load Diff', exact: true });
    await expect(load).toBeVisible();
    const diffStart = performance.now();
    await load.click();
    await expect(page.getByTestId('diff-content')).toContainText('changed line 0');
    await painted();
    const diffPaintMs = performance.now() - diffStart;
    const renderedRows = await page.locator('[data-line-anchor]').count();
    const scrollStart = performance.now();
    await page.getByTestId('diff-content').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.getByTestId('diff-content')).toContainText('changed line 59999');
    await painted();
    const diffScrollMs = performance.now() - scrollStart;
    const tabStart = performance.now();
    await page.getByRole('tab', { name: /^linked-1,/ }).click();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await painted();
    const tabSwitchMs = performance.now() - tabStart;
    const cdp = await page.context().newCDPSession(page);
    const heap = await cdp.send('Runtime.getHeapUsage');
    await cdp.detach();
    const memory = await app.evaluate(({ app: application }) =>
      application
        .getAppMetrics()
        .map((item) => ({ type: item.type, workingSetMiB: item.memory.workingSetSize / 1024 })),
    );
    const report = {
      cpu: cpus()[0]?.model,
      cpus: cpus().length,
      kernel: release(),
      memoryGiB: totalmem() / 1024 ** 3,
      startupMs: f.startupMs,
      restoreSixTabsMs,
      diffPaintMs,
      diffScrollMs,
      tabSwitchMs,
      diffLines: 60_000,
      tabs: 6,
      renderedRows,
      rendererHeapMiB: heap.usedSize / 1024 ** 2,
      processGrowthMiB: memory.reduce((sum, item) => sum + item.workingSetMiB, 0) - baselineMemory / 1024,
      memory,
    };
    await writeFile(test.info().outputPath('browser-performance.json'), JSON.stringify(report, null, 2));
    await page.screenshot({ path: test.info().outputPath('six-tabs.png') });
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect(await f.run('diff', '--cached', '--name-only')).toBe('');
    expect(f.startupMs).toBeLessThan(5_000);
    expect(restoreSixTabsMs).toBeLessThan(5_000);
    expect(diffPaintMs).toBeLessThan(3_000);
    expect(diffScrollMs).toBeLessThan(750);
    expect(tabSwitchMs).toBeLessThan(1_000);
    expect(renderedRows).toBeLessThan(700);
    expect(report.rendererHeapMiB).toBeLessThan(192);
    expect(report.processGrowthMiB).toBeLessThan(512);
  } finally {
    await f.close();
  }
});
