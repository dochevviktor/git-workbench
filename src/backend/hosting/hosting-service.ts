import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type {
  HostedRepository,
  HostingAccount,
  HostingCloneSelection,
  HostingConnectRequest,
  HostingRepositoriesRequest,
  HostingRepositoryRequest,
} from '../../common/ipc/hosting';
import { hostingAccountSchema, hostedRepositoriesSchema } from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';
import type { HostingAccountStore } from './account-store';
import type { StoredAccount } from './account-store';
import { GitHubProvider } from './github-provider';
import type { HostingProvider } from './github-provider';

type Entry = { account: HostingAccount; stored?: StoredAccount; token?: string };
type Request = { owner: number; accountId?: string; controller: AbortController };

export class HostingService {
  private entries = new Map<string, Entry>();
  private loaded: Promise<void> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly pending = new Set<Request>();
  private readonly ownerGenerations = new Map<number, number>();
  private readonly repositories = new Map<number, Map<string, Map<string, HostedRepository>>>();

  constructor(
    private readonly store: HostingAccountStore,
    private readonly provider: HostingProvider = new GitHubProvider(),
  ) {}

  async list() {
    await this.load();
    return {
      accounts: [...this.entries.values()].map((entry) => entry.account),
      secureStorageAvailable: this.store.available(),
    };
  }

  /** Native chooser supplies the path. No path or secret is accepted from the renderer. */
  async connect(owner: number, request: HostingConnectRequest, pickFile: () => Promise<string | null>) {
    const generation = this.ownerGenerations.get(owner) ?? 0;
    await this.load();
    this.checkOwner(owner, generation);
    const expected = request.accountId ? this.require(request.accountId) : undefined;
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
        const path = await pickFile();
        if (!path || signal.aborted) return null;
        const token = await readTokenFile(path);
        const identity = await this.provider.identity(token, signal);
        const account = hostingAccountSchema.parse({
          id: `github-${identity.id}`,
          provider: this.provider.id,
          login: identity.login,
          storage: request.remember ? 'keyring' : 'session',
        });
        if (expected && expected.account.id !== account.id)
          throw new ExpectedBackendError(
            'HOSTING_AUTH',
            'This token belongs to a different GitHub account. Add it as a separate account.',
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
              'This account is already connected. Use Replace token on that account.',
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
        await this.provider.repositories(this.token(entry), request.page, signal),
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
    return {
      url:
        request.protocol === 'ssh'
          ? `git@github.com:${repo.fullName}.git`
          : `https://github.com/${repo.fullName}.git`,
      name: repo.fullName.split('/')[1]!,
    };
  }
  repositoryUrl(owner: number, request: HostingRepositoryRequest) {
    const repo = this.repository(owner, request.accountId, request.repositoryId);
    return `https://github.com/${repo.fullName}${request.destination === 'issues' ? '/issues' : request.destination === 'pull-requests' ? '/pulls' : ''}`;
  }
  cancel(owner: number) {
    this.ownerGenerations.set(owner, (this.ownerGenerations.get(owner) ?? 0) + 1);
    for (const request of this.pending) if (request.owner === owner) request.controller.abort();
    this.repositories.delete(owner);
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
    return entry.token ?? this.store.unseal(entry.stored!);
  }
  private load() {
    this.loaded ??= this.store
      .load()
      .then((entries) => {
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
