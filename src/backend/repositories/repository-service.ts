import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import type {
  GitInfo,
  RecentRepository,
  RepositoryHead,
  RepositorySummary,
} from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import {
  GitCancelledError,
  GitCommandError,
  GitExecutableError,
  GitOutputLimitError,
  GitRunner,
  GitSpawnError,
  GitTimeoutError,
} from '../git/runner';
import type { GitCommandResult, GitRunOptions, GitVersion } from '../git/runner';
import { RecentRepositoryStore, recentPathStatus } from './recent-store';

const repositoryReadTimeoutMs = 10_000;
const repositoryReadOutputLimit = 128 * 1024;

export interface GitRunnerLike {
  readonly executable: string;
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
  version(): Promise<GitVersion>;
}

export interface RepositoryServiceOptions {
  readonly storagePath: string;
  readonly runner?: GitRunnerLike;
  readonly clock?: () => Date;
  readonly maxRecentEntries?: number;
}

/** Owns canonical repository identities, sessions, and the local F01 repository workflow. */
export class RepositoryService {
  private readonly store: RecentRepositoryStore;
  private readonly runner: GitRunnerLike;
  private readonly clock: () => Date;
  private readonly sessions = new Map<number, Map<string, RepositorySummary>>();
  private gitInfoPromise: Promise<GitInfo> | undefined;

  constructor(options: RepositoryServiceOptions) {
    this.store = new RecentRepositoryStore({
      filePath: options.storagePath,
      maxEntries: options.maxRecentEntries ?? 20,
    });
    this.runner = options.runner ?? new GitRunner();
    this.clock = options.clock ?? (() => new Date());
  }

  async getGitInfo(): Promise<GitInfo> {
    this.gitInfoPromise ??= this.probeGit();
    return this.gitInfoPromise;
  }

  async open(ownerId: number, inputPath: string): Promise<RepositorySummary> {
    await this.requireGit();
    const directory = await this.canonicalDirectory(inputPath);
    const summary = await this.discover(directory);
    await this.remember(summary);
    this.addSession(ownerId, summary);
    return summary;
  }

  async initialize(ownerId: number, inputPath: string, bare: boolean): Promise<RepositorySummary> {
    await this.requireGit();
    const directory = await this.canonicalDirectory(inputPath);
    try {
      await this.runner.run(['init', '--quiet', ...(bare ? ['--bare'] : [])], {
        cwd: directory,
        timeoutMs: repositoryReadTimeoutMs,
        maxOutputBytes: repositoryReadOutputLimit,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not initialize the selected directory.');
    }
    const summary = await this.discover(directory);
    await this.remember(summary);
    this.addSession(ownerId, summary);
    return summary;
  }

  async listRecent(ownerId: number): Promise<RecentRepository[]> {
    const entries = await this.store.list();
    return Promise.all(
      entries.map(async (entry) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path,
        lastOpenedAt: entry.lastOpenedAt,
        status: await recentPathStatus(entry.path),
        open: this.sessions.get(ownerId)?.has(entry.id) ?? false,
      })),
    );
  }

  listOpen(ownerId: number): RepositorySummary[] {
    return [...(this.sessions.get(ownerId)?.values() ?? [])];
  }

  close(ownerId: number, id: string): void {
    const ownerSessions = this.sessions.get(ownerId);
    if (!ownerSessions?.delete(id)) {
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'That repository is not open in this window.');
    }
    if (ownerSessions.size === 0) this.sessions.delete(ownerId);
  }

  async removeRecent(id: string): Promise<void> {
    await this.store.remove(id);
  }

  disposeWindow(ownerId: number): void {
    this.sessions.delete(ownerId);
  }

  dispose(): void {
    this.sessions.clear();
  }

  private async probeGit(): Promise<GitInfo> {
    try {
      const version = await this.runner.version();
      return { status: 'available', version: version.version, executable: version.executable };
    } catch (error) {
      if (error instanceof GitExecutableError) {
        return { status: 'missing', version: null, executable: null };
      }
      return { status: 'error', version: null, executable: null };
    }
  }

  private async requireGit(): Promise<void> {
    const info = await this.getGitInfo();
    if (info.status !== 'available') {
      throw new ExpectedBackendError('GIT_UNAVAILABLE', 'Git is not available on this computer.');
    }
  }

  private async canonicalDirectory(inputPath: string): Promise<string> {
    if (!isAbsolute(inputPath) || inputPath.includes('\0')) {
      throw new ExpectedBackendError('INVALID_REQUEST', 'Choose an absolute directory path.');
    }
    let canonical: string;
    try {
      canonical = await realpath(inputPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ExpectedBackendError('PATH_NOT_FOUND', 'The selected directory no longer exists.');
      }
      throw new ExpectedBackendError('OPERATION_FAILED', 'The selected directory could not be accessed.');
    }
    try {
      const details = await stat(canonical);
      if (!details.isDirectory()) {
        throw new ExpectedBackendError('NOT_A_DIRECTORY', 'Choose a directory, not a file.');
      }
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError('OPERATION_FAILED', 'The selected directory could not be accessed.');
    }
    return canonical;
  }

  private async discover(directory: string): Promise<RepositorySummary> {
    const absoluteGitDir = await this.requiredPath(directory, ['rev-parse', '--absolute-git-dir']);
    const commonDirRaw = await this.requiredOutput(directory, ['rev-parse', '--git-common-dir']);
    const commonDir = await this.resolveGitPath(commonDirRaw, directory);
    const bare =
      (await this.requiredOutput(directory, ['rev-parse', '--is-bare-repository'])).trim() === 'true';
    const worktreePath = bare
      ? null
      : await this.resolveGitPath(
          await this.requiredOutput(directory, ['rev-parse', '--show-toplevel']),
          directory,
        );
    const head = await this.discoverHead(directory);
    const displayPath = worktreePath ?? commonDir;
    const id = this.repositoryId(worktreePath, commonDir);

    return {
      id,
      name: basename(displayPath) || displayPath,
      path: displayPath,
      worktreePath,
      gitDir: absoluteGitDir,
      commonDir,
      bare,
      head,
    };
  }

  private async discoverHead(directory: string): Promise<RepositoryHead> {
    const branch = await this.optionalOutput(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const commit = await this.optionalOutput(directory, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (branch && commit) return { state: 'branch', name: branch, commit };
    if (branch) return { state: 'unborn', name: branch, commit: null };
    if (commit) return { state: 'detached', name: null, commit };
    return { state: 'unknown', name: null, commit: null };
  }

  private async requiredPath(directory: string, args: readonly string[]): Promise<string> {
    return this.resolveGitPath(await this.requiredOutput(directory, args), directory);
  }

  private async requiredOutput(directory: string, args: readonly string[]): Promise<string> {
    try {
      const result = await this.runRead(args, directory);
      return removeFinalLineEnding(result.stdout);
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new ExpectedBackendError('NOT_A_REPOSITORY', 'The selected directory is not a Git repository.');
      }
      throw this.mapGitFailure(error, 'Git could not inspect the selected directory.');
    }
  }

  private async optionalOutput(directory: string, args: readonly string[]): Promise<string | null> {
    try {
      const result = await this.runRead(args, directory);
      const output = removeFinalLineEnding(result.stdout);
      return output || null;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw this.mapGitFailure(error, 'Git could not inspect the selected directory.');
    }
  }

  private async runRead(args: readonly string[], directory: string): Promise<GitCommandResult> {
    return this.runner.run(args, {
      cwd: directory,
      timeoutMs: repositoryReadTimeoutMs,
      maxOutputBytes: repositoryReadOutputLimit,
    });
  }

  private async resolveGitPath(rawPath: string, directory: string): Promise<string> {
    const candidate = isAbsolute(rawPath) ? rawPath : resolve(directory, rawPath);
    try {
      return await realpath(candidate);
    } catch {
      throw new ExpectedBackendError('OPERATION_FAILED', 'Git returned an inaccessible repository path.');
    }
  }

  private mapGitFailure(error: unknown, fallback: string): ExpectedBackendError {
    if (error instanceof GitExecutableError) {
      return new ExpectedBackendError('GIT_UNAVAILABLE', 'Git is not available on this computer.');
    }
    if (error instanceof GitCancelledError) {
      return new ExpectedBackendError('OPERATION_FAILED', 'The Git operation was cancelled.');
    }
    if (error instanceof GitTimeoutError) {
      return new ExpectedBackendError('OPERATION_FAILED', 'Git took too long to respond.');
    }
    if (error instanceof GitOutputLimitError) {
      return new ExpectedBackendError(
        'OPERATION_FAILED',
        'Git returned more output than the application can read.',
      );
    }
    if (error instanceof GitSpawnError) {
      return new ExpectedBackendError('OPERATION_FAILED', fallback);
    }
    if (error instanceof GitCommandError) {
      return new ExpectedBackendError('OPERATION_FAILED', fallback);
    }
    return new ExpectedBackendError('OPERATION_FAILED', fallback);
  }

  private async remember(summary: RepositorySummary): Promise<void> {
    await this.store.add({
      id: summary.id,
      name: summary.name,
      path: summary.path,
      lastOpenedAt: this.clock().toISOString(),
    });
  }

  private addSession(ownerId: number, summary: RepositorySummary): void {
    const ownerSessions = this.sessions.get(ownerId) ?? new Map<string, RepositorySummary>();
    ownerSessions.set(summary.id, summary);
    this.sessions.set(ownerId, ownerSessions);
  }

  private repositoryId(worktreePath: string | null, commonDir: string): string {
    const identity = `${worktreePath ?? ''}\0${commonDir}`;
    return `repo-${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
  }
}

function removeFinalLineEnding(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}
