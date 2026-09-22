import { z } from 'zod';
import type {
  HostedRepositories,
  HostingActivityRequest,
  HostingActivityPage,
} from '../../common/ipc/hosting';
import { hostedRepositorySchema, hostingActivityRequestSchema } from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';

export interface HostingProvider {
  readonly id: 'github';
  identity(token: string, signal: AbortSignal): Promise<{ id: string; login: string }>;
  repositories(token: string, page: number, signal: AbortSignal): Promise<HostedRepositories>;
  activity(
    token: string,
    request: HostingActivityRequest,
    repository: string | undefined,
    signal: AbortSignal,
  ): Promise<HostingActivityPage>;
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

  async activity(
    token: string,
    input: HostingActivityRequest,
    repository: string | undefined,
    signal: AbortSignal,
  ): Promise<HostingActivityPage> {
    const request = hostingActivityRequestSchema.parse(input);
    if (request.kind === 'notifications') {
      const { body, headers } = await this.get(
        `/notifications?per_page=100&page=${request.page}&all=${request.all}&participating=${request.participating}`,
        token,
        signal,
      );
      const parsed = z
        .array(
          z.object({
            id: z.string().regex(/^\d+$/u),
            unread: z.boolean(),
            reason: z.string().max(100),
            updated_at: z.iso.datetime(),
            repository: z.object({ full_name: hostedRepositorySchema.shape.fullName }),
            subject: z.object({ title: z.string().max(1024), type: z.string(), url: z.string().nullable() }),
          }),
        )
        .max(100)
        .safeParse(body);
      if (!parsed.success) throw invalidResponse();
      return {
        items: parsed.data.map((item) => {
          // Recognize only exact GitHub subject paths. Unknown subjects open the repository's inbox.
          const match = item.subject.url?.match(
            /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)\/(issues|pulls)\/([1-9]\d*)$/u,
          );
          const valid =
            match &&
            match[1] === item.repository.full_name &&
            ((match[2] === 'issues' && item.subject.type === 'Issue') ||
              (match[2] === 'pulls' && item.subject.type === 'PullRequest')) &&
            Number.isSafeInteger(Number(match[3]));
          return {
            id: `notification-${item.id}`,
            repository: item.repository.full_name,
            title: item.subject.title,
            kind: valid
              ? match[2] === 'pulls'
                ? ('pull-request' as const)
                : ('issue' as const)
              : ('notification' as const),
            number: valid ? Number(match[3]) : null,
            state: null,
            updatedAt: item.updated_at,
            unread: item.unread,
            reason: item.reason,
          };
        }),
        page: request.page,
        nextPage:
          /;\s*rel="next"/u.test(headers.get('link') ?? '') && request.page < 10000 ? request.page + 1 : null,
        limited: false,
      };
    }
    const repo = hostedRepositorySchema.shape.fullName.parse(repository);
    const query = [`repo:${repo}`, request.kind === 'issues' ? 'is:issue' : 'is:pr'];
    if (request.state !== 'all') query.push(`is:${request.state}`);
    if (request.author) query.push(`author:${request.author}`);
    if (request.assignee) query.push(`assignee:${request.assignee}`);
    if (request.text.trim()) query.push(`"${request.text.trim()}" in:title`);
    const { body } = await this.get(
      `/search/issues?per_page=100&page=${request.page}&sort=updated&order=desc&q=${encodeURIComponent(query.join(' '))}`,
      token,
      signal,
    );
    const parsed = z
      .object({
        total_count: z.number().int().nonnegative(),
        incomplete_results: z.boolean(),
        items: z
          .array(
            z.object({
              id: z.number().int().positive(),
              number: z.number().int().positive(),
              title: z.string().max(1024),
              state: z.enum(['open', 'closed']),
              updated_at: z.iso.datetime(),
              repository_url: z.string(),
              pull_request: z.object({ merged_at: z.string().nullable().optional() }).optional(),
            }),
          )
          .max(100),
      })
      .safeParse(body);
    if (
      !parsed.success ||
      parsed.data.items.some(
        (item) =>
          item.repository_url !== `https://api.github.com/repos/${repo}` ||
          Boolean(item.pull_request) !== (request.kind === 'pull-requests'),
      )
    )
      throw invalidResponse();
    return {
      items: parsed.data.items.map((item) => ({
        id: `item-${item.id}`,
        repository: repo,
        title: item.title,
        kind: request.kind === 'issues' ? 'issue' : 'pull-request',
        number: item.number,
        state: item.pull_request?.merged_at ? 'merged' : item.state,
        updatedAt: item.updated_at,
        unread: false,
        reason: '',
      })),
      page: request.page,
      nextPage: request.page < 10 && request.page * 100 < parsed.data.total_count ? request.page + 1 : null,
      limited: parsed.data.incomplete_results || parsed.data.total_count > 1000,
    };
  }

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
