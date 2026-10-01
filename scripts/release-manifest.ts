import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const artifacts: { file: string; bytes: number; sha256: string }[] = [];
for (const file of (await readdir('release')).sort()) {
  if (!/\.(AppImage|deb|rpm|dmg|exe)$/u.test(file)) continue;
  const path = join('release', file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  artifacts.push({ file: basename(path), bytes: (await stat(path)).size, sha256: hash.digest('hex') });
}
if (!artifacts.length) throw new Error('No release artifacts found. Build a package first.');
const lock = createHash('sha256')
  .update(await readFile('package-lock.json'))
  .digest('hex');
await writeFile(
  'release/artifact-manifest.json',
  JSON.stringify(
    { version: 1, generatedAt: new Date().toISOString(), packageLockSha256: lock, artifacts },
    null,
    2,
  ) + '\n',
);
await writeFile('release/SHA256SUMS', artifacts.map((item) => `${item.sha256}  ${item.file}\n`).join(''));
console.info(
  `Recorded ${artifacts.length} local artifacts in release/artifact-manifest.json and SHA256SUMS.`,
);
