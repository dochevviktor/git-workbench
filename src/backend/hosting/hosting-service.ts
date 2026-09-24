import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type {
  HostedRepository,
  HostingAccount,
  HostingCloneSelection,
  HostingConnectRequest,
  HostingRepositoriesRequest,
  HostingRepositoryRequest,
  HostingActivityRequest,
  HostingActivityItem,
  HostingActivitySelection,
  HostingProviderId,
  HostingOAuthRequest,
} from '../../common/ipc/hosting';
import {
  hostingAccountSchema,
  hostedRepositoriesSchema,
  hostingActivityPageSchema,
} from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';
import type { HostingAccountStore } from './account-store';
import type { StoredAccount } from './account-store';
import { GitHubProvider } from './github-provider';
import type { HostingProvider } from './github-provider';
import { credentialContextSchema } from '../git/credential-broker';
import type { GitCredentialContext, GitCredentialSource } from '../git/credential-broker';
import { hostingServer, ServerHostingProvider } from './server-provider';
import { GitHubOAuth } from './github-oauth';
import type { GitHubDeviceAuthorization } from './github-oauth';

type Entry = { account: HostingAccount; stored?: StoredAccount; token?: string };
type Request = { owner: number; accountId?: string; controller: AbortController };
type LoginRequest = {
  accountId?: string | undefined;
  remember: boolean;
  provider?: HostingProviderId | undefined;
  serverUrl?: string | undefined;
  authentication?: 'token' | 'oauth';
  username?: string;
};

export class HostingService {
  private entries = new Map<string, Entry>();
  private loaded: Promise<void> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly pending = new Set<Request>();
  private readonly ownerGenerations = new Map<number, number>();
  private readonly oauthSessions = new Map<
    number,
    {
      state: GitHubDeviceAuthorization;
      request: HostingOAuthRequest;
      busy: boolean;
      expected: Entry | undefined;
    }
  >();
  private readonly repositories = new Map<number, Map<string, Map<string, HostedRepository>>>();
  private readonly activityPages = new Map<
    number,
    { accountId: string; items: Map<string, HostingActivityItem> }
  >();

  constructor(
    private readonly store: HostingAccountStore,
    private readonly provider: HostingProvider = new GitHubProvider(),
    private readonly providerFactory = (id: HostingProviderId, server?: string): HostingProvider =>
      new ServerHostingProvider(id, server),
    private readonly oauth = new GitHubOAuth(),
  ) {}

  async list() {
    await this.load();
    return {
      accounts: [...this.entries.values()].map((entry) => entry.account),
      secureStorageAvailable: this.store.available(),
      gitAccountId: this.entries.keys().next().value ?? null,
      githubOAuthAvailable: this.oauth.available(),
    };
  }

  readonly gitCredentials: GitCredentialSource = {
    scopes: async () => {
      try {
        await this.load();
        return [
          ...new Set(
            [...this.entries.values()].map(({ account }) =>
              hostingServer(account.provider, account.serverUrl),
            ),
          ),
        ];
      } catch {
        return ['https://github.com'];
      }
    },
    available: async () => {
      try {
        await this.load();
        return this.entries.size > 0;
      } catch {
        // Defer store errors until an actual GitHub credential request. Local clones, SSH
        // and other hosts must remain usable even when the hosting store needs repair.
        return true;
      }
    },
    get: async (context: GitCredentialContext) => {
      if (!credentialContextSchema.safeParse(context).success) return null;
      await this.load();
      const url = new URL(`https://${context.host}/${context.path}`);
      const entries = [...this.entries.values()].filter(({ account }) => {
        const server = new URL(hostingServer(account.provider, account.serverUrl));
        const prefix = server.pathname === '/' ? '' : server.pathname;
        return (
          url.origin === server.origin &&
          url.pathname.startsWith(`${prefix}/`) &&
          url.pathname.slice(prefix.length + 1).split('/').length >= 2
        );
      });
      if (!entries.length) return null;
      // Prefer the most specific configured server path when multiple installations share a host.
      const length = Math.max(
        ...entries.map(({ account }) => hostingServer(account.provider, account.serverUrl).length),
      );
      const scoped = entries.filter(
        ({ account }) => hostingServer(account.provider, account.serverUrl).length === length,
      );
      const entry = context.username
        ? scoped.find((item) => item.account.login.toLowerCase() === context.username.toLowerCase())
        : scoped[0];
      if (!entry)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          'No matching hosting account. Log in through Preferences → Accounts.',
        );
      return { username: entry.account.login, password: this.token(entry) };
    },
  };

  async useForGit(accountId: string) {
    await this.load();
    await this.write(async () => {
      const entry = this.require(accountId);
      // Preserve the version-1 store: its entry order also records the default Git account.
      const next = new Map([[accountId, entry], ...[...this.entries].filter(([id]) => id !== accountId)]);
      await this.persist(next);
      this.entries = next;
    });
    return null;
  }

  /** Legacy backend-only file adapter, retained for explicitly invoked verification scripts. */
  async connect(owner: number, request: LoginRequest, pickFile: () => Promise<string | null>) {
    return this.login(owner, request, async () => {
      const path = await pickFile();
      return path ? readTokenFile(path) : null;
    });
  }

  async connectToken(owner: number, request: HostingConnectRequest) {
    return this.login(owner, request, async () => request.token);
  }

  async beginOAuth(owner: number, request: HostingOAuthRequest) {
    const generation = this.ownerGenerations.get(owner) ?? 0;
    await this.load();
    this.checkOwner(owner, generation);
    if (this.oauthSessions.has(owner) || [...this.pending].some((item) => item.owner === owner))
      throw new ExpectedBackendError('UNAVAILABLE', 'Cancel the current request before starting OAuth.');
    const expected = request.accountId ? this.require(request.accountId) : undefined;
    if (expected && expected.account.provider !== 'github')
      throw new ExpectedBackendError('INVALID_REQUEST', 'OAuth is available for GitHub accounts.');
    if (request.remember && !this.store.available())
      throw new ExpectedBackendError('UNAVAILABLE', 'Unlock a secure OS keyring or use this session only.');
    return this.run(owner, request.accountId, async (signal) => {
      const state = await this.oauth.begin(signal);
      this.checkSignal(signal);
      this.oauthSessions.set(owner, { state, request, busy: false, expected });
      return { userCode: state.userCode, interval: state.interval, expiresAt: state.expiresAt };
    });
  }

  async pollOAuth(owner: number) {
    const session = this.oauthSessions.get(owner);
    if (!session) throw new ExpectedBackendError('HOSTING_AUTH', 'Start GitHub OAuth again.');
    if (session.busy)
      throw new ExpectedBackendError('UNAVAILABLE', 'GitHub authorization is already being checked.');
    session.busy = true;
    const generation = this.ownerGenerations.get(owner) ?? 0;
    try {
      const token = await this.run(owner, session.request.accountId, (signal) =>
        this.oauth.poll(session.state, signal),
      );
      this.checkOwner(owner, generation);
      if (this.oauthSessions.get(owner) !== session)
        throw new ExpectedBackendError('UNAVAILABLE', 'GitHub authorization was cancelled.');
      if (session.expected && this.entries.get(session.expected.account.id) !== session.expected)
        throw new ExpectedBackendError(
          'STALE_SNAPSHOT',
          'The account changed. Start OAuth again before replacing its credential.',
        );
      if (!token) return { account: null, interval: session.state.interval };
      this.oauthSessions.delete(owner);
      const account = await this.login(
        owner,
        { ...session.request, provider: 'github', authentication: 'oauth' },
        async () => token,
      );
      return { account, interval: session.state.interval };
    } catch (error) {
      if (this.oauthSessions.get(owner) === session) this.oauthSessions.delete(owner);
      throw error;
    } finally {
      session.busy = false;
    }
  }

  /** Only validated public account metadata leaves main; secrets are write-only. */
  async login(
    owner: number,
    request: LoginRequest,
    acquire: (signal: AbortSignal) => Promise<string | null>,
  ) {
    const generation = this.ownerGenerations.get(owner) ?? 0;
    await this.load();
    this.checkOwner(owner, generation);
    const expected = request.accountId ? this.require(request.accountId) : undefined;
    const providerId = request.provider ?? expected?.account.provider ?? 'github';
    const serverUrl = hostingServer(providerId, request.serverUrl ?? expected?.account.serverUrl);
    if (
      expected &&
      (expected.account.provider !== providerId ||
        hostingServer(expected.account.provider, expected.account.serverUrl) !== serverUrl)
    )
      throw new ExpectedBackendError(
        'INVALID_REQUEST',
        'The provider and server cannot change during a token update. Add a separate account.',
      );
    const provider = this.resolveProvider(providerId, serverUrl);
    if (request.remember && !this.store.available())
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Unlock a secure OS keyring or choose session-only storage.',
      );
    if ([...this.pending].some((item) => item.owner === owner))
      throw new ExpectedBackendError('UNAVAILABLE', 'Wait for the current hosting request or cancel it.');
    return this.run(
      owner,
      request.accountId,
      async (signal) => {
        const value = await acquire(signal);
        if (!value || signal.aborted) return null;
        const token = value.trim();
        if (!/^[\x21-\x7e]{10,4096}$/u.test(token))
          throw new ExpectedBackendError(
            'HOSTING_AUTH',
            'Enter a valid access token without spaces or line breaks.',
          );
        const identity = await provider.identity(token, signal);
        if (request.username && identity.login.toLowerCase() !== request.username.toLowerCase())
          throw new ExpectedBackendError(
            'HOSTING_AUTH',
            'GitHub authorized a different username. Sign in with the requested account and try again.',
          );
        const account = hostingAccountSchema.parse({
          id:
            providerId === 'github'
              ? `github-${identity.id}`
              : `${providerId}-${createHash('sha256').update(`${serverUrl}\n${identity.id}`).digest('hex').slice(0, 32)}`,
          provider: providerId,
          serverUrl,
          authentication: request.authentication ?? 'token',
          login: identity.login,
          storage: request.remember ? 'keyring' : 'session',
        });
        if (expected && expected.account.id !== account.id)
          throw new ExpectedBackendError(
            'HOSTING_AUTH',
            'This token belongs to a different account. Add it as a separate account.',
          );
        await this.write(async () => {
          this.checkSignal(signal);
          if (expected && this.entries.get(expected.account.id) !== expected)
            throw new ExpectedBackendError(
              'STALE_SNAPSHOT',
              'The account changed. Reopen Accounts before updating its token.',
            );
          if (!expected && this.entries.has(account.id))
            throw new ExpectedBackendError(
              'INVALID_REQUEST',
              'This account is already connected. Use Update token on that account.',
            );
          if (!expected && this.entries.size >= 20)
            throw new ExpectedBackendError(
              'UNAVAILABLE',
              'Remove an account before adding another (limit: 20).',
            );
          const entry: Entry = request.remember
            ? { account, stored: this.store.seal(account, token) }
            : { account, token };
          const next = new Map(this.entries).set(account.id, entry);
          await this.persist(next);
          this.entries = next;
          this.clearRepositories(account.id);
        });
        return account;
      },
      300000,
    );
  }

  async disconnect(accountId: string) {
    await this.load();
    // Abort reads and replacement attempts before allowing their result to reach the UI.
    for (const request of this.pending) if (request.accountId === accountId) request.controller.abort();
    for (const [owner, session] of this.oauthSessions)
      if (session.request.accountId === accountId) this.oauthSessions.delete(owner);
    await this.write(async () => {
      this.require(accountId);
      const next = new Map(this.entries);
      next.delete(accountId);
      await this.persist(next);
      this.entries = next;
      this.clearRepositories(accountId);
    });
    return null;
  }

  async listRepositories(owner: number, request: HostingRepositoriesRequest) {
    const generation = this.ownerGenerations.get(owner) ?? 0;
    await this.load();
    this.checkOwner(owner, generation);
    const entry = this.require(request.accountId);
    this.repositories.get(owner)?.delete(request.accountId);
    return this.run(owner, request.accountId, async (signal) => {
      const result = hostedRepositoriesSchema.parse(
        await this.resolveProvider(entry.account.provider, entry.account.serverUrl).repositories(
          this.token(entry),
          request.page,
          signal,
        ),
      );
      this.checkSignal(signal);
      if (this.entries.get(request.accountId) !== entry)
        throw new ExpectedBackendError('STALE_SNAPSHOT', 'The account changed. Refresh repositories.');
      let ownerRepos = this.repositories.get(owner);
      if (!ownerRepos) {
        ownerRepos = new Map();
        this.repositories.set(owner, ownerRepos);
      }
      // Retain only the currently displayed page for each account, not an unbounded repository cache.
      ownerRepos.set(request.accountId, new Map(result.repositories.map((repo) => [repo.id, repo])));
      return result;
    });
  }

  cloneTarget(owner: number, request: HostingCloneSelection) {
    const repo = this.repository(owner, request.accountId, request.repositoryId);
    const account = this.require(request.accountId).account;
    const server = new URL(hostingServer(account.provider, account.serverUrl));
    const base = server.pathname === '/' ? '' : server.pathname;
    return {
      url:
        request.protocol === 'ssh'
          ? `git@${server.hostname}:${repo.fullName}.git`
          : `https://${account.login}@${server.host}${base}/${repo.fullName}.git`,
      name: repo.fullName.split('/').at(-1)!,
    };
  }
  async listActivity(owner: number, request: HostingActivityRequest) {
    const generation = this.ownerGenerations.get(owner) ?? 0;
    await this.load();
    this.checkOwner(owner, generation);
    const entry = this.require(request.accountId);
    const repository =
      request.kind === 'notifications'
        ? undefined
        : this.repository(owner, request.accountId, request.repositoryId).fullName;
    const selection = { accountId: request.accountId, items: new Map<string, HostingActivityItem>() };
    this.activityPages.set(owner, selection);
    return this.run(owner, request.accountId, async (signal) => {
      const result = hostingActivityPageSchema.parse(
        await this.resolveProvider(entry.account.provider, entry.account.serverUrl).activity(
          this.token(entry),
          request,
          repository,
          signal,
        ),
      );
      this.checkSignal(signal);
      if (this.entries.get(request.accountId) !== entry || this.activityPages.get(owner) !== selection)
        throw new ExpectedBackendError('STALE_SNAPSHOT', 'The hosting selection changed. Refresh the list.');
      selection.items = new Map(result.items.map((item) => [item.id, item]));
      return result;
    });
  }
  activityUrl(owner: number, request: HostingActivitySelection) {
    this.require(request.accountId);
    const page = this.activityPages.get(owner);
    const item = page?.accountId === request.accountId ? page.items.get(request.itemId) : undefined;
    if (!item) throw new ExpectedBackendError('STALE_SNAPSHOT', 'Refresh the list before opening an item.');
    if (item.kind === 'notification' || item.number === null)
      return `https://github.com/notifications?query=${encodeURIComponent(`repo:${item.repository}`)}`;
    return `https://github.com/${item.repository}/${item.kind === 'issue' ? 'issues' : 'pull'}/${item.number}`;
  }
  repositoryUrl(owner: number, request: HostingRepositoryRequest) {
    const repo = this.repository(owner, request.accountId, request.repositoryId);
    const account = this.require(request.accountId).account;
    const gitlab = account.provider === 'gitlab' || account.provider === 'gitlab-server';
    return `${hostingServer(account.provider, account.serverUrl)}/${repo.fullName}${request.destination === 'issues' ? (gitlab ? '/-/issues' : '/issues') : request.destination === 'pull-requests' ? (gitlab ? '/-/merge_requests' : '/pulls') : ''}`;
  }
  cancel(owner: number) {
    this.ownerGenerations.set(owner, (this.ownerGenerations.get(owner) ?? 0) + 1);
    this.oauthSessions.delete(owner);
    for (const request of this.pending) if (request.owner === owner) request.controller.abort();
    this.repositories.delete(owner);
    this.activityPages.delete(owner);
    return null;
  }
  private repository(owner: number, accountId: string, repositoryId: string) {
    this.require(accountId);
    const repo = this.repositories.get(owner)?.get(accountId)?.get(repositoryId);
    if (!repo)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Refresh the repository list before selecting a repository.',
      );
    return repo;
  }
  private require(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new ExpectedBackendError('HOSTING_AUTH', 'The hosting account is no longer connected.');
    return entry;
  }
  private token(entry: Entry) {
    const token = entry.token ?? this.store.unseal(entry.stored!);
    if (!/^[\x21-\x7e]{10,4096}$/u.test(token))
      throw new ExpectedBackendError(
        'HOSTING_AUTH',
        'The saved token is invalid. Update it in Preferences → Accounts.',
      );
    return token;
  }
  private load() {
    this.loaded ??= this.store
      .load()
      .then((entries) => {
        for (const { account } of entries) hostingServer(account.provider, account.serverUrl);
        this.entries = new Map(
          entries.map((stored) => [stored.account.id, { account: stored.account, stored }]),
        );
      })
      .catch((error: unknown) => {
        this.loaded = undefined;
        throw error;
      });
    return this.loaded;
  }
  private resolveProvider(id: HostingProviderId, server?: string): HostingProvider {
    return id === 'github' ? this.provider : this.providerFactory(id, server);
  }
  private persist(entries: Map<string, Entry>) {
    const saved = [...entries.values()].flatMap((entry) => (entry.stored ? [entry.stored] : []));
    // Session-only accounts never create a credential file.
    if (!saved.length && ![...this.entries.values()].some((entry) => entry.stored)) return Promise.resolve();
    return this.store.save(saved);
  }
  private write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(work);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
  private clearRepositories(accountId: string) {
    for (const repos of this.repositories.values()) repos.delete(accountId);
    for (const [owner, page] of this.activityPages)
      if (page.accountId === accountId) this.activityPages.delete(owner);
  }
  private checkSignal(signal: AbortSignal) {
    if (signal.aborted) throw new ExpectedBackendError('UNAVAILABLE', 'The hosting request was cancelled.');
  }
  private checkOwner(owner: number, generation: number) {
    if ((this.ownerGenerations.get(owner) ?? 0) !== generation)
      throw new ExpectedBackendError('UNAVAILABLE', 'The hosting request was cancelled.');
  }
  private async run<T>(
    owner: number,
    accountId: string | undefined,
    work: (signal: AbortSignal) => Promise<T>,
    timeout = 11000,
  ) {
    if ([...this.pending].filter((request) => request.owner === owner).length >= 2)
      throw new ExpectedBackendError('UNAVAILABLE', 'Wait for the current hosting requests.');
    const controller = new AbortController();
    const request: Request = { owner, controller, ...(accountId ? { accountId } : {}) };
    this.pending.add(request);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await work(controller.signal);
    } finally {
      clearTimeout(timer);
      this.pending.delete(request);
    }
  }
}

export async function readTokenFile(path: string): Promise<string> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 4096 || stat.size < 1) throw new Error('Invalid file');
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const token = buffer.subarray(0, bytesRead).toString('utf8').trim();
      buffer.fill(0);
      if (bytesRead > 4096 || !/^[A-Za-z0-9_]{10,4096}$/u.test(token)) throw new Error('Invalid token');
      return token;
    } finally {
      await file.close();
    }
  } catch {
    throw new ExpectedBackendError(
      'HOSTING_AUTH',
      'Choose a regular text file containing only a GitHub personal access token (at most 4 KB).',
    );
  }
}
