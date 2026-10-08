import { testPlatform } from '../platform';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostingAccountStore } from '../../src/backend/hosting/account-store';
import { HostingPreferencesStore } from '../../src/backend/hosting/preferences-store';
import { HostingService } from '../../src/backend/hosting/hosting-service';
import {
  BitbucketProvider,
  bitbucketCredential,
  createHostingProvider,
} from '../../src/backend/hosting/server-provider';
import { GitHubProvider } from '../../src/backend/hosting/github-provider';
import type { HostingProvider } from '../../src/backend/hosting/github-provider';
import { ExpectedBackendError } from '../../src/backend/errors';
import {
  hostedRepositoriesSchema,
  hostingCloneTargetSchema,
  hostingConnectRequestSchema,
} from '../../src/common/ipc/hosting';
import { GitRunner } from '../../src/backend/git/runner';
import { createCredentialBroker } from '../../src/backend/git/credential-broker';
import { resolve } from 'node:path';
import { GitHubOAuth, encodeOAuthTokens } from '../../src/backend/hosting/github-oauth';
import { configuredPullRequestUrl, pullRequestUrl } from '../../src/backend/repositories/hosting-service';
import type { HostingAccount } from '../../src/common/ipc/hosting';

const roots: string[] = [];
const services: HostingService[] = [];
const token = 'synthetic-personal-token-p11';
const notification = {
  id: 'notification-9',
  repository: 'example/project',
  title: '<script>Inert title</script>',
  kind: 'issue' as const,
  number: 8,
  state: null,
  updatedAt: '2026-09-30T12:00:00Z',
  unread: true,
  reason: 'mention',
};
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p11-'));
  roots.push(root);
  const preferences = new HostingPreferencesStore(join(root, 'preferences.json'));
  const store = new HostingAccountStore(join(root, 'credentials.json'), {
    available: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  const provider: HostingProvider = {
    id: 'github',
    identity: vi.fn(async () => ({ id: '42', login: 'example' })),
    repositories: vi.fn(async (_token, page) => ({
      repositories: [{ id: '12', fullName: 'example/project', private: true, archived: false }],
      page,
      nextPage: null,
    })),
    activity: vi.fn(async (_token, request) => ({
      items: [notification],
      page: request.page,
      nextPage: null,
      limited: false,
    })),
  };
  const service = new HostingService(store, provider, undefined, undefined, preferences, 1000);
  services.push(service);
  const account = (await service.connectToken(1, { provider: 'github', remember: true, token }))!;
  return { root, preferences, store, provider, service, account };
}

describe('P11 notification and credential lifetime', () => {
  it('accepts expiring device authorization and renews its saved pair through the complete account flow', async () => {
    const f = await fixture();
    await f.service.disconnect(f.account.id);
    let now = Date.now();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          device_code: 'private_device_code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 600,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'gho_initial_synthetic_token',
          refresh_token: 'ghr_initial_synthetic_token',
          expires_in: 1,
          refresh_token_expires_in: 15897600,
          token_type: 'bearer',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'gho_renewed_synthetic_token',
          refresh_token: 'ghr_renewed_synthetic_token',
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: 'bearer',
        }),
      );
    const service = new HostingService(
      f.store,
      f.provider,
      undefined,
      new GitHubOAuth('registered_public_client', transport, () => now),
      f.preferences,
    );
    services.push(service);
    const state = await service.beginOAuth(1, { remember: true, username: 'example' });
    expect(state).toMatchObject({ userCode: 'TEST-CODE', interval: 1 });
    now += 1000;
    const result = await service.pollOAuth(1);
    expect(result.account).toMatchObject({ id: 'github-42', authentication: 'oauth', storage: 'keyring' });
    expect(JSON.stringify(result)).not.toContain('ghr_');
    await service.listRepositories(1, { accountId: result.account!.id, page: 1 });
    expect(f.provider.repositories).toHaveBeenLastCalledWith(
      'gho_renewed_synthetic_token',
      1,
      expect.any(AbortSignal),
    );
    expect(new URLSearchParams(transport.mock.calls[0]![1]!.body as string).get('scope')).toContain(
      'offline_access',
    );
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('allows a bounded OAuth renewal longer than the old helper deadline during real Git credential fill', async () => {
    const f = await fixture();
    await f.service.disconnect(f.account.id);
    const oauth = new GitHubOAuth('registered_public_client', async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5200));
      return Response.json({
        access_token: 'gho_slow_synthetic_token',
        refresh_token: 'ghr_slow_synthetic_token',
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        token_type: 'bearer',
      });
    });
    const service = new HostingService(f.store, f.provider, undefined, oauth, f.preferences);
    services.push(service);
    await service.login(1, { remember: false, authentication: 'oauth' }, async () =>
      encodeOAuthTokens({
        accessToken: 'gho_expired_synthetic_token',
        refreshToken: 'ghr_previous_synthetic_token',
        expiresAt: Date.now() - 1000,
        refreshExpiresAt: Date.now() + 1_000_000,
        clientId: 'registered_public_client',
      }),
    );
    const broker = await createCredentialBroker({
      source: service.gitCredentials,
      executable: process.execPath,
      helperPath: resolve('src/backend/git/credential-helper.ts'),
    });
    try {
      const result = await new GitRunner().run([...broker.args, 'credential', 'fill'], {
        cwd: f.root,
        env: broker.env,
        stdin: 'protocol=https\nhost=github.com\npath=example/project.git\n\n',
      });
      expect(result.stdout).toContain('password=gho_slow_synthetic_token');
    } finally {
      await broker.close();
    }
  }, 15000);
  it('renews expiring device OAuth once for concurrent readers and retains the encrypted token pair across restart', async () => {
    const f = await fixture();
    await f.service.disconnect(f.account.id);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: 'gho_renewed_synthetic_token',
        refresh_token: 'ghr_renewed_synthetic_token',
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        token_type: 'bearer',
      }),
    );
    const oauth = new GitHubOAuth('registered_public_client', transport);
    const service = new HostingService(f.store, f.provider, undefined, oauth, f.preferences);
    services.push(service);
    const packed = encodeOAuthTokens({
      accessToken: 'gho_expired_synthetic_token',
      refreshToken: 'ghr_previous_synthetic_token',
      expiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 1_000_000,
      clientId: 'registered_public_client',
    });
    const account = (await service.login(
      1,
      { remember: true, authentication: 'oauth' },
      async () => packed,
    ))!;
    expect(f.provider.identity).toHaveBeenLastCalledWith(
      'gho_expired_synthetic_token',
      expect.any(AbortSignal),
    );
    const context = {
      protocol: 'https' as const,
      host: 'github.com',
      path: 'example/project.git',
      username: 'example',
    };
    const results = await Promise.all([
      service.gitCredentials.get(context),
      service.gitCredentials.get(context),
    ]);
    expect(results).toEqual([
      { username: 'example', password: 'gho_renewed_synthetic_token' },
      { username: 'example', password: 'gho_renewed_synthetic_token' },
    ]);
    expect(transport).toHaveBeenCalledOnce();
    const params = new URLSearchParams(transport.mock.calls[0]?.[1]?.body as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('ghr_previous_synthetic_token');
    expect(params.has('client_secret')).toBe(false);
    const restarted = new HostingService(f.store, f.provider, undefined, oauth, f.preferences);
    services.push(restarted);
    expect(await restarted.gitCredentials.get(context)).toEqual(results[0]);
    expect(transport).toHaveBeenCalledOnce();
    expect(JSON.stringify(await restarted.list())).not.toContain('ghr_');
    expect(await readFile(join(f.root, 'credentials.json'), 'utf8')).not.toContain('ghr_');
    expect(service.credentialManagementUrl(account.id)).toBe('https://github.com/settings/applications');
  });
  it('cancels an in-flight OAuth renewal on sign-out and refuses its late token pair', async () => {
    const f = await fixture();
    await f.service.disconnect(f.account.id);
    let release!: (value: Response) => void;
    let signal!: AbortSignal;
    const oauth = new GitHubOAuth('registered_public_client', async (_input, init) => {
      signal = init!.signal!;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const service = new HostingService(f.store, f.provider, undefined, oauth, f.preferences);
    services.push(service);
    const packed = encodeOAuthTokens({
      accessToken: 'gho_expired_synthetic_token',
      refreshToken: 'ghr_previous_synthetic_token',
      expiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 1_000_000,
      clientId: 'registered_public_client',
    });
    const account = (await service.login(
      1,
      { remember: true, authentication: 'oauth' },
      async () => packed,
    ))!;
    const read = service.gitCredentials.get({
      protocol: 'https',
      host: 'github.com',
      path: 'example/project.git',
      username: '',
    });
    const rejected = expect(read).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(release).toBeDefined());
    const disconnect = service.disconnect(account.id);
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    release(
      Response.json({
        access_token: 'gho_late_synthetic_token',
        refresh_token: 'ghr_late_synthetic_token',
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        token_type: 'bearer',
      }),
    );
    await rejected;
    await disconnect;
    expect((await service.list()).accounts).toEqual([]);
    expect(await readFile(join(f.root, 'credentials.json'), 'utf8')).not.toContain(account.id);
  });
  it.each(['revoked', 'expired', 'different-client', 'malformed'] as const)(
    'reports %s OAuth renewal with no secret-bearing response',
    async (variant) => {
      const transport = vi.fn<typeof fetch>(async () =>
        Response.json(
          variant === 'malformed'
            ? { access_token: token, token_type: 'bearer' }
            : { error: 'bad_refresh_token', description: token },
        ),
      );
      const oauth = new GitHubOAuth('registered_public_client', transport);
      const tokens = {
        accessToken: token,
        refreshToken: 'ghr_synthetic_refresh_token',
        expiresAt: Date.now() - 1000,
        refreshExpiresAt: variant === 'expired' ? Date.now() - 1000 : Date.now() + 10000,
        clientId: variant === 'different-client' ? 'different_public_client' : 'registered_public_client',
      };
      await expect(oauth.refresh(tokens, new AbortController().signal)).rejects.toMatchObject({
        code: 'HOSTING_AUTH',
      });
      await expect(oauth.refresh(tokens, new AbortController().signal)).rejects.not.toThrow(token);
      if (variant === 'expired' || variant === 'different-client') expect(transport).not.toHaveBeenCalled();
    },
  );
  it('honors the server notification polling interval before both manual and scheduled checks', async () => {
    const f = await fixture();
    const provider = f.provider as HostingProvider & { notificationPollInterval: number };
    provider.notificationPollInterval = 10;
    vi.useFakeTimers();
    f.service.attachOwner(1);
    await f.service.setNotifications({ accountId: f.account.id, enabled: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.activity).toHaveBeenCalledOnce();
    await expect(f.service.refreshNotifications(f.account.id)).rejects.toThrow('pause');
    await vi.advanceTimersByTimeAsync(9998);
    expect(provider.activity).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2);
    expect(provider.activity).toHaveBeenCalledTimes(2);
  });
  it('is opt-in, shares one schedule across windows, persists preference and stops after last window closes', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    f.service.attachOwner(1);
    f.service.attachOwner(2);
    await f.service.list();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.provider.activity).not.toHaveBeenCalled();
    await f.service.setNotifications({ accountId: f.account.id, enabled: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.provider.activity).toHaveBeenCalledTimes(1);
    expect((await f.service.getNotifications()).accounts[0]).toMatchObject({
      items: [notification],
      error: '',
      account: { notificationsEnabled: true },
    });
    expect(f.service.notificationUrl({ accountId: f.account.id, itemId: notification.id })).toBe(
      'https://github.com/example/project/issues/8',
    );
    f.service.disposeOwner(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.provider.activity).toHaveBeenCalledTimes(2);
    f.service.disposeOwner(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.provider.activity).toHaveBeenCalledTimes(2);
    expect(await new HostingPreferencesStore(join(f.root, 'preferences.json')).enabled(f.account.id)).toBe(
      true,
    );
    if (testPlatform.posix) expect((await stat(join(f.root, 'preferences.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(f.root, 'preferences.json'), 'utf8')).not.toContain(token);
  });
  it.each(['disable', 'sign-out', 'close', 'replacement'] as const)(
    'aborts and refuses a late notification result after %s',
    async (action) => {
      const f = await fixture();
      f.service.attachOwner(1);
      await f.service.setNotifications({ accountId: f.account.id, enabled: true });
      let release!: () => void;
      let signal!: AbortSignal;
      vi.mocked(f.provider.activity).mockImplementationOnce(async (_token, request, _repo, pendingSignal) => {
        signal = pendingSignal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { items: [notification], page: request.page, nextPage: null, limited: false };
      });
      const read = f.service.refreshNotifications(f.account.id);
      await vi.waitFor(() => expect(release).toBeDefined());
      if (action === 'disable') await f.service.setNotifications({ accountId: f.account.id, enabled: false });
      if (action === 'sign-out') await f.service.disconnect(f.account.id);
      if (action === 'close') f.service.disposeOwner(1);
      if (action === 'replacement')
        await f.service.connectToken(1, {
          provider: 'github',
          accountId: f.account.id,
          remember: true,
          token: 'replacement-synthetic-token',
        });
      expect(signal.aborted).toBe(true);
      release();
      await read;
      expect((await f.service.getNotifications()).accounts.flatMap((entry) => entry.items)).toEqual([]);
      if (action === 'sign-out') {
        expect(await readFile(join(f.root, 'credentials.json'), 'utf8')).not.toContain(f.account.id);
        expect(await f.preferences.enabled(f.account.id)).toBe(false);
      }
    },
  );
  it('backs off on offline/rate failures, suspends expired credentials, and deduplicates concurrent refresh', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    f.service.attachOwner(1);
    vi.mocked(f.provider.activity).mockRejectedValueOnce(
      new ExpectedBackendError('HOSTING_RATE_LIMIT', 'Wait before trying again.'),
    );
    await f.service.setNotifications({ accountId: f.account.id, enabled: true });
    await vi.advanceTimersByTimeAsync(1);
    expect((await f.service.getNotifications()).accounts[0]?.error).toContain('Wait');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.provider.activity).toHaveBeenCalledTimes(1);
    vi.mocked(f.provider.activity).mockRejectedValueOnce(
      new ExpectedBackendError('HOSTING_AUTH', 'Update your token.'),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.provider.activity).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.provider.activity).toHaveBeenCalledTimes(2);
    await Promise.all([
      f.service.refreshNotifications(f.account.id),
      f.service.refreshNotifications(f.account.id),
    ]);
    expect(f.provider.activity).toHaveBeenCalledTimes(3);
    expect((await f.service.getNotifications()).accounts[0]?.error).toBe('');
  });
  it('persists bounded searches through restart, scopes by repository/kind and clears them on sign-out', async () => {
    const f = await fixture();
    await f.service.listRepositories(1, { accountId: f.account.id, page: 1 });
    const request = {
      accountId: f.account.id,
      repositoryId: '12',
      kind: 'issues' as const,
      page: 1,
      state: 'open' as const,
      author: '',
      assignee: '',
      text: '',
    };
    for (let i = 0; i < 12; i++) await f.service.listActivity(1, { ...request, text: `search ${i}` });
    const next = new HostingService(
      f.store,
      f.provider,
      undefined,
      undefined,
      new HostingPreferencesStore(join(f.root, 'preferences.json')),
    );
    services.push(next);
    await next.listRepositories(2, { accountId: f.account.id, page: 1 });
    expect((await next.listActivity(2, request)).recentSearches).toEqual(
      Array.from({ length: 10 }, (_, i) => `search ${11 - i}`),
    );
    expect((await next.listActivity(2, { ...request, kind: 'pull-requests' })).recentSearches).toEqual([]);
    await next.disconnect(f.account.id);
    expect(
      await new HostingPreferencesStore(join(f.root, 'preferences.json')).recent(`${f.account.id}/issues/12`),
    ).toEqual([]);
  });
  it('leaves damaged preference data untouched and refuses to overwrite it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-p11-corrupt-'));
    roots.push(root);
    const path = join(root, 'preferences.json');
    await writeFile(path, '{corrupt original');
    const prefs = new HostingPreferencesStore(path);
    await expect(prefs.enabled('github-42')).rejects.toThrow('left unchanged');
    await expect(prefs.setEnabled('github-42', true)).rejects.toThrow('left unchanged');
    expect(await readFile(path, 'utf8')).toBe('{corrupt original');
  });
  it('keeps credential creation, replacement, listing and removal usable with corrupt preferences', async () => {
    const f = await fixture();
    await f.service.disconnect(f.account.id);
    const path = join(f.root, 'preferences.json');
    await writeFile(path, '{corrupt original');
    const service = new HostingService(
      f.store,
      f.provider,
      undefined,
      undefined,
      new HostingPreferencesStore(path),
    );
    services.push(service);
    const account = (await service.connectToken(1, { provider: 'github', remember: true, token }))!;
    expect(account.id).toBe(f.account.id);
    expect(await service.list()).toMatchObject({
      accounts: [{ id: account.id, notificationsEnabled: false }],
      preferencesError: expect.stringContaining('left unchanged'),
    });
    service.attachOwner(1);
    expect(await service.getNotifications()).toMatchObject({
      accounts: [{ account: { id: account.id, notificationsEnabled: false }, items: [] }],
      preferencesError: expect.stringContaining('left unchanged'),
    });
    await service.connectToken(1, {
      accountId: account.id,
      provider: 'github',
      remember: true,
      token: 'replacement-synthetic-token',
    });
    const context = {
      protocol: 'https' as const,
      host: 'github.com',
      path: 'example/project.git',
      username: '',
    };
    expect(await service.gitCredentials.get(context)).toMatchObject({
      password: 'replacement-synthetic-token',
    });
    await service.listRepositories(1, { accountId: account.id, page: 1 });
    expect(
      await service.listActivity(1, {
        accountId: account.id,
        repositoryId: '12',
        kind: 'issues',
        page: 1,
        state: 'open',
        author: '',
        assignee: '',
        text: 'useful query',
      }),
    ).toMatchObject({ items: [notification], recentSearches: [], preferencesError: expect.any(String) });
    await service.disconnect(account.id);
    expect((await service.list()).accounts).toEqual([]);
    expect(await service.gitCredentials.get(context)).toBeNull();
    expect(await f.store.load()).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('{corrupt original');
  });
  it.each(['toggle', 'owner', 'replacement'] as const)(
    'retains a server retry deadline across notification %s resets',
    async (reset) => {
      const f = await fixture();
      const transport = vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/user')) return Response.json({ id: 42, login: 'example' });
        return Response.json({}, { status: 429, headers: { 'retry-after': '3600' } });
      });
      const service = new HostingService(
        f.store,
        new GitHubProvider(transport),
        undefined,
        undefined,
        f.preferences,
        1000,
      );
      services.push(service);
      vi.useFakeTimers();
      service.attachOwner(1);
      await service.setNotifications({ accountId: f.account.id, enabled: true });
      await vi.advanceTimersByTimeAsync(1);
      expect(transport).toHaveBeenCalledOnce();
      const first = Date.now();
      if (reset === 'toggle') {
        await service.setNotifications({ accountId: f.account.id, enabled: false });
        await service.setNotifications({ accountId: f.account.id, enabled: true });
      } else if (reset === 'owner') {
        service.disposeOwner(1);
        service.attachOwner(2);
        await service.list();
      } else {
        await service.connectToken(1, { accountId: f.account.id, provider: 'github', remember: true, token });
      }
      const notificationCalls = () =>
        transport.mock.calls.filter(([input]) => String(input).includes('/notifications?')).length;
      await vi.advanceTimersByTimeAsync(1);
      await expect(service.refreshNotifications(f.account.id)).rejects.toThrow('pause');
      await vi.advanceTimersByTimeAsync(3_599_000);
      expect(notificationCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(notificationCalls()).toBe(2);
      expect(Date.now() - first).toBeGreaterThanOrEqual(3_600_000);
    },
  );
});

describe('P11 provider matrix', () => {
  it.each(['bitbucket', 'bitbucket-server'] as const)(
    'keeps %s pagination independent for each browsing owner and releases it on cancel',
    async (id) => {
      const f = await fixture();
      const transport: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/user')) return Response.json({ uuid: '{user}', nickname: 'example' });
        if (url.pathname.endsWith('/users/example')) return Response.json({ id: 42, name: 'example' });
        if (url.pathname.endsWith('/user/workspaces'))
          return Response.json({ values: [{ workspace: { slug: 'team' } }] });
        if (id === 'bitbucket') {
          const page = Number(url.searchParams.get('page'));
          return Response.json({
            values: [{ uuid: `repo-${page}`, full_name: `team/repo-${page}`, is_private: true }],
            next: `https://api.bitbucket.org/2.0/repositories/team?page=${page + 1}`,
          });
        }
        const offset = Number(url.searchParams.get('start'));
        return Response.json({
          values: [
            { id: offset + 1, project: { key: 'team' }, slug: `repo-${offset / 100 + 1}`, public: false },
          ],
          isLastPage: false,
          nextPageStart: offset + 100,
        });
      };
      const service = new HostingService(
        f.store,
        f.provider,
        (_id, server) => new BitbucketProvider(id, server, transport),
      );
      services.push(service);
      const account = (await service.connectToken(1, {
        provider: id,
        remember: false,
        token,
        username: id === 'bitbucket' ? 'example@email.test' : 'example',
        ...(id === 'bitbucket-server' ? { serverUrl: 'https://bb.example' } : {}),
      }))!;
      for (const page of [1, 2, 3]) await service.listRepositories(1, { accountId: account.id, page });
      await service.listRepositories(2, { accountId: account.id, page: 1 });
      expect(await service.listRepositories(1, { accountId: account.id, page: 4 })).toMatchObject({
        repositories: [{ fullName: 'team/repo-4' }],
        page: 4,
      });
      service.cancel(1);
      await expect(service.listRepositories(1, { accountId: account.id, page: 4 })).rejects.toMatchObject({
        code: 'STALE_SNAPSHOT',
      });
      expect(await service.listRepositories(2, { accountId: account.id, page: 2 })).toMatchObject({
        repositories: [{ fullName: 'team/repo-2' }],
        page: 2,
      });
    },
  );
  it('explains the distinct Bitbucket workspace scope and accepts its addition through token replacement', async () => {
    const f = await fixture();
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/user')) return Response.json({ uuid: '{user}', nickname: 'example' });
      if (url.pathname.endsWith('/user/workspaces')) {
        const authorization = new Headers(init?.headers).get('authorization')!;
        const password = Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':')[1];
        if (password !== 'synthetic-with-workspace-scope') return Response.json({}, { status: 403 });
        return Response.json({ values: [{ workspace: { slug: 'team' } }] });
      }
      return Response.json({ values: [{ uuid: '{repo}', full_name: 'team/repo', is_private: true }] });
    };
    const service = new HostingService(
      f.store,
      f.provider,
      () => new BitbucketProvider('bitbucket', undefined, transport),
    );
    services.push(service);
    const request = {
      provider: 'bitbucket' as const,
      remember: false,
      username: 'example@email.test',
      token,
    };
    const account = (await service.connectToken(1, request))!;
    await expect(service.listRepositories(1, { accountId: account.id, page: 1 })).rejects.toThrow(
      'read:workspace:bitbucket',
    );
    expect((await service.list()).accounts.some((item) => item.id === account.id)).toBe(true);
    await service.connectToken(1, {
      ...request,
      accountId: account.id,
      token: 'synthetic-with-workspace-scope',
    });
    expect(await service.listRepositories(1, { accountId: account.id, page: 1 })).toMatchObject({
      repositories: [{ fullName: 'team/repo' }],
    });
  });
  it('uses only registered HTTPS server origins for custom PR forms and includes legacy Azure URLs', () => {
    const accounts: HostingAccount[] = [
      {
        id: 'enterprise',
        provider: 'github-enterprise',
        serverUrl: 'https://enterprise.example:8443',
        login: 'example',
        storage: 'session',
      },
      {
        id: 'lab',
        provider: 'gitlab-server',
        serverUrl: 'https://lab.example/git',
        login: 'example',
        storage: 'session',
      },
      {
        id: 'gitea',
        provider: 'gitea',
        serverUrl: 'https://tea.example',
        login: 'example',
        storage: 'session',
      },
      {
        id: 'bb',
        provider: 'bitbucket-server',
        serverUrl: 'https://bb.example/bitbucket',
        login: 'example',
        storage: 'session',
      },
    ];
    expect(
      configuredPullRequestUrl('https://enterprise.example:8443/team/repo.git', 'feature/a#b', accounts),
    ).toBe('https://enterprise.example:8443/team/repo/compare/feature%2Fa%23b?expand=1');
    expect(
      configuredPullRequestUrl('https://lab.example/git/group/subgroup/repo.git', 'topic', accounts),
    ).toBe(
      'https://lab.example/git/group/subgroup/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=topic',
    );
    expect(configuredPullRequestUrl('git@tea.example:team/repo.git', 'topic', accounts)).toBe(
      'https://tea.example/team/repo/compare/topic',
    );
    expect(
      configuredPullRequestUrl('ssh://git@bb.example:7999/PROJECT/repo.git', 'feature/a', accounts),
    ).toBe(
      'https://bb.example/bitbucket/projects/PROJECT/repos/repo/compare/commits?sourceBranch=refs%2Fheads%2Ffeature%2Fa',
    );
    expect(pullRequestUrl('https://team.visualstudio.com/project/_git/repo', 'feature/a')).toBe(
      'https://team.visualstudio.com/project/_git/repo/pullrequestcreate?sourceRef=feature%2Fa',
    );
    for (const url of [
      'https://enterprise.example.evil.test/team/repo.git',
      'https://lab.example/outside/group/repo.git',
      'https://bb.example/bitbucketevil/scm/project/repo.git',
      'https://lab.example/git/team/%2e%2e/repo.git',
      'file:///tmp/repo',
      'https://unregistered.example/team/repo.git',
      'https://lab.example/git/team/repo.git?next=https://evil.test',
    ])
      expect(configuredPullRequestUrl(url, 'topic', accounts)).toBeNull();
  });
  it('supports Enterprise identity/search/notifications without following returned URLs', async () => {
    const transport = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/user')) return Response.json({ id: 42, login: 'example' });
      return Response.json([
        {
          id: '9',
          unread: true,
          reason: 'mention',
          updated_at: notification.updatedAt,
          repository: { full_name: 'example/project' },
          subject: {
            title: 'Enterprise',
            type: 'Issue',
            url: 'https://foreign.example/repos/example/project/issues/8',
          },
        },
      ]);
    });
    const provider = new GitHubProvider(transport, 'github-enterprise', 'https://enterprise.example/api/v3');
    await provider.identity(token, new AbortController().signal);
    const result = await provider.activity(
      token,
      { accountId: 'account', kind: 'notifications', page: 1, all: false, participating: false },
      undefined,
      new AbortController().signal,
    );
    expect(result.items[0]).toMatchObject({ kind: 'notification', number: null });
    expect(transport.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://enterprise.example/api/v3/user',
      'https://enterprise.example/api/v3/notifications?per_page=100&page=1&all=false&participating=false',
    ]);
    expect(createHostingProvider('github-enterprise', 'https://enterprise.example')).toBeInstanceOf(
      GitHubProvider,
    );
  });
  it('pages all Bitbucket workspaces, shared repositories and server cursors without trusting Link destinations', async () => {
    const urls: string[] = [];
    const provider = new BitbucketProvider('bitbucket', undefined, async (input) => {
      const url = new URL(String(input));
      urls.push(url.href);
      if (url.pathname.endsWith('/user')) return Response.json({ uuid: '{user-uuid}', nickname: 'example' });
      if (url.pathname.endsWith('/user/workspaces'))
        return Response.json({
          values: [{ workspace: { slug: 'owned' } }, { workspace: { slug: 'shared' } }],
        });
      const workspace = url.pathname.split('/').at(-1)!;
      return Response.json({
        values: [{ uuid: `{${workspace}}`, full_name: `${workspace}/project`, is_private: true }],
        ...(workspace === 'owned' && url.searchParams.get('page') === '1'
          ? { next: 'https://evil.example/credential-target' }
          : {}),
      });
    });
    const credential = bitbucketCredential('example@email.test', token);
    expect(await provider.identity(credential, new AbortController().signal)).toEqual({
      id: '{user-uuid}',
      login: 'example',
    });
    const first = hostedRepositoriesSchema.parse(
      await provider.repositories(credential, 1, new AbortController().signal),
    );
    const second = await provider.repositories(credential, first.nextPage!, new AbortController().signal);
    const third = await provider.repositories(credential, second.nextPage!, new AbortController().signal);
    expect(third.repositories[0]?.fullName).toBe('shared/project');
    expect(third.nextPage).toBeNull();
    expect(urls.every((url) => url.startsWith('https://api.bitbucket.org/2.0/'))).toBe(true);
    expect(urls).toContain('https://api.bitbucket.org/2.0/repositories/owned?role=member&pagelen=100&page=2');
    const server = new BitbucketProvider(
      'bitbucket-server',
      'https://bb.example/bitbucket',
      async (input) => {
        const offset = new URL(String(input)).searchParams.get('start');
        return Response.json({
          values: [{ id: 1, project: { key: 'PROJECT' }, slug: 'repo', public: false }],
          isLastPage: offset === '147',
          ...(offset === '0' ? { nextPageStart: 147 } : {}),
        });
      },
    );
    expect((await server.repositories(credential, 1, new AbortController().signal)).nextPage).toBe(2);
    expect((await server.repositories(credential, 2, new AbortController().signal)).nextPage).toBeNull();
    expect((await server.repositories(credential, 1, new AbortController().signal)).nextPage).toBe(2);
  });
  it.each([401, 403, 429, 500])(
    'maps Bitbucket %s failures without returning provider secrets',
    async (status) => {
      const provider = new BitbucketProvider('bitbucket', undefined, async () =>
        Response.json({ message: token }, { status }),
      );
      await expect(
        provider.identity(bitbucketCredential('email@example.test', token), new AbortController().signal),
      ).rejects.toMatchObject({
        code: status === 429 ? 'HOSTING_RATE_LIMIT' : status < 500 ? 'HOSTING_AUTH' : 'UNAVAILABLE',
      });
      await expect(
        provider.repositories(
          bitbucketCredential('email@example.test', token),
          1,
          new AbortController().signal,
        ),
      ).rejects.not.toThrow(token);
    },
  );
  it('rejects malformed, cross-workspace and oversized responses and safe server policy violations', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ values: [{ workspace: { slug: 'example' } }] }))
      .mockResolvedValueOnce(
        Response.json({ values: [{ uuid: 'id', full_name: 'other/repo', is_private: false }] }),
      );
    const provider = new BitbucketProvider('bitbucket', undefined, transport);
    await expect(
      provider.repositories(
        bitbucketCredential('email@example.test', token),
        1,
        new AbortController().signal,
      ),
    ).rejects.toThrow('unsupported');
    expect(() => new BitbucketProvider('bitbucket-server', 'https://user:password@bb.example')).toThrow(
      'HTTPS',
    );
    expect(
      hostingConnectRequestSchema.safeParse({ provider: 'bitbucket', token, remember: false }).success,
    ).toBe(false);
    expect(
      hostingConnectRequestSchema.safeParse({
        provider: 'bitbucket',
        token,
        username: 'email@example.test',
        remember: false,
      }).success,
    ).toBe(true);
  });
  it('delivers the correct Bitbucket Git password through a username-pinned real credential helper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-p11-bb-'));
    roots.push(root);
    const provider = new BitbucketProvider('bitbucket', undefined, async (input) => {
      if (String(input).endsWith('/user')) return Response.json({ uuid: 'user-id', nickname: 'example' });
      if (String(input).includes('/user/workspaces'))
        return Response.json({ values: [{ workspace: { slug: 'team' } }] });
      return Response.json({ values: [{ uuid: 'repo-id', full_name: 'team/project', is_private: true }] });
    });
    const service = new HostingService(
      new HostingAccountStore(join(root, 'credentials.json'), {
        available: () => false,
        encrypt: () => Buffer.alloc(0),
        decrypt: () => '',
      }),
      undefined,
      () => provider,
    );
    services.push(service);
    const account = (await service.connectToken(1, {
      provider: 'bitbucket',
      token,
      username: 'email@example.test',
      remember: false,
    }))!;
    const repos = await service.listRepositories(1, { accountId: account.id, page: 1 });
    const target = hostingCloneTargetSchema.parse(
      service.cloneTarget(1, {
        accountId: account.id,
        repositoryId: repos.repositories[0]!.id,
        protocol: 'https',
      }),
    );
    const broker = await createCredentialBroker({
      source: service.gitCredentials,
      executable: process.execPath,
      helperPath: resolve('src/backend/git/credential-helper.ts'),
    });
    try {
      const result = await new GitRunner().run([...broker.args, 'credential', 'fill'], {
        cwd: root,
        env: broker.env,
        stdin: `url=${target.url}\n\n`,
      });
      expect(result.stdout).toContain('username=x-bitbucket-api-token-auth');
      expect(result.stdout).toContain(`password=${token}`);
      expect(target.url).not.toContain(token);
      await service.disconnect(account.id);
      expect(
        await service.gitCredentials.get({
          protocol: 'https',
          host: 'bitbucket.org',
          path: 'team/project.git',
          username: account.id,
        }),
      ).toBeNull();
    } finally {
      await broker.close();
    }
  });
});
