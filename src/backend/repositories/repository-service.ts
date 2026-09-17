import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import type {
  GitInfo,
  RecentRepository,
  RepositoryHead,
  RepositoryHistoryPage,
  RepositoryHistoryFilter,
  RepositoryLocation,
  RepositoryManagerFolder,
  RepositoryManagerRepository,
  RepositoryManagerSnapshot,
  RepositoryManagerSourceDirectory,
  RepositoryManagerWarning,
  RepositoryTabOrientation,
  RepositoryTabPreferences,
  RepositorySummary,
  RepositoryWorkingTree,
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
import { RepositoryTabStore } from './repository-tab-store';
import { scanSourceDirectory } from './source-scanner';
import type { SourceScanOptions, SourceScanResult } from './source-scanner';
import { readRepositoryHistory } from './history-service';

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
  readonly workspaceStoragePath?: string;
  readonly runner?: GitRunnerLike;
  readonly clock?: () => Date;
  readonly maxRecentEntries?: number;
  readonly maxSourceDirectories?: number;
  readonly maxOpenTabs?: number;
  readonly sourceScanOptions?: SourceScanOptions;
}

/** Owns canonical repository identities, sessions, and local repository-manager workflows. */
export class RepositoryService {
  private readonly store: RecentRepositoryStore;
  private readonly managerStore: RepositoryManagerStore;
  private readonly tabStore: RepositoryTabStore;
  private readonly runner: GitRunnerLike;
  private readonly clock: () => Date;
  private readonly sourceScanOptions: SourceScanOptions;
  private readonly maxOpenTabs: number;
  private readonly sessions = new Map<number, Map<string, RepositorySummary>>();
  private readonly restorePromises = new Map<number, Promise<void>>();
  private readonly ownerGenerations = new Map<number, number>();
  private readonly managerRepositoryPaths = new Map<number, ReadonlyMap<string, string>>();
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
    this.maxOpenTabs = Math.max(1, Math.min(options.maxOpenTabs ?? 20, 20));
    this.tabStore = new RepositoryTabStore({
      filePath: options.workspaceStoragePath ?? `${options.storagePath}.workspace`,
      maxTabs: this.maxOpenTabs,
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
    await this.ensureSessions(ownerId);
    const directory = await this.canonicalDirectory(inputPath);
    const summary = await this.discover(directory);
    if (
      !this.sessions.get(ownerId)?.has(summary.id) &&
      this.listOpenCached(ownerId).length >= this.maxOpenTabs
    ) {
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Close a repository tab before opening another one.',
      );
    }
    await this.remember(summary);
    await this.tabStore.addTab({ id: summary.id, path: summary.path });
    await this.tabStore.setActiveRepositoryId(summary.id);
    this.addSession(ownerId, summary);
    return summary;
  }

  async initialize(ownerId: number, inputPath: string, bare: boolean): Promise<RepositorySummary> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
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
    if (
      !this.sessions.get(ownerId)?.has(summary.id) &&
      this.listOpenCached(ownerId).length >= this.maxOpenTabs
    ) {
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Close a repository tab before opening another one.',
      );
    }
    await this.remember(summary);
    await this.tabStore.addTab({ id: summary.id, path: summary.path });
    await this.tabStore.setActiveRepositoryId(summary.id);
    this.addSession(ownerId, summary);
    return summary;
  }

  async listRecent(ownerId: number): Promise<RecentRepository[]> {
    await this.ensureSessions(ownerId);
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

  async listOpen(ownerId: number): Promise<RepositorySummary[]> {
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    if (!ownerSessions) return [];

    const current = [...ownerSessions.values()];
    const refreshed = await Promise.all(current.map((summary) => this.refreshSummary(summary)));
    for (const summary of refreshed) {
      if (ownerSessions.get(summary.id)?.path === summary.path) ownerSessions.set(summary.id, summary);
    }
    return [...ownerSessions.values()];
  }

  async close(ownerId: number, id: string): Promise<void> {
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    if (!ownerSessions?.has(id)) {
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'That repository is not open in this window.');
    }

    const preferences = await this.tabStore.getPreferences();
    await this.tabStore.removeTab(id);
    if (preferences.activeRepositoryId === id) {
      const nextActiveId = [...ownerSessions.keys()].find((candidate) => candidate !== id) ?? null;
      await this.tabStore.setActiveRepositoryId(nextActiveId);
    }
    ownerSessions.delete(id);
  }

  async getTabPreferences(ownerId: number): Promise<RepositoryTabPreferences> {
    await this.ensureSessions(ownerId);
    return this.tabStore.getPreferences();
  }

  async setTabOrientation(tabOrientation: RepositoryTabOrientation): Promise<RepositoryTabPreferences> {
    await this.tabStore.setTabOrientation(tabOrientation);
    return this.tabStore.getPreferences();
  }

  async selectTab(ownerId: number, id: string): Promise<RepositoryTabPreferences> {
    await this.ensureSessions(ownerId);
    if (!this.sessions.get(ownerId)?.has(id)) {
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository tab is not open in this window.',
      );
    }
    await this.tabStore.setActiveRepositoryId(id);
    return this.tabStore.getPreferences();
  }

  async getHistory(
    ownerId: number,
    id: string,
    offset: number,
    limit: number,
    filter?: RepositoryHistoryFilter,
  ): Promise<RepositoryHistoryPage> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    const cached = ownerSessions?.get(id);
    if (!cached) {
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository tab is not open in this window.',
      );
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      throw new ExpectedBackendError('INVALID_REQUEST', 'The history offset is not valid.');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ExpectedBackendError('INVALID_REQUEST', 'The history page size is not valid.');
    }

    let summary: RepositorySummary;
    try {
      summary = await this.discover(cached.path);
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not refresh the selected repository.');
    }
    if (summary.id !== id) {
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository is no longer open in this window.',
      );
    }
    ownerSessions?.set(id, summary);

    try {
      return await readRepositoryHistory(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        head: summary.head,
        offset,
        limit,
        filter,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the selected repository history.');
    }
  }

  async removeRecent(id: string): Promise<void> {
    await this.store.remove(id);
  }

  async listManager(ownerId: number): Promise<RepositoryManagerSnapshot> {
    await this.ensureSessions(ownerId);
    const sourceDirectories = await this.managerStore.list();
    const openRepositories = this.listOpenCached(ownerId);
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
    this.managerRepositoryPaths.set(
      ownerId,
      new Map(snapshot.repositories.map((repository) => [repository.id, repository.path])),
    );

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

  /**
   * Resolves a location the backend previously issued to this window. The path is never supplied by
   * the renderer, and it must still be an existing directory.
   */
  async resolveLocation(ownerId: number, location: RepositoryLocation): Promise<string> {
    await this.ensureSessions(ownerId);
    let path: string | undefined;
    switch (location.kind) {
      case 'open':
        path = this.sessions.get(ownerId)?.get(location.id)?.path;
        if (!path) {
          throw new ExpectedBackendError(
            'REPOSITORY_NOT_OPEN',
            'That repository is not open in this window.',
          );
        }
        break;
      case 'recent':
        path = (await this.store.list()).find((entry) => entry.id === location.id)?.path;
        break;
      case 'manager-repository':
        path = this.managerRepositoryPaths.get(ownerId)?.get(location.id);
        break;
      case 'source-directory':
        path = (await this.managerStore.list()).find((source) => source.id === location.id)?.path;
        if (!path) {
          throw new ExpectedBackendError(
            'SOURCE_DIRECTORY_NOT_FOUND',
            'That source directory is no longer configured.',
          );
        }
        break;
    }
    if (!path) {
      throw new ExpectedBackendError('PATH_NOT_FOUND', 'That repository is no longer listed.');
    }
    try {
      if (!(await stat(path)).isDirectory()) {
        throw new ExpectedBackendError('NOT_A_DIRECTORY', 'That location is no longer a directory.');
      }
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError('PATH_NOT_FOUND', 'That directory no longer exists.');
    }
    return path;
  }

  disposeWindow(ownerId: number): void {
    this.ownerGenerations.set(ownerId, (this.ownerGenerations.get(ownerId) ?? 0) + 1);
    this.restorePromises.delete(ownerId);
    this.sessions.delete(ownerId);
    this.managerRepositoryPaths.delete(ownerId);
  }

  dispose(): void {
    this.ownerGenerations.clear();
    this.restorePromises.clear();
    this.sessions.clear();
    this.managerRepositoryPaths.clear();
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
    const workingTree = await this.inspectWorkingTree(bare ? null : worktreePath);
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
      workingTree,
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

  private async refreshSummary(summary: RepositorySummary): Promise<RepositorySummary> {
    return {
      ...summary,
      workingTree: await this.inspectWorkingTree(summary.worktreePath),
    };
  }

  private async inspectWorkingTree(worktreePath: string | null): Promise<RepositoryWorkingTree> {
    if (!worktreePath) return { state: 'unavailable', changedFileCount: null };

    try {
      const result = await this.runRead(
        [
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.untrackedCache=false',
          'status',
          '--porcelain=v2',
          '--untracked-files=normal',
          '-z',
          '--',
        ],
        worktreePath,
      );
      const changedFileCount = statusEntryCount(result.stdout);
      return {
        state: changedFileCount === 0 ? 'clean' : 'dirty',
        changedFileCount,
      };
    } catch {
      // A status failure may mean the worktree was moved, Git ownership is no longer trusted,
      // or a configured status helper failed. Keep the tab visible without guessing that it is clean.
      return { state: 'unknown', changedFileCount: null };
    }
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

  private listOpenCached(ownerId: number): RepositorySummary[] {
    return [...(this.sessions.get(ownerId)?.values() ?? [])];
  }

  private async ensureSessions(ownerId: number): Promise<void> {
    if (this.sessions.has(ownerId)) return;
    const existing = this.restorePromises.get(ownerId);
    if (existing) {
      await existing;
      return;
    }

    const generation = (this.ownerGenerations.get(ownerId) ?? 0) + 1;
    this.ownerGenerations.set(ownerId, generation);
    const restore = this.restoreSessions(ownerId, generation);
    this.restorePromises.set(ownerId, restore);
    try {
      await restore;
    } finally {
      if (this.restorePromises.get(ownerId) === restore) this.restorePromises.delete(ownerId);
    }
  }

  private async restoreSessions(ownerId: number, generation: number): Promise<void> {
    const records = await this.tabStore.listTabs();
    const restored = new Map<string, RepositorySummary>();
    for (const record of records) {
      if (restored.size >= this.maxOpenTabs) break;
      try {
        const summary = await this.discover(record.path);
        restored.set(summary.id, summary);
      } catch {
        // Keep the tab record persisted so the path remains recoverable through Recent Repositories.
      }
    }
    if (this.ownerGenerations.get(ownerId) === generation) this.sessions.set(ownerId, restored);
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

function statusEntryCount(output: string): number {
  const records = output.split('\0').filter((record) => record.length > 0);
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    count += 1;
    // Porcelain v2 rename/copy records carry the original path as a second NUL-delimited field.
    if (records[index]?.startsWith('2 ')) index += 1;
  }
  return count;
}
