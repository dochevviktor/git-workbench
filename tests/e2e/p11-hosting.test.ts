import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';

async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  env.GIT_WORKBENCH_GITHUB_CLIENT_ID = 'synthetic_public_client';
  const app = await electron.launch({
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
  await app.evaluate(({ shell, safeStorage }) => {
    // Simulate a keyring in an isolated profile; no real desktop keyring or hosting account is touched.
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
    safeStorage.encryptString = (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x5a));
    safeStorage.decryptString = (value) =>
      Buffer.from(value)
        .map((byte) => byte ^ 0x5a)
        .toString();
    shell.openExternal = async (url) => {
      (globalThis as unknown as { opened: string }).opened = url;
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (init?.redirect !== 'error') throw new Error('Redirect policy changed');
      const state = globalThis as unknown as { notifications?: number; failure?: boolean };
      if (url.hostname === 'api.github.com' || url.hostname === 'enterprise.example') {
        if (url.pathname.endsWith('/user')) return Response.json({ id: 42, login: 'example' });
        if (url.pathname.endsWith('/notifications')) {
          state.notifications = (state.notifications ?? 0) + 1;
          if (state.failure) return Response.json({ message: 'secret must not be shown' }, { status: 401 });
          return Response.json([
            {
              id: '9',
              unread: true,
              reason: 'mention',
              updated_at: '2026-09-30T12:00:00Z',
              repository: { full_name: 'example/project' },
              subject: {
                type: 'Issue',
                title: '<script>Notification remains text</script>',
                url: `${url.origin}${url.hostname === 'api.github.com' ? '' : '/api/v3'}/repos/example/project/issues/8`,
              },
            },
          ]);
        }
        if (url.pathname.endsWith('/search/issues'))
          return Response.json({
            total_count: 1,
            incomplete_results: false,
            items: [
              {
                id: 7,
                number: 8,
                title: 'Review the change',
                state: 'open',
                updated_at: '2026-09-30T12:00:00Z',
                repository_url: `${url.origin}${url.hostname === 'api.github.com' ? '' : '/api/v3'}/repos/example/project`,
                ...(url.searchParams.get('q')?.includes('is:pr') ? { pull_request: {} } : {}),
              },
            ],
          });
        if (url.pathname.endsWith('/user/repos'))
          return Response.json([{ id: 12, full_name: 'example/project', private: true, archived: false }]);
      }
      if (url.hostname === 'api.bitbucket.org') {
        if (url.pathname.endsWith('/user')) return Response.json({ uuid: 'user-uuid', nickname: 'example' });
        if (url.pathname.endsWith('/user/workspaces'))
          return Response.json({
            values: [{ workspace: { slug: 'owned' } }, { workspace: { slug: 'shared' } }],
          });
        if (url.pathname.endsWith('/repositories/owned') || url.pathname.endsWith('/repositories/shared')) {
          const workspace = url.pathname.split('/').at(-1)!;
          return Response.json({
            values: [{ uuid: `${workspace}-uuid`, full_name: `${workspace}/project`, is_private: true }],
          });
        }
      }
      if (url.hostname === 'bb.example') {
        if (url.pathname.endsWith('/users/example')) return Response.json({ id: 42, name: 'example' });
        if (url.pathname.endsWith('/repos'))
          return Response.json({
            values: [{ id: 12, project: { key: 'PROJECT' }, slug: 'repo', public: false }],
            isLastPage: true,
          });
      }
      throw new Error('Unexpected fixture URL');
    };
  });
  const page = await app.firstWindow();
  await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
  return { app, page };
}
async function openAccounts(page: Awaited<ReturnType<typeof launch>>['page']) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Preferences…', exact: true }).click();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  return page.getByRole('dialog', { name: 'Preferences', exact: true });
}

test('P11 opt-in notifications, compact inbox, saved searches, restart and credential removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p11-ui-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const first = await launch(join(root, 'profile'));
    app = first.app;
    let page = first.page;
    let panel = await openAccounts(page);
    await panel.getByLabel('Personal access token:', { exact: true }).fill('synthetic_p11_private_token');
    await panel.getByRole('checkbox', { name: 'Remember account securely' }).check();
    await panel.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'example', exact: true })).toBeVisible();
    expect(
      await app.evaluate(() => (globalThis as unknown as { notifications?: number }).notifications ?? 0),
    ).toBe(0);
    await page.screenshot({ path: test.info().outputPath('p11-account-light.png') });
    await panel.getByRole('checkbox', { name: 'Enable Notifications' }).check();
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: test.info().outputPath('p11-account-dark.png') });
    await panel.getByRole('button', { name: 'Manage tokens…' }).click();
    expect(await app.evaluate(() => (globalThis as unknown as { opened: string }).opened)).toBe(
      'https://github.com/settings/tokens',
    );
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    const anchor = page.getByRole('button', { name: 'Notifications, 1 unread', exact: true });
    await anchor.click();
    let inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(inbox).toContainText('<script>Notification remains text</script>');
    await expect(inbox.locator('script')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('p11-notifications-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: test.info().outputPath('p11-notifications-light.png') });
    await inbox.getByRole('button', { name: /Notification remains text/u }).click();
    expect(await app.evaluate(() => (globalThis as unknown as { opened: string }).opened)).toBe(
      'https://github.com/example/project/issues/8',
    );
    await inbox.press('Escape');
    await expect(anchor).toBeFocused();
    panel = await openAccounts(page);
    await panel.getByRole('checkbox', { name: 'Enable Notifications' }).uncheck();
    await panel.getByRole('button', { name: 'Repositories', exact: true }).click();
    await panel.getByRole('button', { name: 'Browse pull requests' }).click();
    await panel.getByLabel('Title phrase', { exact: true }).fill('saved title phrase');
    await panel.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(panel).toContainText('Review the change');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await readFile(join(root, 'profile', 'hosting-preferences.json'), 'utf8')).toContain(
      'saved title phrase',
    );
    expect(await readFile(join(root, 'profile', 'hosting-credentials.json'), 'utf8')).not.toContain(
      'synthetic_p11_private_token',
    );
    await app.close();
    app = undefined;
    const second = await launch(join(root, 'profile'));
    app = second.app;
    page = second.page;
    panel = await openAccounts(page);
    await expect(panel.getByRole('heading', { name: 'example', exact: true })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Enable Notifications' })).not.toBeChecked();
    await panel.getByRole('button', { name: 'Repositories', exact: true }).click();
    await panel.getByRole('button', { name: 'Browse pull requests' }).click();
    await expect(panel.locator('datalist option')).toHaveAttribute('value', 'saved title phrase');
    await panel.getByRole('button', { name: 'Account', exact: true }).click();
    await panel.getByRole('checkbox', { name: 'Enable Notifications' }).check();
    await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(panel).toContainText('No connected accounts');
    expect(await readFile(join(root, 'profile', 'hosting-preferences.json'), 'utf8')).not.toContain(
      'saved title phrase',
    );
    expect(await readFile(join(root, 'profile', 'hosting-credentials.json'), 'utf8')).not.toContain(
      'github-42',
    );
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(inbox).toContainText('Connect a GitHub account');
    await inbox.press('Escape');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('P11 Bitbucket Cloud/Server accounts and Enterprise activity retain exact destinations and small-window access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p11-providers-ui-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const launched = await launch(join(root, 'profile'));
    app = launched.app;
    const page = launched.page;
    const panel = await openAccounts(page);
    for (const id of ['bitbucket', 'bitbucket-server', 'github-enterprise'] as const) {
      await panel.getByLabel('Server Type:', { exact: true }).selectOption(id);
      if (id === 'bitbucket')
        await panel.getByLabel('Atlassian email:', { exact: true }).fill('example@email.test');
      if (id === 'bitbucket-server') {
        await panel.getByLabel('Server URL:', { exact: true }).fill('https://bb.example/bitbucket');
        await panel.getByLabel('Username:', { exact: true }).fill('example');
      }
      if (id === 'github-enterprise')
        await panel.getByLabel('Server URL:', { exact: true }).fill('https://enterprise.example');
      await panel.getByLabel('Personal access token:', { exact: true }).fill('synthetic_p11_private_token');
      await page.screenshot({ path: test.info().outputPath(`p11-${id}-form-light.png`) });
      await panel.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(panel.getByRole('heading', { name: 'example', exact: true })).toBeVisible();
      await panel.getByRole('button', { name: 'Repositories', exact: true }).click();
      if (id === 'bitbucket') {
        await expect(panel).toContainText('owned/project');
        await panel.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(panel).toContainText('shared/project');
      } else
        await expect(panel).toContainText(id === 'bitbucket-server' ? 'PROJECT/repo' : 'example/project');
      await panel.getByRole('button', { name: 'Pull requests', exact: true }).click();
      const opened = await app.evaluate(() => (globalThis as unknown as { opened: string }).opened);
      expect(opened).toBe(
        id === 'bitbucket'
          ? 'https://bitbucket.org/shared/project/pull-requests'
          : id === 'bitbucket-server'
            ? 'https://bb.example/bitbucket/projects/PROJECT/repos/repo/pull-requests'
            : 'https://enterprise.example/example/project/pulls',
      );
      if (id === 'github-enterprise') {
        await panel.getByRole('button', { name: 'Browse pull requests' }).click();
        await expect(panel).toContainText('Review the change');
      }
      await page.screenshot({ path: test.info().outputPath(`p11-${id}-repositories-light.png`) });
      await panel.getByRole('button', { name: 'Add account', exact: true }).click();
    }
    await page.setViewportSize({ width: 780, height: 600 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: test.info().outputPath('p11-provider-narrow-dark.png') });
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.press('Escape');
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
    expect(
      await inbox.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight;
      }),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath('p11-inbox-narrow-dark.png') });
    await inbox.press('Escape');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('P11 branch PR handoff uses registered Enterprise and Server origins without changing Git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p11-pr-ui-'));
  const cwd = join(root, 'repository');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await run('init', '--quiet', '--initial-branch=main');
    await run('config', 'user.name', 'P11 Fixture');
    await run('config', 'user.email', 'p11@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'README.md'), 'P11 fixture\n');
    await run('add', '.');
    await run('commit', '--quiet', '-m', 'P11 fixture');
    await run('branch', 'feature/a#b');
    await run('remote', 'add', 'enterprise', 'https://enterprise.example/example/project.git');
    await run('remote', 'add', 'bitbucket', 'https://bb.example/bitbucket/scm/project/repo.git');
    const head = await run('rev-parse', 'HEAD');
    const index = await readFile(join(cwd, '.git', 'index'));
    const launched = await launch(join(root, 'profile'));
    app = launched.app;
    const page = launched.page;
    await page.evaluate(async () => window.desktop!.repository.setAutomaticFetch({ enabled: false }));
    const panel = await openAccounts(page);
    for (const [provider, server] of [
      ['github-enterprise', 'https://enterprise.example'],
      ['bitbucket-server', 'https://bb.example/bitbucket'],
    ] as const) {
      await panel.getByLabel('Server Type:', { exact: true }).selectOption(provider);
      await panel.getByLabel('Server URL:', { exact: true }).fill(server);
      if (provider === 'bitbucket-server')
        await panel.getByLabel('Username:', { exact: true }).fill('example');
      await panel.getByLabel('Personal access token:', { exact: true }).fill('synthetic_p11_private_token');
      await panel.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(panel.getByRole('heading', { name: 'example', exact: true })).toBeVisible();
      if (provider === 'github-enterprise')
        await panel.getByRole('button', { name: 'Add account', exact: true }).click();
    }
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    const opened = await page.evaluate(openTrustedFixture, cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    for (const [remote, expected] of [
      ['enterprise', 'https://enterprise.example/example/project/compare/feature%2Fa%23b?expand=1'],
      [
        'bitbucket',
        'https://bb.example/bitbucket/projects/project/repos/repo/compare/commits?sourceBranch=refs%2Fheads%2Ffeature%2Fa%23b',
      ],
    ]) {
      const result = await page.evaluate(
        async (request) => window.desktop!.repository.openPullRequest(request),
        { id: opened.value.id, fullName: 'refs/heads/feature/a#b', remote: remote! },
      );
      expect(result.ok).toBe(true);
      expect(await app.evaluate(() => (globalThis as unknown as { opened: string }).opened)).toBe(expected);
    }
    expect(await run('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(cwd, '.git', 'index'))).toEqual(index);
    expect(await run('status', '--porcelain')).toBe('');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
