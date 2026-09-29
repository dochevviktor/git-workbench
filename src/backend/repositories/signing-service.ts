import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  RepositorySignature,
  RepositorySigningSettings,
  RepositorySigningSettingsRequest,
  RepositoryVerifySignatureRequest,
} from '../../common/ipc/contracts';
import { repositorySignatureSchema, repositorySigningSettingsSchema } from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import { ExpectedBackendError } from '../errors';
import type { CommitRunner } from './commit-service';

const bounds = { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 };

export async function readSigningSettings(
  runner: CommitRunner,
  cwd: string,
  repositoryId: string,
): Promise<RepositorySigningSettings> {
  const read = async (key: string, local = false, bool = false) => {
    try {
      return (
        await runner.run(
          ['config', ...(local ? ['--local'] : []), ...(bool ? ['--bool'] : []), '--get', key],
          { cwd, ...bounds },
        )
      ).stdout.trimEnd();
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) return null;
      throw error;
    }
  };
  const [key, localKey, format, commits, tags, localCommits, localTags, config] = await Promise.all([
    read('user.signingkey'),
    read('user.signingkey', true),
    read('gpg.format'),
    read('commit.gpgsign', false, true),
    read('tag.gpgsign', false, true),
    read('commit.gpgsign', true, true),
    read('tag.gpgsign', true, true),
    signingConfig(runner, cwd),
  ]);
  const values = {
    repositoryId,
    key,
    localKey,
    format: format ?? 'openpgp',
    commits: commits === 'true',
    tags: tags === 'true',
    localCommits: localCommits === null ? null : localCommits === 'true',
    localTags: localTags === null ? null : localTags === 'true',
  };
  return repositorySigningSettingsSchema.parse({
    ...values,
    snapshot: createHash('sha256')
      .update(JSON.stringify([values, config.bytes.toString('base64')]))
      .digest('hex'),
  });
}

async function signingConfig(runner: CommitRunner, cwd: string) {
  const common = (await runner.run(['rev-parse', '--git-common-dir'], { cwd, ...bounds })).stdout.trim();
  const path = join(resolve(cwd, common), 'config');
  const info = await lstat(path);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Signing settings require a regular Git config smaller than 1 MiB.',
    );
  return { path, bytes: await readFile(path), mode: info.mode };
}

/** Prepare all changed signing keys privately, then publish under Git's lock without changing unrelated config. */
export async function setSigningKey(
  runner: CommitRunner,
  cwd: string,
  request: RepositorySigningSettingsRequest,
): Promise<RepositorySigningSettings> {
  const before = await readSigningSettings(runner, cwd, request.id);
  if (before.snapshot !== request.snapshot)
    throw new ExpectedBackendError(
      'STALE_SNAPSHOT',
      'Signing settings changed. Reopen settings before saving.',
    );
  const changes: Array<[string, string | null, string | null]> = [
    ['user.signingkey', request.key, before.localKey],
  ];
  for (const [key, next, old] of [
    ['commit.gpgsign', request.commits, before.localCommits],
    ['tag.gpgsign', request.tags, before.localTags],
  ] as const)
    if (next !== undefined)
      changes.push([key, next === null ? null : String(next), old == null ? null : String(old)]);
  if (changes.every(([, next, old]) => next === old)) return before;
  const config = await signingConfig(runner, cwd);
  const lockPath = `${config.path}.lock`;
  const lock = await open(lockPath, 'wx', config.mode & 0o777);
  let temporary: string | undefined,
    published = false;
  try {
    if ((await readSigningSettings(runner, cwd, request.id)).snapshot !== request.snapshot)
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'Signing settings changed. Reopen settings.');
    temporary = await mkdtemp(join(tmpdir(), 'workbench-signing-config-'));
    const copy = join(temporary, 'config');
    await writeFile(copy, config.bytes, { mode: 0o600 });
    for (const [key, next, old] of changes) {
      if (next === old) continue;
      await runner.run(
        [
          'config',
          '--file',
          copy,
          '--no-includes',
          ...(next === null ? ['--unset-all', key] : ['--replace-all', key, next]),
        ],
        { cwd, ...bounds },
      );
    }
    if ((await readSigningSettings(runner, cwd, request.id)).snapshot !== request.snapshot)
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'Signing settings changed. Reopen settings.');
    await lock.writeFile(await readFile(copy));
    await lock.sync();
    await lock.close();
    await rename(lockPath, config.path);
    published = true;
  } finally {
    await lock.close();
    if (!published) await unlink(lockPath).catch(() => undefined);
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
  return readSigningSettings(runner, cwd, request.id);
}

/** Interpret machine status only: human-readable diagnostics and key UIDs never cross IPC. */
export function parseSignatureStatus(stderr: string, success: boolean): RepositorySignature {
  const records = stderr
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('[GNUPG:] '))
    .map((line) => line.slice(9).split(' '));
  const has = (name: string) => records.some((record) => record[0] === name);
  const fingerprint = records.find((record) => record[0] === 'VALIDSIG')?.[1] ?? null;
  const status = has('BADSIG')
    ? 'invalid'
    : has('REVKEYSIG')
      ? 'revoked'
      : has('EXPKEYSIG') || has('EXPSIG')
        ? 'expired'
        : has('NO_PUBKEY')
          ? 'missing-key'
          : success && has('VALIDSIG')
            ? has('TRUST_FULLY') || has('TRUST_ULTIMATE')
              ? 'valid'
              : 'untrusted'
            : 'unavailable';
  return repositorySignatureSchema.parse({ status, fingerprint });
}

export async function verifySignature(
  runner: CommitRunner,
  cwd: string,
  request: RepositoryVerifySignatureRequest,
): Promise<RepositorySignature> {
  const options = { cwd, ...bounds, signal: AbortSignal.timeout(10_000) };
  // Exact object IDs, no revision expressions or tag peeling: verify the tag object itself.
  const type = (await runner.run(['cat-file', '-t', request.objectId], options)).stdout.trim();
  if (type !== request.kind)
    throw new Error('The selected object has a different type. Refresh and try again.');
  const raw = (await runner.run(['cat-file', request.kind, request.objectId], options)).stdout;
  const signed =
    request.kind === 'commit'
      ? /^gpgsig(?:-sha256)? /mu.test(raw.split('\n\n', 1)[0] ?? '')
      : /\n-----BEGIN (?:PGP SIGNATURE|SSH SIGNATURE|SIGNED MESSAGE)-----/u.test(raw);
  if (!signed) return { status: 'unsigned', fingerprint: null };
  const openpgp =
    request.kind === 'commit'
      ? /^gpgsig(?:-sha256)? -----BEGIN PGP SIGNATURE-----/mu.test(raw.split('\n\n', 1)[0] ?? '')
      : raw.includes('\n-----BEGIN PGP SIGNATURE-----');
  if (!openpgp) return { status: 'unsupported', fingerprint: null };
  try {
    const result = await runner.run(
      ['-c', 'gpg.format=openpgp', `verify-${request.kind}`, '--raw', request.objectId],
      options,
    );
    return parseSignatureStatus(result.stderr, true);
  } catch (error) {
    if (error instanceof GitCommandError) return parseSignatureStatus(error.stderr, false);
    throw error;
  }
}
