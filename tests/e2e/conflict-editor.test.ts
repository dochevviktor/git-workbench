import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

function environment(): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  result.ELECTRON_RENDERER_URL = '';
  return result;
}

test('F17 opens the two-input conflict helper, stages the result, and commits the merge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-conflict-ui-'));
  const cwd = join(root, 'work');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    await mkdir(cwd);
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'Conflict UI');
    await run('config', 'user.email', 'conflict-ui@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'conflict.txt'), 'header\nbase value\nfooter\n');
    await run('add', '--all');
    await run('commit', '--quiet', '-m', 'base');
    await run('checkout', '--quiet', '-b', 'feature');
    await writeFile(join(cwd, 'conflict.txt'), 'header\nfeature value\nfooter\n');
    await run('commit', '--quiet', '-am', 'feature');
    await run('checkout', '--quiet', 'main');
    await writeFile(join(cwd, 'conflict.txt'), 'header\nmain value\nfooter\n');
    await run('commit', '--quiet', '-am', 'main');
    const before = await run('rev-parse', 'HEAD');

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    expect((await page.evaluate(openTrustedFixture, cwd)).ok).toBe(true);
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toBeVisible();

    await page.getByRole('treeitem', { name: 'feature', exact: true }).click({ button: 'right' });
    await page
      .getByRole('menu', { name: 'feature', exact: true })
      .getByRole('menuitem', { name: "Merge 'feature' into 'main'…", exact: true })
      .click();
    await page.getByTestId('reference-dialog-submit').click();
    await expect(page.getByTestId('reference-dialog')).toHaveCount(0);
    await expect.poll(() => run('ls-files', '--unmerged')).toContain('conflict.txt');
    await expect(page.getByTestId('working-changes')).toBeVisible();

    await page.getByRole('button', { name: /Local Changes/u }).click();
    const row = page
      .getByTestId('working-changes-unstaged')
      .getByTestId('working-change')
      .filter({ hasText: 'conflict.txt' });
    await row.click();
    await page.getByTestId('open-conflict-resolver').click();
    const resolver = page.getByTestId('conflict-resolver');
    await expect(resolver).toContainText("Current 'main'");
    await expect(resolver).toContainText("Merged 'feature'");
    await expect(resolver.getByText('0/1 conflict regions resolved', { exact: true })).toBeVisible();
    await expect(resolver.getByTestId('conflict-ours')).toContainText('main value');
    await expect(resolver.getByTestId('conflict-theirs')).toContainText('feature value');
    await resolver.getByTestId('conflict-result').fill('header\nfeature value\nfooter\n');
    await resolver.getByRole('button', { name: 'Resolve and Stage', exact: true }).click();
    await expect(resolver).toHaveCount(0);
    await expect.poll(() => run('ls-files', '--unmerged')).toBe('');
    await expect(page.getByTestId('working-changes-staged')).toContainText('conflict.txt');

    await page.getByTestId('commit-submit').click();
    await expect.poll(() => run('rev-parse', 'HEAD')).not.toBe(before);
    expect((await run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toHaveLength(2);
    expect(await readFile(join(cwd, 'conflict.txt'), 'utf8')).toBe('header\nfeature value\nfooter\n');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
