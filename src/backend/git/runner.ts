import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { resolveGitExecutable } from './executable';
import { applyAuthenticationPolicy } from './authentication-policy';
import type { GitAuthenticationPolicy } from './authentication-policy';

const defaultOutputLimit = 2 * 1024 * 1024;
const defaultTimeout = 30_000;

export interface GitRunOptions {
  /** Backend-only binary blob reads; limits still count raw bytes. */
  readonly stdoutEncoding?: 'utf8' | 'base64';
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal | undefined;
  readonly env?: NodeJS.ProcessEnv;
  /** Only explicit user network operations may invoke configured native authentication prompts. */
  readonly authentication?: GitAuthenticationPolicy;
  /** Optional patch data supplied by a backend Git service, never by the renderer. */
  readonly stdin?: string | Buffer;
  /**
   * Receives standard error as it arrives, for the progress Git reports there. The chunk is raw Git
   * output: a caller that shows it must redact and bound it first.
   */
  readonly onStderr?: (chunk: string) => void;
}

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
}

export interface GitVersion {
  readonly executable: string;
  readonly version: string;
}

export interface GitLogEntry {
  readonly command: string;
  readonly cwd: string;
}

export type GitLogger = (entry: GitLogEntry) => void;

export class GitExecutableError extends Error {
  constructor(readonly executable: string) {
    super('Git executable is not available.');
    this.name = 'GitExecutableError';
  }
}

export class GitSpawnError extends Error {
  constructor() {
    super('Git could not be started.');
    this.name = 'GitSpawnError';
  }
}

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super('Git returned a non-zero exit status.');
    this.name = 'GitCommandError';
  }
}

export class GitCancelledError extends Error {
  constructor() {
    super('The Git operation was cancelled.');
    this.name = 'GitCancelledError';
  }
}

export class GitTimeoutError extends Error {
  constructor() {
    super('The Git operation timed out.');
    this.name = 'GitTimeoutError';
  }
}

export class GitOutputLimitError extends Error {
  constructor(readonly stream: 'stdout' | 'stderr') {
    super(`Git ${stream} exceeded the output limit.`);
    this.name = 'GitOutputLimitError';
  }
}

/** Keeps a command diagnostic useful while ensuring URL credentials cannot reach logs or the UI. */
export function redactUrlCredentials(value: string): string {
  return value
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)([^\s/]+)@/giu, '$1<redacted>@')
    .replace(/([?&](?:access_token|private_token|token|password|api_key)=)[^&#\s]+/giu, '$1<redacted>');
}

function redactArgument(value: string): string {
  return redactUrlCredentials(value);
}

function displayCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map((value) => JSON.stringify(redactArgument(value))).join(' ');
}

function controlledEnvironment(
  overrides?: NodeJS.ProcessEnv,
  authentication: GitAuthenticationPolicy = 'silent',
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  // These variables can silently redirect a repository operation away from the selected path.
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_OBJECT_DIRECTORY_RELATIVE',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
  ]) {
    delete environment[key];
  }
  environment.GIT_TERMINAL_PROMPT = '0';
  // Every file capability names literal repository paths, never user-supplied pathspecs.
  delete environment.GIT_GLOB_PATHSPECS;
  delete environment.GIT_NOGLOB_PATHSPECS;
  delete environment.GIT_ICASE_PATHSPECS;
  delete environment.GIT_LITERAL_PATHSPECS;
  environment.GIT_PAGER = 'cat';
  environment.GIT_EDITOR = ':';
  environment.LC_ALL = 'C';
  return applyAuthenticationPolicy(environment, authentication);
}

/**
 * Stops the child and, on POSIX, everything it started. `git fetch` runs a transport helper and may
 * run ssh; killing only the direct child would leave those connected. Windows has no equivalent
 * signal, so the direct child is terminated there and its children exit with the broken pipe.
 */
function terminateProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && typeof child.pid === 'number') {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // The group may already be gone, or the child never became a group leader. Fall through.
  }
  try {
    child.kill(signal);
  } catch {
    // The process may have exited between the event and kill(). The close event settles it.
  }
}

export interface GitRunnerOptions {
  readonly executable?: string;
  readonly maxOutputBytes?: number;
  readonly defaultTimeoutMs?: number;
  readonly logger?: GitLogger;
}

/** A small, argument-array-only process boundary for Git. */
export class GitRunner {
  private readonly configuredExecutable: string;
  private readonly maxOutputBytes: number;
  private readonly defaultTimeoutMs: number;
  private readonly logger: GitLogger | undefined;
  private resolvedExecutable: string | null | undefined;

  constructor(options: GitRunnerOptions = {}) {
    this.configuredExecutable = options.executable ?? process.env.GIT_EXECUTABLE ?? 'git';
    this.maxOutputBytes = options.maxOutputBytes ?? defaultOutputLimit;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? defaultTimeout;
    this.logger = options.logger;
  }

  get executable(): string {
    return this.resolvedExecutable ?? this.configuredExecutable;
  }

  async version(): Promise<GitVersion> {
    const result = await this.run(['--version'], { cwd: tmpdir(), timeoutMs: 5_000 });
    const line = result.stdout.replace(/\r?\n$/u, '');
    const match = /^git version (\S+)$/u.exec(line);
    if (!match?.[1]) throw new GitSpawnError();
    return { executable: this.executable, version: match[1] };
  }

  async run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult> {
    if (options.signal?.aborted) throw new GitCancelledError();
    const executable = await this.resolveExecutable();
    if (!executable) throw new GitExecutableError(this.configuredExecutable);
    const limit = options.maxOutputBytes ?? this.maxOutputBytes;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    let commandIndex = 0;
    while (args[commandIndex]?.startsWith('-')) commandIndex += args[commandIndex] === '-c' ? 2 : 1;
    // Apply the policy only to file-oriented commands. Exporting it to `stash` changes the
    // interpretation of pathspecs Git constructs internally when cleaning saved untracked files.
    const literal = ['add', 'reset', 'rm', 'diff', 'diff-tree', 'diff-index', 'ls-tree'].includes(
      args[commandIndex] ?? '',
    );
    const commandArgs = literal ? ['--literal-pathspecs', ...args] : [...args];
    this.logger?.({ command: displayCommand(executable, commandArgs), cwd: redactArgument(options.cwd) });

    return new Promise<GitCommandResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, commandArgs, {
          cwd: options.cwd,
          env: controlledEnvironment(options.env, options.authentication),
          shell: false,
          windowsHide: true,
          // A POSIX child leads its own process group, so cancelling a fetch also stops the transport
          // helper and ssh it started. Windows has no process groups here; see terminateProcess.
          detached: process.platform !== 'win32',
          stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        } satisfies SpawnOptions) as ChildProcessWithoutNullStreams;
      } catch {
        reject(new GitSpawnError());
        return;
      }

      // Keep bounded chunks and join once. Repeated Buffer.concat copies the entire prefix for every
      // chunk, making a bounded multi-megabyte history read allocate hundreds of megabytes transiently.
      const stdout: Buffer<ArrayBufferLike>[] = [];
      const stderr: Buffer<ArrayBufferLike>[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let termination: Error | undefined;
      let closed = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutTimer = setTimeout(() => terminate(new GitTimeoutError()), timeoutMs);

      const terminate = (reason: Error) => {
        if (termination) return;
        termination = reason;
        terminateProcess(child, 'SIGTERM');
        forceKillTimer = setTimeout(() => {
          // `killed` only says a signal was sent; it does not mean the process group exited.
          if (!closed) terminateProcess(child, 'SIGKILL');
        }, 1_000);
      };

      const onAbort = () => terminate(new GitCancelledError());
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.stdin !== undefined && child.stdin) {
        child.stdin.on('error', () => terminate(new GitSpawnError()));
        child.stdin.end(options.stdin);
      }
      child.stdout.on('data', (chunk: Buffer | string) => {
        if (termination) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (stdoutBytes + buffer.byteLength > limit) {
          terminate(new GitOutputLimitError('stdout'));
        } else {
          stdout.push(buffer);
          stdoutBytes += buffer.byteLength;
        }
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        if (termination) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        options.onStderr?.(buffer.toString('utf8'));
        if (stderrBytes + buffer.byteLength > limit) {
          terminate(new GitOutputLimitError('stderr'));
        } else {
          stderr.push(buffer);
          stderrBytes += buffer.byteLength;
        }
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') terminate(new GitExecutableError(executable));
        else terminate(new GitSpawnError());
      });
      child.once('close', (exitCode, signal) => {
        closed = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        options.signal?.removeEventListener('abort', onAbort);
        const output = {
          stdout: Buffer.concat(stdout, stdoutBytes).toString(options.stdoutEncoding ?? 'utf8'),
          stderr: Buffer.concat(stderr, stderrBytes).toString('utf8'),
        };
        if (termination) {
          reject(termination);
        } else if (exitCode === 0) {
          resolve({ ...output, exitCode, signal });
        } else {
          reject(new GitCommandError(args, exitCode, signal, output.stdout, output.stderr));
        }
      });
    });
  }

  private async resolveExecutable(): Promise<string | null> {
    if (this.resolvedExecutable !== undefined) return this.resolvedExecutable;
    this.resolvedExecutable = await resolveGitExecutable(this.configuredExecutable);
    return this.resolvedExecutable;
  }
}
