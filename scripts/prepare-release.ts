import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { packageAur } from './package-aur.ts';
import {
  digestFile,
  installerNames,
  readReleaseVersion,
  releaseFiles,
  releaseRepository,
} from './release-metadata.ts';
import { writeReleaseManifest } from './release-manifest.ts';

const directory = resolve(process.argv[2] ?? 'release');
const version = await readReleaseVersion();
// An explicit set prevents stale versions or TEST-ONLY Debian packages from entering a release.
for (const name of installerNames(version)) await digestFile(join(directory, name));
const revision = (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim();
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== revision)
  throw new Error('Release checkout does not match the workflow commit.');
await packageAur(directory, version, releaseRepository());
await writeReleaseManifest(directory, releaseFiles(version), revision);
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`);
