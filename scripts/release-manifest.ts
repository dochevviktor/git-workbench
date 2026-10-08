import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestFile, readReleaseVersion } from './release-metadata.ts';

export async function writeReleaseManifest(
  directory: string,
  files: string[],
  sourceRevision?: string,
): Promise<void> {
  if (!files.length) throw new Error('No release artifacts found. Build a package first.');
  const artifacts = [];
  for (const file of [...files].sort())
    artifacts.push({ file, ...(await digestFile(join(directory, file))) });
  const packageLockSha256 = createHash('sha256')
    .update(await readFile('package-lock.json'))
    .digest('hex');
  await writeFile(
    join(directory, 'artifact-manifest.json'),
    JSON.stringify(
      {
        version: 1,
        appVersion: await readReleaseVersion(),
        generatedAt: new Date().toISOString(),
        sourceRevision,
        packageLockSha256,
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  const manifest = await digestFile(join(directory, 'artifact-manifest.json'));
  await writeFile(
    join(directory, 'SHA256SUMS'),
    [
      ...artifacts.map((item) => `${item.sha256}  ${item.file}\n`),
      `${manifest.sha256}  artifact-manifest.json\n`,
    ].join(''),
  );
  console.info(
    `Recorded ${artifacts.length} artifacts in ${directory}/artifact-manifest.json and SHA256SUMS.`,
  );
}

if (import.meta.main)
  await writeReleaseManifest(
    'release',
    (await readdir('release')).filter((file) => /\.(AppImage|deb|rpm|dmg|exe)$/u.test(file)),
  );
