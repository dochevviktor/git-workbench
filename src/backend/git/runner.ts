import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { resolveGitExecutable } from './executable';

const defaultOutputLimit = 2 * 1024 * 1024;
const defaultTimeout = 30_000;

export interface GitRunOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
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

function redactArgument(value: string): string {
  // Keep the command diagnostic useful while ensuring URL credentials cannot reach logs.
  return value.replace(/(\b[a-z][a-z\d+.-]*:\/\/)([^\s/@]+)@/giu, '$1<redacted>@');
}

function displayCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map((value) => JSON.stringify(redactArgument(value))).join(' ');
}

function controlledEnvironment(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
  environment.GIT_PAGER = 'cat';
  environment.GIT_EDITOR = ':';
  environment.LC_ALL = 'C';
  return environment;
}

function appendOutput(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  limit: number,
): Buffer<ArrayBufferLike> {
  if (current.byteLength + chunk.byteLength > limit) throw new Error('output-limit');
  return Buffer.concat([current, chunk]);
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
    this.logger?.({ command: displayCommand(executable, args), cwd: redactArgument(options.cwd) });

    return new Promise<GitCommandResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, [...args], {
          cwd: options.cwd,
          env: controlledEnvironment(options.env),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        } satisfies SpawnOptions) as ChildProcessWithoutNullStreams;
      } catch {
        reject(new GitSpawnError());
        return;
      }

      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let termination: Error | undefined;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutTimer = setTimeout(() => terminate(new GitTimeoutError()), timeoutMs);

      const terminate = (reason: Error) => {
        if (termination) return;
        termination = reason;
        try {
          child.kill('SIGTERM');
        } catch {
          // The process may have exited between the event and kill(). The close event settles it.
        }
        forceKillTimer = setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill('SIGKILL');
            } catch {
              // The close event remains the source of truth for process lifetime.
            }
          }
        }, 1_000);
      };

      const onAbort = () => terminate(new GitCancelledError());
      options.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk: Buffer | string) => {
        if (termination) return;
        try {
          stdout = appendOutput(stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), limit);
        } catch {
          terminate(new GitOutputLimitError('stdout'));
        }
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        if (termination) return;
        try {
          stderr = appendOutput(stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), limit);
        } catch {
          terminate(new GitOutputLimitError('stderr'));
        }
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') terminate(new GitExecutableError(executable));
        else terminate(new GitSpawnError());
      });
      child.once('close', (exitCode, signal) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        options.signal?.removeEventListener('abort', onAbort);
        const output = { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
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
