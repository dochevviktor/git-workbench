import { z } from 'zod';
import {
  hostedRepositorySchema,
  hostingServerUrlSchema,
  hostingProviderNames,
} from '../../common/ipc/hosting';
import type { HostingProviderId } from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';
import type { HostingProvider } from './github-provider';

export function hostingServer(provider: HostingProviderId, serverUrl?: string): string {
  if (provider === 'github') return 'https://github.com';
  if (provider === 'gitlab') return 'https://gitlab.com';
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
