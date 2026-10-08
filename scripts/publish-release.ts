import { openAsBlob } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  compareVersions,
  digestFile,
  readReleaseVersion,
  releaseFiles,
  releaseRepository,
} from './release-metadata.ts';

type Release = { id: number; tag_name: string; draft: boolean; target_commitish: string };
type Asset = { id: number; name: string; size: number; state: string; digest: string | null };
export type Artifact = { file: string; bytes: number; sha256: string };
export type GitHubRequest = (
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    file?: string;
  },
) => Promise<unknown>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed release API response.');
  return value as Record<string, unknown>;
}

function release(value: unknown): Release {
  const data = object(value);
  if (
    !Number.isSafeInteger(data.id) ||
    typeof data.tag_name !== 'string' ||
    typeof data.draft !== 'boolean' ||
    typeof data.target_commitish !== 'string'
  )
    throw new Error('Malformed release metadata.');
  return data as Release;
}

function asset(value: unknown): Asset {
  const data = object(value);
  if (
    !Number.isSafeInteger(data.id) ||
    typeof data.name !== 'string' ||
    typeof data.size !== 'number' ||
    typeof data.state !== 'string' ||
    !(data.digest === null || typeof data.digest === 'string')
  )
    throw new Error('Malformed release asset metadata.');
  return data as Asset;
}

async function list<T>(api: GitHubRequest, path: string, parse: (value: unknown) => T): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; ; page++) {
    const data = await api(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw new Error('Malformed paginated release response.');
    result.push(...data.map(parse));
    if (data.length < 100) return result;
  }
}

async function tagRevision(api: GitHubRequest, tag: string): Promise<string | undefined> {
  const reference = await api(`/git/ref/tags/${tag}`);
  if (reference === null) return undefined;
  let target = object(object(reference).object);
  for (let depth = 0; depth < 8; depth++) {
    if (typeof target.sha !== 'string' || !/^[a-f0-9]{40}$/u.test(target.sha)) break;
    if (target.type === 'commit') return target.sha;
    if (target.type !== 'tag') break;
    target = object(object(await api(`/git/tags/${target.sha}`)).object);
  }
  throw new Error(`Cannot resolve ${tag} to a commit.`);
}

async function isCurrentHead(api: GitHubRequest, branch: string, revision: string): Promise<boolean> {
  const data = object(await api(`/branches/${encodeURIComponent(branch)}`));
  const sha = object(data.commit).sha;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/u.test(sha))
    throw new Error('Cannot resolve the default branch commit.');
  return sha === revision;
}

export async function publishRelease(options: {
  api: GitHubRequest;
  directory: string;
  version: string;
  revision: string;
  branch: string;
  artifacts: Artifact[];
}): Promise<string> {
  const { api, directory, version, revision, branch, artifacts } = options;
  const tag = `v${version}`;
  if (!(await isCurrentHead(api, branch, revision))) return 'Skipped: the default branch has moved.';
  const releases = await list(api, '/releases', release);
  if (
    releases.some(
      (item) =>
        !item.draft &&
        /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(item.tag_name) &&
        compareVersions(item.tag_name.slice(1), version) >= 0,
    )
  )
    return `Skipped: ${tag} or a newer version is already published. Bump package.json for another release.`;
  let candidate = releases.find((item) => item.tag_name === tag);
  if (candidate && (!candidate.draft || candidate.target_commitish !== revision))
    throw new Error(
      `Existing ${tag} draft belongs to another commit. Bump the version; it will not be replaced.`,
    );
  const tagged = await tagRevision(api, tag);
  if (tagged && tagged !== revision)
    throw new Error(`${tag} points to another commit. Tags are never moved.`);
  const body = [
    `Git Workbench ${version}`,
    '',
    `Source commit: ${revision}`,
    '',
    '- Windows x64: download the .exe installer.',
    '- Linux x64: download the .AppImage (FUSE 2 or APPIMAGE_EXTRACT_AND_RUN=1).',
    '- macOS Intel / Apple Silicon: open the universal .dmg and drag the app to Applications.',
    '- Arch: extract the git-workbench-bin source archive and run makepkg -si. The PKGBUILD and .SRCINFO are also attached.',
    '',
    'Git 2.43 or newer must be installed separately; Arch installs it as a dependency.',
    'Windows builds are unsigned. macOS uses an ad-hoc signature, without Developer ID signing or notarization; OS trust warnings are expected.',
    'The AUR recipe is attached here; yay -S git-workbench-bin requires a separate AUR submission.',
    'Verify downloads with SHA256SUMS. Updates are manual; keep the previous installer for rollback.',
  ].join('\n');
  if (!candidate)
    candidate = release(
      await api('/releases', {
        method: 'POST',
        body: {
          tag_name: tag,
          target_commitish: revision,
          name: `Git Workbench ${version}`,
          body,
          draft: true,
        },
      }),
    );
  const id = candidate.id;
  const existing = await list(api, `/releases/${id}/assets`, asset);
  if (existing.some((item) => !artifacts.some((file) => file.file === item.name)))
    throw new Error('The draft contains unexpected assets; refusing to publish them.');
  for (const file of artifacts) {
    const previous = existing.find((item) => item.name === file.file);
    if (
      previous?.state === 'uploaded' &&
      previous.size === file.bytes &&
      previous.digest === `sha256:${file.sha256}`
    )
      continue;
    // A retry may replace incomplete/different assets only on its own unpublished draft.
    const current = release(await api(`/releases/${id}`));
    if (!current.draft || current.target_commitish !== revision || current.tag_name !== tag)
      throw new Error('Release changed while uploading. Refusing to replace assets.');
    if (previous) await api(`/releases/assets/${previous.id}`, { method: 'DELETE' });
    await api(`/releases/${id}/assets?name=${encodeURIComponent(file.file)}`, {
      method: 'POST',
      file: join(directory, file.file),
    });
  }
  const uploaded = await list(api, `/releases/${id}/assets`, asset);
  if (
    uploaded.length !== artifacts.length ||
    artifacts.some(
      (file) =>
        !uploaded.some(
          (item) =>
            item.name === file.file &&
            item.state === 'uploaded' &&
            item.size === file.bytes &&
            item.digest === `sha256:${file.sha256}`,
        ),
    )
  )
    throw new Error(
      'Uploaded assets do not match the complete, checksummed release. The release remains a draft.',
    );
  if (!(await isCurrentHead(api, branch, revision)))
    return 'Skipped: the default branch moved; the release remains a draft.';
  const current = release(await api(`/releases/${id}`));
  if (!current.draft || current.target_commitish !== revision || current.tag_name !== tag)
    throw new Error('Release changed before publication.');
  const finalTag = await tagRevision(api, tag);
  if (finalTag && finalTag !== revision) throw new Error(`${tag} changed before publication.`);
  if (!finalTag) await api('/git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: revision } });
  await api(`/releases/${id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true', body } });
  return `Published ${tag} with ${artifacts.length} verified assets.`;
}

export async function verifyReleaseArtifacts(
  directory: string,
  version: string,
  revision: string,
): Promise<Artifact[]> {
  const manifest = object(JSON.parse(await readFile(join(directory, 'artifact-manifest.json'), 'utf8')));
  const lock = await digestFile('package-lock.json');
  if (
    manifest.version !== 1 ||
    manifest.appVersion !== version ||
    manifest.sourceRevision !== revision ||
    manifest.packageLockSha256 !== lock.sha256 ||
    !Array.isArray(manifest.artifacts)
  )
    throw new Error('Release manifest does not match the version, source commit and lockfile.');
  const expected = releaseFiles(version);
  if (manifest.artifacts.length !== expected.length)
    throw new Error('Release manifest has an incomplete artifact set.');
  const artifacts: Artifact[] = [];
  for (const file of expected) {
    const actual = await digestFile(join(directory, file));
    if (
      !manifest.artifacts.some((entry: unknown) => {
        const data = object(entry);
        return data.file === file && data.sha256 === actual.sha256 && data.bytes === actual.bytes;
      })
    )
      throw new Error(`Release checksum mismatch: ${file}`);
    artifacts.push({ file, ...actual });
  }
  artifacts.push({
    file: 'artifact-manifest.json',
    ...(await digestFile(join(directory, 'artifact-manifest.json'))),
  });
  const sums = [...artifacts].sort((a, b) => a.file.localeCompare(b.file));
  const recorded = (await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n').sort();
  if (
    recorded.join('\n') !==
    sums
      .map((item) => `${item.sha256}  ${item.file}`)
      .sort()
      .join('\n')
  )
    throw new Error('SHA256SUMS does not match the release artifacts.');
  artifacts.push({ file: 'SHA256SUMS', ...(await digestFile(join(directory, 'SHA256SUMS'))) });
  return artifacts;
}

export function githubClient(
  repository: string,
  token: string,
  request: typeof fetch = fetch,
): GitHubRequest {
  releaseRepository(repository);
  return async (path, options = {}) => {
    const host = options.file ? 'https://uploads.github.com' : 'https://api.github.com';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    let body: BodyInit | undefined;
    if (options.file) {
      headers['Content-Type'] = 'application/octet-stream';
      body = await openAsBlob(options.file);
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await request(`${host}/repos/${repository}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(options.file ? 600000 : 30000),
      redirect: 'error',
    });
    if (response.status === 404 && path.startsWith('/git/ref/tags/') && !options.method) return null;
    if (!response.ok)
      throw new Error(`GitHub ${options.method ?? 'GET'} ${path} failed (HTTP ${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
}

if (import.meta.main) {
  const event = process.env.GITHUB_EVENT_NAME;
  if (process.env.GITHUB_ACTIONS !== 'true' || !['push', 'workflow_dispatch'].includes(event ?? ''))
    throw new Error('Publishing is restricted to push/manual GitHub Actions runs on the default branch.');
  const revision = process.env.GITHUB_SHA ?? '';
  const token = process.env.GITHUB_TOKEN;
  if (!/^[a-f0-9]{40}$/u.test(revision) || !token) throw new Error('Missing release commit or GitHub token.');
  const api = githubClient(releaseRepository(), token);
  const repository = object(await api(''));
  const branch = repository.default_branch;
  if (typeof branch !== 'string' || process.env.GITHUB_REF !== `refs/heads/${branch}`)
    throw new Error('Only the default branch can publish releases.');
  const version = await readReleaseVersion();
  const directory = resolve(process.argv[2] ?? 'release');
  const artifacts = await verifyReleaseArtifacts(directory, version, revision);
  const result = await publishRelease({ api, directory, version, revision, branch, artifacts });
  console.info(result);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${result}\n`);
}
