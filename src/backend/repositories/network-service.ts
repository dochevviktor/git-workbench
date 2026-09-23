import type {
  RepositoryHead,
  RepositoryNetworkRequest,
  RepositoryOperationFailureReason,
  RepositoryOperationKind,
  RepositoryOperationProgress,
} from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitTimeoutError, redactUrlCredentials } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import type { GitAuthenticationPolicy } from '../git/authentication-policy';
import { ExpectedBackendError } from '../errors';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';

/** Network work waits on a remote host, so it gets its own long bound rather than a read timeout. */
const networkTimeoutMs = 10 * 60 * 1000;
const networkOutputLimit = 8 * 1024 * 1024;
const outputDisplayLimit = 64 * 1024;

export interface NetworkRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface NetworkOperationInput {
  readonly cwd: string;
  readonly head: RepositoryHead;
  readonly request: RepositoryNetworkRequest;
}

export interface NetworkPlan {
  readonly kind: RepositoryOperationKind;
  readonly args: readonly string[];
  readonly title: string;
  /** The command as it is shown in the activity list, with credentials removed. */
  readonly command: string;
}

export class NetworkRequestError extends Error {
  constructor(
    message: string,
    readonly reason: RepositoryOperationFailureReason,
  ) {
    super(message);
    this.name = 'NetworkRequestError';
  }
}

/**
 * Builds the single Git invocation for one network request. Every argument comes from this file: the
 * renderer names a remote, branches, and options, never a refspec or a transport flag.
 */
export function planNetworkOperation(input: NetworkOperationInput): NetworkPlan {
  const request = input.request;
  switch (request.kind) {
    case 'fetch': {
      const args = ['fetch', '--progress', '--no-auto-gc'];
      if (request.prune) args.push('--prune');
      args.push(request.tags ? '--tags' : '--no-tags');
      if (request.remote === null) args.push('--all');
      else args.push('--', request.remote);
      return {
        kind: 'fetch',
        args,
        title: request.remote === null ? 'Fetch all remotes' : `Fetch '${request.remote}'`,
        command: displayCommand(args),
      };
    }
    case 'pull': {
      if (Boolean(request.remote) !== Boolean(request.branch))
        throw new NetworkRequestError('Choose a remote and a source branch together.', 'not-found');
      if ((!input.head.name || input.head.state !== 'branch') && !request.into) {
        throw new NetworkRequestError(
          'Check out a branch before pulling; a detached HEAD has no upstream to pull from.',
          'no-upstream',
        );
      }
      // The caller chooses ordinary merge or rebase explicitly; an unfinished operation remains in
      // Git and is surfaced through the shared Recovery controls.
      const args = [
        'pull',
        '--progress',
        ...(request.rebase === undefined
          ? ['--ff-only', '--no-rebase']
          : request.rebase
            ? ['--rebase']
            : ['--no-rebase', '--ff']),
        '--no-autostash',
      ];
      if (request.prune) args.push('--prune');
      if (request.remote && request.branch) args.push('--', request.remote, `refs/heads/${request.branch}`);
      return {
        kind: 'pull',
        args,
        title:
          request.remote && request.branch
            ? `Pull '${request.remote}/${request.branch}' into '${request.into?.slice('refs/heads/'.length) ?? input.head.name}'`
            : `Pull '${input.head.name}'`,
        command: displayCommand(args),
      };
    }
    case 'fast-forward':
      return {
        kind: 'fast-forward',
        args: [],
        title: `Fast-Forward '${request.fullName.slice('refs/heads/'.length)}'`,
        command: '',
      };
    case 'push': {
      const args = ['push', '--progress', '--no-follow-tags'];
      if (request.setUpstream) args.push('--set-upstream');
      // The repository service replaces force plans with the reviewed, explicit leases before execution.
      if (request.tags) args.push('--tags');
      args.push('--', request.remote);
      for (const target of request.targets) {
        // Only a local branch may be pushed, and only to a branch name. The renderer never supplies a
        // refspec, so no other ref of this repository can be written to the remote.
        if (!isLocalBranchRef(target.fullName)) {
          throw new NetworkRequestError(
            'Only local branches can be pushed by this application.',
            'not-found',
          );
        }
        args.push(`${target.fullName}:refs/heads/${target.remoteBranch}`);
      }
      const names = request.targets.map((target) => target.remoteBranch);
      return {
        kind: 'push',
        args,
        title:
          names.length === 1
            ? `Push '${names[0]}' to '${request.remote}'`
            : `Push ${names.length} branches to '${request.remote}'`,
        command: displayCommand(args),
      };
    }
    case 'delete-remote-branch': {
      const args = [
        'push',
        '--progress',
        '--no-follow-tags',
        '--',
        request.remote,
        `:refs/heads/${request.remoteBranch}`,
      ];
      return {
        kind: 'delete-remote-branch',
        args,
        title: `Delete '${request.remote}/${request.remoteBranch}'`,
        command: displayCommand(args),
      };
    }
  }
}

/**
 * Runs the planned command, reporting Git's own progress while it works. A failure is classified into
 * an actionable reason; nothing is retried, because a network write that was interrupted may already
 * have been applied on the other side.
 */
export async function runNetworkOperation(
  runner: NetworkRunner,
  plan: NetworkPlan,
  cwd: string,
  handle: OperationHandle,
  authentication: GitAuthenticationPolicy = 'prompt',
): Promise<OperationOutcome> {
  const collector = new ProgressCollector(
    (progress) => handle.setProgress(progress),
    (line) => handle.appendOutput(`${line}\n`),
  );

  try {
    const result = await runner.run(plan.args, {
      cwd,
      timeoutMs: networkTimeoutMs,
      maxOutputBytes: networkOutputLimit,
      signal: handle.signal,
      authentication,
      onStderr: (chunk) => collector.push(chunk),
    });
    collector.flush();
    return {
      status: 'succeeded',
      message: successMessage(plan, result),
      output: displayOutput(result.stdout, result.stderr),
    };
  } catch (error) {
    collector.flush();
    if (error instanceof ExpectedBackendError && error.code === 'HOSTING_AUTH')
      return { status: 'failed', message: error.message, output: '', failureReason: 'authentication' };
    if (error instanceof GitCancelledError) {
      return {
        status: 'failed',
        message: 'The operation was cancelled.',
        output: '',
        failureReason: 'cancelled',
      };
    }
    if (error instanceof GitTimeoutError) {
      return {
        status: 'failed',
        message: 'Git stopped responding. Refresh the repository to see what it had already done.',
        output: '',
        failureReason: 'timeout',
      };
    }
    if (!(error instanceof GitCommandError)) throw error;
    const output = displayOutput(error.stdout, error.stderr);
    const failure = classifyNetworkFailure(plan.kind, output);
    return {
      status: 'failed',
      message: failure.message,
      output,
      failureReason: failure.reason,
      canForceWithLease:
        failure.canForceWithLease && !plan.args.some((arg) => arg.startsWith('--force-with-lease')),
    };
  }
}

function isLocalBranchRef(fullName: string): boolean {
  if (!fullName.startsWith('refs/heads/')) return false;
  const name = fullName.slice('refs/heads/'.length);
  // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
  return name.length > 0 && !name.startsWith('-') && !/[\u0000-\u001F\u007F\s]/u.test(name);
}

function successMessage(plan: NetworkPlan, result: GitCommandResult): string {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/Everything up-to-date/iu.test(text)) return 'Everything is up to date.';
  if (/Already up to date/iu.test(text)) return 'Already up to date.';
  switch (plan.kind) {
    case 'fetch':
      return /\S/u.test(text) ? 'Fetched new changes.' : 'Already up to date.';
    case 'pull':
      return plan.args.includes('--ff-only')
        ? 'Fast-forwarded to the upstream branch.'
        : plan.args.includes('--rebase')
          ? 'Pulled changes with rebase.'
          : 'Pulled remote changes.';
    case 'push':
      return 'Pushed.';
    case 'delete-remote-branch':
      return 'Deleted the branch on the remote.';
    default:
      return 'Completed.';
  }
}

interface NetworkFailure {
  readonly reason: RepositoryOperationFailureReason;
  readonly message: string;
  readonly canForceWithLease: boolean;
}

/** Turns Git's transport and receive-pack messages into one actionable sentence. */
export function classifyNetworkFailure(kind: RepositoryOperationKind, output: string): NetworkFailure {
  const plain = (reason: RepositoryOperationFailureReason, message: string): NetworkFailure => ({
    reason,
    message,
    canForceWithLease: false,
  });

  if (/host key verification failed|remote host identification has changed/iu.test(output))
    return plain(
      'authentication',
      'SSH could not verify this host. Check its fingerprint and your known_hosts entry with SSH before retrying.',
    );

  if (
    /authentication failed|could not read username|could not read password|unable to get password|credential helper[^\n]*told us to quit|permission denied \(publickey|terminal prompts disabled|invalid username or password|access denied|403 forbidden|returned error: (?:401|403)|authentication cancel|user cancel/iu.test(
      output,
    )
  ) {
    return plain(
      'authentication',
      'Authentication failed. For GitHub HTTPS, check the token and repository permissions in Preferences → Accounts. Other remotes use your Git credential helper or SSH key.',
    );
  }
  if (
    /could not resolve host|connection refused|connection timed out|failed to connect|network is unreachable|operation timed out|unable to access/iu.test(
      output,
    )
  ) {
    return plain(
      'network',
      'The remote host could not be reached. Check the remote URL and your connection, then retry.',
    );
  }
  if (/stale info|does not match any|remote ref is at but expected/iu.test(output)) {
    return plain(
      'lease',
      'The remote branch moved since it was last fetched, so the lease check refused the push. Fetch and review the new commits first.',
    );
  }
  if (/\[rejected\][\s\S]*non-fast-forward|fetch first|updates were rejected/iu.test(output)) {
    return {
      reason: 'not-fast-forward',
      message:
        'The remote branch has commits this branch does not. Fetch and integrate them, or push with a lease check.',
      canForceWithLease: kind === 'push',
    };
  }
  if (/\[remote rejected\]|pre-receive hook declined|protected branch/iu.test(output)) {
    return plain('rejected', 'The remote rejected the push. Its output is shown below.');
  }
  if (/no tracking information|has no upstream branch|no upstream configured/iu.test(output)) {
    return plain(
      'no-upstream',
      'This branch has no upstream branch yet. Push it with "Set upstream" to create one.',
    );
  }
  if (/not possible to fast-forward|diverging branches/iu.test(output)) {
    return plain(
      'not-fast-forward',
      'The upstream branch has diverged, so a fast-forward pull is not possible. Choose Merge or Rebase, then resolve any conflicts in Recovery.',
    );
  }
  if (
    /local changes to the following files would be overwritten|please commit your changes|cannot pull with rebase|unmerged files/iu.test(
      output,
    )
  ) {
    return plain('local-changes', 'Local changes would be overwritten. Commit or stash them first.');
  }
  if (
    /couldn't find remote ref|no such ref was fetched|does not appear to be a git repository|repository not found|remote ref does not exist|no such remote/iu.test(
      output,
    )
  ) {
    return plain(
      'not-found',
      'The remote or its branch no longer exists. Fetch with pruning, then choose another branch or update its tracking settings.',
    );
  }
  return plain('other', 'Git could not complete the operation. Its output is shown below.');
}

/**
 * Splits Git's stderr, which overwrites progress with carriage returns, into progress updates and the
 * lines worth keeping in a log. Intermediate percentages become progress; only completed phases stay.
 */
export class ProgressCollector {
  private buffer = '';

  constructor(
    private readonly onProgress: (progress: RepositoryOperationProgress) => void,
    private readonly onLine: (line: string) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r\n|\r|\n/u);
    this.buffer = parts.pop() ?? '';
    for (const part of parts) this.handle(part);
  }

  flush(): void {
    if (!this.buffer) return;
    const remainder = this.buffer;
    this.buffer = '';
    this.handle(remainder);
  }

  private handle(rawLine: string): void {
    const line = rawLine.trimEnd();
    if (!line) return;
    const progress = parseProgress(line);
    if (!progress) {
      this.onLine(redactUrlCredentials(line));
      return;
    }
    this.onProgress(progress);
    // A finished phase is worth keeping; the percentages leading to it are not.
    if (/done\.|100%/u.test(line)) this.onLine(redactUrlCredentials(line));
  }
}

const progressPattern = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/u;

export function parseProgress(line: string): RepositoryOperationProgress | null {
  const match = progressPattern.exec(line);
  if (!match?.[1] || match[2] === undefined) return null;
  const percent = Number(match[2]);
  return {
    phase: match[1].slice(0, 128),
    percent: Number.isSafeInteger(percent) && percent >= 0 && percent <= 100 ? percent : null,
  };
}

function displayCommand(args: readonly string[]): string {
  return redactUrlCredentials(['git', ...args].join(' ')).slice(0, 4_096);
}

/** Keeps Git output as bounded inert text with no escape sequences and no embedded credentials. */
export function displayOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
  const plain = redactUrlCredentials(combined)
    .replace(/\r/gu, '\n')
    // eslint-disable-next-line no-control-regex -- terminal escapes are stripped, not interpreted.
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/gu, '')
    // eslint-disable-next-line no-control-regex -- keep newlines and tabs, drop other control bytes.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
  return plain.length > outputDisplayLimit
    ? `${plain.slice(0, outputDisplayLimit)}\n… output truncated.`
    : plain;
}
