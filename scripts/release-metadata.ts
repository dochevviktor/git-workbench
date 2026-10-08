import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';

// Stable versions also map directly to Arch's pkgver. Prereleases need an explicit Arch policy.
export function releaseVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value))
    throw new Error('Release versions must be plain major.minor.patch numbers in package.json.');
  return value;
}

export function compareVersions(left: string, right: string): number {
  const a = releaseVersion(left).split('.').map(BigInt);
  const b = releaseVersion(right).split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index]! > b[index]!) return 1;
    if (a[index]! < b[index]!) return -1;
  }
  return 0;
}

export async function readReleaseVersion(): Promise<string> {
  const metadata = JSON.parse(await readFile('package.json', 'utf8')) as { version?: unknown };
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as {
    version?: unknown;
    packages?: Record<string, { version?: unknown }>;
  };
  const version = releaseVersion(metadata.version);
  if (lock.version !== version || lock.packages?.['']?.version !== version)
    throw new Error(
      'package.json and package-lock.json versions differ. Run npm install --package-lock-only.',
    );
  return version;
}

export function releaseRepository(
  value = process.env.GITHUB_REPOSITORY ?? 'dochevviktor/git-workbench',
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value))
    throw new Error('Expected a GitHub owner/repository.');
  return value;
}

export function installerNames(version: string): string[] {
  releaseVersion(version);
  return [
    `git-workbench-${version}-linux-x86_64.AppImage`,
    `git-workbench-${version}-win-x64.exe`,
    `git-workbench-${version}-mac-universal.dmg`,
  ];
}

export function releaseFiles(version: string): string[] {
  return [
    ...installerNames(version),
    'PKGBUILD',
    'git-workbench-bin.SRCINFO',
    `git-workbench-bin-${version}.tar.gz`,
  ];
}

export async function digestFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const info = await lstat(path);
  if (!info.isFile() || info.size === 0) throw new Error(`Expected a nonempty regular artifact: ${path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { bytes: info.size, sha256: hash.digest('hex') };
}
