import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { repositoryBisectContextSchema } from '../../common/ipc/contracts';
import type { RepositoryBisectActionRequest, RepositoryBisectContext } from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import { GitCommandError, redactUrlCredentials } from '../git/runner';
import type { GitRunner } from '../git/runner';
import { detectPendingOperation } from './commit-service';

interface ContextInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
}

async function stateFile(gitDir: string, name: string): Promise<string> {
  try {
    const file = await open(join(gitDir, name), 'r');
    try {
      const bytes = Buffer.alloc(1024 * 1024 + 1);
      const { bytesRead } = await file.read(bytes);
      if (bytesRead > 1024 * 1024) throw new Error('Bisect state exceeds the supported size.');
      return bytes.subarray(0, bytesRead).toString('utf8').trim();
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function readBisectContext(
  runner: Pick<GitRunner, 'run'>,
  input: ContextInput,
): Promise<RepositoryBisectContext> {
  const options = { cwd: input.cwd, maxOutputBytes: 2 * 1024 * 1024, timeoutMs: 15000 };
  const [original, log, terms, noCheckout, pending, status, refs, rawHead, symbolicHead] = await Promise.all([
    stateFile(input.gitDir, 'BISECT_START'),
    stateFile(input.gitDir, 'BISECT_LOG'),
    stateFile(input.gitDir, 'BISECT_TERMS'),
    stateFile(input.gitDir, 'BISECT_HEAD'),
    detectPendingOperation(input.gitDir),
    runner.run(['status', '--porcelain=v1', '--untracked-files=normal'], options),
    runner.run(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/bisect/'], options),
    runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], options).catch((error: unknown) => {
      if (error instanceof GitCommandError && error.exitCode === 1) return { stdout: '' };
      throw error;
    }),
    runner.run(['symbolic-ref', '--quiet', 'HEAD'], options).catch((error: unknown) => {
      if (error instanceof GitCommandError && error.exitCode === 1) return { stdout: '' };
      throw error;
    }),
  ]);
  const head = rawHead.stdout.trim() || null;
  const active = original.length > 0;
  const entries = refs.stdout
    .trim()
    .split('\n')
    .map((line) => line.split(' '));
  const bad = entries.find(([name]) => name === 'refs/bisect/bad')?.[1] ?? null;
  const good = entries.filter(([name]) => name?.startsWith('refs/bisect/good-')).map(([, id]) => id!);
  const skipped = entries.filter(([name]) => name?.startsWith('refs/bisect/skip-')).map(([, id]) => id!);
  const firstBad = /^# first '?bad'? commit: \[([0-9a-f]{40,64})\]/mu.exec(log)?.[1] ?? null;
  const candidates = [...log.matchAll(/^# possible first '?bad'? commit: \[([0-9a-f]{40,64})\]/gmu)].map(
    (match) => match[1]!,
  );
  const blockedReason = !head
    ? 'Create a commit before bisecting.'
    : pending
      ? 'Finish or abort the ' + pending + ' first.'
      : status.stdout
        ? 'Commit or stash local changes, including untracked files, before bisecting.'
        : noCheckout || (terms && terms !== 'bad\ngood')
          ? 'This externally started bisect uses unsupported terms or no-checkout mode. Use Git to finish it.'
          : null;
  return repositoryBisectContextSchema.parse({
    repositoryId: input.repositoryId,
    active,
    original: original || null,
    head,
    bad,
    good,
    skipped,
    firstBad,
    candidates,
    blockedReason,
    snapshot: createHash('sha256')
      .update(
        JSON.stringify([
          original,
          log,
          terms,
          noCheckout,
          status.stdout,
          refs.stdout,
          head,
          symbolicHead.stdout,
          pending,
        ]),
      )
      .digest('hex'),
  });
}

export async function applyBisectAction(
  runner: Pick<GitRunner, 'run'>,
  input: ContextInput,
  request: RepositoryBisectActionRequest,
  signal?: AbortSignal,
): Promise<RepositoryBisectContext> {
  const before = await readBisectContext(runner, input);
  if (before.snapshot !== request.snapshot)
    throw new ExpectedBackendError(
      'STALE_SNAPSHOT',
      'Bisect or the checkout changed. Refresh and try again.',
    );
  if (before.blockedReason) throw new ExpectedBackendError('INVALID_REQUEST', before.blockedReason);
  if ((request.action === 'start') === before.active)
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      before.active ? 'A bisect is already active.' : 'Start a bisect first.',
    );
  if (request.action !== 'reset' && (before.firstBad || before.candidates.length))
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      'Bisect has finished. Abort to restore the original checkout.',
    );
  if (request.action === 'good' && (!before.bad || before.bad === before.head))
    throw new ExpectedBackendError(
      'INVALID_REQUEST',
      'Mark a bad commit, then check out a known good commit first.',
    );
  if (request.action === 'skip' && (!before.bad || !before.good.length))
    throw new ExpectedBackendError('INVALID_REQUEST', 'Mark both ends of the range before skipping.');
  try {
    await runner.run(['bisect', request.action], {
      cwd: input.cwd,
      signal,
      timeoutMs: 120000,
      maxOutputBytes: 2 * 1024 * 1024,
    });
  } catch (error) {
    // Git exits 2 when skipped revisions make the answer ambiguous. Its durable log is authoritative.
    if (!(
      error instanceof GitCommandError &&
      error.exitCode === 2 &&
      (await readBisectContext(runner, input)).candidates.length
    )) {
      if (error instanceof GitCommandError)
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'Bisect could not complete: ' +
            redactUrlCredentials(error.stderr || error.stdout)
              .trim()
              .slice(0, 1500),
        );
      throw error;
    }
  }
  return readBisectContext(runner, input);
}
