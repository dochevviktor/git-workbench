import type {
  RepositoryRemote,
  RepositoryRemoteAction,
  RepositoryRemoteActionResult,
  RepositoryRemoteFailureReason,
} from '../../common/ipc/contracts';
import { repositoryRemoteActionResultSchema } from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

const remoteReadTimeoutMs = 10_000;
const remoteReadOutputLimit = 4 * 1024 * 1024;
const remoteLimit = 1_000;

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
      optionalOutput(runner, cwd, ['remote', 'get-url', '--', name]),
      // `pushurl` is only set when pushes go somewhere else; `get-url --push` would repeat the fetch URL.
      optionalOutput(runner, cwd, ['config', '--get', `remote.${name}.pushurl`]),
    ]);
    const prefix = `refs/remotes/${name}/`;
    remotes.push({
      name,
      fetchUrl: fetchUrl ?? '',
      pushUrl,
      branchCount: refNames.filter((refName) => refName.startsWith(prefix)).length,
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
  if ((action.kind === 'add' || action.kind === 'set-url') && !isAllowedRemoteUrl(action.url)) {
    return blocked(
      'invalid-url',
      'A remote URL that runs a local command is not accepted here, because this application has no repository trust model yet.',
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
  }
}

/**
 * Git's `ext::` and `--upload-pack`-style transports run a program named in the URL. Repository trust
 * is a later phase, so this slice declines to configure one rather than quietly gaining that power.
 */
export function isAllowedRemoteUrl(url: string): boolean {
  return !/^\s*ext::/iu.test(url) && !url.startsWith('-');
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
