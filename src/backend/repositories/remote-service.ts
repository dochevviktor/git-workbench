import type {
  RepositoryRemote,
  RepositoryRemoteAction,
  RepositoryRemoteActionResult,
  RepositoryRemoteFailureReason,
} from '../../common/ipc/contracts';
import { repositoryRemoteActionResultSchema } from '../../common/ipc/contracts';
import { GitCommandError, redactUrlCredentials } from '../git/runner';
import { isAbsolute } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

const remoteReadTimeoutMs = 10_000;
const remoteReadOutputLimit = 4 * 1024 * 1024;
const remoteLimit = 1_000;
// An existing URL can contain a credential. Its public guard must not allow offline guessing.
const remoteSnapshotKey = randomBytes(32);

export interface RemoteRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface RemoteActionInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly action: RepositoryRemoteAction;
}

/** Lists the configured remotes with the URLs Git would use and their remote-tracking branch counts. */
export async function readRemotes(runner: RemoteRunner, cwd: string): Promise<RepositoryRemote[]> {
  const [names, refNames] = await Promise.all([
    readRemoteNames(runner, cwd),
    readRemoteRefNames(runner, cwd),
  ]);
  const remotes: RepositoryRemote[] = [];
  for (const name of names.slice(0, remoteLimit)) {
    const [fetchUrl, pushUrl] = await Promise.all([
      optionalOutput(runner, cwd, ['remote', 'get-url', '--all', '--', name]),
      // `pushurl` is only set when pushes go somewhere else; `get-url --push` would repeat the fetch URL.
      optionalOutput(runner, cwd, ['config', '--get-all', `remote.${name}.pushurl`]),
    ]);
    const prefix = `refs/remotes/${name}/`;
    remotes.push({
      name,
      fetchUrl: redactUrlCredentials(fetchUrl?.split('\n')[0] ?? ''),
      pushUrl: pushUrl === null ? null : redactUrlCredentials(pushUrl.split('\n')[0] ?? ''),
      branchCount: refNames.filter((refName) => refName.startsWith(prefix)).length,
      fetchAutomatically: true,
      snapshot: createHmac('sha256', remoteSnapshotKey)
        .update(JSON.stringify([name, fetchUrl, pushUrl]))
        .digest('hex'),
    });
  }
  return remotes;
}

/**
 * Applies one remote change. Git validates the name itself through `check-ref-format`; a refusal this
 * service can foresee comes back as a structured result rather than an exception.
 */
export async function applyRemoteAction(
  runner: RemoteRunner,
  input: RemoteActionInput,
): Promise<RepositoryRemoteActionResult> {
  const action = input.action;
  const existing = await readRemotes(runner, input.cwd);
  if (action.kind === 'edit') return editRemote(runner, input, action, existing);
  const blocked = (reason: RepositoryRemoteFailureReason, message: string) =>
    repositoryRemoteActionResultSchema.parse({
      status: 'blocked',
      repositoryId: input.repositoryId,
      reason,
      message,
      remotes: existing,
    } satisfies RepositoryRemoteActionResult);

  const names = new Set(existing.map((remote) => remote.name));
  const targetName = action.kind === 'rename' ? action.newName : action.name;
  if (action.kind === 'add' || action.kind === 'rename') {
    if (!(await isValidRemoteName(runner, input.cwd, targetName))) {
      return blocked('invalid-name', `Git does not accept '${targetName}' as a remote name.`);
    }
    if (names.has(targetName)) {
      return blocked('exists', `A remote named '${targetName}' already exists.`);
    }
  }
  if (action.kind !== 'add' && !names.has(action.name)) {
    return blocked('not-found', `This repository has no remote named '${action.name}'.`);
  }
  if (action.kind === 'set-url') {
    const previous = existing.find((remote) => remote.name === action.name);
    // A display-only redaction must never replace the privileged URL. An unchanged field is a no-op.
    if (action.url === (action.push ? previous?.pushUrl : previous?.fetchUrl)) {
      return {
        status: 'applied',
        repositoryId: input.repositoryId,
        message: 'The URL is unchanged.',
        remotes: existing,
      };
    }
  }
  if ((action.kind === 'add' || action.kind === 'set-url') && action.url.includes('<redacted>')) {
    return blocked('invalid-url', 'Enter a complete replacement URL without embedded credentials.');
  }
  if ((action.kind === 'add' || action.kind === 'set-url') && !isAllowedRemoteUrl(action.url)) {
    return blocked(
      'invalid-url',
      'Use a remote URL without embedded passwords or tokens, or local command transports. Credentials belong in a Git credential helper or SSH agent.',
    );
  }

  try {
    await runner.run(remoteArguments(action), {
      cwd: input.cwd,
      timeoutMs: remoteReadTimeoutMs,
      maxOutputBytes: remoteReadOutputLimit,
    });
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    const output = `${error.stdout}\n${error.stderr}`;
    if (/already exists/iu.test(output)) {
      return blocked('exists', `A remote named '${targetName}' already exists.`);
    }
    if (/no such remote|does not exist/iu.test(output)) {
      return blocked('not-found', `This repository has no remote named '${action.name}'.`);
    }
    return blocked('other', 'Git could not change the remotes of this repository.');
  }

  return repositoryRemoteActionResultSchema.parse({
    status: 'applied',
    repositoryId: input.repositoryId,
    message: remoteMessage(action),
    remotes: await readRemotes(runner, input.cwd),
  } satisfies RepositoryRemoteActionResult);
}

function remoteArguments(action: RepositoryRemoteAction): readonly string[] {
  switch (action.kind) {
    case 'add':
      return ['remote', 'add', action.name, action.url];
    case 'rename':
      return ['remote', 'rename', action.name, action.newName];
    case 'remove':
      return ['remote', 'remove', action.name];
    case 'set-url':
      return ['remote', 'set-url', ...(action.push ? ['--push'] : []), action.name, action.url];
    case 'set-automatic-fetch':
    case 'edit':
      throw new Error('Automatic fetch preferences are not Git remote actions.');
  }
}

function remoteMessage(action: RepositoryRemoteAction): string {
  switch (action.kind) {
    case 'add':
      return `Added the remote '${action.name}'.`;
    case 'rename':
      return `Renamed '${action.name}' to '${action.newName}'.`;
    case 'remove':
      return `Removed the remote '${action.name}'.`;
    case 'set-url':
      return action.push
        ? `Changed the push URL of '${action.name}'.`
        : `Changed the URL of '${action.name}'.`;
    case 'set-automatic-fetch':
      return `${action.enabled ? 'Enabled' : 'Disabled'} automatic fetching for '${action.name}'.`;
    case 'edit':
      return `Updated '${action.newName}'.`;
  }
}

async function editRemote(
  runner: RemoteRunner,
  input: RemoteActionInput,
  action: Extract<RepositoryRemoteAction, { kind: 'edit' }>,
  existing: RepositoryRemote[],
): Promise<RepositoryRemoteActionResult> {
  const previous = existing.find((remote) => remote.name === action.name);
  const blocked = (reason: RepositoryRemoteFailureReason, message: string): RepositoryRemoteActionResult => ({
    status: 'blocked',
    repositoryId: input.repositoryId,
    reason,
    message,
    remotes: existing,
  });
  if (!previous) return blocked('not-found', 'The remote no longer exists. Reopen Remotes.');
  if (previous.snapshot !== action.snapshot)
    return blocked(
      'other',
      'The remote changed after this dialog opened. Reopen it to review the current URLs.',
    );
  if (!(await isValidRemoteName(runner, input.cwd, action.newName)))
    return blocked('invalid-name', 'Enter a valid remote name.');
  if (action.newName !== action.name && existing.some((remote) => remote.name === action.newName))
    return blocked('exists', `A remote named '${action.newName}' already exists.`);
  for (const [value, old] of [
    [action.url, previous.fetchUrl],
    [action.pushUrl, previous.pushUrl],
  ]) {
    // Unchanged display redactions preserve the original privileged URL.
    if (
      value !== old &&
      value !== null &&
      value !== undefined &&
      (value.includes('<redacted>') || !isAllowedRemoteUrl(value))
    )
      return blocked(
        'invalid-url',
        'Enter a complete URL without embedded passwords, tokens or command transports.',
      );
  }
  const commands: string[][] = [];
  if (action.newName !== action.name) commands.push(['remote', 'rename', action.name, action.newName]);
  if (action.url !== previous.fetchUrl) commands.push(['remote', 'set-url', action.newName, action.url]);
  if (action.pushUrl !== previous.pushUrl)
    commands.push(
      action.pushUrl === null
        ? ['config', '--unset-all', `remote.${action.newName}.pushurl`]
        : ['remote', 'set-url', '--push', action.newName, action.pushUrl],
    );
  let completed = 0;
  try {
    for (const args of commands) {
      await runner.run(args, {
        cwd: input.cwd,
        timeoutMs: remoteReadTimeoutMs,
        maxOutputBytes: remoteReadOutputLimit,
      });
      completed++;
    }
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    return {
      ...blocked(
        'other',
        completed
          ? 'Some remote settings were saved before Git refused the next change. Reopen Remotes to review the saved values.'
          : 'Git could not save the remote. Check for an existing configuration lock and retry.',
      ),
      remotes: await readRemotes(runner, input.cwd),
    };
  }
  return {
    status: 'applied',
    repositoryId: input.repositoryId,
    message: `Updated '${action.newName}'.`,
    remotes: await readRemotes(runner, input.cwd),
  };
}

/**
 * Git's `ext::` and `--upload-pack`-style transports run a program named in the URL. Repository trust
 * is a later phase, so this slice declines to configure one rather than quietly gaining that power.
 */
export function isAllowedRemoteUrl(url: string): boolean {
  if (!url.trim() || url.startsWith('-') || /[\r\n\0]/u.test(url)) return false;
  if (/^[A-Za-z]:[\\/]/u.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'ssh:', 'git:', 'file:'].includes(parsed.protocol)) return false;
    if (parsed.protocol === 'ssh:' && !parsed.password && !parsed.search) return true;
    // A public GitHub login selects an account; passwords/tokens remain forbidden in URLs.
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      !parsed.port &&
      /^[A-Za-z0-9-]{1,39}$/u.test(parsed.username) &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
      return true;
  } catch {
    // SCP/local paths are valid; arbitrary remote-helper transports would execute local programs.
    if (/^[^/\\]+::/u.test(url)) return false;
  }
  return redactUrlCredentials(url) === url;
}

/** Standalone Clone/Test Connection have no repository base for interpreting a relative local path. */
export function isStandaloneRepositoryUrl(url: string): boolean {
  if (!isAllowedRemoteUrl(url)) return false;
  if (isAbsolute(url) || /^[A-Za-z]:[\\/]/u.test(url)) return true;
  if (/^[^\s/:]+@[^\s/:]+:[^:]/u.test(url)) return true;
  try {
    return ['http:', 'https:', 'ssh:', 'git:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function isValidRemoteName(runner: RemoteRunner, cwd: string, name: string): Promise<boolean> {
  if (name.startsWith('-') || /[\s]/u.test(name)) return false;
  try {
    await runner.run(['check-ref-format', `refs/remotes/${name}/HEAD`], {
      cwd,
      timeoutMs: remoteReadTimeoutMs,
      maxOutputBytes: 4_096,
    });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

async function readRemoteNames(runner: RemoteRunner, cwd: string): Promise<string[]> {
  const result = await runner.run(['remote'], {
    cwd,
    timeoutMs: remoteReadTimeoutMs,
    maxOutputBytes: remoteReadOutputLimit,
  });
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readRemoteRefNames(runner: RemoteRunner, cwd: string): Promise<string[]> {
  const result = await runner.run(['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/remotes'], {
    cwd,
    timeoutMs: remoteReadTimeoutMs,
    maxOutputBytes: remoteReadOutputLimit,
  });
  const names: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [refName, symbolicTarget] = line.split('\0');
    // `origin/HEAD` points at another branch of the same remote; counting it would double one branch.
    if (!refName || symbolicTarget?.trim()) continue;
    names.push(refName.trim());
  }
  return names;
}

async function optionalOutput(
  runner: RemoteRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await runner.run(args, {
      cwd,
      timeoutMs: remoteReadTimeoutMs,
      maxOutputBytes: remoteReadOutputLimit,
    });
    return result.stdout.replace(/\r?\n$/u, '') || null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}
