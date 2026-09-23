import { createHash, randomUUID } from 'node:crypto';
import type {
  RepositoryNetworkRequest,
  RepositoryPushPreview,
  RepositoryPushPreviewRequest,
} from '../../common/ipc/contracts';
import { repositoryPushPreviewSchema } from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import { GitCommandError } from '../git/runner';
import type { NetworkRunner } from './network-service';

type Push = Extract<RepositoryNetworkRequest, { kind: 'push' }>;
interface SavedPreview {
  ownerId: number;
  repositoryId: string;
  expires: number;
  request: RepositoryPushPreviewRequest;
  preview: RepositoryPushPreview;
  destination: string;
  tags: string;
}

/** One-use, window-owned reviews. Fetch may move tracking refs but cannot change a reviewed lease. */
export class PushPreviewStore {
  private readonly entries = new Map<string, SavedPreview>();

  async preview(
    runner: NetworkRunner,
    cwd: string,
    ownerId: number,
    request: RepositoryPushPreviewRequest,
  ): Promise<RepositoryPushPreview> {
    const signal = AbortSignal.timeout(10_000);
    const options = { cwd, signal, timeoutMs: 10_000, maxOutputBytes: 2 * 1024 * 1024 };
    const destinations = new Set<string>();
    const targets: RepositoryPushPreview['targets'] = [];
    for (const target of request.targets) {
      if (!target.fullName.startsWith('refs/heads/') || destinations.has(target.remoteBranch))
        throw new ExpectedBackendError('INVALID_REQUEST', 'Choose each destination branch once.');
      destinations.add(target.remoteBranch);
      await runner.run(['check-ref-format', target.fullName], options);
      await runner.run(['check-ref-format', `refs/heads/${target.remoteBranch}`], options);
      const localId = (
        await runner.run(['rev-parse', '--verify', '--end-of-options', target.fullName], options)
      ).stdout.trim();
      let remoteId: string | null = null;
      try {
        remoteId = (
          await runner.run(
            [
              'rev-parse',
              '--verify',
              '--end-of-options',
              `refs/remotes/${request.remote}/${target.remoteBranch}`,
            ],
            options,
          )
        ).stdout.trim();
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error;
      }
      const replacedCommits = remoteId
        ? Number(
            (
              await runner.run(['rev-list', '--count', remoteId, '--not', localId, '--'], options)
            ).stdout.trim(),
          )
        : 0;
      targets.push({
        fullName: target.fullName,
        remoteBranch: target.remoteBranch,
        localId,
        remoteId,
        replacedCommits,
      });
    }
    const destination = await destinationFingerprint(runner, cwd, request.remote, signal);
    const tags = request.tags ? await readTags(runner, cwd, signal) : '';
    const preview = repositoryPushPreviewSchema.parse({
      token: randomUUID(),
      remote: request.remote,
      targets,
      tagCount: tags.split('\n').filter(Boolean).length,
    });
    for (const [token, entry] of this.entries) if (entry.expires < Date.now()) this.entries.delete(token);
    while (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(preview.token, {
      ownerId,
      repositoryId: request.id,
      request: structuredClone(request),
      preview,
      destination,
      tags,
      expires: Date.now() + 5 * 60_000,
    });
    return preview;
  }

  async consume(
    runner: NetworkRunner,
    cwd: string,
    ownerId: number,
    repositoryId: string,
    request: Push,
  ): Promise<string[]> {
    const saved = request.previewToken ? this.entries.get(request.previewToken) : undefined;
    if (!saved || saved.ownerId !== ownerId || saved.repositoryId !== repositoryId)
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'Review the force push before confirming it.');
    this.entries.delete(saved.preview.token);
    const stale = () =>
      new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'The push selection or local references changed. Review the push again.',
      );
    if (
      saved.expires < Date.now() ||
      request.remote !== saved.request.remote ||
      request.tags !== saved.request.tags ||
      JSON.stringify(request.targets) !== JSON.stringify(saved.request.targets)
    )
      throw stale();
    if (saved.destination !== (await destinationFingerprint(runner, cwd, request.remote))) throw stale();
    for (const target of saved.preview.targets) {
      const current = await runner.run(['rev-parse', '--verify', '--end-of-options', target.fullName], {
        cwd,
      });
      if (current.stdout.trim() !== target.localId) throw stale();
    }
    if (request.tags && saved.tags !== (await readTags(runner, cwd))) throw stale();
    // Explicit expectations remain authoritative even if automatic fetching ran after the review.
    return [
      'push',
      '--progress',
      '--no-follow-tags',
      ...saved.preview.targets.map(
        (target) => `--force-with-lease=refs/heads/${target.remoteBranch}:${target.remoteId ?? ''}`,
      ),
      '--',
      request.remote,
      ...saved.preview.targets.map((target) => `${target.localId}:refs/heads/${target.remoteBranch}`),
      ...saved.tags
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [objectId, fullName] = line.split(' ');
          return `${objectId}:${fullName}`;
        }),
    ];
  }

  release(ownerId?: number, repositoryId?: string): void {
    for (const [token, entry] of this.entries)
      if (
        (ownerId === undefined || entry.ownerId === ownerId) &&
        (repositoryId === undefined || entry.repositoryId === repositoryId)
      )
        this.entries.delete(token);
  }
}

async function destinationFingerprint(
  runner: NetworkRunner,
  cwd: string,
  remote: string,
  signal?: AbortSignal,
): Promise<string> {
  const urls = await runner.run(['remote', 'get-url', '--push', '--all', '--', remote], { cwd, signal });
  if (urls.stdout.trim().split('\n').length !== 1)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Force push requires one push URL. Choose a remote with a single destination.',
    );
  return createHash('sha256').update(urls.stdout).digest('hex');
}

async function readTags(runner: NetworkRunner, cwd: string, signal?: AbortSignal): Promise<string> {
  const result = await runner.run(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/tags'], {
    cwd,
    signal,
    maxOutputBytes: 2 * 1024 * 1024,
    timeoutMs: 10_000,
  });
  if (result.stdout.split('\n').filter(Boolean).length > 1_000)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Push tags separately when a repository has more than 1,000 tags.',
    );
  return result.stdout.trim();
}
