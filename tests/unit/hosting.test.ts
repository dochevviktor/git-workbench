import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from '../../src/backend/hosting/github-provider';
import type { HostingProvider } from '../../src/backend/hosting/github-provider';
import { HostingAccountStore } from '../../src/backend/hosting/account-store';
import { HostingService, readTokenFile } from '../../src/backend/hosting/hosting-service';
import {
  hostingConnectRequestSchema,
  hostingRepositoriesRequestSchema,
  hostingActivityRequestSchema,
} from '../../src/common/ipc/hosting';

const token = 'synthetic_token_for_unit_tests';
const repo = { id: '12', fullName: 'example/project', private: true, archived: false };
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-hosting-'));
  roots.push(root);
  const path = join(root, 'credentials.json');
  const tokenPath = join(root, 'test-token');
  await writeFile(tokenPath, token, { mode: 0o600 });
  const key = randomBytes(32);
  const encryption = {
    available: () => true,
    encrypt: (value: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt: (value: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  const provider: HostingProvider = {
    activity: vi.fn(async (_token, request) => ({
      items: [],
      page: request.page,
      nextPage: null,
      limited: false,
    })),
    id: 'github',
    identity: vi.fn(async () => ({ id: '42', login: 'example' })),
    repositories: vi.fn(async (_token, page) => ({
      repositories: [repo],
      page,
      nextPage: page === 1 ? 2 : null,
    })),
  };
  const store = new HostingAccountStore(path, encryption);
  const service = new HostingService(store, provider);
  const connect = (remember = false) => service.connect(1, { remember }, async () => tokenPath);
  return { root, path, tokenPath, provider, store, service, encryption, connect };
}

describe('GitHub provider', () => {
  it('rejects foreign repository search results and malformed notification payloads', async () => {
    const provider = new GitHubProvider(async () =>
      Response.json({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            id: 1,
            number: 1,
            title: 'wrong repository',
            state: 'open',
            updated_at: '2026-09-22T10:00:00Z',
            repository_url: 'https://api.github.com/repos/other/project',
          },
        ],
      }),
    );
    await expect(
      provider.activity(
        token,
        {
          accountId: 'github-42',
          repositoryId: '12',
          kind: 'issues',
          page: 1,
          state: 'open',
          author: '',
          assignee: '',
          text: '',
        },
        repo.fullName,
        new AbortController().signal,
      ),
    ).rejects.toThrow('unsupported');
    await expect(
      provider.activity(
        token,
        { accountId: 'github-42', kind: 'notifications', page: 1, all: false, participating: false },
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow('unsupported');
  });
  it('owns activity selections by window, invalidates pages and aborts sign-out races', async () => {
    const { service, connect, provider } = await fixture();
    await connect();
    const request = {
      accountId: 'github-42',
      kind: 'notifications' as const,
      page: 1,
      all: false,
      participating: false,
    };
    const item = {
      id: 'notification-9',
      repository: repo.fullName,
      title: 'Title',
      kind: 'issue' as const,
      number: 8,
      state: null,
      updatedAt: '2026-09-22T10:00:00Z',
      unread: true,
      reason: 'mention',
    };
    vi.mocked(provider.activity).mockResolvedValueOnce({
      items: [item],
      page: 1,
      nextPage: 2,
      limited: false,
    });
    await service.listActivity(1, request);
    const selection = { accountId: request.accountId, itemId: item.id };
    expect(service.activityUrl(1, selection)).toBe('https://github.com/example/project/issues/8');
    expect(() => service.activityUrl(2, selection)).toThrow('Refresh');
    await service.listActivity(1, { ...request, page: 2 });
    expect(() => service.activityUrl(1, selection)).toThrow('Refresh');
    let release!: () => void;
    let signal!: AbortSignal;
    vi.mocked(provider.activity).mockImplementationOnce(async (_token, _request, _repo, pendingSignal) => {
      signal = pendingSignal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { items: [item], page: 1, nextPage: null, limited: false };
    });
    const pending = service.listActivity(1, request);
    await vi.waitFor(() => expect(release).toBeDefined());
    await service.disconnect(request.accountId);
    expect(signal.aborted).toBe(true);
    release();
    await expect(pending).rejects.toThrow('cancelled');
    expect(() => service.activityUrl(1, selection)).toThrow('no longer connected');
  });
  it('builds scoped issue/PR searches with author, assignee and phrase filters and reports the search cap', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        total_count: 1200,
        incomplete_results: false,
        items: [
          {
            id: 7,
            number: 8,
            title: '<script>inert</script>',
            state: 'closed',
            updated_at: '2026-09-22T10:00:00Z',
            repository_url: 'https://api.github.com/repos/example/project',
            pull_request: { merged_at: '2026-09-22T10:00:00Z' },
          },
        ],
      }),
    );
    const result = await new GitHubProvider(transport).activity(
      token,
      {
        accountId: 'github-42',
        repositoryId: '12',
        kind: 'pull-requests',
        page: 1,
        state: 'closed',
        author: 'alice',
        assignee: 'bob',
        text: 'repo:other/project',
      },
      repo.fullName,
      new AbortController().signal,
    );
    const url = new URL(String(transport.mock.calls[0]![0]));
    expect(url.origin).toBe('https://api.github.com');
    expect(url.searchParams.get('q')).toBe(
      'repo:example/project is:pr is:closed author:alice assignee:bob "repo:other/project" in:title',
    );
    expect(result).toMatchObject({
      nextPage: 2,
      limited: true,
      items: [{ state: 'merged', kind: 'pull-request' }],
    });
    expect(
      hostingActivityRequestSchema.safeParse({
        accountId: 'x',
        repositoryId: '12',
        kind: 'issues',
        page: 11,
        state: 'all',
        author: '',
        assignee: '',
        text: '',
      }).success,
    ).toBe(false);
  });
  it('validates notification subject paths and ignores hostile next links', async () => {
    const notification = {
      id: '9',
      unread: true,
      reason: 'mention',
      updated_at: '2026-09-22T10:00:00Z',
      repository: { full_name: repo.fullName },
      subject: {
        type: 'Issue',
        title: 'Title',
        url: 'https://api.github.com/repos/example/project/issues/8',
      },
    };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        [
          notification,
          {
            ...notification,
            id: '10',
            subject: { ...notification.subject, url: 'https://evil.example/secret' },
          },
        ],
        { headers: { link: '<https://evil.example/>; rel="next"' } },
      ),
    );
    const result = await new GitHubProvider(transport).activity(
      token,
      { accountId: 'github-42', kind: 'notifications', page: 1, all: false, participating: true },
      undefined,
      new AbortController().signal,
    );
    expect(result.items.map((item) => [item.kind, item.number])).toEqual([
      ['issue', 8],
      ['notification', null],
    ]);
    expect(result.nextPage).toBe(2);
    expect(String(transport.mock.calls[0]![0])).toContain('all=false&participating=true');
  });
  it.each([401, 403, 429, 500])('suppresses notification error bodies (%s)', async (status) => {
    const provider = new GitHubProvider(async () => Response.json({ message: token }, { status }));
    await expect(
      provider.activity(
        token,
        { accountId: 'github-42', kind: 'notifications', page: 1, all: false, participating: false },
        undefined,
        new AbortController().signal,
      ),
    ).rejects.not.toThrow(token);
  });
  it('uses fixed authenticated endpoints, maps metadata and never follows a pagination URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: 42, login: 'example', extra: 'discarded' }))
      .mockResolvedValueOnce(
        Response.json(
          [
            {
              id: 12,
              full_name: repo.fullName,
              private: true,
              archived: false,
              clone_url: 'https://evil.example/secret',
            },
          ],
          { headers: { link: '<https://evil.example/stolen>; rel="next"' } },
        ),
      );
    const provider = new GitHubProvider(fetcher);
    const signal = new AbortController().signal;
    expect(await provider.identity(token, signal)).toEqual({ id: '42', login: 'example' });
    expect(await provider.repositories(token, 1, signal)).toEqual({
      repositories: [repo],
      page: 1,
      nextPage: 2,
    });
    expect(fetcher.mock.calls[1]![0]).toBe(
      'https://api.github.com/user/repos?per_page=100&sort=full_name&direction=asc&page=1',
    );
    expect(fetcher.mock.calls[1]![1]).toMatchObject({
      redirect: 'error',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  });
  it.each([
    [401, {}, 'HOSTING_AUTH'],
    [403, {}, 'HOSTING_AUTH'],
    [403, { 'x-ratelimit-remaining': '0' }, 'HOSTING_RATE_LIMIT'],
    [429, {}, 'HOSTING_RATE_LIMIT'],
    [503, {}, 'UNAVAILABLE'],
  ] as const)('sanitizes status %s', async (status, headers, code) => {
    const provider = new GitHubProvider(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: token }, { status, headers })),
    );
    const error = await provider
      .identity(token, new AbortController().signal)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(token);
  });
  it('contains transport errors, malformed responses and oversized bodies', async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error(token)),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 1, login: '../bad' })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1))),
    ]) {
      const error = await new GitHubProvider(fetcher)
        .identity(token, new AbortController().signal)
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({ code: 'UNAVAILABLE' });
      expect(String(error)).not.toContain(token);
    }
  });
});

describe('hosting lifecycle and credential boundaries', () => {
  it('logs in without a file and supplies only exact GitHub HTTPS contexts to Git', async () => {
    const f = await fixture();
    await expect(f.service.login(1, { remember: false }, async () => 'not a token')).rejects.toThrow('Copy');
    await f.service.login(1, { remember: false }, async () => token);
    const context = {
      protocol: 'https' as const,
      host: 'github.com' as const,
      path: 'example/private.git',
      username: '',
    };
    expect(await f.service.gitCredentials.get(context)).toEqual({ username: 'example', password: token });
    for (const change of [
      { host: 'github.com.evil.test' },
      { host: 'github.com:8443' },
      { protocol: 'http' },
      { path: '../private.git' },
    ])
      expect(await f.service.gitCredentials.get({ ...context, ...change } as never)).toBeNull();
    await expect(f.service.gitCredentials.get({ ...context, username: 'other' })).rejects.toThrow(
      'No matching',
    );
    await f.service.disconnect('github-42');
    expect(await f.service.gitCredentials.available()).toBe(false);
    await expect(f.service.gitCredentials.get(context)).rejects.toThrow('No matching');
  });
  it('remembers a default Git account and pins selected clones by public username', async () => {
    const f = await fixture();
    await f.connect(true);
    vi.mocked(f.provider.identity).mockResolvedValueOnce({ id: '99', login: 'second-user' });
    await f.service.login(1, { remember: true }, async () => 'second_synthetic_token');
    await f.service.useForGit('github-99');
    const restarted = new HostingService(f.store, f.provider);
    expect((await restarted.list()).gitAccountId).toBe('github-99');
    const context = {
      protocol: 'https' as const,
      host: 'github.com' as const,
      path: 'org/private.git',
      username: '',
    };
    expect(await restarted.gitCredentials.get(context)).toEqual({
      username: 'second-user',
      password: 'second_synthetic_token',
    });
    expect(await restarted.gitCredentials.get({ ...context, username: 'EXAMPLE' })).toEqual({
      username: 'example',
      password: token,
    });
    await restarted.listRepositories(1, { accountId: 'github-42', page: 1 });
    expect(
      restarted.cloneTarget(1, { accountId: 'github-42', repositoryId: '12', protocol: 'https' }),
    ).toEqual({ url: 'https://example@github.com/example/project.git', name: 'project' });
    await restarted.disconnect('github-99');
    expect((await restarted.list()).gitAccountId).toBe('github-42');
    expect(JSON.stringify(await restarted.list())).not.toContain(token);
  });
  it('keeps session tokens in main memory and maps only owner-discovered repository IDs', async () => {
    const f = await fixture();
    const account = await f.connect();
    expect(account).toEqual({ id: 'github-42', login: 'example', provider: 'github', storage: 'session' });
    expect(JSON.stringify(await f.service.list())).not.toContain(token);
    await expect(stat(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.service.listRepositories(1, { accountId: account!.id, page: 1 });
    expect(f.service.cloneTarget(1, { accountId: account!.id, repositoryId: '12', protocol: 'ssh' })).toEqual(
      { url: 'git@github.com:example/project.git', name: 'project' },
    );
    expect(
      f.service.repositoryUrl(1, {
        accountId: account!.id,
        repositoryId: '12',
        destination: 'pull-requests',
      }),
    ).toBe('https://github.com/example/project/pulls');
    expect(() =>
      f.service.cloneTarget(2, { accountId: account!.id, repositoryId: '12', protocol: 'https' }),
    ).toThrow('Refresh');
    f.service.cancel(1);
    expect(() =>
      f.service.cloneTarget(1, { accountId: account!.id, repositoryId: '12', protocol: 'https' }),
    ).toThrow('Refresh');
    expect(await new HostingService(f.store, f.provider).list()).toMatchObject({ accounts: [] });
  });
  it('persists encrypted credentials, restores them and removes them on sign-out', async () => {
    const f = await fixture();
    await f.connect(true);
    expect(await readFile(f.path, 'utf8')).not.toContain(token);
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    const restarted = new HostingService(f.store, f.provider);
    expect((await restarted.list()).accounts[0]?.storage).toBe('keyring');
    await restarted.listRepositories(2, { accountId: 'github-42', page: 2 });
    expect(f.provider.repositories).toHaveBeenCalledWith(token, 2, expect.any(AbortSignal));
    await restarted.disconnect('github-42');
    expect(JSON.parse(await readFile(f.path, 'utf8'))).toEqual({ version: 1, entries: [] });
    expect((await new HostingService(f.store, f.provider).list()).accounts).toEqual([]);
    expect(await readFile(f.tokenPath, 'utf8')).toBe(token);
  });
  it('fails closed without a keyring, but allows session use and forgetting a locked credential', async () => {
    const f = await fixture();
    f.encryption.available = () => false;
    await expect(f.connect(true)).rejects.toThrow('keyring');
    expect(f.provider.identity).not.toHaveBeenCalled();
    await f.connect();
    await f.service.disconnect('github-42');
    f.encryption.available = () => true;
    await f.connect(true);
    f.encryption.available = () => false;
    await expect(f.service.listRepositories(1, { accountId: 'github-42', page: 1 })).rejects.toThrow(
      'keyring',
    );
    await f.service.disconnect('github-42');
  });
  it('preserves existing credentials on failed replacement and rejects another identity', async () => {
    const f = await fixture();
    await f.connect(true);
    const before = await readFile(f.path, 'utf8');
    vi.mocked(f.provider.identity).mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(
      f.service.connect(1, { accountId: 'github-42', remember: true }, async () => f.tokenPath),
    ).rejects.toThrow();
    expect(await readFile(f.path, 'utf8')).toBe(before);
    vi.mocked(f.provider.identity).mockResolvedValueOnce({ id: '99', login: 'someone-else' });
    await expect(
      f.service.connect(1, { accountId: 'github-42', remember: true }, async () => f.tokenPath),
    ).rejects.toThrow('different');
    expect(await readFile(f.path, 'utf8')).toBe(before);
    await f.service.connect(1, { accountId: 'github-42', remember: false }, async () => f.tokenPath);
    expect(JSON.parse(await readFile(f.path, 'utf8')).entries).toEqual([]);
  });
  it('does nothing on chooser cancellation or owner closing during selection', async () => {
    const f = await fixture();
    expect(await f.service.connect(1, { remember: false }, async () => null)).toBeNull();
    expect(
      await f.service.connect(1, { remember: false }, async () => {
        f.service.cancel(1);
        return f.tokenPath;
      }),
    ).toBeNull();
    expect(f.provider.identity).not.toHaveBeenCalled();
    expect((await f.service.list()).accounts).toEqual([]);
  });
  it('does not start a chooser after its owner closes while the credential store is loading', async () => {
    const f = await fixture();
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.store, 'load').mockImplementationOnce(async () => {
      await loaded;
      return [];
    });
    const picker = vi.fn(async () => f.tokenPath);
    const pending = f.service.connect(1, { remember: false }, picker);
    f.service.cancel(1);
    release();
    await expect(pending).rejects.toThrow('cancelled');
    expect(picker).not.toHaveBeenCalled();
  });
  it('aborts in-flight requests and does not resurrect repositories after sign-out', async () => {
    const f = await fixture();
    await f.connect();
    let release!: () => void;
    let started!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received: AbortSignal | undefined;
    vi.mocked(f.provider.repositories).mockImplementationOnce(async (_token, page, signal) => {
      received = signal;
      started();
      await finish;
      return { repositories: [repo], page, nextPage: null };
    });
    const pending = f.service.listRepositories(1, { accountId: 'github-42', page: 1 });
    await begin;
    await f.service.disconnect('github-42');
    expect(received?.aborted).toBe(true);
    release();
    await expect(pending).rejects.toThrow('cancelled');
    expect((await f.service.list()).accounts).toEqual([]);
  });
  it('rejects corrupt stores without overwriting them and rejects unsafe token files', async () => {
    const f = await fixture();
    await writeFile(f.path, 'broken');
    await expect(f.service.list()).rejects.toThrow('left unchanged');
    // Installing the scoped helper is safe; only a GitHub request should surface this error.
    expect(await f.service.gitCredentials.available()).toBe(true);
    expect(await readFile(f.path, 'utf8')).toBe('broken');
    await expect(readTokenFile(f.root)).rejects.toThrow('regular');
    const link = join(f.root, 'link');
    await symlink(f.tokenPath, link);
    await expect(readTokenFile(link)).rejects.toThrow('regular');
    await writeFile(f.tokenPath, 'secret\nsecond line');
    await expect(readTokenFile(f.tokenPath)).rejects.toThrow('regular');
    await writeFile(f.tokenPath, 'x'.repeat(4097));
    await expect(readTokenFile(f.tokenPath)).rejects.toThrow('regular');
  });
  it('rejects renderer-supplied tokens, paths, provider origins and invalid pages', () => {
    for (const extra of [{ token }, { path: '/etc/passwd' }, { origin: 'https://evil.example' }])
      expect(hostingConnectRequestSchema.safeParse({ remember: false, ...extra }).success).toBe(false);
    expect(hostingRepositoriesRequestSchema.safeParse({ accountId: 'github-42', page: -1 }).success).toBe(
      false,
    );
  });
});
