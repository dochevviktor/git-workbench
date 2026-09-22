import { z } from 'zod';
import type { HostedRepositories } from '../../common/ipc/hosting';
import { hostedRepositorySchema } from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';

export interface HostingProvider {
  readonly id: 'github';
  identity(token: string, signal: AbortSignal): Promise<{ id: string; login: string }>;
  repositories(token: string, page: number, signal: AbortSignal): Promise<HostedRepositories>;
}

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().regex(/^[A-Za-z0-9-]{1,100}$/u),
});
const reposSchema = z
  .array(
    z.object({
      id: z.number().int().positive(),
      full_name: hostedRepositorySchema.shape.fullName,
      private: z.boolean(),
      archived: z.boolean(),
    }),
  )
  .max(100);

/** Fixed origin and paths: neither API payload URLs nor Link headers can receive credentials. */
export class GitHubProvider implements HostingProvider {
  readonly id = 'github' as const;
  constructor(private readonly transport: typeof fetch = (input, init) => fetch(input, init)) {}

  async identity(token: string, signal: AbortSignal) {
    const { body } = await this.get('/user', token, signal);
    const parsed = userSchema.safeParse(body);
    if (!parsed.success) throw invalidResponse();
    return { id: String(parsed.data.id), login: parsed.data.login };
  }

  async repositories(token: string, page: number, signal: AbortSignal): Promise<HostedRepositories> {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw invalidResponse();
    const { body, headers } = await this.get(
      `/user/repos?per_page=100&sort=full_name&direction=asc&page=${page}`,
      token,
      signal,
    );
    const parsed = reposSchema.safeParse(body);
    if (!parsed.success) throw invalidResponse();
    // Only the presence of the next relation matters; never follow a server-supplied URL.
    const hasNext = /;\s*rel="next"/u.test(headers.get('link') ?? '');
    return {
      repositories: parsed.data.map((repo) => ({
        id: String(repo.id),
        fullName: repo.full_name,
        private: repo.private,
        archived: repo.archived,
      })),
      page,
      nextPage: hasNext && page < 10000 ? page + 1 : null,
    };
  }

  private async get(path: string, token: string, signal: AbortSignal) {
    try {
      const response = await this.transport(`https://api.github.com${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Git-Workbench',
        },
      });
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 401)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          'The GitHub token expired or was revoked. Select a replacement token file.',
        );
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))
      )
        throw new ExpectedBackendError(
          'HOSTING_RATE_LIMIT',
          'GitHub rate limit reached. Wait before refreshing.',
        );
      if (response.status === 403)
        throw new ExpectedBackendError(
          'HOSTING_AUTH',
          'GitHub denied access. Check token permissions and organization SSO authorization.',
        );
      if (!response.ok)
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          'GitHub could not complete the request. Try again later.',
        );
      if (!response.body) throw invalidResponse();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024) throw invalidResponse();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return { body, headers: response.headers };
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      // Never propagate transport exceptions, response bodies or URLs: they may contain secrets.
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        signal.aborted
          ? 'The hosting request was cancelled.'
          : 'GitHub is unavailable, timed out, or returned an invalid response. Check your connection.',
      );
    }
  }
}

function invalidResponse() {
  return new ExpectedBackendError('UNAVAILABLE', 'GitHub returned an unsupported or oversized response.');
}
