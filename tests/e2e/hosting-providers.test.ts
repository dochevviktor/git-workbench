import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('provider account forms, token entry, OAuth, removal and cancellation in Preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-provider-e2e-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    env.GIT_WORKBENCH_GITHUB_CLIENT_ID = 'synthetic_public_client_id';
    app = await electron.launch({
      chromiumSandbox: true,
      args: [
        '.',
        `--user-data-dir=${join(root, 'profile')}`,
        '--ozone-platform=headless',
        '--disable-gpu',
        '--password-store=basic',
      ],
      env,
    });
    await app.evaluate(({ clipboard, dialog, shell }) => {
      clipboard.readText = async () => {
        throw new Error('Clipboard credential acquisition is forbidden');
      };
      dialog.showOpenDialog = async () => {
        throw new Error('Token files must not be selected');
      };
      shell.openExternal = async (url) => {
        (globalThis as unknown as { opened: string }).opened = url;
      };
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (init?.redirect !== 'error') throw new Error('Redirects must be disabled');
        if (url.href === 'https://github.com/login/device/code')
          return Response.json({
            device_code: 'synthetic_device_secret',
            user_code: 'TEST-CODE',
            verification_uri: 'https://github.com/login/device',
            interval: 1,
            expires_in: 600,
          });
        if (url.href === 'https://github.com/login/oauth/access_token')
          return Response.json({ access_token: 'gho_synthetic_oauth_token', token_type: 'bearer' });
        const paths: Record<string, string> = {
          'api.github.com': '',
          'gitlab.com': '/api/v4',
          'gitea.example': '/git/api/v1',
          'enterprise.example': '/api/v3',
          'lab.example': '/api/v4',
        };
        if (!(url.hostname in paths) || !url.pathname.startsWith(`${paths[url.hostname]}/`))
          throw new Error('Unexpected provider destination');
        const headers = new Headers(init?.headers);
        if (!headers.get('Authorization')?.includes('synthetic')) throw new Error('Missing credential');
        if (url.pathname.endsWith('/user'))
          return Response.json({ id: 42, login: 'fixture-user', username: 'fixture_user' });
        return Response.json([
          {
            id: 12,
            full_name: 'example/project',
            path_with_namespace: 'group/subgroup/project',
            private: true,
            visibility: 'private',
            archived: false,
          },
        ]);
      };
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Preferences…', exact: true }).click();
    await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Preferences', exact: true });
    const provider = panel.getByLabel('Server Type:', { exact: true });
    await expect(provider.locator('option')).toHaveText([
      'Gitea',
      'GitHub',
      'GitHub Enterprise',
      'GitLab',
      'GitLab Server',
    ]);
    await expect(panel.getByRole('button', { name: 'Remove account', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('Personal access token:', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await panel.getByLabel('Personal access token:', { exact: true }).fill('synthetic_never_submitted_token');
    await provider.selectOption('gitea');
    await expect(panel.getByLabel('Access token:', { exact: true })).toHaveValue('');
    await expect(panel.getByLabel('Authentication Type:', { exact: true })).toHaveCount(0);

    for (const [id, server, tokenLabel, username] of [
      ['gitea', 'https://gitea.example/git', 'Access token:', 'fixture-user'],
      ['github-enterprise', 'https://enterprise.example', 'Personal access token:', 'fixture-user'],
      ['gitlab', '', 'Personal access token:', 'fixture_user'],
      ['gitlab-server', 'https://lab.example', 'Token:', 'fixture_user'],
    ]) {
      await provider.selectOption(id!);
      if (server) await panel.getByLabel('Server URL:', { exact: true }).fill(server);
      else await expect(panel.getByLabel('Server URL:', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${id}-form-light.png`) });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: test.info().outputPath(`${id}-form-dark.png`) });
      await page.emulateMedia({ colorScheme: 'light' });
      await panel.getByLabel(tokenLabel!, { exact: true }).fill('synthetic_personal-access-token');
      await panel.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(panel.getByRole('heading', { name: username!, exact: true })).toBeVisible();
      await expect(panel.locator('input[type="password"]')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Repositories', exact: true }).click();
      await expect(panel).toContainText(
        id!.startsWith('gitlab') ? 'group/subgroup/project' : 'example/project',
      );
      await expect(panel.getByRole('button', { name: 'Notifications', exact: true })).toHaveCount(0);
      const account = (await page.evaluate(async () => {
        const result = await window.desktop!.hosting.listAccounts();
        return result.ok ? result.value.accounts.at(-1) : undefined;
      }))!;
      const target = await page.evaluate(
        async (accountId) =>
          window.desktop!.hosting.getCloneTarget({ accountId, repositoryId: '12', protocol: 'https' }),
        account.id,
      );
      expect(target.ok && target.value.url).toContain(server ? new URL(server).host : 'gitlab.com');
      await panel.getByRole('button', { name: 'Add account', exact: true }).click();
    }
    await expect(panel.locator('.hosting-account')).toHaveCount(4);
    await provider.selectOption('github');
    await panel.getByLabel('Authentication Type:', { exact: true }).selectOption('oauth');
    await expect(panel.getByLabel('Personal access token:', { exact: true })).toHaveCount(0);
    await panel.getByLabel('Username:', { exact: true }).fill('fixture-user');
    await page.screenshot({ path: test.info().outputPath('github-oauth-form-light.png') });
    await panel.getByRole('button', { name: 'Log in with OAuth', exact: true }).click();
    await expect(panel).toContainText('TEST-CODE');
    expect(await app.evaluate(() => (globalThis as unknown as { opened: string }).opened)).toBe(
      'https://github.com/login/device',
    );
    await expect(panel.getByRole('heading', { name: 'fixture-user', exact: true })).toBeVisible();
    await expect(panel.locator('dd').filter({ hasText: /^OAuth$/u })).toBeVisible();
    await expect(panel.locator('.hosting-account')).toHaveCount(5);
    await expect(panel).not.toContainText('synthetic_device_secret');
    await expect(panel).not.toContainText('gho_synthetic_oauth_token');
    await page.screenshot({ path: test.info().outputPath('accounts-all-providers-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: test.info().outputPath('accounts-all-providers-dark.png') });
    await panel.getByRole('button', { name: 'Remove account', exact: true }).click();
    const confirmation = panel.getByRole('group', { name: 'Confirm account removal' });
    await confirmation.getByRole('button', { name: 'Cancel removal' }).click();
    await expect(panel.locator('.hosting-account')).toHaveCount(5);
    await panel.getByRole('button', { name: 'Remove account', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Remove account', exact: true }).click();
    await expect(panel.locator('.hosting-account')).toHaveCount(4);
    await panel.getByRole('button', { name: 'Add account', exact: true }).click();
    await provider.selectOption('github');
    await panel.getByLabel('Authentication Type:', { exact: true }).selectOption('oauth');
    await panel.getByRole('button', { name: 'Log in with OAuth', exact: true }).click();
    await expect(panel).toContainText('TEST-CODE');
    await panel.getByRole('button', { name: 'Cancel request', exact: true }).click();
    await expect(panel).not.toContainText('TEST-CODE');
    const cancelled = await page.evaluate(async () => window.desktop!.hosting.pollOAuth());
    expect(cancelled.ok).toBe(false);
    await expect(panel.locator('.hosting-account')).toHaveCount(4);
    await page.setViewportSize({ width: 780, height: 600 });
    await provider.selectOption('gitlab-server');
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('provider-form-narrow-dark.png') });
    await panel.press('Escape');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
