import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostingService } from '../../src/backend/hosting/hosting-service';
import { HostingAccountStore } from '../../src/backend/hosting/account-store';
import { ServerHostingProvider, hostingServer } from '../../src/backend/hosting/server-provider';
import { GitHubProvider } from '../../src/backend/hosting/github-provider';
import { GitHubOAuth } from '../../src/backend/hosting/github-oauth';
import { hostingConnectRequestSchema, hostingOAuthStateSchema } from '../../src/common/ipc/hosting';
import type { HostingProviderId } from '../../src/common/ipc/hosting';
import { createCredentialBroker } from '../../src/backend/git/credential-broker';
import { GitRunner } from '../../src/backend/git/runner';
import { resolve } from 'node:path';

const roots: string[] = [];
const token = 'glpat-synthetic-token_value';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(oauth?: GitHubOAuth) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-provider-'));
  roots.push(root);
  const store = new HostingAccountStore(join(root, 'credentials.json'), {
    available: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => '',
  });
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/user')) return Response.json({ id: 42, login: 'example', username: 'example' });
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
  });
  const provider = new GitHubProvider(transport);
  const factory = (id: HostingProviderId, server?: string) =>
    new ServerHostingProvider(id, server, transport);
  const service = new HostingService(store, provider, factory, oauth);
  return { root, store, transport, service };
}

describe('provider account authentication', () => {
  it.each([
    ['gitea', 'https://gitea.example/git', 'https://gitea.example/git/api/v1/user', 'token'],
    ['github-enterprise', 'https://enterprise.example', 'https://enterprise.example/api/v3/user', 'Bearer'],
    ['gitlab', undefined, 'https://gitlab.com/api/v4/user', 'Bearer'],
    ['gitlab-server', 'https://git.example:8443/lab', 'https://git.example:8443/lab/api/v4/user', 'Bearer'],
  ] as const)(
    'validates %s identity, lists repositories and supplies exact-host Git credentials',
    async (provider, serverUrl, endpoint, scheme) => {
      const f = await fixture();
      const request = hostingConnectRequestSchema.parse({ provider, serverUrl, token, remember: false });
      const account = await f.service.connectToken(1, request);
      expect(account).toMatchObject({
        provider,
        login: 'example',
        authentication: 'token',
        storage: 'session',
      });
      expect(f.transport).toHaveBeenLastCalledWith(
        endpoint,
        expect.objectContaining({
          redirect: 'error',
          headers: expect.objectContaining({ Authorization: `${scheme} ${token}` }),
        }),
      );
      const repos = await f.service.listRepositories(1, { accountId: account!.id, page: 1 });
      const target = f.service.cloneTarget(1, {
        accountId: account!.id,
        repositoryId: '12',
        protocol: 'https',
      });
      expect(target.name).toBe('project');
      expect(target.url).not.toContain(token);
      expect(() =>
        f.service.cloneTarget(2, { accountId: account!.id, repositoryId: '12', protocol: 'https' }),
      ).toThrow('Refresh');
      const url = new URL(target.url);
      const context = {
        protocol: 'https' as const,
        host: url.host,
        path: url.pathname.slice(1),
        username: 'example',
      };
      expect(await f.service.gitCredentials.get(context)).toEqual({ username: 'example', password: token });
      for (const change of [
        { host: 'other.example' },
        { host: `${url.hostname}.evil.example` },
        { path: '../project.git' },
        { protocol: 'http' },
      ])
        expect(await f.service.gitCredentials.get({ ...context, ...change } as never)).toBeNull();
      if (serverUrl?.endsWith('/lab') || serverUrl?.endsWith('/git'))
        expect(await f.service.gitCredentials.get({ ...context, path: 'outside/repo.git' })).toBeNull();
      if (provider.startsWith('gitlab')) {
        expect(repos.repositories[0]?.fullName).toBe('group/subgroup/project');
        expect(
          f.service.repositoryUrl(1, {
            accountId: account!.id,
            repositoryId: '12',
            destination: 'pull-requests',
          }),
        ).toContain('/group/subgroup/project/-/merge_requests');
      }
      expect(JSON.stringify(await f.service.list())).not.toContain(token);
      await expect(readFile(join(f.root, 'credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      await f.service.disconnect(account!.id);
      expect(await f.service.gitCredentials.get(context)).toBeNull();
    },
  );

  it('isolates identical user IDs across servers, retains a working token after failed replacement, and selects server defaults', async () => {
    const f = await fixture();
    const first = await f.service.connectToken(1, {
      provider: 'gitea',
      serverUrl: 'https://one.example',
      token,
      remember: false,
    });
    const second = await f.service.connectToken(1, {
      provider: 'gitea',
      serverUrl: 'https://two.example',
      token: 'second-synthetic-token',
      remember: false,
    });
    expect(first!.id).not.toBe(second!.id);
    f.transport.mockResolvedValueOnce(Response.json({ id: 99, login: 'different' }));
    await expect(
      f.service.connectToken(1, {
        accountId: first!.id,
        provider: 'gitea',
        serverUrl: 'https://one.example',
        token: 'wrong-user-token',
        remember: false,
      }),
    ).rejects.toThrow('different account');
    await expect(
      f.service.connectToken(1, {
        accountId: first!.id,
        provider: 'gitea',
        serverUrl: 'https://two.example',
        token,
        remember: false,
      }),
    ).rejects.toThrow('cannot change');
    await f.service.useForGit(second!.id);
    expect(
      await f.service.gitCredentials.get({
        protocol: 'https',
        host: 'one.example',
        path: 'team/project.git',
        username: '',
      }),
    ).toEqual({ username: 'example', password: token });
    expect(
      await f.service.gitCredentials.get({
        protocol: 'https',
        host: 'two.example',
        path: 'team/project.git',
        username: '',
      }),
    ).toEqual({ username: 'example', password: 'second-synthetic-token' });
  });

  it('passes self-hosted credentials through the real Git helper, preserving native helpers on unrelated hosts', async () => {
    const f = await fixture();
    await f.service.connectToken(1, {
      provider: 'gitlab-server',
      serverUrl: 'https://git.example:8443/lab',
      token,
      remember: false,
    });
    const broker = await createCredentialBroker({
      source: f.service.gitCredentials,
      executable: process.execPath,
      helperPath: resolve('src/backend/git/credential-helper.ts'),
    });
    try {
      expect(broker.args.join(' ')).toContain('credential.https://git.example:8443/lab.helper=');
      expect(broker.args.join(' ')).not.toContain('credential.helper=');
      const result = await new GitRunner().run([...broker.args, 'credential', 'fill'], {
        cwd: f.root,
        env: { ...broker.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
        stdin: 'protocol=https\nhost=git.example:8443\npath=lab/group/subgroup/project.git\n\n',
      });
      expect(result.stdout).toContain(`password=${token}`);
      expect(broker.redact(result.stdout)).not.toContain(token);
    } finally {
      await broker.close();
    }
  });

  it('rejects credential URLs, non-HTTPS destinations and cross-provider field combinations before transport', () => {
    for (const serverUrl of [
      'http://git.example',
      'https://user:secret@git.example',
      'https://git.example?token=private',
      'https://git.example/#fragment',
      'https://git.example/../other',
      'file:///etc/passwd',
    ]) {
      expect(
        hostingConnectRequestSchema.safeParse({ provider: 'gitea', serverUrl, token, remember: false })
          .success,
      ).toBe(false);
      expect(() => hostingServer('gitea', serverUrl)).toThrow();
    }
    expect(() => hostingServer('github-enterprise', 'https://git.example/subpath')).toThrow('server root');
    expect(
      hostingConnectRequestSchema.safeParse({
        provider: 'github',
        serverUrl: 'https://other.example',
        token,
        remember: false,
      }).success,
    ).toBe(false);
    expect(hostingConnectRequestSchema.safeParse({ provider: 'gitea', token, remember: false }).success).toBe(
      false,
    );
    expect(
      hostingConnectRequestSchema.safeParse({ provider: 'gitlab', token: 'private\nvalue', remember: false })
        .success,
    ).toBe(false);
  });

  it('contains provider errors and rejects malformed and oversized responses', async () => {
    for (const response of [
      Response.json({ error: token }, { status: 401 }),
      Response.json({ id: 1, username: '../unsafe' }),
      new Response('x'.repeat(4 * 1024 * 1024 + 1)),
      new Response(null, { status: 302, headers: { location: 'https://other.example' } }),
    ]) {
      const provider = new ServerHostingProvider(
        'gitlab',
        undefined,
        vi.fn<typeof fetch>().mockResolvedValue(response),
      );
      const error: unknown = await provider
        .identity(token, new AbortController().signal)
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(token);
    }
  });
});

describe('GitHub OAuth device authorization', () => {
  function oauthFixture() {
    let now = 100000;
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        device_code: 'private-device-code',
        user_code: 'TEST-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    );
    const oauth = new GitHubOAuth('registered_public_client', transport, () => now);
    return {
      oauth,
      transport,
      advance: (seconds = 5) => {
        now += seconds * 1000;
      },
    };
  }
  it('honors polling intervals and slow_down, verifies the username and keeps OAuth credentials out of results', async () => {
    const o = oauthFixture();
    const f = await fixture(o.oauth);
    const state = await f.service.beginOAuth(1, { remember: false, username: 'example' });
    expect(hostingOAuthStateSchema.parse(state).userCode).toBe('TEST-CODE');
    expect(JSON.stringify(state)).not.toContain('private-device-code');
    expect(o.transport).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({
        redirect: 'error',
        body: expect.stringContaining('client_id=registered_public_client'),
      }),
    );
    expect((await f.service.pollOAuth(1)).account).toBeNull();
    expect(o.transport).toHaveBeenCalledTimes(1);
    o.advance();
    o.transport.mockResolvedValueOnce(Response.json({ error: 'slow_down' }));
    expect(await f.service.pollOAuth(1)).toEqual({ account: null, interval: 10 });
    o.advance();
    await f.service.pollOAuth(1);
    expect(o.transport).toHaveBeenCalledTimes(2);
    o.advance();
    o.transport.mockResolvedValueOnce(
      Response.json({ access_token: 'gho_private_synthetic_token', token_type: 'bearer' }),
    );
    const result = await f.service.pollOAuth(1);
    expect(result.account).toMatchObject({ provider: 'github', authentication: 'oauth', login: 'example' });
    expect(JSON.stringify(result)).not.toContain('gho_private');
    expect(
      await f.service.gitCredentials.get({
        protocol: 'https',
        host: 'github.com',
        path: 'team/private.git',
        username: '',
      }),
    ).toMatchObject({ password: 'gho_private_synthetic_token' });
    await expect(f.service.pollOAuth(1)).rejects.toThrow('Start');
  });
  it.each(['access_denied', 'expired_token'])('reports %s without creating an account', async (error) => {
    const o = oauthFixture();
    const f = await fixture(o.oauth);
    await f.service.beginOAuth(1, { remember: false, username: '' });
    o.advance();
    o.transport.mockResolvedValueOnce(Response.json({ error, error_description: 'private-device-code' }));
    await expect(f.service.pollOAuth(1)).rejects.toThrow(error === 'access_denied' ? 'denied' : 'expired');
    expect((await f.service.list()).accounts).toEqual([]);
  });
  it('rejects a wrong username and cancellation, including a late device-code response', async () => {
    const o = oauthFixture();
    const f = await fixture(o.oauth);
    await f.service.beginOAuth(1, { remember: false, username: 'someone-else' });
    o.advance();
    o.transport.mockResolvedValueOnce(
      Response.json({ access_token: 'gho_synthetic_token', token_type: 'bearer' }),
    );
    await expect(f.service.pollOAuth(1)).rejects.toThrow('different username');
    expect((await f.service.list()).accounts).toEqual([]);
    let release!: (value: Response) => void;
    o.transport.mockImplementationOnce(
      async () =>
        new Promise<Response>((done) => {
          release = done;
        }),
    );
    const pending = f.service.beginOAuth(1, { remember: false, username: '' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.service.cancel(1);
    release(
      Response.json({
        device_code: 'late-secret',
        user_code: 'LATE-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    );
    await expect(pending).rejects.toThrow('cancelled');
    await expect(f.service.pollOAuth(1)).rejects.toThrow('Start');
  });
  it('reports missing registration and local expiry without issuing extra requests', async () => {
    const missing = new GitHubOAuth('', vi.fn<typeof fetch>());
    expect(missing.available()).toBe(false);
    await expect(missing.begin(new AbortController().signal)).rejects.toThrow('registered');
    const o = oauthFixture();
    const state = await o.oauth.begin(new AbortController().signal);
    o.advance(901);
    await expect(o.oauth.poll(state, new AbortController().signal)).rejects.toThrow('expired');
    expect(o.transport).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a credential replaced in another window while OAuth authorization was pending', async () => {
    const o = oauthFixture();
    const f = await fixture(o.oauth);
    const account = await f.service.connectToken(2, {
      provider: 'github',
      token: 'first_synthetic_token',
      remember: false,
    });
    await f.service.beginOAuth(1, { accountId: account!.id, remember: false, username: 'example' });
    await f.service.connectToken(2, {
      accountId: account!.id,
      provider: 'github',
      token: 'replacement_synthetic_token',
      remember: false,
    });
    o.advance();
    o.transport.mockResolvedValueOnce(
      Response.json({ access_token: 'late_oauth_synthetic_token', token_type: 'bearer' }),
    );
    await expect(f.service.pollOAuth(1)).rejects.toThrow('account changed');
    expect(
      await f.service.gitCredentials.get({
        protocol: 'https',
        host: 'github.com',
        path: 'team/private.git',
        username: '',
      }),
    ).toMatchObject({ password: 'replacement_synthetic_token' });
  });
  it('discards an access token returned after its owner cancelled OAuth', async () => {
    const o = oauthFixture();
    const f = await fixture(o.oauth);
    await f.service.beginOAuth(1, { remember: false, username: 'example' });
    o.advance();
    let release!: (value: Response) => void;
    o.transport.mockImplementationOnce(
      async () =>
        new Promise<Response>((done) => {
          release = done;
        }),
    );
    const pending = f.service.pollOAuth(1);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.service.cancel(1);
    release(Response.json({ access_token: 'late_oauth_synthetic_token', token_type: 'bearer' }));
    await expect(pending).rejects.toThrow('cancelled');
    expect((await f.service.list()).accounts).toEqual([]);
  });
});
