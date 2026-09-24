import { z } from 'zod';
import { ExpectedBackendError } from '../errors';
import { readHostingJson } from './server-provider';

export interface GitHubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
}

/** Device authorization uses our registered public client ID; no bundled client secret. */
export class GitHubOAuth {
  constructor(
    private readonly clientId = process.env.GIT_WORKBENCH_GITHUB_CLIENT_ID ?? '',
    private readonly transport: typeof fetch = (input, init) => fetch(input, init),
    private readonly now = Date.now,
  ) {}
  available() {
    return /^[A-Za-z0-9_.-]{5,100}$/u.test(this.clientId);
  }
  async begin(signal: AbortSignal): Promise<GitHubDeviceAuthorization> {
    if (!this.available())
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'GitHub OAuth requires a registered Git Workbench OAuth app. Configure GIT_WORKBENCH_GITHUB_CLIENT_ID and enable device flow, or use a personal access token.',
      );
    const body = await this.post(
      '/login/device/code',
      { client_id: this.clientId, scope: 'repo read:user notifications' },
      signal,
    );
    const parsed = z
      .object({
        device_code: z.string().min(1).max(1024),
        user_code: z.string().regex(/^[A-Z0-9-]{4,32}$/u),
        verification_uri: z.literal('https://github.com/login/device'),
        expires_in: z.number().int().min(1).max(1800),
        interval: z.number().int().min(1).max(60),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new ExpectedBackendError(
        'HOSTING_AUTH',
        'GitHub could not start OAuth. Check the registered client ID and enable device flow.',
      );
    const data = parsed.data;
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      expiresAt: this.now() + data.expires_in * 1000,
      interval: data.interval,
      nextPollAt: this.now() + data.interval * 1000,
    };
  }
  async poll(state: GitHubDeviceAuthorization, signal: AbortSignal): Promise<string | null> {
    if (this.now() >= state.expiresAt)
      throw new ExpectedBackendError('HOSTING_AUTH', 'GitHub authorization expired. Start OAuth again.');
    if (this.now() < state.nextPollAt) return null;
    state.nextPollAt = this.now() + state.interval * 1000;
    const body = await this.post(
      '/login/oauth/access_token',
      {
        client_id: this.clientId,
        device_code: state.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      signal,
    );
    const parsed = z
      .object({
        access_token: z
          .string()
          .min(10)
          .max(4096)
          .regex(/^[\x21-\x7e]+$/u)
          .optional(),
        token_type: z.string().optional(),
        error: z.string().optional(),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new ExpectedBackendError(
        'HOSTING_AUTH',
        'GitHub returned an invalid authorization response. Start OAuth again.',
      );
    if (parsed.data.error === 'authorization_pending') return null;
    if (parsed.data.error === 'slow_down') {
      state.interval = Math.min(60, state.interval + 5);
      state.nextPollAt = this.now() + state.interval * 1000;
      return null;
    }
    if (parsed.data.error || !parsed.data.access_token || parsed.data.token_type?.toLowerCase() !== 'bearer')
      throw new ExpectedBackendError(
        'HOSTING_AUTH',
        parsed.data.error === 'access_denied'
          ? 'GitHub authorization was denied. Start OAuth again when ready.'
          : 'GitHub authorization expired or failed. Start OAuth again.',
      );
    return parsed.data.access_token;
  }
  private async post(path: string, values: Record<string, string>, signal: AbortSignal) {
    try {
      const response = await this.transport(`https://github.com${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Git-Workbench',
        },
        body: new URLSearchParams(values).toString(),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error();
      }
      return await readHostingJson(response, 16384);
    } catch {
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        signal.aborted
          ? 'GitHub authorization was cancelled.'
          : 'GitHub authorization is unavailable. Check your connection and try again.',
      );
    }
  }
}
