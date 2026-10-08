import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { lfsContextSchema, lfsLocksSchema } from '../../common/ipc/lfs';
import type { LfsContext, LfsLocks, LfsOperationRequest } from '../../common/ipc/lfs';
import { ExpectedBackendError } from '../errors';
import { GitCancelledError, GitCommandError, sanitizeGitOutput } from '../git/runner';
import type { GitRunOptions } from '../git/runner';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import { probeGitLfs, withLfsSignal } from './lfs-service';
import type { LfsRunner } from './lfs-service';
import { classifyNetworkFailure } from './network-service';

const readBounds = { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 };
const patternListSchema = z.object({
  patterns: z
    .array(
      z.object({
        pattern: z.string(),
        source: z.string(),
        lockable: z.boolean(),
        tracked: z.boolean(),
      }),
    )
    .max(1000),
});
const serverLock = z.object({
  id: z.string(),
  path: z.string(),
  locked_at: z.string(),
  owner: z.object({ name: z.string() }).nullish(),
});
const verifiedLocks = z.object({
  ours: z.array(serverLock).nullish(),
  theirs: z.array(serverLock).nullish(),
});

async function optionalGit(runner: LfsRunner, cwd: string, args: string[]) {
  try {
    return (await runner.run(args, { cwd, ...readBounds })).stdout.trimEnd();
  } catch (error) {
    if (error instanceof GitCommandError && [1, 128].includes(error.exitCode ?? 0)) return '';
    throw error;
  }
}

/** Opening management only reads local state. Lock server requests are explicit cancellable jobs. */
export async function readLfsContext(
  runner: LfsRunner,
  cwd: string,
  repositoryId: string,
): Promise<LfsContext> {
  runner = withLfsSignal(runner, AbortSignal.timeout(10_000));
  const [tool, head, remoteNames, config, attributes, lfsconfig] = await Promise.all([
    probeGitLfs(runner, cwd),
    optionalGit(runner, cwd, ['rev-parse', '--verify', 'HEAD']),
    optionalGit(runner, cwd, ['remote']),
    optionalGit(runner, cwd, ['config', '--null', '--list']),
    readAttributeFile(cwd),
    readLocalConfig(cwd),
  ]);
  const names = remoteNames.split('\n').filter(Boolean);
  if (names.length > 100)
    throw new ExpectedBackendError('UNAVAILABLE', 'LFS management supports up to 100 remotes.');
  const defaultRemote = await defaultLfsRemote(runner, cwd, names);
  // Distribution builds can backport individual options. Probe local help instead of guessing from a version.
  const supportsRefetch =
    tool.available && /^\s*--refetch\b/mu.test(await optionalGit(runner, cwd, ['lfs', 'fetch', '-h']));
  const endpointOutput = tool.available
    ? (await runner.run(['lfs', 'env'], { cwd, ...readBounds })).stdout
    : '';
  const endpoints = new Map(
    [...endpointOutput.matchAll(/^Endpoint(?: \(([^)]+)\))?=(.*?) \(auth=[^)]*\)$/gmu)].map((entry) => [
      entry[1] ?? defaultRemote,
      sanitizeGitOutput(entry[2]!),
    ]),
  );
  const ownLfsConfig = async (key: string) =>
    (await optionalGit(runner, cwd, ['config', '--get', key])) ||
    (lfsconfig ? await optionalGit(runner, cwd, ['config', '--file', '.lfsconfig', '--get', key]) : '');
  const pushOverride = (await ownLfsConfig('lfs.pushurl')) || (await ownLfsConfig('lfs.url'));
  const remotes = await Promise.all(
    names.map(async (name) => ({
      name,
      url: sanitizeGitOutput(await optionalGit(runner, cwd, ['remote', 'get-url', name])),
      endpoint: endpoints.get(name) ?? null,
      pushUrl: sanitizeGitOutput(
        pushOverride ||
          (await ownLfsConfig(`remote.${name}.lfspushurl`)) ||
          (await ownLfsConfig(`remote.${name}.lfsurl`)) ||
          (await optionalGit(runner, cwd, ['remote', 'get-url', '--push', name])),
      ),
    })),
  );
  const rawPatterns = tool.available ? await readPatterns(runner, cwd) : [];
  const patterns = rawPatterns
    .filter((item) => item.tracked || item.lockable)
    .map(({ pattern, source, lockable }) => ({ pattern, source, lockable }));
  const configIndex = await optionalGit(runner, cwd, [
    'ls-files',
    '--stage',
    '-z',
    '--',
    '.lfsconfig',
    '.gitattributes',
  ]);
  return lfsContextSchema.parse({
    repositoryId,
    available: tool.available,
    supportsRefetch,
    version: tool.version,
    head: head || null,
    remotes,
    patterns,
    defaultRemote,
    snapshot: createHash('sha256')
      .update(
        JSON.stringify([
          head,
          config,
          attributes,
          lfsconfig,
          rawPatterns,
          remotes,
          configIndex,
          tool.version,
          supportsRefetch,
        ]),
      )
      .digest('hex'),
  });
}

/** `lfs track --json` writes a local format-version even when listing. Give that inspection its own
 * Git metadata, preserving the real working directory, configured attributes and info attributes. */
async function readPatterns(runner: LfsRunner, cwd: string) {
  const temporary = await mkdtemp(join(tmpdir(), 'workbench-lfs-inspect-'));
  try {
    // Git LFS computes relative patterns from canonical paths, including Windows 8.3 expansion.
    const directory = await realpath(temporary);
    const worktree = await realpath(cwd);
    await mkdir(join(directory, 'objects'));
    await mkdir(join(directory, 'refs'));
    await mkdir(join(directory, 'info'));
    await writeFile(join(directory, 'HEAD'), 'ref: refs/heads/inspection\n');
    await writeFile(
      join(directory, 'config'),
      '[core]\nrepositoryformatversion = 0\nbare = false\n[lfs]\nrepositoryformatversion = 0\n',
    );
    const attributes = await optionalGit(runner, cwd, ['config', '--path', '--get', 'core.attributesFile']);
    const infoPath = await optionalGit(runner, cwd, ['rev-parse', '--git-path', 'info/attributes']);
    if (infoPath) {
      const file = resolve(cwd, infoPath);
      const info = await lstat(file).catch(() => undefined);
      if (info?.isFile() && info.size <= 1024 * 1024)
        await writeFile(join(directory, 'info/attributes'), await readFile(file));
    }
    const result = await runner.run(
      [
        `--git-dir=${directory}`,
        `--work-tree=${worktree}`,
        ...(attributes ? ['-c', `core.attributesFile=${resolve(cwd, attributes)}`] : []),
        'lfs',
        'track',
        '--json',
      ],
      { cwd, ...readBounds, env: { GIT_LFS_TRACK_NO_INSTALL_HOOKS: '1' } },
    );
    const infoPrefix = `${relative(worktree, join(directory, 'info')).split(sep).join('/')}/`;
    return patternListSchema
      .parse(JSON.parse(result.stdout))
      .patterns.map((entry) =>
        entry.pattern.startsWith(infoPrefix)
          ? { ...entry, pattern: entry.pattern.slice(infoPrefix.length), source: infoPath }
          : entry,
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function defaultLfsRemote(runner: LfsRunner, cwd: string, names: string[]) {
  const configured = await optionalGit(runner, cwd, ['config', '--get', 'remote.lfsdefault']);
  if (names.includes(configured)) return configured;
  const branch = await optionalGit(runner, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const upstream = branch
    ? await optionalGit(runner, cwd, ['config', '--get', `branch.${branch}.remote`])
    : '';
  return names.includes(upstream) ? upstream : names.includes('origin') ? 'origin' : (names[0] ?? null);
}

export async function resolveLfsRemote(runner: LfsRunner, cwd: string, selected?: string) {
  const names = (await optionalGit(runner, cwd, ['remote'])).split('\n').filter(Boolean);
  const remote = selected ?? (await defaultLfsRemote(runner, cwd, names));
  if (!remote || !names.includes(remote))
    throw new ExpectedBackendError('UNAVAILABLE', 'Configure a remote to retrieve the missing LFS payload.');
  return remote;
}

async function readLocalConfig(cwd: string): Promise<string | null> {
  const path = join(cwd, '.lfsconfig');
  const info = await lstat(path).catch(() => undefined);
  if (!info) return null;
  if (!info.isFile() || info.size > 65536)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'The LFS configuration must be a regular file smaller than 64 KiB.',
    );
  return readFile(path, 'utf8');
}

async function readAttributeFile(cwd: string): Promise<string | null> {
  const path = join(cwd, '.gitattributes');
  const info = await lstat(path).catch(() => undefined);
  if (!info) return null;
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'The root .gitattributes must be a regular file smaller than 1 MiB.',
    );
  return readFile(path, 'utf8');
}

/** Git LFS owns transport/authentication. A private progress file never contains object bytes. */
export async function runLfsTransfer(
  runner: LfsRunner,
  cwd: string,
  args: string[],
  handle: Pick<OperationHandle, 'signal' | 'setProgress'>,
  extra: Partial<GitRunOptions> = {},
) {
  const temporary = await mkdtemp(join(tmpdir(), 'workbench-lfs-'));
  const progressPath = join(temporary, 'progress');
  const phase = args.includes('push') ? 'Uploading LFS objects' : 'Downloading LFS objects';
  let reading = false;
  const poll = async () => {
    if (reading) return;
    reading = true;
    let file;
    try {
      file = await open(progressPath, 'r');
      const info = await file.stat();
      const buffer = Buffer.alloc(Math.min(info.size, 4096));
      await file.read(buffer, 0, buffer.length, Math.max(0, info.size - buffer.length));
      const matches = [...buffer.toString().matchAll(/(?:download|upload) (\d+)\/(\d+) (\d+)\/(\d+) /gu)];
      const last = matches.at(-1);
      if (last) {
        const total = Number(last[2]);
        const bytes = Number(last[4]);
        const percent =
          total > 0
            ? Math.floor(((Number(last[1]) - 1 + (bytes > 0 ? Number(last[3]) / bytes : 1)) / total) * 100)
            : 0;
        handle.setProgress({ phase, percent: Math.max(0, Math.min(100, percent)) });
      }
    } catch {
      /* Progress may not exist until the first byte is transferred. */
    } finally {
      await file?.close();
      reading = false;
    }
  };
  const timer = setInterval(() => void poll(), 150);
  handle.setProgress({ phase, percent: null });
  try {
    return await runner.run(['-c', `core.hooksPath=${temporary}`, ...args], {
      cwd,
      signal: handle.signal,
      timeoutMs: 30 * 60_000,
      maxOutputBytes: 1024 * 1024,
      authentication: 'prompt',
      ...extra,
      env: { ...extra.env, GIT_LFS_PROGRESS: progressPath, GIT_LFS_FORCE_PROGRESS: '1' },
    });
  } finally {
    clearInterval(timer);
    // No pending progress callback may outlive this job or its temporary file.
    while (reading) await new Promise<void>((done) => setTimeout(done, 5));
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function readLfsLocks(
  runner: LfsRunner,
  cwd: string,
  remote: string,
  handle: OperationHandle,
): Promise<LfsLocks> {
  // The ordinary route propagates server errors that git-lfs 3.8's JSON route can suppress.
  const verified = await runner.run(['lfs', 'locks', '--verify', '--limit=1000', `--remote=${remote}`], {
    cwd,
    signal: handle.signal,
    timeoutMs: 120_000,
    maxOutputBytes: 1024 * 1024,
    authentication: 'prompt',
  });
  const result = await runner.run(
    ['lfs', 'locks', '--verify', '--json', '--limit=1000', `--remote=${remote}`],
    {
      cwd,
      signal: handle.signal,
      timeoutMs: 120_000,
      maxOutputBytes: 1024 * 1024,
      authentication: 'prompt',
    },
  );
  const parsed = verifiedLocks.parse(JSON.parse(result.stdout));
  const entries = [
    ...(parsed.ours ?? []).map((lock) => ({ ...lock, ours: true })),
    ...(parsed.theirs ?? []).map((lock) => ({ ...lock, ours: false })),
  ];
  const locks = entries.map((lock) => ({
    id: lock.id,
    path: lock.path,
    owner: sanitizeGitOutput(lock.owner?.name ?? 'Unknown'),
    lockedAt: lock.locked_at,
    ours: lock.ours,
  }));
  // Require every structured row to match the successful ownership read.
  const width = Math.max(0, ...locks.map((lock) => Buffer.byteLength(lock.path)));
  const ownerWidth = Math.max(0, ...entries.map((lock) => Buffer.byteLength(lock.owner?.name ?? '')));
  const expected = [...entries]
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map((lock) => {
      const owner = lock.owner?.name ?? '';
      return `${lock.ours ? 'O ' : '  '}${lock.path}${' '.repeat(width - Buffer.byteLength(lock.path))}\t${owner}${' '.repeat(ownerWidth - Buffer.byteLength(owner))}\tID:${lock.id}\n`;
    })
    .join('');
  if (verified.stdout.replaceAll('\r\n', '\n') !== expected)
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'LFS locks changed while verifying ownership. Refresh the lock list.',
    );
  return lfsLocksSchema.parse({ remote, locks, truncated: locks.length >= 1000 });
}

export async function applyLfsOperation(
  runner: LfsRunner,
  cwd: string,
  request: LfsOperationRequest,
  handle: OperationHandle,
): Promise<OperationOutcome> {
  runner = withLfsSignal(runner, handle.signal);
  const context = await readLfsContext(runner, cwd, request.id);
  if (context.snapshot !== request.snapshot)
    throw new ExpectedBackendError(
      'STALE_SNAPSHOT',
      'LFS settings or the checkout changed. Refresh and review the action again.',
    );
  if (!context.available)
    throw new ExpectedBackendError('UNAVAILABLE', 'Install Git LFS to use this action.');
  const action = request.action;
  if (action.kind === 'fetch' && action.refetch && !context.supportsRefetch)
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'This Git LFS installation does not support downloading cached objects again. Update Git LFS to use this option.',
    );
  if ('remote' in action && !context.remotes.some((remote) => remote.name === action.remote))
    throw new ExpectedBackendError('INVALID_REQUEST', 'Choose a configured remote.');
  try {
    if (action.kind === 'locks') {
      handle.setProgress({ phase: 'Checking lock ownership', percent: null });
      const locks = await readLfsLocks(runner, cwd, action.remote, handle);
      return {
        status: 'succeeded',
        message: 'LFS locks refreshed.',
        output: '',
        result: { kind: 'lfs-locks', value: locks },
      };
    }
    if (action.kind === 'fetch' || action.kind === 'push') {
      if (!context.head)
        throw new ExpectedBackendError('UNAVAILABLE', 'Create a commit before transferring LFS objects.');
      const args =
        action.kind === 'fetch'
          ? [
              '-c',
              'lfs.fetchrecentalways=false',
              'lfs',
              'fetch',
              '--include=',
              '--exclude=',
              ...(action.refetch ? ['--refetch'] : []),
              action.remote,
              context.head,
            ]
          : ['lfs', 'push', action.remote, context.head];
      await runLfsTransfer(runner, cwd, args, handle);
      return {
        status: 'succeeded',
        message:
          action.kind === 'fetch'
            ? 'LFS objects downloaded. The checkout is unchanged.'
            : 'LFS objects uploaded. Git references are unchanged.',
        output: '',
      };
    }
    if (action.kind === 'lock' || action.kind === 'unlock') {
      await assertLfsPath(runner, cwd, action.path);
      const locks = await readLfsLocks(runner, cwd, action.remote, handle);
      if (action.kind === 'unlock') {
        const lock = locks.locks.find((entry) => entry.id === action.lockId && entry.path === action.path);
        if (!lock?.ours)
          throw new ExpectedBackendError(
            'OPERATION_FAILED',
            'Only a lock confirmed as yours can be unlocked. Refresh the lock list.',
          );
      } else if (locks.locks.some((entry) => entry.path === action.path)) {
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'This file is already locked. Refresh the lock list to see its owner.',
        );
      }
      const reviewed = await readLfsContext(runner, cwd, request.id);
      // LFS may remember authentication access mode in config; compare the actual reviewed
      // destinations, HEAD and rules again instead of treating that native cache write as a retarget.
      if (
        reviewed.head !== context.head ||
        JSON.stringify([reviewed.remotes, reviewed.patterns]) !==
          JSON.stringify([context.remotes, context.patterns])
      )
        throw new ExpectedBackendError(
          'STALE_SNAPSHOT',
          'The LFS destination or tracking rules changed. Review the action again.',
        );
      await assertLfsPath(runner, cwd, action.path);
      handle.setProgress({
        phase: action.kind === 'lock' ? 'Locking file' : 'Unlocking file',
        percent: null,
      });
      await runner.run(
        [
          'lfs',
          action.kind,
          '--json',
          `--remote=${action.remote}`,
          ...(action.kind === 'unlock' ? [`--id=${action.lockId}`] : ['--', action.path]),
        ],
        {
          cwd,
          signal: handle.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 65536,
          authentication: 'prompt',
        },
      );
      return {
        status: 'succeeded',
        message:
          action.kind === 'lock'
            ? 'File locked. Refresh to see current ownership.'
            : 'File unlocked. Refresh to see current ownership.',
        output: '',
      };
    }
    if (
      action.kind === 'untrack' &&
      !context.patterns.some((item) => item.pattern === action.pattern && item.source === '.gitattributes')
    )
      throw new ExpectedBackendError(
        'INVALID_REQUEST',
        'Only a pattern from the root .gitattributes can be removed here.',
      );
    await readAttributeFile(cwd);
    await runner.run(
      [
        'lfs',
        action.kind,
        ...(action.kind === 'track' ? [action.lockable ? '--lockable' : '--not-lockable'] : []),
        '--',
        action.pattern,
      ],
      {
        cwd,
        signal: handle.signal,
        timeoutMs: 120_000,
        maxOutputBytes: 65536,
        env: { GIT_LFS_TRACK_NO_INSTALL_HOOKS: '1' },
      },
    );
    const after = await readLfsContext(runner, cwd, request.id);
    const exists = after.patterns.some(
      (item) => item.pattern === action.pattern && item.source === '.gitattributes',
    );
    if (exists !== (action.kind === 'track'))
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Git LFS did not update this pattern. Check .gitattributes permissions and pattern syntax.',
      );
    return {
      status: 'succeeded',
      message: 'Tracking rules updated. Review and commit .gitattributes in Local Changes.',
      output: '',
    };
  } catch (error) {
    if (error instanceof GitCancelledError || handle.signal.aborted) throw new GitCancelledError();
    if (error instanceof GitCommandError) {
      const failure = lfsFailure(error);
      return {
        status: 'failed',
        failureReason: failure.reason,
        message: `Git LFS: ${failure.message}`.slice(0, 512),
        output: '',
      };
    }
    throw error;
  }
}

export function lfsFailure(error: GitCommandError) {
  const output = `${error.stdout}\n${error.stderr}`;
  if (/401|403|authentication|authorization|credentials/iu.test(output))
    return {
      reason: 'authentication' as const,
      message: 'Authentication failed. Check the account, credential helper and LFS permissions, then retry.',
    };
  if (/404|object.*not found|missing object/iu.test(output))
    return {
      reason: 'not-found' as const,
      message:
        'The LFS server does not have this object or endpoint. Check the LFS URL and that the payload was pushed.',
    };
  if (/501|not implemented|locking.*not supported/iu.test(output))
    return { reason: 'other' as const, message: 'This LFS server does not support the requested operation.' };
  if (/hash|checksum|corrupt/iu.test(output))
    return {
      reason: 'other' as const,
      message: 'The received LFS payload failed verification. Check the server object and retry.',
    };
  const failure = classifyNetworkFailure('lfs', output);
  return failure.reason === 'other'
    ? {
        reason: 'other' as const,
        message: 'The LFS operation failed. Check the tool, remote and repository configuration, then retry.',
      }
    : failure;
}

async function assertLfsPath(runner: LfsRunner, cwd: string, path: string) {
  const root = await realpath(cwd);
  const full = resolve(cwd, path);
  const info = await lstat(full).catch(() => undefined);
  if (!info?.isFile())
    throw new ExpectedBackendError('INVALID_REQUEST', 'Select a regular working file to lock or unlock.');
  const local = relative(root, await realpath(full));
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
    throw new ExpectedBackendError('INVALID_REQUEST', 'The file is outside the repository.');
  const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  await file.close();
  const tracked = (
    await runner.run(['check-attr', '-z', 'filter', '--', path], { cwd, ...readBounds })
  ).stdout.split('\0');
  if (tracked.at(-2) !== 'lfs')
    throw new ExpectedBackendError('INVALID_REQUEST', 'This file is not tracked by LFS.');
}
