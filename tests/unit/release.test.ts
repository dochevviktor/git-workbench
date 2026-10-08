import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { aurSources } from '../../scripts/package-aur';
import { githubClient, publishRelease, verifyReleaseArtifacts } from '../../scripts/publish-release';
import type { GitHubRequest } from '../../scripts/publish-release';
import {
  compareVersions,
  digestFile,
  installerNames,
  readReleaseVersion,
  releaseFiles,
  releaseRepository,
  releaseVersion,
} from '../../scripts/release-metadata';
import { writeReleaseManifest } from '../../scripts/release-manifest';

const revision = 'a'.repeat(40);
const otherRevision = 'b'.repeat(40);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-release-test-'));
  roots.push(root);
  return root;
}

it('validates versions and compares their numeric parts without lexicographic or precision errors', () => {
  expect(releaseVersion('0.1.0')).toBe('0.1.0');
  expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.2.3', '2.0.0')).toBe(-1);
  expect(compareVersions('10000000000000001.0.0', '10000000000000000.0.0')).toBe(1);
  for (const invalid of [
    'v1.0.0',
    '01.0.0',
    '1.0',
    '1.0.0-rc.1',
    '1.0.0+meta',
    '1.0.0\n',
    '$(id)',
    undefined,
  ])
    expect(() => releaseVersion(invalid)).toThrow('major.minor.patch');
  expect(() => releaseRepository('owner/repo\nmalicious')).toThrow();
});

it('refuses mismatched lockfile versions before packaging', async () => {
  const root = await directory();
  await writeFile(join(root, 'package.json'), '{"version":"1.2.3"}');
  await writeFile(join(root, 'package-lock.json'), '{"version":"1.2.2","packages":{"":{"version":"1.2.2"}}}');
  await expect(
    promisify(execFile)(process.execPath, [resolve('scripts/package-aur.ts')], { cwd: root }),
  ).rejects.toMatchObject({ stderr: expect.stringContaining('versions differ') });
});

it('pins AUR sources to the versioned AppImage and license and preserves the sandbox', () => {
  const { pkgbuild, srcinfo } = aurSources('1.2.3', 'owner/repo', 'a'.repeat(64), 'b'.repeat(64));
  expect(pkgbuild).toContain(
    'https://github.com/owner/repo/releases/download/v1.2.3/git-workbench-1.2.3-linux-x86_64.AppImage',
  );
  expect(pkgbuild).toContain('https://raw.githubusercontent.com/owner/repo/v1.2.3/LICENSE');
  expect(pkgbuild).toContain('chmod 4755 "$pkgdir/opt/git-workbench/chrome-sandbox"');
  expect(pkgbuild).toContain('ln -s /opt/git-workbench/git-workbench');
  expect(pkgbuild).not.toContain('--no-sandbox');
  expect(pkgbuild).not.toContain('SKIP');
  expect(srcinfo).toContain('\tarch = x86_64');
  expect(srcinfo).toContain('\tdepends = git>=2.43');
  expect(srcinfo).toContain(`\tsha256sums = ${'a'.repeat(64)}`);
  expect(() => aurSources('1.2.3', 'owner/repo', 'SKIP', 'b'.repeat(64))).toThrow('checksums');
});

it('requires the exact release set, source revision, lockfile and checksums before publishing', async () => {
  const root = await directory();
  const version = await readReleaseVersion();
  for (const file of releaseFiles(version)) await writeFile(join(root, file), `fixture ${file}`);
  await writeReleaseManifest(root, releaseFiles(version), revision);
  expect((await verifyReleaseArtifacts(root, version, revision)).map((item) => item.file)).toEqual([
    ...releaseFiles(version),
    'artifact-manifest.json',
    'SHA256SUMS',
  ]);
  await expect(verifyReleaseArtifacts(root, version, otherRevision)).rejects.toThrow('source commit');
  const manifestPath = join(root, 'artifact-manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original) as { artifacts: unknown[]; packageLockSha256: string };
  manifest.artifacts.pop();
  await writeFile(manifestPath, JSON.stringify(manifest));
  await expect(verifyReleaseArtifacts(root, version, revision)).rejects.toThrow('incomplete');
  await writeFile(manifestPath, original);
  await writeFile(join(root, installerNames(version)[0]!), 'tampered');
  await expect(verifyReleaseArtifacts(root, version, revision)).rejects.toThrow('checksum mismatch');
});

it('assembles a complete fixture bundle without npm dependencies and excludes stale installers', async () => {
  const root = await directory();
  const version = await readReleaseVersion();
  const execute = promisify(execFile);
  const sourceRevision = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
  for (const file of installerNames(version)) await writeFile(join(root, file), `test-only ${file}`);
  await writeFile(join(root, 'obsolete.TEST-ONLY.deb'), 'must not publish');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: join(root, 'outputs'),
    GITHUB_SHA: sourceRevision,
    GITHUB_REPOSITORY: 'test/fixtures',
  };
  await execute(process.execPath, [resolve('scripts/prepare-release.ts'), root], { env });
  expect((await verifyReleaseArtifacts(root, version, sourceRevision)).map((item) => item.file)).toEqual([
    ...releaseFiles(version),
    'artifact-manifest.json',
    'SHA256SUMS',
  ]);
  expect(await readFile(join(root, '.SRCINFO'), 'utf8')).toBe(
    await readFile(join(root, 'git-workbench-bin.SRCINFO'), 'utf8'),
  );
  expect(
    (await execute('tar', ['-tzf', join(root, `git-workbench-bin-${version}.tar.gz`)])).stdout,
  ).toContain('git-workbench-bin/.SRCINFO');
  expect(await readFile(join(root, 'outputs'), 'utf8')).toBe(`version=${version}\ntag=v${version}\n`);
  await rm(join(root, installerNames(version)[2]!));
  await expect(
    execute(process.execPath, [resolve('scripts/prepare-release.ts'), root], { env }),
  ).rejects.toThrow();
});

type RemoteRelease = { id: number; tag_name: string; target_commitish: string; draft: boolean };
type RemoteAsset = { id: number; name: string; size: number; state: string; digest: string | null };
async function harness() {
  const root = await directory();
  const version = '1.2.3';
  const file = installerNames(version)[0]!;
  await writeFile(join(root, file), 'artifact contents');
  const artifacts = [{ file, ...(await digestFile(join(root, file))) }];
  const state = {
    head: revision,
    tag: undefined as string | undefined,
    releases: [] as RemoteRelease[],
    assets: [] as RemoteAsset[],
    failUpload: false,
    badDigest: false,
    moveHeadAfterUpload: false,
  };
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const api: GitHubRequest = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path, method, body: options.body });
    if (path === '/branches/master') return { commit: { sha: state.head } };
    if (path.startsWith('/releases?')) return structuredClone(state.releases);
    if (path === `/git/ref/tags/v${version}`)
      return state.tag ? { object: { sha: state.tag, type: 'commit' } } : null;
    if (path === '/git/refs' && method === 'POST') {
      state.tag = (options.body as { sha: string }).sha;
      return { object: { sha: state.tag, type: 'commit' } };
    }
    if (path === '/releases' && method === 'POST') {
      const created = { id: 1, ...(options.body as Omit<RemoteRelease, 'id'>) };
      state.releases.push(created);
      return structuredClone(created);
    }
    if (path === '/releases/1' && method === 'GET') return structuredClone(state.releases[0]);
    if (path === '/releases/1' && method === 'PATCH') {
      Object.assign(state.releases[0]!, options.body);
      return structuredClone(state.releases[0]);
    }
    if (path.startsWith('/releases/1/assets?per_page=')) return structuredClone(state.assets);
    if (path.startsWith('/releases/assets/') && method === 'DELETE') {
      state.assets = state.assets.filter((item) => item.id !== Number(path.split('/').at(-1)));
      return null;
    }
    if (path.startsWith('/releases/1/assets?name=') && method === 'POST' && options.file) {
      if (state.failUpload) throw new Error('Upload interrupted');
      const data = await digestFile(options.file);
      state.assets.push({
        id: 10,
        name: basename(options.file),
        size: data.bytes,
        state: 'uploaded',
        digest: `sha256:${state.badDigest ? '0'.repeat(64) : data.sha256}`,
      });
      if (state.moveHeadAfterUpload) state.head = otherRevision;
      return state.assets.at(-1);
    }
    throw new Error(`Unexpected API request: ${method} ${path}`);
  };
  return {
    state,
    calls,
    artifacts,
    run: () => publishRelease({ api, directory: root, version, revision, branch: 'master', artifacts }),
  };
}

it('creates a draft and publishes only after checking every upload, then creates a tag for the exact commit', async () => {
  const { run, state, calls } = await harness();
  await expect(run()).resolves.toContain('Published v1.2.3');
  expect(state.tag).toBe(revision);
  expect(state.releases[0]?.draft).toBe(false);
  expect(calls.filter((call) => call.method !== 'GET').map((call) => [call.method, call.path])).toEqual([
    ['POST', '/releases'],
    ['POST', '/releases/1/assets?name=git-workbench-1.2.3-linux-x86_64.AppImage'],
    ['POST', '/git/refs'],
    ['PATCH', '/releases/1'],
  ]);
});

it.each(['v1.2.3', 'v1.10.0'])(
  'leaves published %s immutable on reruns and later same-version commits',
  async (tag) => {
    const { run, state, calls } = await harness();
    state.releases.push({ id: 1, tag_name: tag, target_commitish: otherRevision, draft: false });
    await expect(run()).resolves.toContain('already published');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  },
);

it('skips superseded default-branch commits without writes', async () => {
  const { run, state, calls } = await harness();
  state.head = otherRevision;
  await expect(run()).resolves.toContain('branch has moved');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

it('refuses a tag owned by another commit', async () => {
  const { run, state, calls } = await harness();
  state.tag = otherRevision;
  await expect(run()).rejects.toThrow('never moved');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

it('refuses to resume a draft owned by another commit', async () => {
  const { run, state, calls } = await harness();
  state.releases.push({ id: 1, tag_name: 'v1.2.3', target_commitish: otherRevision, draft: true });
  await expect(run()).rejects.toThrow('another commit');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

it('resumes an interrupted same-commit release without reuploading already verified assets', async () => {
  const { run, state, calls, artifacts } = await harness();
  state.tag = revision;
  state.releases.push({ id: 1, tag_name: 'v1.2.3', target_commitish: revision, draft: true });
  state.assets.push({
    id: 10,
    name: artifacts[0]!.file,
    size: artifacts[0]!.bytes,
    digest: `sha256:${artifacts[0]!.sha256}`,
    state: 'uploaded',
  });
  await expect(run()).resolves.toContain('Published');
  expect(calls.filter((call) => call.method !== 'GET').map((call) => call.method)).toEqual(['PATCH']);
});

it('replaces an interrupted upload only on its own draft', async () => {
  const { run, state, calls, artifacts } = await harness();
  state.releases.push({ id: 1, tag_name: 'v1.2.3', target_commitish: revision, draft: true });
  state.assets.push({ id: 9, name: artifacts[0]!.file, size: 0, digest: null, state: 'starter' });
  await expect(run()).resolves.toContain('Published');
  expect(calls).toContainEqual({ method: 'DELETE', path: '/releases/assets/9', body: undefined });
});

it.each(['failUpload', 'badDigest'] as const)('leaves failures unpublished: %s', async (failure) => {
  const { run, state } = await harness();
  state[failure] = true;
  await expect(run()).rejects.toThrow();
  expect(state.releases[0]?.draft).toBe(true);
  expect(state.tag).toBeUndefined();
});

it('does not publish if a newer commit arrives during upload', async () => {
  const { run, state } = await harness();
  state.moveHeadAfterUpload = true;
  await expect(run()).resolves.toContain('remains a draft');
  expect(state.releases[0]?.draft).toBe(true);
  expect(state.tag).toBeUndefined();
});

it('refuses unexpected draft assets instead of making them public', async () => {
  const { run, state, calls } = await harness();
  state.releases.push({ id: 1, tag_name: 'v1.2.3', target_commitish: revision, draft: true });
  state.assets.push({ id: 9, name: 'unreviewed.exe', size: 1, digest: null, state: 'uploaded' });
  await expect(run()).rejects.toThrow('unexpected assets');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

it('finds a published version beyond the first API page', async () => {
  const api = vi.fn<GitHubRequest>(async (path) => {
    if (path === '/branches/master') return { commit: { sha: revision } };
    if (path === '/releases?per_page=100&page=1')
      return Array.from({ length: 100 }, (_, index) => ({
        id: index,
        tag_name: `nightly-${index}`,
        target_commitish: otherRevision,
        draft: false,
      }));
    if (path === '/releases?per_page=100&page=2')
      return [
        {
          id: 101,
          tag_name: 'v1.2.3',
          target_commitish: otherRevision,
          draft: false,
        },
      ];
    throw new Error(`Unexpected request: ${path}`);
  });
  await expect(
    publishRelease({ api, directory: '', version: '1.2.3', revision, branch: 'master', artifacts: [] }),
  ).resolves.toContain('already published');
  expect(api).toHaveBeenCalledWith('/releases?per_page=100&page=2');
});

it('peels annotated tags before refusing a conflicting source commit', async () => {
  const api = vi.fn<GitHubRequest>(async (path) => {
    if (path === '/branches/master') return { commit: { sha: revision } };
    if (path === '/releases?per_page=100&page=1') return [];
    if (path === '/git/ref/tags/v1.2.3') return { object: { type: 'tag', sha: 'c'.repeat(40) } };
    if (path === `/git/tags/${'c'.repeat(40)}`) return { object: { type: 'commit', sha: otherRevision } };
    throw new Error(`Unexpected request: ${path}`);
  });
  await expect(
    publishRelease({ api, directory: '', version: '1.2.3', revision, branch: 'master', artifacts: [] }),
  ).rejects.toThrow('Tags are never moved');
});

it('fails closed on API errors and distinguishes a missing tag from failed release discovery', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
  const api = githubClient('owner/repo', 'test-token', request);
  await expect(api('/git/ref/tags/v1.2.3')).resolves.toBeNull();
  await expect(api('/releases?per_page=100&page=1')).rejects.toThrow('HTTP 404');
  request.mockResolvedValueOnce(new Response('', { status: 503 }));
  await expect(api('/git/ref/tags/v1.2.3')).rejects.toThrow('HTTP 503');
  expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', method: 'GET' });
});

it('cannot publish from a local run or pull request context', async () => {
  for (const event of ['push', 'pull_request'])
    await expect(
      promisify(execFile)(process.execPath, [resolve('scripts/publish-release.ts')], {
        env: {
          ...process.env,
          GITHUB_ACTIONS: event === 'pull_request' ? 'true' : 'false',
          GITHUB_EVENT_NAME: event,
        },
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('restricted to push/manual') });
});
