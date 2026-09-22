import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('F29 accounts, paged repositories, browser links, clone selection and sign-out through Electron', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-hosting-e2e-'));
  const tokenPath = join(root, 'synthetic-token');
  const profile = join(root, 'profile');
  await writeFile(tokenPath, 'synthetic_github_token_for_e2e', { mode: 0o600 });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    app = await electron.launch({
      chromiumSandbox: true,
      args: [
        '.',
        `--user-data-dir=${profile}`,
        '--ozone-platform=headless',
        '--disable-gpu',
        '--password-store=basic',
      ],
      env,
    });
    await app.evaluate(({ dialog, shell }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      shell.openExternal = async (url) => {
        (globalThis as unknown as { openedUrl: string }).openedUrl = url;
      };
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (!url.startsWith('https://api.github.com/') || init?.redirect !== 'error')
          throw new Error('Unexpected origin');
        if (url.endsWith('/user')) return Response.json({ id: 42, login: 'synthetic-account' });
        const state = globalThis as unknown as { hostingFailure?: boolean };
        if (state.hostingFailure)
          return Response.json({ message: 'synthetic secret must not appear' }, { status: 401 });
        const second = new URL(url).searchParams.get('page') === '2';
        return Response.json(
          [
            {
              id: second ? 13 : 12,
              full_name: second ? 'example/second' : 'example/project',
              private: !second,
              archived: second,
            },
          ],
          { headers: second ? {} : { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } },
        );
      };
    }, tokenPath);
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const openAccounts = async () => {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Accounts…', exact: true }).click();
    };
    await openAccounts();
    let accounts = page.getByRole('dialog', { name: 'Accounts', exact: true });
    await expect(accounts).toContainText('No connected accounts');
    await expect(accounts.getByRole('checkbox')).toBeDisabled();
    await accounts.getByRole('button', { name: 'Add GitHub account…' }).click();
    await expect(accounts.getByRole('heading', { name: 'synthetic-account' })).toBeVisible();
    await expect(accounts).toContainText('This application session only');
    await page.screenshot({ path: test.info().outputPath('f29-account.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: test.info().outputPath('f29-account-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await accounts.getByRole('button', { name: 'Repositories', exact: true }).click();
    await expect(accounts).toContainText('example/project');
    await accounts.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(accounts).toContainText('example/second');
    await expect(accounts.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await accounts.getByRole('button', { name: 'Previous', exact: true }).click();
    await accounts.getByRole('textbox', { name: 'Filter loaded repositories' }).fill('missing');
    await expect(accounts).toContainText('No matches on this page');
    await accounts.getByRole('textbox', { name: 'Filter loaded repositories' }).fill('project');
    await accounts.getByRole('button', { name: 'Pull requests', exact: true }).click();
    expect(await app.evaluate(() => (globalThis as unknown as { openedUrl: string }).openedUrl)).toBe(
      'https://github.com/example/project/pulls',
    );
    await accounts.getByRole('combobox', { name: 'Clone protocol' }).selectOption('ssh');
    await page.screenshot({ path: test.info().outputPath('f29-repositories.png') });
    await accounts.getByRole('button', { name: 'Clone…', exact: true }).click();
    const clone = page.getByRole('dialog', { name: 'Clone', exact: true });
    await expect(clone.getByRole('textbox', { name: 'Repository URL:' })).toHaveValue(
      'git@github.com:example/project.git',
    );
    await expect(clone.getByRole('textbox', { name: 'Name:', exact: true })).toHaveValue('project');
    await page.screenshot({ path: test.info().outputPath('f29-clone.png') });
    await clone.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openAccounts();
    accounts = page.getByRole('dialog', { name: 'Accounts', exact: true });
    await accounts.getByRole('button', { name: 'Repositories', exact: true }).click();
    await app.evaluate(() => {
      (globalThis as unknown as { hostingFailure: boolean }).hostingFailure = true;
    });
    await accounts.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(accounts.getByRole('alert')).toContainText('expired or was revoked');
    await expect(accounts).not.toContainText('synthetic secret');
    await accounts.getByRole('button', { name: 'Account', exact: true }).click();
    await accounts.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(accounts).toContainText('No connected accounts');
    await accounts.press('Escape');
    await expect(accounts).toHaveCount(0);
    await expect(stat(join(profile, 'hosting-credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(tokenPath, 'utf8')).toBe('synthetic_github_token_for_e2e');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
