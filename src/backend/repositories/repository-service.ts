import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import type {
  GitInfo,
  RecentRepository,
  RepositoryHead,
  RepositoryManagerFolder,
  RepositoryManagerRepository,
  RepositoryManagerSnapshot,
  RepositoryManagerSourceDirectory,
  RepositoryManagerWarning,
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
import { RepositoryManagerStore } from './repository-manager-store';
import type { SourceDirectoryRecord } from './repository-manager-store';
import { scanSourceDirectory } from './source-scanner';
import type { SourceScanOptions, SourceScanResult } from './source-scanner';

const repositoryReadTimeoutMs = 10_000;
const repositoryReadOutputLimit = 128 * 1024;
const managerMaxRepositories = 5_000;
const managerMaxFolders = 20_000;

export interface GitRunnerLike {
  readonly executable: string;
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
  version(): Promise<GitVersion>;
}

export interface RepositoryServiceOptions {
  readonly storagePath: string;
  readonly managerStoragePath?: string;
  readonly runner?: GitRunnerLike;
  readonly clock?: () => Date;
  readonly maxRecentEntries?: number;
  readonly maxSourceDirectories?: number;
  readonly sourceScanOptions?: SourceScanOptions;
}

/** Owns canonical repository identities, sessions, and local repository-manager workflows. */
export class RepositoryService {
  private readonly store: RecentRepositoryStore;
  private readonly managerStore: RepositoryManagerStore;
  private readonly runner: GitRunnerLike;
  private readonly clock: () => Date;
  private readonly sourceScanOptions: SourceScanOptions;
  private readonly sessions = new Map<number, Map<string, RepositorySummary>>();
  private gitInfoPromise: Promise<GitInfo> | undefined;

  constructor(options: RepositoryServiceOptions) {
    this.store = new RecentRepositoryStore({
      filePath: options.storagePath,
      maxEntries: options.maxRecentEntries ?? 20,
    });
    this.managerStore = new RepositoryManagerStore({
      filePath: options.managerStoragePath ?? `${options.storagePath}.manager`,
      maxSourceDirectories: options.maxSourceDirectories ?? 10,
    });
    this.runner = options.runner ?? new GitRunner();
    this.clock = options.clock ?? (() => new Date());
    this.sourceScanOptions = options.sourceScanOptions ?? {};
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

  async listManager(ownerId: number): Promise<RepositoryManagerSnapshot> {
    const sourceDirectories = await this.managerStore.list();
    const openRepositories = this.listOpen(ownerId);
    const openByPath = new Map(
      openRepositories.map((repository) => [this.pathKey(repository.path), repository.id]),
    );
    const snapshot: ManagerBuildState = {
      sourceDirectories: [],
      folders: [],
      repositories: [],
      warnings: [],
      seenRepositories: new Set<string>(),
      folderIds: new Map<string, string>(),
      openByPath,
    };

    for (const sourceDirectory of sourceDirectories) {
      const scan = await this.scanSource(sourceDirectory);
      this.addManagerSource(snapshot, sourceDirectory, scan);
    }

    return {
      sourceDirectories: snapshot.sourceDirectories,
      folders: snapshot.folders,
      repositories: snapshot.repositories,
      warnings: snapshot.warnings,
    };
  }

  async addSourceDirectory(ownerId: number, inputPath: string): Promise<RepositoryManagerSnapshot> {
    const directory = await this.canonicalDirectory(inputPath);
    await this.managerStore.add({ id: this.sourceDirectoryId(directory), path: directory });
    return this.listManager(ownerId);
  }

  async removeSourceDirectory(id: string): Promise<void> {
    const removed = await this.managerStore.remove(id);
    if (!removed) {
      throw new ExpectedBackendError(
        'SOURCE_DIRECTORY_NOT_FOUND',
        'That source directory is no longer configured.',
      );
    }
  }

  async rescanSourceDirectory(ownerId: number, id: string): Promise<RepositoryManagerSnapshot> {
    const sourceDirectories = await this.managerStore.list();
    if (!sourceDirectories.some((sourceDirectory) => sourceDirectory.id === id)) {
      throw new ExpectedBackendError(
        'SOURCE_DIRECTORY_NOT_FOUND',
        'That source directory is no longer configured.',
      );
    }
    return this.listManager(ownerId);
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

  private async scanSource(
    sourceDirectory: SourceDirectoryRecord,
  ): Promise<SourceScanResult & { readonly status: RepositoryManagerSourceDirectory['status'] }> {
    const status = await this.sourceDirectoryStatus(sourceDirectory.path);
    if (status !== 'available') {
      return {
        repositories: [],
        warnings: [],
        scannedEntries: 0,
        truncated: false,
        rootReadable: false,
        status,
      };
    }

    const scan = await scanSourceDirectory(sourceDirectory.path, this.sourceScanOptions);
    return { ...scan, status: scan.rootReadable ? 'available' : 'unreadable' };
  }

  private addManagerSource(
    state: ManagerBuildState,
    sourceDirectory: SourceDirectoryRecord,
    scan: SourceScanResult & { readonly status: RepositoryManagerSourceDirectory['status'] },
  ): void {
    const source: RepositoryManagerSourceDirectory = {
      id: sourceDirectory.id,
      name: basename(sourceDirectory.path) || sourceDirectory.path,
      path: sourceDirectory.path,
      status: scan.status,
      repositoryCount: 0,
      lastScannedAt: this.clock().toISOString(),
      truncated: scan.truncated,
    };
    state.sourceDirectories.push(source);

    for (const warning of scan.warnings) this.addManagerWarning(state, warning);

    for (const repository of scan.repositories) {
      const repositoryKey = this.pathKey(repository.path);
      if (state.seenRepositories.has(repositoryKey)) continue;
      if (state.repositories.length >= managerMaxRepositories) {
        state.sourceDirectories[state.sourceDirectories.length - 1]!.truncated = true;
        this.addManagerWarning(state, {
          code: 'scan-limit',
          path: sourceDirectory.path,
          message: 'The repository manager reached its total repository limit.',
        });
        break;
      }

      const folderId = this.ensureManagerFolders(state, sourceDirectory.id, repository.relativePath);
      if (folderId === 'limit') {
        state.sourceDirectories[state.sourceDirectories.length - 1]!.truncated = true;
        this.addManagerWarning(state, {
          code: 'scan-limit',
          path: repository.path,
          message: 'The repository manager reached its folder limit.',
        });
        break;
      }

      state.seenRepositories.add(repositoryKey);
      state.repositories.push({
        id: this.managerRepositoryId(repository.path),
        sourceDirectoryId: sourceDirectory.id,
        folderId,
        name: repository.name,
        path: repository.path,
        relativePath: repository.relativePath,
        kind: repository.kind,
        sessionId: state.openByPath.get(repositoryKey) ?? null,
      });
      state.sourceDirectories[state.sourceDirectories.length - 1]!.repositoryCount += 1;
    }
  }

  private ensureManagerFolders(
    state: ManagerBuildState,
    sourceDirectoryId: string,
    relativeRepositoryPath: string,
  ): string | null | 'limit' {
    const parts = relativeRepositoryPath ? relativeRepositoryPath.split('/') : [];
    parts.pop();
    let parentId: string | null = null;
    let relativeFolderPath = '';
    for (const part of parts) {
      relativeFolderPath = relativeFolderPath ? `${relativeFolderPath}/${part}` : part;
      const key = `${sourceDirectoryId}\0${relativeFolderPath}`;
      const existingId = state.folderIds.get(key);
      if (existingId) {
        parentId = existingId;
        continue;
      }
      if (state.folders.length >= managerMaxFolders) return 'limit';
      const id = this.managerFolderId(sourceDirectoryId, relativeFolderPath);
      state.folderIds.set(key, id);
      state.folders.push({
        id,
        sourceDirectoryId,
        name: part,
        relativePath: relativeFolderPath,
        parentId,
      });
      parentId = id;
    }
    return parentId;
  }

  private addManagerWarning(state: ManagerBuildState, warning: RepositoryManagerWarning): void {
    if (state.warnings.length < 100) state.warnings.push(warning);
  }

  private async sourceDirectoryStatus(
    directory: string,
  ): Promise<RepositoryManagerSourceDirectory['status']> {
    try {
      const details = await stat(directory);
      return details.isDirectory() ? 'available' : 'not-directory';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' ? 'missing' : 'unreadable';
    }
  }

  private pathKey(path: string): string {
    return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path;
  }

  private sourceDirectoryId(path: string): string {
    return `source-${createHash('sha256').update(this.pathKey(path), 'utf8').digest('hex')}`;
  }

  private managerFolderId(sourceDirectoryId: string, relativePath: string): string {
    return `folder-${createHash('sha256').update(`${sourceDirectoryId}\0${relativePath}`, 'utf8').digest('hex')}`;
  }

  private managerRepositoryId(path: string): string {
    return `manager-repo-${createHash('sha256').update(this.pathKey(path), 'utf8').digest('hex')}`;
  }
}

interface ManagerBuildState {
  readonly sourceDirectories: RepositoryManagerSourceDirectory[];
  readonly folders: RepositoryManagerFolder[];
  readonly repositories: RepositoryManagerRepository[];
  readonly warnings: RepositoryManagerWarning[];
  readonly seenRepositories: Set<string>;
  readonly folderIds: Map<string, string>;
  readonly openByPath: ReadonlyMap<string, string>;
}

function removeFinalLineEnding(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}
