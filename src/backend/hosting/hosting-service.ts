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
  HostingNotificationPreference,
  HostingNotificationSnapshot,
} from '../../common/ipc/hosting';
import {
  hostingAccountSchema,
  hostedRepositoriesSchema,
  hostingActivityPageSchema,
  hostingActivityProviders,
} from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';
import type { HostingAccountStore } from './account-store';
import type { StoredAccount } from './account-store';
import { GitHubProvider } from './github-provider';
import type { HostingProvider } from './github-provider';
import { credentialContextSchema } from '../git/credential-broker';
import type { GitCredentialContext, GitCredentialSource } from '../git/credential-broker';
import {
  hostingServer,
  createHostingProvider,
  bitbucketCredential,
  bitbucketPassword,
} from './server-provider';
import { HostingPreferencesStore } from './preferences-store';
import { GitHubOAuth, decodeOAuthTokens, encodeOAuthTokens } from './github-oauth';
import type { GitHubDeviceAuthorization } from './github-oauth';
import { configuredPullRequestUrl } from '../repositories/hosting-service';

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
  private readonly providers = new Map<string, HostingProvider>();
  private readonly repositoryProviders = new Map<number, Map<string, HostingProvider>>();
  private preferencesError = '';
  private readonly renewals = new Map<string, { controller: AbortController; promise: Promise<string> }>();
  private readonly notificationOwners = new Set<number>();
  private readonly notificationListeners = new Set<() => void>();
  private notificationRevision = 0;
  // Server deadlines outlive the visible inbox and its opt-in/owner/credential resets.
  private readonly notificationDeadlines = new Map<string, number>();
  private readonly notifications = new Map<
    string,
    {
      items: HostingActivityItem[];
      hasMore: boolean;
      checkedAt: string | null;
      error: string;
      timer?: ReturnType<typeof setTimeout> | undefined;
      controller?: AbortController | undefined;
      failures: number;
      paused: boolean;
    }
  >();

  constructor(
    private readonly store: HostingAccountStore,
    private readonly provider: HostingProvider = new GitHubProvider(),
    private readonly providerFactory = createHostingProvider,
    private readonly oauth = new GitHubOAuth(),
    private readonly preferences = new HostingPreferencesStore(),
    private readonly notificationInterval = 300_000,
  ) {}

  async list() {
    await this.load();
    return {
      accounts: await Promise.all(
        [...this.entries.values()].map(async (entry) => ({
          ...entry.account,
          notificationsEnabled: await this.optionalPreference(
            () => this.preferences.enabled(entry.account.id),
            false,
          ),
        })),
      ),
      secureStorageAvailable: this.store.available(),
      gitAccountId: this.entries.keys().next().value ?? null,
      githubOAuthAvailable: this.oauth.available(),
      preferencesError: this.preferencesError,
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
        ? scoped.find(
            (item) =>
              item.account.login.toLowerCase() === context.username.toLowerCase() ||
              (item.account.provider === 'bitbucket' && item.account.id === context.username),
          )
        : scoped[0];
      if (!entry)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          'No matching hosting account. Log in through Preferences → Accounts.',
        );
      const credential = await this.credential(entry);
      if (this.entries.get(entry.account.id) !== entry)
        throw new ExpectedBackendError('HOSTING_AUTH', 'The account is no longer connected.');
      return {
        username: entry.account.provider === 'bitbucket' ? 'x-bitbucket-api-token-auth' : entry.account.login,
        password: entry.account.provider.startsWith('bitbucket') ? bitbucketPassword(credential) : credential,
      };
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
    const { username, ...login } = request;
    return this.login(owner, login, async () =>
      request.provider.startsWith('bitbucket')
        ? bitbucketCredential(username!, request.token)
        : request.token,
    );
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
        async () => (typeof token === 'string' ? token : encodeOAuthTokens(token)),
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
        if (!/^[\x21-\x7e]{10,16384}$/u.test(token))
          throw new ExpectedBackendError(
            'HOSTING_AUTH',
            'Enter a valid access token without spaces or line breaks.',
          );
        const identity = await provider.identity(decodeOAuthTokens(token)?.accessToken ?? token, signal);
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
          this.renewals.get(account.id)?.controller.abort();
          this.clearRepositories(account.id);
          this.stopNotifications(account.id);
        });
        this.changedNotifications();
        if (await this.optionalPreference(() => this.preferences.enabled(account.id), false))
          this.scheduleNotifications(account.id, 0);
        return account;
      },
      300000,
    );
  }

  async disconnect(accountId: string) {
    await this.load();
    // Abort reads and replacement attempts before allowing their result to reach the UI.
    for (const request of this.pending) if (request.accountId === accountId) request.controller.abort();
    this.renewals.get(accountId)?.controller.abort();
    for (const [owner, session] of this.oauthSessions)
      if (session.request.accountId === accountId) this.oauthSessions.delete(owner);
    await this.write(async () => {
      this.require(accountId);
      this.stopNotifications(accountId);
      const next = new Map(this.entries);
      next.delete(accountId);
      await this.persist(next);
      this.entries = next;
      this.clearRepositories(accountId);
    });
    this.changedNotifications();
    await this.optionalPreference(() => this.preferences.remove(accountId), undefined);
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
        await this.repositoryProvider(owner, entry.account).repositories(
          await this.credential(entry),
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
    const path =
      account.provider === 'bitbucket-server'
        ? `scm/${repo.fullName.split('/')[0]!.toLowerCase()}/${repo.fullName.split('/')[1]}`
        : repo.fullName;
    return {
      url:
        request.protocol === 'ssh'
          ? account.provider === 'bitbucket-server'
            ? `ssh://git@${server.hostname}:7999/${repo.fullName}.git`
            : `git@${server.hostname}:${repo.fullName}.git`
          : `https://${account.provider === 'bitbucket' ? account.id : account.login}@${server.host}${base}/${path}.git`,
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
          await this.credential(entry),
          request,
          repository,
          signal,
        ),
      );
      this.checkSignal(signal);
      if (this.entries.get(request.accountId) !== entry || this.activityPages.get(owner) !== selection)
        throw new ExpectedBackendError('STALE_SNAPSHOT', 'The hosting selection changed. Refresh the list.');
      selection.items = new Map(result.items.map((item) => [item.id, item]));
      if (request.kind === 'notifications') return result;
      const key = `${request.accountId}/${request.kind}/${request.repositoryId}`;
      if (request.text.trim())
        await this.optionalPreference(() => this.preferences.remember(key, request.text.trim()), undefined);
      const recentSearches = await this.optionalPreference(() => this.preferences.recent(key), []);
      this.checkSignal(signal);
      return { ...result, recentSearches, preferencesError: this.preferencesError };
    });
  }
  activityUrl(owner: number, request: HostingActivitySelection) {
    const account = this.require(request.accountId).account;
    const page = this.activityPages.get(owner);
    const item = page?.accountId === request.accountId ? page.items.get(request.itemId) : undefined;
    if (!item) throw new ExpectedBackendError('STALE_SNAPSHOT', 'Refresh the list before opening an item.');
    if (item.kind === 'notification' || item.number === null)
      return `${hostingServer(account.provider, account.serverUrl)}/notifications?query=${encodeURIComponent(`repo:${item.repository}`)}`;
    return `${hostingServer(account.provider, account.serverUrl)}/${item.repository}/${item.kind === 'issue' ? 'issues' : 'pull'}/${item.number}`;
  }
  repositoryUrl(owner: number, request: HostingRepositoryRequest) {
    const repo = this.repository(owner, request.accountId, request.repositoryId);
    const account = this.require(request.accountId).account;
    const gitlab = account.provider === 'gitlab' || account.provider === 'gitlab-server';
    if (account.provider === 'bitbucket-server') {
      const [project, name] = repo.fullName.split('/');
      return `${hostingServer(account.provider, account.serverUrl)}/projects/${project}/repos/${name}/${request.destination === 'pull-requests' ? 'pull-requests' : request.destination === 'issues' ? 'browse' : 'browse'}`;
    }
    if (account.provider === 'bitbucket')
      return `https://bitbucket.org/${repo.fullName}${request.destination === 'issues' ? '/issues' : request.destination === 'pull-requests' ? '/pull-requests' : ''}`;
    return `${hostingServer(account.provider, account.serverUrl)}/${repo.fullName}${request.destination === 'issues' ? (gitlab ? '/-/issues' : '/issues') : request.destination === 'pull-requests' ? (gitlab ? '/-/merge_requests' : '/pulls') : ''}`;
  }
  credentialManagementUrl(accountId: string) {
    const account = this.require(accountId).account;
    const server = hostingServer(account.provider, account.serverUrl);
    if (account.provider === 'bitbucket')
      return 'https://id.atlassian.com/manage-profile/security/api-tokens';
    if (account.provider === 'bitbucket-server') return `${server}/plugins/servlet/access-tokens/manage`;
    if (account.provider.startsWith('gitlab')) return `${server}/-/user_settings/personal_access_tokens`;
    if (account.provider === 'gitea') return `${server}/user/settings/applications`;
    return `${server}/settings/${account.authentication === 'oauth' ? 'applications' : 'tokens'}`;
  }
  async pullRequestUrl(remote: string, branch: string) {
    await this.load();
    return configuredPullRequestUrl(
      remote,
      branch,
      [...this.entries.values()].map((entry) => entry.account),
    );
  }
  attachOwner(owner: number) {
    this.notificationOwners.add(owner);
    void this.list()
      .then((result) => {
        if (!this.notificationOwners.has(owner)) return;
        for (const account of result.accounts)
          if (account.notificationsEnabled) this.scheduleNotifications(account.id, 0);
      })
      .catch(() => undefined);
  }
  disposeOwner(owner: number) {
    this.cancel(owner);
    this.notificationOwners.delete(owner);
    if (!this.notificationOwners.size) for (const id of this.notifications.keys()) this.stopNotifications(id);
  }
  dispose() {
    for (const owner of [...this.notificationOwners]) this.disposeOwner(owner);
    for (const request of this.pending) request.controller.abort();
    for (const renewal of this.renewals.values()) renewal.controller.abort();
    this.notificationListeners.clear();
  }
  subscribeNotifications(listener: () => void) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }
  private changedNotifications() {
    this.notificationRevision++;
    for (const listener of this.notificationListeners) listener();
  }
  async getNotifications(): Promise<HostingNotificationSnapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = this.notificationRevision;
      const listed = await this.list();
      const accounts = listed.accounts.filter((account) =>
        hostingActivityProviders.includes(account.provider),
      );
      if (revision !== this.notificationRevision) continue;
      return {
        revision,
        preferencesError: listed.preferencesError,
        accounts: accounts
          .filter((account) => this.entries.has(account.id))
          .map((account) => {
            const state = this.notifications.get(account.id);
            return {
              account,
              items: state?.items ?? [],
              hasMore: state?.hasMore ?? false,
              checkedAt: state?.checkedAt ?? null,
              error: state?.error ?? '',
            };
          }),
      };
    }
    throw new ExpectedBackendError('STALE_SNAPSHOT', 'The notification accounts changed. Refresh the inbox.');
  }
  async setNotifications(request: HostingNotificationPreference) {
    await this.load();
    await this.write(async () => {
      const entry = this.require(request.accountId);
      if (!hostingActivityProviders.includes(entry.account.provider))
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          'Notifications are supported for GitHub and GitHub Enterprise.',
        );
      await this.preferences.setEnabled(request.accountId, request.enabled);
      this.stopNotifications(request.accountId);
      if (request.enabled) this.scheduleNotifications(request.accountId, 0);
    });
    this.changedNotifications();
    return null;
  }
  private stopNotifications(accountId: string) {
    const state = this.notifications.get(accountId);
    clearTimeout(state?.timer);
    state?.controller?.abort();
    this.notifications.delete(accountId);
  }
  private scheduleNotifications(accountId: string, delay: number) {
    if (!this.notificationOwners.size || !this.entries.has(accountId)) return;
    let state = this.notifications.get(accountId);
    if (!state) {
      state = { items: [], hasMore: false, checkedAt: null, error: '', failures: 0, paused: false };
      this.notifications.set(accountId, state);
    }
    if (state.controller || state.timer || state.paused) return;
    state.timer = setTimeout(
      () => {
        state!.timer = undefined;
        void this.refreshNotifications(accountId).catch(() => undefined);
      },
      Math.max(delay, this.notificationDeadline(accountId) - Date.now()),
    );
    state.timer.unref();
  }
  async refreshNotifications(accountId: string) {
    await this.load();
    const entry = this.require(accountId);
    if (
      !hostingActivityProviders.includes(entry.account.provider) ||
      !(await this.preferences.enabled(accountId))
    )
      throw new ExpectedBackendError('UNAVAILABLE', 'Enable notifications for this account first.');
    let state = this.notifications.get(accountId);
    if (!state) {
      this.scheduleNotifications(accountId, this.notificationInterval);
      state = this.notifications.get(accountId);
    }
    if (!state || state.controller) return null;
    if (this.notificationDeadline(accountId) > Date.now())
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'The server requires a pause between notification checks. Try again later.',
      );
    clearTimeout(state.timer);
    state.timer = undefined;
    const controller = new AbortController();
    state.controller = controller;
    const timer = setTimeout(() => controller.abort(), 11000);
    const provider = this.resolveProvider(entry.account.provider, entry.account.serverUrl);
    try {
      const result = hostingActivityPageSchema.parse(
        await provider.activity(
          await this.credential(entry),
          { accountId, kind: 'notifications', page: 1, all: false, participating: false },
          undefined,
          controller.signal,
        ),
      );
      this.checkSignal(controller.signal);
      if (this.entries.get(accountId) !== entry || this.notifications.get(accountId) !== state) return null;
      state.items = result.items;
      state.hasMore = result.nextPage !== null;
      state.checkedAt = new Date().toISOString();
      state.error = '';
      state.failures = 0;
      state.paused = false;
    } catch (error) {
      if (this.notifications.get(accountId) !== state) return null;
      state.error = controller.signal.aborted
        ? 'The notification request timed out. Try again later.'
        : error instanceof ExpectedBackendError
          ? error.message
          : 'Notifications could not be checked. Try again later.';
      state.failures = Math.min(state.failures + 1, 4);
      state.paused = error instanceof ExpectedBackendError && error.code === 'HOSTING_AUTH';
    } finally {
      clearTimeout(timer);
      state.controller = undefined;
      const minimum = Math.max(
        (provider.notificationPollInterval ?? 0) * 1000,
        (provider.notificationRetryAt ?? 0) - Date.now(),
      );
      this.notificationDeadlines.set(
        accountId,
        Math.max(this.notificationDeadlines.get(accountId) ?? 0, Date.now() + minimum),
      );
      if (this.notifications.get(accountId) === state) {
        this.changedNotifications();
        this.scheduleNotifications(
          accountId,
          Math.max(minimum, Math.min(this.notificationInterval * 2 ** state.failures, 3_600_000)),
        );
      }
    }
    return null;
  }
  private notificationDeadline(accountId: string) {
    for (const [id, deadline] of this.notificationDeadlines)
      if (deadline <= Date.now()) this.notificationDeadlines.delete(id);
    return this.notificationDeadlines.get(accountId) ?? 0;
  }
  notificationUrl(request: HostingActivitySelection) {
    const account = this.require(request.accountId).account;
    const item = this.notifications.get(account.id)?.items.find((item) => item.id === request.itemId);
    if (!item)
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'Refresh notifications before opening this item.');
    const server = hostingServer(account.provider, account.serverUrl);
    return item.number === null || item.kind === 'notification'
      ? `${server}/notifications?query=${encodeURIComponent(`repo:${item.repository}`)}`
      : `${server}/${item.repository}/${item.kind === 'issue' ? 'issues' : 'pull'}/${item.number}`;
  }
  cancel(owner: number) {
    this.ownerGenerations.set(owner, (this.ownerGenerations.get(owner) ?? 0) + 1);
    this.oauthSessions.delete(owner);
    for (const request of this.pending) if (request.owner === owner) request.controller.abort();
    this.repositories.delete(owner);
    this.repositoryProviders.delete(owner);
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
    if (!/^[\x21-\x7e]{10,16384}$/u.test(token))
      throw new ExpectedBackendError(
        'HOSTING_AUTH',
        'The saved token is invalid. Update it in Preferences → Accounts.',
      );
    return token;
  }
  private async credential(entry: Entry): Promise<string> {
    const credential = this.token(entry);
    const tokens = entry.account.authentication === 'oauth' ? decodeOAuthTokens(credential) : null;
    if (!tokens || tokens.expiresAt > Date.now() + 60_000) return tokens?.accessToken ?? credential;
    const existing = this.renewals.get(entry.account.id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.write(async () => {
      this.checkSignal(controller.signal);
      if (this.entries.get(entry.account.id) !== entry)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          'The account changed. Try again with its current authorization.',
        );
      const nextTokens = await this.oauth.refresh(tokens, controller.signal);
      this.checkSignal(controller.signal);
      const encoded = encodeOAuthTokens(nextTokens);
      // Serialize credential rotation with sign-out/replacement. The token pair changes atomically.
      const stored = entry.stored ? this.store.seal(entry.account, encoded) : undefined;
      const nextEntry: Entry = stored
        ? { account: entry.account, stored }
        : { account: entry.account, token: encoded };
      await this.persist(new Map(this.entries).set(entry.account.id, nextEntry));
      // Retain entry identity so a successful renewal does not invalidate a reviewed read.
      if (stored) entry.stored = stored;
      else entry.token = encoded;
      return nextTokens.accessToken;
    }).finally(() => {
      if (this.renewals.get(entry.account.id)?.controller === controller)
        this.renewals.delete(entry.account.id);
    });
    this.renewals.set(entry.account.id, { controller, promise });
    return promise;
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
    if (id === 'github') return this.provider;
    const key = `${id}/${server ?? ''}`;
    let provider = this.providers.get(key);
    if (!provider) {
      provider = this.providerFactory(id, server);
      this.providers.set(key, provider);
    }
    return provider;
  }
  private repositoryProvider(owner: number, account: HostingAccount): HostingProvider {
    if (!account.provider.startsWith('bitbucket'))
      return this.resolveProvider(account.provider, account.serverUrl);
    // Bitbucket continuation state belongs to a browsing owner, not to every window using its token.
    let providers = this.repositoryProviders.get(owner);
    if (!providers) {
      providers = new Map();
      this.repositoryProviders.set(owner, providers);
    }
    let provider = providers.get(account.id);
    if (!provider) {
      provider = this.providerFactory(account.provider, account.serverUrl);
      providers.set(account.id, provider);
    }
    return provider;
  }
  private async optionalPreference<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      // Optional metadata must not conceal an account or turn a completed credential write into failure.
      this.preferencesError =
        error instanceof ExpectedBackendError
          ? error.message
          : 'Hosting preferences are unavailable. Account credentials can still be managed.';
      return fallback;
    }
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
    for (const providers of this.repositoryProviders.values()) providers.delete(accountId);
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
