import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('catalogue clone, additive repository list, reorder/reopen, view shortcuts and annotated tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-foundation-ui-'));
  const source = join(root, 'source');
  const other = join(root, 'other');
  const cloned = join(root, 'cloned');
  const git = new GitRunner();
  const run = async (cwd: string, ...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let application: ElectronApplication | undefined;
  try {
    for (const cwd of [source, other]) {
      await mkdir(cwd);
      await run(cwd, 'init', '--initial-branch=main');
      await run(cwd, 'config', 'user.name', 'Catalogue Author');
      await run(cwd, 'config', 'user.email', 'catalogue@example.invalid');
      await run(cwd, 'config', 'commit.gpgsign', 'false');
      await writeFile(join(cwd, 'file.txt'), 'baseline\n');
      await run(cwd, 'add', '--', 'file.txt');
      await run(cwd, 'commit', '-m', 'Catalogue baseline');
    }
    const sourceRefs = await run(source, 'show-ref');
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
    await page.keyboard.press('ControlOrMeta+n');
    const dialog = page.getByRole('dialog', { name: 'Clone', exact: true });
    await dialog.getByLabel('Repository URL:').fill(source);
    await dialog.getByLabel('Parent Folder:').fill(root);
    await dialog.getByLabel('Name:', { exact: true }).fill('cloned');
    await dialog.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Connection succeeded');
    await dialog.getByRole('button', { name: 'Clone', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^cloned, /u })).toHaveAttribute('aria-selected', 'true');
    expect(await readFile(join(cloned, 'file.txt'), 'utf8')).toBe('baseline\n');
    expect(await run(source, 'show-ref')).toBe(sourceRefs);
    await page.evaluate(async (path) => {
      const result = await window.desktop!.repository.open({ path });
      if (result.ok) await window.desktop!.repository.setTrust({ id: result.value.id, trusted: true });
      if (!result.ok) throw new Error(result.error.message);
    }, other);
    await page.reload();
    await expect(page.getByRole('tab', { name: /^other, /u })).toBeVisible();
    await page.getByRole('button', { name: 'Show repository list', exact: true }).click();
    await expect(page.getByRole('tablist', { name: 'Repository tabs' })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Repository list' })).toBeVisible();
    const strip = page.locator('.workspace-tabs.horizontal');
    await strip
      .getByRole('tab', { name: /^other, /u })
      .dragTo(strip.getByRole('tab', { name: /^cloned, /u }));
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await window.desktop!.repository.listOpen();
          return result.ok ? result.value.map((repository) => repository.name) : [];
        }),
      )
      .toEqual(['other', 'cloned']);
    await strip.getByRole('tab', { name: /^other, /u }).click();
    await page.keyboard.press('ControlOrMeta+w');
    await expect(strip.getByRole('tab', { name: /^other, /u })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('listbox', { name: 'Repository list' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+t');
    await expect(strip.getByRole('tab', { name: /^other, /u })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+1');
    await expect(page.getByTestId('commit-composer')).toBeVisible();
    await expect(strip.getByRole('tab', { name: /^other, /u })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page.getByTestId('history-commit').first()).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+g');
    const tagDialog = page.getByRole('dialog', { name: 'Create Tag', exact: true });
    await tagDialog.getByTestId('reference-name').fill('empty-annotation');
    await tagDialog.getByTestId('reference-dialog-submit').click();
    await expect(tagDialog).toHaveCount(0);
    expect(await run(other, 'cat-file', '-t', 'refs/tags/empty-annotation')).toBe('tag');
    const tags = page.getByRole('treeitem', { name: 'Tags', exact: true });
    // The tag operation finishes before the asynchronous reference refresh makes the section expandable.
    await expect(tags).toHaveAttribute('aria-expanded', /^(?:true|false)$/u);
    if ((await tags.getAttribute('aria-expanded')) === 'false') await tags.click();
    await page.getByRole('treeitem', { name: 'empty-annotation', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show Tag Details…', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Tag Details', exact: true })).toContainText(
      'Catalogue Author',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Fetch Remotes Automatically', exact: true }).click();
    expect(await page.evaluate(async () => window.desktop!.repository.getAutomaticFetch())).toMatchObject({
      ok: true,
      value: { enabled: false },
    });
    await page.screenshot({ path: 'test-results/catalogue-foundation-dark.png' });
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await page.screenshot({ path: 'test-results/catalogue-foundation-light.png' });
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
