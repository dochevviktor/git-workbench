import { createHash } from 'node:crypto';
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
  const [key, localKey, format, commits, tags] = await Promise.all([
    read('user.signingkey'),
    read('user.signingkey', true),
    read('gpg.format'),
    read('commit.gpgsign', false, true),
    read('tag.gpgsign', false, true),
  ]);
  const values = {
    repositoryId,
    key,
    localKey,
    format: format ?? 'openpgp',
    commits: commits === 'true',
    tags: tags === 'true',
  };
  return repositorySigningSettingsSchema.parse({
    ...values,
    snapshot: createHash('sha256').update(JSON.stringify(values)).digest('hex'),
  });
}

/** A single Git config write preserves unrelated entries; local scope is shared by linked worktrees. */
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
  if (request.key !== null) {
    await runner.run(['config', '--local', '--replace-all', 'user.signingkey', request.key], {
      cwd,
      ...bounds,
    });
  } else if (before.localKey !== null) {
    await runner.run(['config', '--local', '--unset-all', 'user.signingkey'], { cwd, ...bounds });
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
