import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  hostedRepositorySchema,
  hostingServerUrlSchema,
  hostingProviderNames,
} from '../../common/ipc/hosting';
import type { HostingProviderId } from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';
import type { HostingProvider } from './github-provider';
import { GitHubProvider } from './github-provider';

export function hostingServer(provider: HostingProviderId, serverUrl?: string): string {
  if (provider === 'github') return 'https://github.com';
  if (provider === 'gitlab') return 'https://gitlab.com';
  if (provider === 'bitbucket') return 'https://bitbucket.org';
  const parsed = hostingServerUrlSchema.safeParse(serverUrl);
  if (!parsed.success)
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      'Enter an HTTPS server URL without credentials, query or fragment.',
    );
  try {
    const url = new URL(parsed.data);
    if (
      !url.hostname ||
      url.hostname.endsWith('.') ||
      (provider === 'github-enterprise' && url.pathname !== '/')
    )
      throw new Error();
    return url.href.replace(/\/$/u, '');
  } catch {
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      'Enter a valid HTTPS server URL. GitHub Enterprise requires the server root.',
    );
  }
}

/** User-selected HTTPS destination, fixed API paths, bounded bodies and no redirects. */
export class ServerHostingProvider implements HostingProvider {
  private readonly api: string;
  private readonly gitlab: boolean;
  constructor(
    readonly id: HostingProviderId,
    serverUrl?: string,
    private readonly transport: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.gitlab = id === 'gitlab' || id === 'gitlab-server';
    this.api = `${hostingServer(id, serverUrl)}${this.gitlab ? '/api/v4' : id === 'gitea' ? '/api/v1' : '/api/v3'}`;
  }
  async identity(token: string, signal: AbortSignal) {
    const { body } = await this.get('/user', token, signal);
    const parsed = z
      .object({
        id: z.number().int().positive(),
        login: z.string().optional(),
        username: z.string().optional(),
      })
      .safeParse(body);
    const login = parsed.success ? (this.gitlab ? parsed.data.username : parsed.data.login) : undefined;
    if (!parsed.success || !login || !/^[A-Za-z0-9_.-]{1,100}$/u.test(login)) throw this.invalid();
    return { id: String(parsed.data.id), login };
  }
  async repositories(token: string, page: number, signal: AbortSignal) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw this.invalid();
    const path = this.gitlab
      ? `/projects?membership=true&per_page=100&order_by=path&sort=asc&page=${page}`
      : `/user/repos?${this.id === 'gitea' ? 'limit=100' : 'per_page=100&sort=full_name&direction=asc'}&page=${page}`;
    const { body, headers } = await this.get(path, token, signal);
    const parsed = z
      .array(
        z.object({
          id: z.number().int().positive(),
          full_name: hostedRepositorySchema.shape.fullName.optional(),
          path_with_namespace: hostedRepositorySchema.shape.fullName.optional(),
          private: z.boolean().optional(),
          visibility: z.enum(['public', 'internal', 'private']).optional(),
          archived: z.boolean(),
        }),
      )
      .max(100)
      .safeParse(body);
    if (!parsed.success) throw this.invalid();
    const repositories = parsed.data.map((repo) => {
      const fullName = this.gitlab ? repo.path_with_namespace : repo.full_name;
      if (!fullName || (this.gitlab ? !repo.visibility : typeof repo.private !== 'boolean'))
        throw this.invalid();
      return {
        id: String(repo.id),
        fullName,
        private: this.gitlab ? repo.visibility !== 'public' : repo.private!,
        archived: repo.archived,
      };
    });
    // Never follow provider-supplied Link URLs with a credential.
    const next = this.gitlab
      ? Boolean(headers.get('x-next-page'))
      : /;\s*rel="next"/u.test(headers.get('link') ?? '');
    return {
      repositories,
      page,
      nextPage:
        page < 10000 && (next || (this.id === 'gitea' && repositories.length === 100)) ? page + 1 : null,
    };
  }
  async activity(): ReturnType<HostingProvider['activity']> {
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Use the repository’s website to view activity for this provider.',
    );
  }
  private invalid() {
    return new ExpectedBackendError(
      'UNAVAILABLE',
      'The server returned an unsupported or oversized response.',
    );
  }
  private async get(path: string, token: string, signal: AbortSignal) {
    const name = hostingProviderNames[this.id];
    try {
      const response = await this.transport(`${this.api}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        headers: {
          Authorization: `${this.id === 'gitea' ? 'token' : 'Bearer'} ${token}`,
          Accept: 'application/json',
          'User-Agent': 'Git-Workbench',
        },
      });
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))
      )
        throw new ExpectedBackendError(
          'HOSTING_RATE_LIMIT',
          `${name} rate limit reached. Wait before trying again.`,
        );
      if (response.status === 401 || response.status === 403)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          `${name} denied access. Check the token, its permissions and any organization authorization.`,
        );
      if (!response.ok)
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          `${name} could not complete the request. Check the server URL and connection.`,
        );
      return { body: await readHostingJson(response), headers: response.headers };
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        signal.aborted
          ? 'The hosting request was cancelled.'
          : `${name} is unavailable or returned an invalid response. Check the server URL, certificate and connection.`,
      );
    }
  }
}

export function createHostingProvider(id: HostingProviderId, server?: string): HostingProvider {
  if (id === 'github-enterprise')
    return new GitHubProvider(undefined, id, `${hostingServer(id, server)}/api/v3`);
  if (id === 'bitbucket' || id === 'bitbucket-server') return new BitbucketProvider(id, server);
  return new ServerHostingProvider(id, server);
}

// The email/user is part of the encrypted credential, never a token-bearing URL or argument.
export function bitbucketCredential(username: string, token: string) {
  return `basic:${Buffer.from(`${username}:${token}`, 'utf8').toString('base64')}`;
}
export function bitbucketPassword(credential: string) {
  return Buffer.from(credential.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
}

export class BitbucketProvider implements HostingProvider {
  private readonly api: string;
  private readonly pages = new Map<
    string,
    {
      cursors: Map<number, { workspacePage: number; workspaceIndex: number; repoPage: number }>;
      workspaces: Map<number, { slugs: string[]; next: boolean }>;
    }
  >();
  private readonly serverOffsets = new Map<string, Map<number, number>>();
  constructor(
    readonly id: 'bitbucket' | 'bitbucket-server',
    server?: string,
    private readonly transport: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.api =
      id === 'bitbucket' ? 'https://api.bitbucket.org/2.0' : `${hostingServer(id, server)}/rest/api/latest`;
  }
  async identity(token: string, signal: AbortSignal) {
    const username = Buffer.from(token.slice(6), 'base64').toString('utf8').split(':')[0]!;
    const body = await this.get(
      this.id === 'bitbucket' ? '/user' : `/users/${encodeURIComponent(username)}`,
      token,
      signal,
    );
    const parsed = z
      .object({
        uuid: z.string().max(100).optional(),
        id: z.number().int().optional(),
        nickname: z.string().optional(),
        name: z.string().optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw this.invalid();
    const id = this.id === 'bitbucket' ? parsed.data.uuid : String(parsed.data.id ?? '');
    const nickname = this.id === 'bitbucket' ? parsed.data.nickname : parsed.data.name;
    const login =
      this.id === 'bitbucket' && nickname && !/^[A-Za-z0-9_.-]{1,100}$/u.test(nickname)
        ? `bb-${createHash('sha256')
            .update(id ?? '')
            .digest('hex')
            .slice(0, 16)}`
        : nickname;
    if (!id || !login || !/^[A-Za-z0-9_.-]{1,100}$/u.test(login)) throw this.invalid();
    return { id, login };
  }
  async repositories(token: string, page: number, signal: AbortSignal) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw this.invalid();
    if (this.id === 'bitbucket') return this.cloudRepositories(token, page, signal);
    const key = createHash('sha256').update(token).digest('hex');
    let offsets = this.serverOffsets.get(key);
    if (page === 1 || !offsets) {
      if (this.serverOffsets.size >= 20 && !offsets)
        this.serverOffsets.delete(this.serverOffsets.keys().next().value!);
      offsets = new Map([[1, 0]]);
      this.serverOffsets.set(key, offsets);
    }
    const offset = offsets.get(page);
    if (offset === undefined)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Refresh repositories and use Next to load this page.',
      );
    const body = await this.get(`/repos?limit=100&start=${offset}`, token, signal);
    const parsed = z
      .object({
        values: z
          .array(
            z.object({
              id: z.number().int().positive(),
              slug: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
              project: z.object({ key: z.string().regex(/^[A-Za-z0-9_~.-]+$/u) }),
              public: z.boolean(),
              archived: z.boolean().optional(),
            }),
          )
          .max(100),
        isLastPage: z.boolean(),
        nextPageStart: z.number().int().min(0).max(999999).optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw this.invalid();
    const repositories = parsed.data.values.map((repo) => {
      const id = repo.id;
      const fullName = `${repo.project.key}/${repo.slug}`;
      if (!hostedRepositorySchema.shape.fullName.safeParse(fullName).success) throw this.invalid();
      return {
        id: `bb-${createHash('sha256').update(String(id)).digest('hex').slice(0, 32)}`,
        fullName,
        private: !repo.public,
        archived: repo.archived ?? false,
      };
    });
    const nextPage =
      parsed.data.isLastPage === false &&
      parsed.data.nextPageStart !== undefined &&
      parsed.data.nextPageStart > offset &&
      page < 10000
        ? page + 1
        : null;
    if (!parsed.data.isLastPage && nextPage === null) throw this.invalid();
    if (nextPage) offsets.set(nextPage, parsed.data.nextPageStart!);
    return { repositories, page, nextPage };
  }
  private async cloudRepositories(token: string, page: number, signal: AbortSignal) {
    const key = createHash('sha256').update(token).digest('hex');
    let state = this.pages.get(key);
    if (page === 1 || !state) {
      if (this.pages.size >= 20 && !state) this.pages.delete(this.pages.keys().next().value!);
      state = {
        cursors: new Map([[1, { workspacePage: 1, workspaceIndex: 0, repoPage: 1 }]]),
        workspaces: new Map(),
      };
      this.pages.set(key, state);
    }
    const start = state.cursors.get(page);
    if (!start)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Refresh repositories and use Next to load this page.',
      );
    const cursor = { ...start };
    // Visit one bounded workspace/repository page. Empty workspaces remain traversable with Next.
    let workspaces = state.workspaces.get(cursor.workspacePage);
    if (!workspaces) {
      const result = z
        .object({
          values: z
            .array(z.object({ workspace: z.object({ slug: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/u) }) }))
            .max(100),
          next: z.string().optional(),
        })
        .safeParse(
          await this.get(`/user/workspaces?pagelen=100&page=${cursor.workspacePage}`, token, signal),
        );
      if (!result.success) throw this.invalid();
      workspaces = {
        slugs: result.data.values.map((value) => value.workspace.slug),
        next: Boolean(result.data.next),
      };
      state.workspaces.set(cursor.workspacePage, workspaces);
    }
    const workspace = workspaces.slugs[cursor.workspaceIndex];
    if (!workspace) {
      if (workspaces.next && page < 10000)
        state.cursors.set(page + 1, {
          workspacePage: cursor.workspacePage + 1,
          workspaceIndex: 0,
          repoPage: 1,
        });
      return { repositories: [], page, nextPage: workspaces.next && page < 10000 ? page + 1 : null };
    }
    const result = z
      .object({
        values: z
          .array(
            z.object({
              uuid: z.string().min(1).max(100),
              full_name: hostedRepositorySchema.shape.fullName,
              is_private: z.boolean(),
            }),
          )
          .max(100),
        next: z.string().optional(),
      })
      .safeParse(
        await this.get(
          `/repositories/${workspace}?role=member&pagelen=100&page=${cursor.repoPage}`,
          token,
          signal,
        ),
      );
    if (!result.success || result.data.values.some((repo) => repo.full_name.split('/')[0] !== workspace))
      throw this.invalid();
    let next = false;
    if (result.data.next) {
      cursor.repoPage++;
      next = true;
    } else if (cursor.workspaceIndex + 1 < workspaces.slugs.length) {
      cursor.workspaceIndex++;
      cursor.repoPage = 1;
      next = true;
    } else if (workspaces.next) {
      cursor.workspacePage++;
      cursor.workspaceIndex = 0;
      cursor.repoPage = 1;
      next = true;
    }
    if (next && page >= 10000)
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'The repository catalogue exceeds the 10,000-page limit.',
      );
    if (next) state.cursors.set(page + 1, cursor);
    return {
      repositories: result.data.values.map((repo) => ({
        id: `bb-${createHash('sha256').update(repo.uuid).digest('hex').slice(0, 32)}`,
        fullName: repo.full_name,
        private: repo.is_private,
        archived: false,
      })),
      page,
      nextPage: next ? page + 1 : null,
    };
  }
  async activity(): ReturnType<HostingProvider['activity']> {
    throw new ExpectedBackendError('UNAVAILABLE', 'Open Bitbucket issues and pull requests in your browser.');
  }
  private invalid() {
    return new ExpectedBackendError(
      'UNAVAILABLE',
      'Bitbucket returned an unsupported or oversized response.',
    );
  }
  private async get(path: string, credential: string, signal: AbortSignal) {
    try {
      const response = await this.transport(`${this.api}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        headers: {
          Authorization: `Basic ${credential.slice(6)}`,
          Accept: 'application/json',
          'User-Agent': 'Git-Workbench',
        },
      });
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 429 || (response.status === 403 && response.headers.has('retry-after')))
        throw new ExpectedBackendError(
          'HOSTING_RATE_LIMIT',
          'Bitbucket rate limit reached. Wait before trying again.',
        );
      if (response.status === 401 || response.status === 403)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          'Bitbucket denied access. Update the token and check its permissions.',
        );
      if (!response.ok) throw this.invalid();
      return await readHostingJson(response);
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        signal.aborted
          ? 'The hosting request was cancelled.'
          : 'Bitbucket is unavailable or returned an invalid response. Check the connection and certificate.',
      );
    }
  }
}

export async function readHostingJson(response: Response, limit = 4 * 1024 * 1024): Promise<unknown> {
  if (!response.body) throw new Error('Missing response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Oversized response');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
