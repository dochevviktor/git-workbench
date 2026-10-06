import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('hover hunk controls, resizable/hideable/popped-out details and split toolbar actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-interactions-'));
  const repository = join(root, 'repository');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd: repository })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(repository);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'Interaction Author');
    await run('config', 'user.email', 'interaction@example.invalid');
    await run('config', 'commit.gpgsign', 'false');
    const base =
      [
        `function ${'longFunctionName'.repeat(50)}() {`,
        ...Array.from({ length: 100 }, (_value, index) => `  value_${index} = ${index};`),
        '}',
      ].join('\n') + '\n';
    await writeFile(join(repository, 'long.ts'), base);
    await run('add', '--all');
    await run('commit', '-m', 'First commit');
    const first = await run('rev-parse', 'HEAD');
    await writeFile(join(repository, 'notes.txt'), 'Selected revision contents\n');
    await run('add', '--all');
    await run('commit', '-m', 'Second commit');
    const head = await run('rev-parse', 'HEAD');
    const changed = base
      .replace('value_20 = 20;', `value_20 = "${'long content '.repeat(400)}";`)
      .replace('value_80 = 80;', 'value_80 = 8000;');
    await writeFile(join(repository, 'long.ts'), changed);
    const before = await run('status', '--porcelain');
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    environment.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment,
    });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await expect(page.getByRole('button', { name: 'Branch', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.evaluate(async (path) => {
      const result = await window.desktop!.repository.open({ path });
      if (result.ok) await window.desktop!.repository.setTrust({ id: result.value.id, trusted: true });
      if (!result.ok) throw new Error(result.error.message);
    }, repository);
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toContainText('Second commit');

    // Primary actions open their form; only the narrow right segment opens the command menu.
    const branch = page.getByRole('button', { name: 'Branch', exact: true });
    await expect(branch).not.toHaveAttribute('aria-disabled', 'true');
    await branch.click();
    await expect(page.getByRole('dialog', { name: 'Create Branch', exact: true })).toBeVisible();
    await expect(page.getByRole('menu', { name: 'Branch', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const branchMenu = page.getByRole('button', { name: 'Branch menu', exact: true });
    expect((await branchMenu.boundingBox())!.width).toBeLessThan((await branch.boundingBox())!.width);
    await branchMenu.click();
    await expect(page.getByRole('menu', { name: 'Branch', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Stash', exact: true }).click();
    await expect(page.getByTestId('stash-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Stash menu', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu', { name: 'Stash', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await page.getByTestId('working-change').filter({ hasText: 'long.ts' }).click();
    const body = page.getByTestId('diff-content');
    const region = page.getByTestId('diff-change-region').first();
    const stage = page.getByTestId('diff-hunk-stage').first();
    const range = page.getByTestId('diff-range-line').first();
    await expect(page.locator('.diff-hunk-header')).toHaveCount(0);
    await expect(range).toContainText('@@');
    await branch.hover();
    await expect(stage).toBeHidden();
    await region.hover({ position: { x: 120, y: 4 } });
    await expect(stage).toBeVisible();
    expect(await range.getByRole('button').count()).toBe(0);
    const rangeLeft = await range
      .locator('.diff-range-text')
      .evaluate((element) => element.getBoundingClientRect().left);
    await body.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect.poll(() => body.evaluate((element) => element.scrollLeft)).toBeGreaterThan(1000);
    await expect
      .poll(() =>
        range.locator('.diff-range-text').evaluate((element) => element.getBoundingClientRect().left),
      )
      .toBeLessThan(rangeLeft - 1000);
    const bounds = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('[data-testid="diff-content"]')!;
      const highlight = body.querySelector<HTMLElement>('.diff-hunk-highlight')!;
      const action = highlight.querySelector<HTMLElement>('button')!;
      return {
        body: body.getBoundingClientRect().toJSON(),
        highlight: highlight.getBoundingClientRect().toJSON(),
        action: action.getBoundingClientRect().toJSON(),
        clientWidth: body.clientWidth,
      };
    });
    expect(Math.abs(bounds.highlight.left - bounds.body.left)).toBeLessThan(2);
    expect(bounds.highlight.width).toBeLessThanOrEqual(bounds.clientWidth + 1);
    expect(bounds.action.left).toBeGreaterThanOrEqual(bounds.body.left);
    expect(bounds.action.right).toBeLessThanOrEqual(bounds.body.right);
    await page.screenshot({ path: 'test-results/hunk-hover-scrolled.png' });
    await branch.hover();
    await expect(stage).toBeHidden();
    await region.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await expect(stage).toBeVisible();
    await stage.click();
    await expect
      .poll(() => run('show', ':long.ts'))
      .toBe(changed.replace('value_80 = 8000;', 'value_80 = 80;').trim());
    expect(await readFile(join(repository, 'long.ts'), 'utf8')).toBe(changed);

    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    const details = page.getByRole('region', { name: 'Commit details', exact: true });
    const splitter = page.getByRole('separator', { name: 'Resize commit details', exact: true });
    const initialHeight = (await details.boundingBox())!.height;
    const grip = (await splitter.boundingBox())!;
    await page.mouse.move(grip.x + 100, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 100, grip.y - 100, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await details.boundingBox())!.height).toBeGreaterThan(initialHeight + 80);
    const resizedHeight = (await details.boundingBox())!.height;
    await page.getByRole('button', { name: 'Hide commit details', exact: true }).click();
    await expect(details.getByRole('tabpanel')).toHaveCount(0);
    await expect(details.getByRole('tab', { name: 'Commit', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show commit details', exact: true }).click();
    expect(Math.abs((await details.boundingBox())!.height - resizedHeight)).toBeLessThan(3);
    await splitter.focus();
    await page.keyboard.press('ArrowDown');
    expect(Math.abs((await details.boundingBox())!.height - (resizedHeight - 16))).toBeLessThan(3);
    await page.keyboard.press('ArrowUp');
    await details.getByRole('tab', { name: 'Changes', exact: true }).click();
    await expect(page.getByTestId('commit-change')).toContainText('notes.txt');
    const childEvent = application.waitForEvent('window');
    await page.getByRole('button', { name: 'Pop out commit details', exact: true }).click();
    const child = await childEvent;
    child.on('pageerror', (error) => errors.push(error.message));
    await expect(child.getByTestId('commit-inspector')).toBeVisible();
    const inspectorContext = await child.evaluate(async () =>
      window.desktop!.repository.getCommitDetailsContext(),
    );
    if (!inspectorContext.ok) throw new Error(inspectorContext.error.message);
    await expect(child.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(child.getByTestId('diff-content')).toContainText('Selected revision contents');
    expect(
      await child.evaluate(() => ({ require: 'require' in window, ipc: 'ipcRenderer' in window })),
    ).toEqual({ require: false, ipc: false });
    expect(
      await child.evaluate(async (path) => window.desktop!.repository.open({ path }), repository),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await child.evaluate(async () => window.desktop!.window.command({ action: 'quit' })),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await page.getByTestId('history-commit').filter({ hasText: 'First commit' }).click();
    await child.getByRole('tab', { name: 'Commit', exact: true }).click();
    await expect(child.locator('.history-full-hash')).toHaveText(head);
    await expect(page.getByTestId('history-commit').filter({ hasText: 'First commit' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await details.getByRole('tab', { name: 'File Tree', exact: true }).click();
    await page.getByTestId('revision-tree-entry').filter({ hasText: 'long.ts' }).click();
    const treeWindow = application.waitForEvent('window');
    await page.getByRole('button', { name: 'Pop out commit details', exact: true }).click();
    const treeChild = await treeWindow;
    await expect(treeChild.getByRole('tab', { name: 'File Tree', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(treeChild.getByTestId('revision-blob')).toContainText('value_20 = 20');
    await expect(treeChild.getByTestId('revision-tree-entry').filter({ hasText: 'long.ts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await treeChild.close();
    await expect(child.getByTestId('commit-inspector')).toBeVisible();
    await child.screenshot({ path: 'test-results/commit-details-window.png' });
    await child.getByRole('button', { name: first.slice(0, 7), exact: true }).click();
    await expect(child.locator('.history-full-hash')).toHaveText(first);
    await page.bringToFront();
    await page.keyboard.press('ControlOrMeta+w');
    await expect(page.getByRole('heading', { name: 'Repository Manager' })).toBeVisible();
    expect(
      await child.evaluate(
        async ({ id, commitId }) =>
          window.desktop!.repository.getRevisionBlob({ id, commitId, path: 'long.ts' }),
        { id: inspectorContext.value.repositoryId, commitId: first },
      ),
    ).toMatchObject({ ok: true });
    const closed = child.waitForEvent('close');
    await page
      .evaluate(async () => window.desktop!.window.command({ action: 'close' }))
      .catch((reason: unknown) => {
        if (!(reason instanceof Error) || !reason.message.includes('has been closed')) throw reason;
      });
    await closed;
    expect(errors).toEqual([]);
    expect(await run('rev-parse', 'HEAD')).toBe(head);
    expect(before).toContain('long.ts');
  } finally {
    await application?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
