import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { createCredentialBroker } from '../../src/backend/git/credential-broker';
import { GitRunner } from '../../src/backend/git/runner';

test('F29 accounts, paged repositories, browser links, clone selection and sign-out through Electron', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-hosting-e2e-'));
  const profile = join(root, 'profile');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    env.GIT_WORKBENCH_GITHUB_CLIENT_ID = '';
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
    await app.evaluate(async ({ dialog, shell, clipboard }) => {
      dialog.showOpenDialog = async () => {
        throw new Error('Account login must not select a file');
      };
      clipboard.readText = async () => {
        throw new Error('Account login must not read the clipboard');
      };
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
        if (url.includes('/notifications?'))
          return Response.json([
            {
              id: '9',
              unread: true,
              reason: 'mention',
              updated_at: '2026-09-22T10:00:00Z',
              repository: { full_name: 'example/project' },
              subject: {
                type: 'Issue',
                title: 'Notification title',
                url: 'https://api.github.com/repos/example/project/issues/8',
              },
            },
          ]);
        if (url.includes('/search/issues?')) {
          const query = new URL(url).searchParams.get('q') ?? '';
          const pull = query.includes('is:pr');
          return Response.json({
            total_count: 1,
            incomplete_results: false,
            items: query.includes('author:nobody')
              ? []
              : [
                  {
                    id: 7,
                    number: 8,
                    title: pull ? 'Review this change' : '<script>Issue title</script>',
                    state: 'open',
                    updated_at: '2026-09-22T10:00:00Z',
                    repository_url: 'https://api.github.com/repos/example/project',
                    ...(pull ? { pull_request: {} } : {}),
                  },
                ],
          });
        }
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
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    // Exercise the shipped helper with Electron's Node mode, not only the source under Node tests.
    const broker = await createCredentialBroker({
      source: {
        available: async () => true,
        get: async () => ({ username: 'synthetic-account', password: 'synthetic_github_token_for_e2e' }),
      },
      executable: await app.evaluate(() => process.execPath),
      helperPath: resolve('out/main/credential-helper.cjs'),
    });
    try {
      const result = await new GitRunner().run([...broker.args, 'credential', 'fill'], {
        cwd: root,
        env: broker.env,
        stdin: 'protocol=https\nhost=github.com\npath=example/project.git\n\n',
      });
      expect(result.stdout.includes('password=synthetic_github_token_for_e2e')).toBe(true);
    } finally {
      await broker.close();
    }
    const openAccounts = async () => {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Accounts…', exact: true })).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'Preferences…', exact: true }).click();
      await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    };
    await openAccounts();
    let accounts = page.getByRole('dialog', { name: 'Preferences', exact: true });
    await expect(accounts).toContainText('No connected accounts');
    await expect(accounts.getByRole('checkbox')).toBeDisabled();
    await accounts.getByLabel('Authentication Type:', { exact: true }).selectOption('oauth');
    await expect(accounts.getByLabel('Username:', { exact: true })).toBeVisible();
    await expect(accounts).toContainText('GitHub OAuth is not configured');
    await expect(accounts.getByRole('button', { name: 'Log in with OAuth', exact: true })).toBeDisabled();
    await accounts.getByLabel('Authentication Type:', { exact: true }).selectOption('token');
    await page.screenshot({ path: test.info().outputPath('accounts-login-light.png') });
    await accounts
      .getByLabel('Personal access token:', { exact: true })
      .fill('synthetic_github_token_for_e2e');
    await accounts.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(accounts.getByRole('heading', { name: 'synthetic-account' })).toBeVisible();
    await expect(accounts).toContainText('This application session only');
    await expect(accounts).toContainText('Default account');
    await expect(accounts).not.toContainText('synthetic_github_token_for_e2e');
    await accounts.getByRole('button', { name: 'Update token…', exact: true }).click();
    await accounts.getByLabel('Personal access token:', { exact: true }).fill('not a valid token');
    await accounts.getByRole('button', { name: 'Update token', exact: true }).click();
    await expect(accounts.getByRole('alert')).toContainText('Enter a valid access token');
    await expect(accounts.getByLabel('Personal access token:', { exact: true })).toHaveValue('');
    await accounts.getByRole('button', { name: 'Cancel update', exact: true }).click();
    await accounts.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(accounts).toContainText('Notification title');
    await accounts.getByRole('button', { name: '#8 Notification title' }).click();
    expect(await app.evaluate(() => (globalThis as unknown as { openedUrl: string }).openedUrl)).toBe(
      'https://github.com/example/project/issues/8',
    );
    await page.screenshot({ path: test.info().outputPath('f30-notifications.png') });
    await accounts.getByRole('combobox', { name: 'Notification state' }).selectOption('all');
    await accounts.getByRole('checkbox', { name: 'Participating only' }).check();
    await accounts.getByRole('button', { name: 'Apply filters' }).click();
    await expect(accounts).toContainText('Notification title');
    await accounts.getByRole('button', { name: 'Repositories', exact: true }).click();
    await accounts.getByRole('button', { name: 'Browse issues', exact: true }).click();
    await expect(accounts).toContainText('<script>Issue title</script>');
    await accounts.getByRole('textbox', { name: 'Author', exact: true }).fill('nobody');
    await accounts.getByRole('button', { name: 'Apply filters' }).click();
    await expect(accounts).toContainText('No matching items.');
    await accounts.getByRole('button', { name: 'Repositories', exact: true }).click();
    await accounts.getByRole('button', { name: 'Browse pull requests', exact: true }).click();
    await expect(accounts).toContainText('Review this change');
    await page.screenshot({ path: test.info().outputPath('f30-pull-requests.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: test.info().outputPath('f30-pull-requests-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await accounts.getByRole('button', { name: '#8 Review this change' }).click();
    expect(await app.evaluate(() => (globalThis as unknown as { openedUrl: string }).openedUrl)).toBe(
      'https://github.com/example/project/pull/8',
    );
    await accounts.getByRole('button', { name: 'Account', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('f29-account.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: test.info().outputPath('f29-account-dark.png') });
    await page.setViewportSize({ width: 780, height: 600 });
    expect(await accounts.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('accounts-narrow-dark.png') });
    await page.setViewportSize({ width: 1280, height: 820 });
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
    accounts = page.getByRole('dialog', { name: 'Preferences', exact: true });
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
    // Closing Preferences aborts a pending login; a late identity cannot restore its account.
    await openAccounts();
    await app.evaluate(async () => {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/user'))
          return new Promise<Response>((done) => {
            (globalThis as unknown as { finishLogin: () => void }).finishLogin = () =>
              done(Response.json({ id: 42, login: 'synthetic-account' }));
          });
        return original(input, init);
      };
    });
    await accounts
      .getByLabel('Personal access token:', { exact: true })
      .fill('synthetic_github_token_for_e2e');
    await accounts.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect
      .poll(() =>
        app!.evaluate(() => typeof (globalThis as unknown as { finishLogin?: unknown }).finishLogin),
      )
      .toBe('function');
    await accounts.press('Escape');
    await app.evaluate(() => (globalThis as unknown as { finishLogin: () => void }).finishLogin());
    await openAccounts();
    await expect(accounts).toContainText('No connected accounts');
    await accounts.press('Escape');
    await expect(stat(join(profile, 'hosting-credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
