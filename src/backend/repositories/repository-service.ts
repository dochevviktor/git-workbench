import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PatchPreviews, validatePatch } from './patch-service';
import type { RepositoryPatchPreview, RepositoryPatchApplyRequest } from '../../common/ipc/contracts';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DirectoryWatcher } from './directory-watcher';
import { ReadCoordinator } from '../git/read-coordinator';
import { RepositoryTrustStore } from '../git/trust-store';
import { RepositoryGitRunner } from '../git/repository-runner';
import { gitCapabilities, minimumGitVersion } from '../git/capabilities';
import type {
  RepositoryManagerAction,
  RepositoryManagerScan,
  RepositoryManagerLocation,
  RepositoryManagerOverview,
  RepositoryInvalidation,
  WorkspaceRecovery,
  RecoverRepositoryTab,
  RepositorySigningSettingsRequest,
  RepositoryVerifySignatureRequest,
  GitInfo,
  RepositoryCloneRequest,
  RepositoryConnectionRequest,
  RecentRepository,
  RepositoryAmendChanges,
  RepositoryCommitChanges,
  RepositoryCommitContext,
  RepositoryCommitRequest,
  RepositoryCommitResult,
  RepositoryConflictRequest,
  RepositoryConflictState,
  RepositoryDiff,
  RepositoryDiffOptions,
  RepositoryDiffCancel,
  RepositoryDiscardPreview,
  RepositoryDiscardPreviewRequest,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
  RepositoryHead,
  RepositoryHistoryPage,
  RepositoryHistoryFilter,
  RepositoryHistoryAnchor,
  RepositoryHistoryMode,
  RepositoryHistoryOperationAction,
  RepositoryHistoryOperationPreview,
  RepositoryHistoryOperationPreviewRequest,
  RepositoryInteractiveRebasePlan,
  RepositoryInteractiveRebasePlanRequest,
  RepositoryInteractiveRebaseRequest,
  RepositoryLocation,
  RepositoryManagerFolder,
  RepositoryManagerRepository,
  RepositoryManagerSnapshot,
  RepositoryManagerSourceDirectory,
  RepositoryManagerWarning,
  RepositoryNetworkRequestEnvelope,
  RepositoryOperation,
  RepositoryOperationSource,
  RepositoryLocalChangesPreview,
  RepositoryMergeRebaseRequest,
  RepositoryPatchExportRequest,
  RepositoryPatchExportResult,
  RepositoryRecoveryRequest,
  RepositoryRecoveryState,
  RepositoryPullRequestHandoff,
  RepositoryResolveConflictRequest,
  RepositoryRemote,
  RepositoryRemoteActionRequest,
  RepositoryRemoteActionResult,
  RepositoryReferenceActionRequest,
  RepositoryReferenceActionResult,
  RepositoryReferenceContext,
  RepositoryBisectActionRequest,
  RepositoryBisectContext,
  RepositoryLeanRead,
  RepositoryLeanAction,
  RepositoryGitFlowActionRequest,
  RepositoryGitFlowActionResult,
  RepositoryGitFlowContext,
  RepositoryWorktreeActionRequest,
  RepositoryWorktreeActionResult,
  RepositoryWorktreeContext,
  RepositorySubmoduleActionRequest,
  RepositorySubmoduleActionResult,
  RepositorySubmoduleContext,
  RepositoryTabOrientation,
  RepositoryTabPreferences,
  RepositoryRevisionBlob,
  RepositoryRevisionTree,
  RepositoryLfsFile,
  RepositoryLfsInitializationRequest,
  RepositoryLfsSaveRequest,
  RepositoryBlame,
  RepositoryFileHistory,
  RepositorySummary,
  RepositoryStashActionRequest,
  RepositoryStashDetails,
  RepositoryStashEntry,
  RepositoryWorkingChanges,
  RepositoryWorkingChangeActionRequest,
  RepositoryWorkingChangeActionResult,
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
import {
  readCommitChanges,
  readRevisionBlob,
  readRevisionTree,
  RevisionNotFoundError,
  RevisionPathError,
} from './revision-service';
import {
  FileHistoryNotFoundError,
  FileHistoryPathError,
  readBlame,
  readFileHistory,
} from './file-history-service';
import { readWorkingChanges } from './working-tree-service';
import {
  AmendUnavailableError,
  commitChanges,
  readAmendChanges,
  readCommitContext,
  StaleCommitSnapshotError,
} from './commit-service';
import { readRepositoryDiff } from './diff-service';
import { OperationRegistry } from '../operations/operation-registry';
import { OperationBusyError } from '../operations/operation-registry';
import type {
  OperationDescriptor,
  OperationHandle,
  OperationListener,
  OperationOutcome,
} from '../operations/operation-registry';
import { BackgroundFetchScheduler } from '../operations/background-fetch-scheduler';
import {
  displayOutput,
  NetworkRequestError,
  planNetworkOperation,
  runNetworkOperation,
} from './network-service';
import type { NetworkPlan } from './network-service';
import { PushPreviewStore } from './push-preview-service';
import type { RepositoryPushPreviewRequest } from '../../common/ipc/contracts';
import {
  applyRemoteAction,
  isAllowedRemoteUrl,
  isStandaloneRepositoryUrl,
  readRemotes,
} from './remote-service';
import { RemoteFetchPreferenceStore } from './remote-fetch-preference-store';
import { applyReferenceAction, readReferenceContext, StaleReferenceSnapshotError } from './reference-service';
import { applyWorktreeAction, readWorktreeContext, StaleWorktreeSnapshotError } from './worktree-service';
import { applySubmoduleAction, readSubmoduleContext, StaleSubmoduleSnapshotError } from './submodule-service';
import { readBisectContext, applyBisectAction } from './bisect-service';
import { readSigningSettings, setSigningKey, verifySignature } from './signing-service';
import { StatisticsService } from './statistics-service';
import type { StatisticsRequest } from '../../common/ipc/statistics';
import { statisticsLimits } from '../../common/ipc/statistics';
import { GitSettingsService, globalConfigPath } from './settings-service';
import type { SaveGitSettings } from '../../common/ipc/settings';
import { applyGitFlowAction, GitFlowSnapshotError, readGitFlowContext } from './gitflow-service';
import { readLeanContext, runLeanAction } from './lean-branching-service';
import {
  applyWorkingChange,
  previewDiscard,
  StaleWorkingSnapshotError,
  WorkingChangeActionError,
} from './staging-service';
import { previewLocalChanges, readRecovery, recover, withLocalChanges } from './recovery-service';
import {
  ConflictRequestError,
  readConflictState,
  resolveConflict,
  StaleConflictSnapshotError,
} from './conflict-service';
import { pullRequestUrl } from './hosting-service';
import { readPatch, readStashDetails, readStashes, StashNotFoundError } from './stash-service';
import { MergeRebaseRequestError, runMergeRebase } from './merge-rebase-service';
import {
  HistoryOperationRequestError,
  StaleHistoryOperationError,
  readHistoryOperationPreview,
  runHistoryOperation,
} from './history-operation-service';
import {
  InteractiveRebaseRequestError,
  StaleInteractiveRebasePlanError,
  readInteractiveRebasePlan,
  runInteractiveRebase,
} from './interactive-rebase-service';
import {
  LfsPathError,
  LfsPayloadError,
  LfsRevisionNotFoundError,
  readLfsFile,
  saveLfsPayload,
} from './lfs-service';

import { CustomCommandStore } from '../commands/custom-command-store';
import { AiService } from '../ai/ai-service';
import type { AiPreviewRequest, AiSend } from '../../common/ipc/ai';
import { ExternalToolStore } from '../tools/external-tool-store';
import { ExternalToolService } from '../tools/external-tool-service';
import type { ExternalToolRun } from '../../common/ipc/external-tools';
import { CustomCommandService, runCustomCommand } from '../commands/custom-command-service';
import type { CustomPreviewRequest, CustomPreview } from '../../common/ipc/custom-commands';

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
  readonly backgroundFetchStoragePath?: string;
  readonly backgroundFetchIntervalMs?: number;
  readonly runner?: GitRunnerLike;
  readonly clock?: () => Date;
  readonly maxRecentEntries?: number;
  readonly maxSourceDirectories?: number;
  readonly maxOpenTabs?: number;
  readonly sourceScanOptions?: SourceScanOptions;
}

/** Owns canonical repository identities, sessions, and local repository-manager workflows. */
export class RepositoryService {
  readonly ai = new AiService();

  previewAi(owner: number, request: AiPreviewRequest) {
    const repository = this.operationRepository(owner, request.id);
    if (request.target.kind === 'staged' && !repository.worktreePath)
      throw new ExpectedBackendError('UNAVAILABLE', 'Staged AI messages require a working tree.');
    return this.ai.preview(this.runner, owner, repository.worktreePath ?? repository.commonDir, request);
  }

  sendAi(owner: number, request: AiSend) {
    this.operationRepository(owner, request.id);
    return this.ai.send(owner, request);
  }
  private readonly patches = new PatchPreviews();
  readonly externalTools: ExternalToolService;
  readonly customCommands: CustomCommandService;
  private readonly store: RecentRepositoryStore;
  private readonly managerStore: RepositoryManagerStore;
  private readonly tabStore: RepositoryTabStore;
  private readonly runner: ReadCoordinator;
  private readonly repositoryRunner: RepositoryGitRunner;
  private readonly trust: RepositoryTrustStore;
  private readonly clock: () => Date;
  private readonly sourceScanOptions: SourceScanOptions;
  private readonly maxOpenTabs: number;
  private readonly sessions = new Map<number, Map<string, RepositorySummary>>();
  private readonly pushPreviews = new PushPreviewStore();
  private readonly sessionGenerations = new Map<string, number>();
  private readonly diffReads = new Map<string, AbortController>();
  private readonly statistics = new StatisticsService();
  private readonly statisticsReads = new Map<string, AbortController>();
  private readonly restorePromises = new Map<number, Promise<void>>();
  private readonly ownerGenerations = new Map<number, number>();
  private readonly managerRepositoryPaths = new Map<number, ReadonlyMap<string, string>>();
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly operationScope = new AsyncLocalStorage<AbortSignal>();
  private readonly operations: OperationRegistry;
  private readonly backgroundFetch: BackgroundFetchScheduler;
  private readonly remoteFetchPreferences: RemoteFetchPreferenceStore;
  private automaticFetchEnabled = true;
  private readonly releaseOperationSubscription: () => void;
  private gitInfoPromise: Promise<GitInfo> | undefined;
  private readonly topologyKeys = new Map<string, string>();
  private readonly invalidationListeners = new Set<
    (ownerId: number, event: RepositoryInvalidation) => void
  >();
  private readonly watches = new Map<string, { watcher: DirectoryWatcher; owners: Set<number> }>();
  private readonly sourceWatches = new Map<string, DirectoryWatcher>();
  private readonly managerOwners = new Set<number>();
  private readonly managerRescanPending = new Set<number>();
  private readonly managerScans = new Map<
    number,
    { state: RepositoryManagerScan; controller: AbortController }
  >();
  private readonly settingsFiles: readonly string[];
  readonly workspaceStorageDirectory: string;
  private invalidationRevision = 0;

  constructor(options: RepositoryServiceOptions) {
    this.workspaceStorageDirectory = dirname(options.storagePath);
    this.settingsFiles = [
      options.storagePath,
      options.managerStoragePath ?? `${options.storagePath}.manager`,
      options.workspaceStoragePath ?? `${options.storagePath}.workspace`,
      join(this.workspaceStorageDirectory, 'window-state.json'),
    ];
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
    this.trust = new RepositoryTrustStore(`${options.storagePath}.trust`);
    this.repositoryRunner = new RepositoryGitRunner(options.runner ?? new GitRunner(), this.trust);
    this.runner = new ReadCoordinator(this.repositoryRunner);
    this.externalTools = new ExternalToolService(
      new ExternalToolStore(`${options.storagePath}.external-tools`),
      this.runner,
    );
    this.customCommands = new CustomCommandService(
      new CustomCommandStore(`${options.storagePath}.custom-commands`),
      this.runner,
    );
    this.clock = options.clock ?? (() => new Date());
    this.sourceScanOptions = options.sourceScanOptions ?? {};
    this.operations = new OperationRegistry({ clock: this.clock });
    this.remoteFetchPreferences = new RemoteFetchPreferenceStore(
      options.backgroundFetchStoragePath ?? `${options.storagePath}.background-fetch`,
    );
    this.backgroundFetch = new BackgroundFetchScheduler({
      intervalMs: options.backgroundFetchIntervalMs,
      start: (target) =>
        this.startNetworkOperation(
          target.ownerId,
          {
            id: target.repositoryId,
            request: { kind: 'fetch', remote: target.remote, prune: true, tags: true },
          },
          'background',
        ),
      cancel: (target, operationId) => {
        this.operations.cancel(target.ownerId, operationId);
      },
    });
    this.releaseOperationSubscription = this.operations.subscribe((ownerId, operation) => {
      this.backgroundFetch.operationChanged(ownerId, operation);
    });
  }

  async getGitInfo(): Promise<GitInfo> {
    this.gitInfoPromise ??= this.probeGit();
    return this.gitInfoPromise;
  }

  async setTrust(ownerId: number, id: string, trusted: boolean): Promise<null> {
    if (!this.sessions.get(ownerId)?.has(id))
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'Open this repository before changing its trust.',
      );
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    if (
      [...this.sessions.values()].some((sessions) =>
        [...sessions.values()].some(
          (repository) =>
            repository.commonDir === summary.commonDir && this.operations.isBusyForRepository(repository.id),
        ),
      )
    )
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Wait for repository operations to finish before changing trust.',
      );
    // Revocation waits for existing writes and prevents subsequent queued operations from starting.
    await this.withRepositoryMutation(
      summary.commonDir,
      () => this.trust.set(summary.commonDir, trusted),
      false,
    );
    this.runner.invalidate();
    for (const [owner, sessions] of this.sessions) {
      for (const [key, repository] of sessions) {
        if (repository.commonDir !== summary.commonDir) continue;
        const updated = { ...repository, trusted };
        sessions.set(key, updated);
        await this.refreshBackgroundFetch(owner, updated);
      }
    }
    return null;
  }

  async open(ownerId: number, inputPath: string, displayName?: string): Promise<RepositorySummary> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
    const generation = this.ownerGenerations.get(ownerId);
    if (!this.sessions.has(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    const directory = await this.canonicalDirectory(inputPath);
    const summary = await this.discover(directory, displayName);
    if (generation !== this.ownerGenerations.get(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
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
    if (generation !== this.ownerGenerations.get(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    this.addSession(ownerId, summary);
    void this.refreshBackgroundFetch(ownerId, summary);
    return summary;
  }

  async initialize(ownerId: number, inputPath: string, bare: boolean): Promise<RepositorySummary> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
    const generation = this.ownerGenerations.get(ownerId);
    if (!this.sessions.has(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    const directory = await this.canonicalDirectory(inputPath);
    if (
      this.listOpenCached(ownerId).length >= this.maxOpenTabs &&
      !this.listOpenCached(ownerId).some((entry) => entry.path === directory)
    )
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Close a repository tab before initializing another one.',
      );
    const existing = await lstat(join(directory, bare ? 'HEAD' : '.git')).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    try {
      await this.repositoryRunner.applicationAction(() =>
        this.runner.run(['init', '--quiet', ...(bare ? ['--bare'] : [])], {
          cwd: directory,
          timeoutMs: repositoryReadTimeoutMs,
          maxOutputBytes: repositoryReadOutputLimit,
        }),
      );
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not initialize the selected directory.');
    }
    const summary = await this.discover(directory);
    if (!existing) await this.trust.set(summary.commonDir, true);
    summary.trusted = await this.trust.isTrusted(summary.commonDir);
    summary.workingTree = await this.inspectWorkingTree(summary.worktreePath);
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
    if (generation !== this.ownerGenerations.get(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    this.addSession(ownerId, summary);
    void this.refreshBackgroundFetch(ownerId, summary);
    return summary;
  }

  async listRecent(ownerId: number): Promise<RecentRepository[]> {
    await this.ensureSessions(ownerId);
    const entries = await this.store.list();
    const configuration = await this.managerStore.configuration();
    return Promise.all(
      entries.map(async (entry) => ({
        id: entry.id,
        name:
          configuration.repositories.find((repository) => repository.path === entry.path)?.name || entry.name,
        path: entry.path,
        lastOpenedAt: entry.lastOpenedAt,
        status: await recentPathStatus(entry.path),
        open: this.sessions.get(ownerId)?.has(entry.id) ?? false,
      })),
    );
  }

  /** Cloning owns a newly reserved destination and returns a queryable job before network work starts. */
  async clone(ownerId: number, request: RepositoryCloneRequest): Promise<RepositoryOperation> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
    if (!isStandaloneRepositoryUrl(request.url)) {
      throw new ExpectedBackendError(
        'INVALID_REQUEST',
        'Use an absolute local path, file, HTTPS, SSH or Git URL without embedded credentials.',
      );
    }
    if (
      !request.name ||
      request.name === '.' ||
      request.name === '..' ||
      // eslint-disable-next-line no-control-regex -- reject control bytes in a destination component.
      /[\\/\u0000-\u001F\u007F]/u.test(request.name) ||
      request.name.startsWith('-')
    ) {
      throw new ExpectedBackendError('INVALID_REQUEST', 'Choose a single destination folder name.');
    }
    if (this.listOpenCached(ownerId).length >= this.maxOpenTabs) {
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Close a repository tab before cloning another repository.',
      );
    }
    const parent = await this.canonicalDirectory(request.parentPath);
    const destination = join(parent, request.name);
    const repositoryId = `repo-${createHash('sha256').update(`clone:${destination}`).digest('hex')}`;
    const generation = this.ownerGenerations.get(ownerId);
    const args = ['-c', 'protocol.ext.allow=never', 'clone', '--progress', '--', request.url, '.'];
    return this.operations.start(
      {
        ownerId,
        repositoryId,
        kind: 'clone',
        title: `Clone '${request.name}'`,
        command: `git clone --progress ${request.url} ${destination}`,
      },
      async (handle) => {
        if (handle.signal.aborted)
          return {
            status: 'failed',
            message: 'Clone cancelled before creating the destination.',
            output: '',
            failureReason: 'cancelled',
          };
        try {
          // Exclusive mkdir refuses existing directories, symlinks and files, including races after preflight.
          await mkdir(destination, { recursive: false });
        } catch (error) {
          return {
            status: 'failed',
            message:
              (error as NodeJS.ErrnoException).code === 'EEXIST'
                ? 'The destination already exists. Choose a new folder name.'
                : 'The destination folder could not be created.',
            output: '',
            failureReason: 'other',
          };
        }
        const outcome = await this.repositoryRunner.applicationAction(() =>
          runNetworkOperation(
            this.runner,
            {
              kind: 'clone',
              args,
              title: `Clone '${request.name}'`,
              command: `git clone --progress ${request.url} ${destination}`,
            },
            destination,
            handle,
          ),
        );
        if (outcome.status !== 'succeeded' || handle.signal.aborted) {
          return {
            ...outcome,
            status: 'failed',
            message: `${outcome.message} The destination is retained for inspection: ${destination}`.slice(
              0,
              512,
            ),
          };
        }
        if (this.ownerGenerations.get(ownerId) !== generation || !this.sessions.has(ownerId)) {
          return {
            status: 'succeeded',
            message: 'Cloned. Open the destination to inspect it.',
            output: outcome.output,
          };
        }
        try {
          const summary = await this.open(ownerId, destination);
          await this.setTrust(ownerId, summary.id, true);
          summary.trusted = true;
          return {
            ...outcome,
            message: 'Cloned and opened the repository.',
            result: { kind: 'clone', value: summary },
          };
        } catch {
          return {
            ...outcome,
            message: 'Cloned. The repository could not be opened automatically; open the destination folder.',
          };
        }
      },
    );
  }

  async testConnection(ownerId: number, request: RepositoryConnectionRequest): Promise<RepositoryOperation> {
    await this.requireGit();
    let cwd = tmpdir();
    let url: string;
    let repositoryId: string;
    if (request.kind === 'remote') {
      const summary = await this.refreshOpenRepository(ownerId, request.id, false);
      cwd = summary.worktreePath ?? summary.commonDir;
      const remotes = await readRemotes(this.runner, cwd);
      if (!remotes.some((remote) => remote.name === request.name)) {
        throw new ExpectedBackendError('INVALID_REQUEST', 'That remote no longer exists.');
      }
      url = (
        await this.runner.run(['remote', 'get-url', '--', request.name], {
          cwd,
          timeoutMs: repositoryReadTimeoutMs,
        })
      ).stdout.trim();
      repositoryId = request.id;
    } else {
      url = request.url;
      repositoryId = `repo-${createHash('sha256').update(`connection:${url}`).digest('hex')}`;
      if (!isStandaloneRepositoryUrl(url))
        throw new ExpectedBackendError(
          'INVALID_REQUEST',
          'Use an absolute local path or supported repository URL without embedded credentials.',
        );
    }
    const args = ['-c', 'protocol.ext.allow=never', 'ls-remote', '--symref', '--', url];
    const command = `git ls-remote --symref ${url}`;
    return this.operations.start(
      { ownerId, repositoryId, kind: 'connection', title: 'Test Connection', command },
      async (handle) => {
        const run = () =>
          runNetworkOperation(
            this.runner,
            { kind: 'connection', args, title: 'Test Connection', command },
            cwd,
            handle,
          );
        const outcome =
          request.kind === 'remote'
            ? await this.repositoryRunner.authorized(
                this.sessions.get(ownerId)!.get(request.id)!.commonDir,
                run,
              )
            : await this.repositoryRunner.applicationAction(run);
        return outcome.status === 'succeeded' ? { ...outcome, message: 'Connection succeeded.' } : outcome;
      },
    );
  }

  async listOpen(ownerId: number): Promise<RepositorySummary[]> {
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    if (!ownerSessions) return [];
    const ownerGeneration = this.ownerGenerations.get(ownerId);
    const current = [...ownerSessions.values()];
    const generations = new Map(
      current.map((summary) => [summary.id, this.sessionGenerations.get(`${ownerId}:${summary.id}`) ?? 0]),
    );
    const refreshed = await Promise.all(current.map((summary) => this.refreshSummary(summary)));
    const sessions = this.sessions.get(ownerId);
    if (!sessions || ownerGeneration !== this.ownerGenerations.get(ownerId)) return [];
    for (const summary of refreshed) {
      if (
        sessions.get(summary.id)?.path === summary.path &&
        generations.get(summary.id) === (this.sessionGenerations.get(`${ownerId}:${summary.id}`) ?? 0)
      )
        sessions.set(summary.id, summary);
    }
    return [...sessions.values()];
  }

  async close(ownerId: number, id: string): Promise<void> {
    this.pushPreviews.release(ownerId, id);
    this.ai.cancel(ownerId, id);
    this.patches.release(ownerId, id);
    for (const [key, controller] of this.statisticsReads)
      if (key.startsWith(`${ownerId}:${id}:`)) {
        controller.abort();
        this.statisticsReads.delete(key);
      }
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    if (!ownerSessions?.has(id)) {
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'That repository is not open in this window.');
    }

    const preferences = await this.tabStore.getPreferences();
    await this.tabStore.removeTab(id);
    if (preferences.activeRepositoryId === id) {
      const ids = [...ownerSessions.keys()];
      const index = ids.indexOf(id);
      const nextActiveId = ids[index - 1] ?? ids[index + 1] ?? null;
      await this.tabStore.setActiveRepositoryId(nextActiveId);
    }
    for (const operationId of this.backgroundFetch.remove(ownerId, id))
      this.operations.cancel(ownerId, operationId);
    ownerSessions.delete(id);
    this.runner.invalidate();
    this.sessionGenerations.set(
      `${ownerId}:${id}`,
      (this.sessionGenerations.get(`${ownerId}:${id}`) ?? 0) + 1,
    );
    this.releaseWatch(ownerId, id);
  }

  async getTabPreferences(ownerId: number): Promise<RepositoryTabPreferences> {
    await this.ensureSessions(ownerId);
    return this.tabStore.getPreferences();
  }

  /** Give a bounded read-only inspector its own session without persisting a tab or scheduling fetch. */
  async attachInspectionSession(ownerId: number, sourceOwnerId: number, id: string): Promise<void> {
    const generation = this.ownerGenerations.get(ownerId) ?? 0;
    const summary = await this.refreshOpenRepository(sourceOwnerId, id, false);
    if (
      (this.ownerGenerations.get(ownerId) ?? 0) !== generation ||
      !this.sessions.get(sourceOwnerId)?.has(id)
    ) {
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The source repository window was closed.');
    }
    if (this.sessions.has(ownerId))
      throw new ExpectedBackendError('INVALID_REQUEST', 'That inspector already has a repository.');
    this.sessions.set(ownerId, new Map([[id, summary]]));
  }

  async reorderTabs(ownerId: number, ids: readonly string[]): Promise<RepositorySummary[]> {
    await this.ensureSessions(ownerId);
    const current = this.sessions.get(ownerId)!;
    if (
      ids.length !== current.size ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !current.has(id))
    ) {
      throw new ExpectedBackendError('INVALID_REQUEST', 'The tab order changed. Refresh and try again.');
    }
    await this.tabStore.reorder(ids);
    this.sessions.set(ownerId, new Map(ids.map((id) => [id, current.get(id)!])));
    return this.listOpen(ownerId);
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
    anchor?: RepositoryHistoryAnchor,
    mode?: RepositoryHistoryMode,
  ): Promise<RepositoryHistoryPage> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    const cached = ownerSessions?.get(id);
    if (!ownerSessions || !cached) {
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
      summary = await this.refreshOpenRepository(ownerId, id);
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not refresh the selected repository.');
    }
    if (summary.id !== id) {
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository is no longer open in this window.',
      );
    }

    try {
      return await readRepositoryHistory(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        head: summary.head,
        offset,
        limit,
        filter,
        anchor,
        mode,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the selected repository history.');
    }
  }

  async getCommitChanges(ownerId: number, id: string, commitId: string): Promise<RepositoryCommitChanges> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readCommitChanges(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        commitId,
      });
    } catch (error) {
      throw this.mapRevisionFailure(error, 'Git could not read the selected commit changes.');
    }
  }

  async getDiff(
    ownerId: number,
    id: string,
    target: RepositoryDiffTarget,
    whitespace: RepositoryDiffWhitespace,
    options?: RepositoryDiffOptions,
  ): Promise<RepositoryDiff> {
    const readKey = options?.readId ? `${ownerId}:${id}:${options.readId}` : undefined;
    const controller = new AbortController();
    if (readKey) {
      this.diffReads.get(readKey)?.abort();
      if (
        !this.diffReads.has(readKey) &&
        [...this.diffReads.keys()].filter((key) => key.startsWith(`${ownerId}:`)).length >= 4
      )
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          'Too many diff reads are in progress. Cancel a read and try again.',
        );
      this.diffReads.set(readKey, controller);
    }
    try {
      const summary = await this.refreshOpenRepository(ownerId, id, false);
      return await readRepositoryDiff(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        target,
        whitespace,
        options,
        ...(readKey ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      throw this.mapRevisionFailure(error, 'Git could not read the selected diff.');
    } finally {
      if (readKey && this.diffReads.get(readKey) === controller) this.diffReads.delete(readKey);
    }
  }

  async cancelDiff(ownerId: number, request: RepositoryDiffCancel): Promise<null> {
    this.diffReads.get(`${ownerId}:${request.id}:${request.readId}`)?.abort();
    return null;
  }

  async previewDiscard(
    ownerId: number,
    request: RepositoryDiscardPreviewRequest,
  ): Promise<RepositoryDiscardPreview> {
    const summary = await this.refreshOpenRepository(ownerId, request.id, false);
    if (!summary.worktreePath)
      throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree.');
    try {
      return await previewDiscard(this.runner, {
        repositoryId: request.id,
        cwd: summary.worktreePath,
        targets: request.targets,
        selection: request.selection,
      });
    } catch (error) {
      if (error instanceof WorkingChangeActionError)
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      throw this.mapGitFailure(error, 'Git could not preview the selected changes.');
    }
  }

  async getWorkingChanges(
    ownerId: number,
    id: string,
    includeUntracked: boolean,
    includeIgnored: boolean,
  ): Promise<RepositoryWorkingChanges> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    if (!summary.worktreePath) {
      throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree.');
    }
    try {
      return await readWorkingChanges(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        includeUntracked,
        includeIgnored,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the working tree changes.');
    }
  }

  async getConflicts(ownerId: number, request: RepositoryConflictRequest): Promise<RepositoryConflictState> {
    const summary = await this.requireWorktree(ownerId, request.id);
    try {
      return await readConflictState(
        this.runner,
        { repositoryId: request.id, cwd: summary.worktreePath, gitDir: summary.gitDir },
        request,
      );
    } catch (error) {
      if (error instanceof ConflictRequestError) {
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      }
      throw this.mapGitFailure(error, 'Git could not inspect the conflicted files.');
    }
  }

  async resolveConflict(
    request: RepositoryResolveConflictRequest,
    ownerId: number,
  ): Promise<RepositoryConflictState> {
    const cached = await this.requireWorktree(ownerId, request.id);
    if (this.operations.isBusyForRepository(request.id))
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Wait for the current Git operation to finish before staging a conflict resolution.',
      );
    return this.withRepositoryMutation(cached.commonDir, async () => {
      const summary = await this.requireWorktree(ownerId, request.id);
      try {
        return await resolveConflict(
          this.runner,
          { repositoryId: request.id, cwd: summary.worktreePath, gitDir: summary.gitDir },
          request,
        );
      } catch (error) {
        if (error instanceof StaleConflictSnapshotError)
          throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
        if (error instanceof ConflictRequestError)
          throw new ExpectedBackendError('OPERATION_FAILED', error.message);
        throw this.mapGitFailure(error, 'Git could not stage the conflict resolution.');
      }
    });
  }

  async applyWorkingChange(
    ownerId: number,
    request: RepositoryWorkingChangeActionRequest,
  ): Promise<RepositoryWorkingChangeActionResult> {
    const cached = await this.refreshOpenRepository(ownerId, request.id);
    if (!cached.worktreePath) {
      throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree.');
    }
    return this.withRepositoryMutation(cached.commonDir, async () => {
      const summary = await this.refreshOpenRepository(ownerId, request.id);
      if (!summary.worktreePath) {
        throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree.');
      }
      try {
        await applyWorkingChange(this.runner, {
          repositoryId: request.id,
          cwd: summary.worktreePath,
          action: request.action,
          targets: request.targets,
          snapshot: request.snapshot,
          selection: request.selection,
        });
      } catch (error) {
        if (error instanceof StaleWorkingSnapshotError) {
          throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
        }
        if (error instanceof RevisionPathError) {
          throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
        }
        if (error instanceof WorkingChangeActionError) {
          throw new ExpectedBackendError('OPERATION_FAILED', error.message);
        }
        throw this.mapGitFailure(error, 'Git could not update the working tree changes.');
      }

      try {
        const changes = await readWorkingChanges(this.runner, {
          repositoryId: request.id,
          cwd: summary.worktreePath,
          includeUntracked: true,
          includeIgnored: true,
        });
        return {
          repositoryId: request.id,
          action: request.action,
          targets: request.targets,
          selection: request.selection,
          changes,
        } satisfies RepositoryWorkingChangeActionResult;
      } catch (error) {
        throw this.mapGitFailure(error, 'Git could not refresh the working tree changes.');
      }
    });
  }

  async getCommitContext(ownerId: number, id: string): Promise<RepositoryCommitContext> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readCommitContext(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        gitDir: summary.gitDir,
        head: summary.head,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the commit details.');
    }
  }

  async getAmendChanges(ownerId: number, id: string): Promise<RepositoryAmendChanges> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readAmendChanges(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        gitDir: summary.gitDir,
        head: summary.head,
      });
    } catch (error) {
      if (error instanceof AmendUnavailableError) {
        throw new ExpectedBackendError('UNAVAILABLE', error.message);
      }
      throw this.mapGitFailure(error, 'Git could not read the amended commit changes.');
    }
  }

  async commit(
    ownerId: number,
    request: RepositoryCommitRequest,
    signal?: AbortSignal,
    onCommand?: (args: readonly string[]) => void,
  ): Promise<RepositoryCommitResult> {
    const cached = await this.requireWorktree(ownerId, request.id);
    return this.withRepositoryMutation(cached.commonDir, async () => {
      const summary = await this.requireWorktree(ownerId, request.id);
      try {
        if (signal?.aborted) throw new GitCancelledError();
        return await commitChanges(this.runner, {
          signal,
          onCommand,
          repositoryId: request.id,
          cwd: summary.worktreePath,
          gitDir: summary.gitDir,
          head: summary.head,
          subject: request.subject,
          body: request.body,
          amend: request.amend,
          snapshot: request.snapshot,
          skipHooks: request.skipHooks,
          signing: request.signing,
        });
      } catch (error) {
        if (error instanceof StaleCommitSnapshotError) {
          throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
        }
        throw this.mapGitFailure(error, 'Git could not complete the commit.');
      }
    });
  }

  async getReferenceContext(ownerId: number, id: string): Promise<RepositoryReferenceContext> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readReferenceContext(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        gitDir: summary.gitDir,
        worktreePath: summary.worktreePath,
        head: summary.head,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the branches and tags.');
    }
  }

  async applyReferenceAction(
    ownerId: number,
    request: RepositoryReferenceActionRequest,
    signal?: AbortSignal,
    onCommand?: (args: readonly string[]) => void,
    progress?: Pick<OperationHandle, 'appendOutput' | 'setProgress'>,
  ): Promise<RepositoryReferenceActionResult> {
    const cached = await this.requireWorktree(ownerId, request.id);
    return this.withRepositoryMutation(cached.commonDir, async () => {
      const summary = await this.requireWorktree(ownerId, request.id);
      try {
        if (signal?.aborted) throw new GitCancelledError();
        const action = request.action;
        const policy = 'localChanges' in action ? (action.localChanges ?? 'keep') : 'keep';
        if (action.kind === 'create-branch' && !action.checkout && policy !== 'keep')
          throw new ExpectedBackendError(
            'INVALID_REQUEST',
            'Local changes can only be handled when checking out the new branch.',
          );
        const changesSnapshot = 'changesSnapshot' in action ? action.changesSnapshot : undefined;
        // Validate the original reference snapshot before saving any local changes.
        if (policy !== 'keep') {
          const context = await readReferenceContext(this.runner, {
            repositoryId: request.id,
            cwd: summary.worktreePath,
            gitDir: summary.gitDir,
            worktreePath: summary.worktreePath,
            head: summary.head,
          });
          if (context.snapshot !== request.snapshot) throw new StaleReferenceSnapshotError();
        }
        return await withLocalChanges(
          this.runner,
          { id: request.id, cwd: summary.worktreePath, gitDir: summary.gitDir, head: summary.head },
          policy,
          changesSnapshot,
          request.action.kind,
          async () => {
            const result = await applyReferenceAction(this.runner, {
              signal,
              onCommand,
              onOutput: progress?.appendOutput,
              onProgress: progress?.setProgress,
              repositoryId: request.id,
              cwd: summary.worktreePath,
              gitDir: summary.gitDir,
              worktreePath: summary.worktreePath,
              head: summary.head,
              action: request.action,
              snapshot: request.snapshot,
            });
            if (policy !== 'keep' && result.status === 'blocked')
              throw new ExpectedBackendError(
                'OPERATION_FAILED',
                `${result.message} Saved changes are available in Recovery.`,
              );
            return result;
          },
          signal,
        );
      } catch (error) {
        if (error instanceof StaleReferenceSnapshotError) {
          throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
        }
        throw this.mapGitFailure(error, 'Git could not update the repository references.');
      }
    });
  }

  async getWorktrees(ownerId: number, id: string): Promise<RepositoryWorktreeContext> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readWorktreeContext(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        commonDir: summary.commonDir,
        currentWorktreePath: summary.worktreePath,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the linked worktrees.');
    }
  }

  async getBisect(ownerId: number, id: string): Promise<RepositoryBisectContext> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readBisectContext(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        gitDir: summary.gitDir,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the bisect state.');
    }
  }

  async getSigningSettings(ownerId: number, id: string) {
    const summary = await this.requireWorktree(ownerId, id);
    return readSigningSettings(this.runner, summary.worktreePath, id);
  }

  async getStatistics(ownerId: number, request: StatisticsRequest) {
    const repository = this.operationRepository(ownerId, request.id);
    const key = `${ownerId}:${request.id}:${request.readId}`;
    if (this.statisticsReads.size >= 4)
      throw new ExpectedBackendError('UNAVAILABLE', 'Too many statistics reads. Cancel a read first.');
    this.statisticsReads.get(key)?.abort();
    const controller = new AbortController();
    this.statisticsReads.set(key, controller);
    try {
      return await this.statistics.read(
        this.runner,
        repository.worktreePath ?? repository.commonDir,
        request,
        AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(statisticsLimits(request.limitScale).timeoutMs),
        ]),
      );
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not calculate statistics.');
    } finally {
      if (this.statisticsReads.get(key) === controller) this.statisticsReads.delete(key);
    }
  }

  async cancelStatistics(ownerId: number, request: { id: string; readId: string }): Promise<null> {
    this.statisticsReads.get(`${ownerId}:${request.id}:${request.readId}`)?.abort();
    return null;
  }

  async getGitSettings(ownerId: number, id: string | null) {
    const service = new GitSettingsService(this.runner);
    if (id === null) return service.read(null, tmpdir(), await globalConfigPath());
    const repository = this.operationRepository(ownerId, id);
    return service.read(
      id,
      repository.worktreePath ?? repository.commonDir,
      join(repository.commonDir, 'config'),
    );
  }

  async saveGitSettings(ownerId: number, request: SaveGitSettings) {
    const service = new GitSettingsService(this.runner);
    if (request.id === null) {
      const path = await globalConfigPath();
      return this.withRepositoryMutation(
        path,
        () => this.repositoryRunner.applicationAction(() => service.save(tmpdir(), path, request)),
        false,
      );
    }
    const repository = this.operationRepository(ownerId, request.id);
    return this.withRepositoryMutation(repository.commonDir, () => {
      const current = this.operationRepository(ownerId, request.id!);
      return service.save(
        current.worktreePath ?? current.commonDir,
        join(current.commonDir, 'config'),
        request,
      );
    });
  }

  async setSigningKey(ownerId: number, request: RepositorySigningSettingsRequest) {
    const cached = await this.requireWorktree(ownerId, request.id);
    return this.withRepositoryMutation(cached.commonDir, async () => {
      const summary = await this.requireWorktree(ownerId, request.id);
      return setSigningKey(this.runner, summary.worktreePath, request);
    });
  }

  async verifySignature(ownerId: number, request: RepositoryVerifySignatureRequest) {
    const summary = this.operationRepository(ownerId, request.id);
    return verifySignature(this.runner, summary.worktreePath ?? summary.commonDir, request);
  }

  startBisectOperation(ownerId: number, request: RepositoryBisectActionRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'bisect',
        title: 'Bisect: ' + request.action,
        command: 'git bisect ' + request.action,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          const value = await applyBisectAction(
            this.runner,
            { repositoryId: request.id, cwd: summary.worktreePath, gitDir: summary.gitDir },
            request,
            handle.signal,
          );
          return {
            status: 'succeeded',
            output: '',
            message: value.firstBad
              ? 'First bad commit: ' + value.firstBad
              : value.candidates.length
                ? 'Skipped commits prevent a unique result.'
                : value.active
                  ? 'Bisect state updated.'
                  : 'Bisect stopped; original checkout restored.',
            result: { kind: 'bisect', value },
          };
        }),
    );
  }

  async getLean(ownerId: number, request: RepositoryLeanRead) {
    const summary = await this.requireWorktree(ownerId, request.id);
    try {
      return await readLeanContext(this.runner, {
        repositoryId: request.id,
        cwd: summary.worktreePath,
        worktreePath: summary.worktreePath,
        gitDir: summary.gitDir,
        base: request.base,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read Lean Branching state.');
    }
  }

  startLean(ownerId: number, request: RepositoryLeanAction): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'lean-branching',
        title: `Lean Branching: ${request.kind}`,
        command: '',
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            return await runLeanAction(
              this.runner,
              {
                repositoryId: request.id,
                cwd: summary.worktreePath,
                worktreePath: summary.worktreePath,
                gitDir: summary.gitDir,
                base: request.base,
              },
              request,
              handle,
            );
          } catch (error) {
            if (error instanceof StaleReferenceSnapshotError)
              throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
            throw this.mapGitFailure(
              error,
              'Git could not complete Lean Branching. Check Activity and Recovery before retrying.',
            );
          }
        }),
    );
  }

  async getGitFlow(ownerId: number, id: string): Promise<RepositoryGitFlowContext> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readGitFlowContext(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        gitDir: summary.gitDir,
        worktreePath: summary.worktreePath,
      });
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the Git-flow configuration.');
    }
  }

  startGitFlowOperation(ownerId: number, request: RepositoryGitFlowActionRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const action = request.action;
    const title =
      action.kind === 'initialize'
        ? 'Initialize Git-flow'
        : action.kind === 'start'
          ? `Start ${action.type} '${action.name}'`
          : `Finish ${action.type} '${action.name}'`;
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'git-flow',
        title,
        command: `git flow ${action.kind}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            const value = await applyGitFlowAction(this.runner, {
              repositoryId: request.id,
              cwd: summary.worktreePath,
              gitDir: summary.gitDir,
              worktreePath: summary.worktreePath,
              action,
              signal: handle.signal,
              onCommand: (args) =>
                handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' ')),
            });
            return {
              status: value.status === 'applied' ? 'succeeded' : 'failed',
              message: value.message,
              output: value.output,
              failureReason: value.status === 'blocked' ? gitFlowOperationFailure(value) : undefined,
              result: { kind: 'git-flow', value },
            };
          } catch (error) {
            if (error instanceof GitFlowSnapshotError)
              throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
            throw this.mapGitFailure(error, 'Git could not complete the Git-flow action.');
          }
        }),
    );
  }

  async getSubmodules(ownerId: number, id: string): Promise<RepositorySubmoduleContext> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await this.repositoryRunner.authorized(summary.commonDir, () =>
        readSubmoduleContext(this.runner, {
          repositoryId: id,
          cwd: summary.worktreePath,
        }),
      );
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the repository submodules.');
    }
  }

  startSubmoduleOperation(ownerId: number, request: RepositorySubmoduleActionRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const action = request.action;
    const title =
      action.kind === 'add'
        ? `Add submodule '${action.path}'`
        : action.kind === 'remove'
          ? 'Remove submodule'
          : `${action.kind[0]!.toLocaleUpperCase()}${action.kind.slice(1)} submodule`;
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'submodule',
        title,
        command: `git submodule ${action.kind}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            const value = await applySubmoduleAction(this.runner, {
              repositoryId: request.id,
              cwd: summary.worktreePath,
              action,
              snapshot: request.snapshot,
              signal: handle.signal,
              onCommand: (args) =>
                handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' ')),
            });
            return {
              status: value.status === 'applied' ? 'succeeded' : 'failed',
              message: value.message,
              output: value.output,
              failureReason: value.status === 'blocked' ? submoduleOperationFailure(value) : undefined,
              result: { kind: 'submodule', value },
            };
          } catch (error) {
            if (error instanceof StaleSubmoduleSnapshotError)
              throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
            throw this.mapGitFailure(error, 'Git could not update the repository submodule.');
          }
        }),
    );
  }

  async openSubmodule(ownerId: number, id: string, submoduleId: string): Promise<RepositorySummary> {
    const parent = await this.requireWorktree(ownerId, id);
    const context = await this.getSubmodules(ownerId, id);
    const submodule = context.submodules.find((candidate) => candidate.id === submoduleId);
    if (!submodule)
      throw new ExpectedBackendError('INVALID_REQUEST', 'That submodule is no longer registered.');
    if (!submodule.initialized)
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        `The submodule '${submodule.path}' is not initialized. Update it before opening the child repository.`,
      );
    const childPath = resolve(parent.worktreePath, submodule.path);
    return this.open(ownerId, childPath, `${parent.name}: ${submodule.name}`);
  }

  startWorktreeOperation(ownerId: number, request: RepositoryWorktreeActionRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const action = request.action;
    const title =
      action.kind === 'create'
        ? 'Create worktree'
        : action.kind === 'remove'
          ? 'Remove worktree'
          : 'Prune worktrees';
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'worktree',
        title,
        command: `git worktree ${action.kind}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.refreshOpenRepository(ownerId, request.id, false);
          try {
            const value = await applyWorktreeAction(this.runner, {
              repositoryId: request.id,
              cwd: summary.worktreePath ?? summary.commonDir,
              commonDir: summary.commonDir,
              currentWorktreePath: summary.worktreePath,
              action,
              snapshot: request.snapshot,
              signal: handle.signal,
              onCommand: (args) =>
                handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' ')),
            });
            if (value.status === 'applied' && action.kind === 'remove' && value.path)
              await this.closeRemovedWorktreeTabs(value.path, summary.commonDir);
            return {
              status: value.status === 'applied' ? 'succeeded' : 'failed',
              message: value.message,
              output: value.output,
              failureReason: worktreeOperationFailure(value),
              result: { kind: 'worktree', value },
            };
          } catch (error) {
            if (error instanceof StaleWorktreeSnapshotError)
              throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
            throw this.mapGitFailure(error, 'Git could not update the linked worktrees.');
          }
        }),
    );
  }

  async listRemotes(ownerId: number, id: string): Promise<RepositoryRemote[]> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      const remotes = await this.readConfiguredRemotes(id, summary.worktreePath ?? summary.commonDir);
      this.configureBackgroundFetch(ownerId, id, remotes);
      return remotes;
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the remotes of this repository.');
    }
  }

  async getPullRequestUrl(ownerId: number, request: RepositoryPullRequestHandoff): Promise<string> {
    const summary = await this.requireWorktree(ownerId, request.id);
    const context = await this.getReferenceContext(ownerId, request.id);
    const branch = context.branches.find((candidate) => candidate.fullName === request.fullName);
    if (!branch || !context.remotes.includes(request.remote))
      throw new ExpectedBackendError(
        'INVALID_REQUEST',
        'Choose a local branch and a configured hosting remote.',
      );
    const raw = await this.runner.run(['remote', 'get-url', '--push', '--', request.remote], {
      cwd: summary.worktreePath,
    });
    const sourceBranch =
      branch.upstreamRemote === request.remote ? (branch.upstreamBranch ?? branch.name) : branch.name;
    const url = pullRequestUrl(raw.stdout.trim(), sourceBranch);
    if (!url)
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Browser pull requests are supported for github.com, gitlab.com, bitbucket.org, and dev.azure.com remotes.',
      );
    return url;
  }

  async applyRemoteAction(
    ownerId: number,
    request: RepositoryRemoteActionRequest,
  ): Promise<RepositoryRemoteActionResult> {
    const cached = await this.refreshOpenRepository(ownerId, request.id);
    return this.withRepositoryMutation(cached.commonDir, async () => {
      const summary = await this.refreshOpenRepository(ownerId, request.id);
      try {
        const cwd = summary.worktreePath ?? summary.commonDir;
        const action = request.action;
        if (action.kind === 'set-automatic-fetch') {
          const existing = await readRemotes(this.runner, cwd);
          const remote = existing.find((candidate) => candidate.name === action.name);
          const remotes = await this.readConfiguredRemotes(request.id, cwd);
          if (!remote) {
            this.configureBackgroundFetch(ownerId, request.id, remotes);
            return {
              status: 'blocked',
              repositoryId: request.id,
              reason: 'not-found',
              message: `This repository has no remote named '${action.name}'.`,
              remotes,
            } satisfies RepositoryRemoteActionResult;
          }
          await this.remoteFetchPreferences.setEnabled(request.id, action.name, action.enabled);
          const updated = await this.readConfiguredRemotes(request.id, cwd);
          this.configureBackgroundFetch(ownerId, request.id, updated);
          return {
            status: 'applied',
            repositoryId: request.id,
            message: `${action.enabled ? 'Enabled' : 'Disabled'} automatic fetching for '${action.name}'.`,
            remotes: updated,
          } satisfies RepositoryRemoteActionResult;
        }

        const result = await applyRemoteAction(this.runner, {
          repositoryId: request.id,
          cwd,
          action,
        });
        if (
          result.status === 'applied' ||
          (action.kind === 'edit' &&
            action.newName !== action.name &&
            result.remotes.some((remote) => remote.name === action.newName) &&
            !result.remotes.some((remote) => remote.name === action.name))
        ) {
          if (action.kind === 'rename' || (action.kind === 'edit' && action.newName !== action.name))
            await this.remoteFetchPreferences.rename(request.id, action.name, action.newName);
          if (action.kind === 'remove') await this.remoteFetchPreferences.remove(request.id, action.name);
        }
        const remotes = await this.readConfiguredRemotes(request.id, cwd);
        this.configureBackgroundFetch(ownerId, request.id, remotes);
        return { ...result, remotes };
      } catch (error) {
        throw this.mapGitFailure(error, 'Git could not change the remotes of this repository.');
      }
    });
  }

  private async readConfiguredRemotes(repositoryId: string, cwd: string): Promise<RepositoryRemote[]> {
    this.automaticFetchEnabled = await this.remoteFetchPreferences.isGloballyEnabled();
    const [remotes, disabled] = await Promise.all([
      readRemotes(this.runner, cwd),
      this.remoteFetchPreferences.disabledRemotes(repositoryId),
    ]);
    const disabledRemotes = new Set(disabled);
    return remotes.map((remote) => ({
      ...remote,
      fetchAutomatically: !disabledRemotes.has(remote.name),
    }));
  }

  async getAutomaticFetch(): Promise<{ enabled: boolean }> {
    this.automaticFetchEnabled = await this.remoteFetchPreferences.isGloballyEnabled();
    return { enabled: this.automaticFetchEnabled };
  }

  async setAutomaticFetch(enabled: boolean): Promise<{ enabled: boolean }> {
    await this.remoteFetchPreferences.setGloballyEnabled(enabled);
    this.automaticFetchEnabled = enabled;
    for (const [ownerId, sessions] of this.sessions) {
      for (const summary of sessions.values()) await this.refreshBackgroundFetch(ownerId, summary);
    }
    return { enabled };
  }

  private configureBackgroundFetch(
    ownerId: number,
    repositoryId: string,
    remotes: readonly RepositoryRemote[],
  ): void {
    const cancelled = this.backgroundFetch.configure(
      ownerId,
      repositoryId,
      this.automaticFetchEnabled && this.sessions.get(ownerId)?.get(repositoryId)?.trusted === true
        ? remotes.filter((remote) => remote.fetchAutomatically).map((remote) => remote.name)
        : [],
    );
    for (const operationId of cancelled) this.operations.cancel(ownerId, operationId);
  }

  private async refreshBackgroundFetch(ownerId: number, summary: RepositorySummary): Promise<void> {
    try {
      const remotes = await this.readConfiguredRemotes(summary.id, summary.worktreePath ?? summary.commonDir);
      if (this.sessions.get(ownerId)?.get(summary.id)?.path !== summary.path) return;
      this.configureBackgroundFetch(ownerId, summary.id, remotes);
    } catch {
      // A missing repository, unreadable remote, or invalid existing transport disables automatic
      // scheduling for this session until the next explicit remote read succeeds.
      for (const operationId of this.backgroundFetch.remove(ownerId, summary.id))
        this.operations.cancel(ownerId, operationId);
    }
  }

  listOperations(ownerId: number): RepositoryOperation[] {
    return this.operations.list(ownerId);
  }

  startExternalTool(ownerId: number, request: ExternalToolRun): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.repositoryId);
    return this.startOperation(
      { ownerId, repositoryId: cached.id, kind: 'external-tool', title: 'External tool', command: '' },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          if (handle.signal.aborted)
            return { status: 'failed', message: 'Cancelled before launch.', output: '' };
          const summary = await this.refreshOpenRepository(ownerId, cached.id);
          return this.externalTools.run(summary, request, handle);
        }),
    );
  }

  async previewCustomCommand(ownerId: number, request: CustomPreviewRequest): Promise<CustomPreview> {
    const generation = this.ownerGenerations.get(ownerId) ?? 0;
    const summary = await this.refreshOpenRepository(ownerId, request.context.repositoryId);
    const preview = await this.customCommands.preview(ownerId, summary, request);
    if ((this.ownerGenerations.get(ownerId) ?? 0) !== generation) {
      this.customCommands.disposeOwner(ownerId);
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The owning window has closed.');
    }
    return preview;
  }

  startCustomCommand(
    ownerId: number,
    token: string,
    openUrl: (url: string) => Promise<void>,
  ): RepositoryOperation {
    const id = this.customCommands.repositoryFor(ownerId, token);
    const cached = this.operationRepository(ownerId, id);
    return this.startOperation(
      { ownerId, repositoryId: id, kind: 'custom-command', title: 'Custom command', command: '' },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          if (handle.signal.aborted)
            return { status: 'failed', message: 'Cancelled before execution.', output: '' };
          const summary = await this.refreshOpenRepository(ownerId, id);
          const preview = await this.customCommands.consume(ownerId, token, summary);
          handle.setCommand?.(preview.name);
          return runCustomCommand(preview, handle, openUrl);
        }),
    );
  }

  private operationRepository(ownerId: number, id: string): RepositorySummary {
    const summary = this.sessions.get(ownerId)?.get(id);
    if (!summary)
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'That repository is not open in this window.');
    if (this.operations.isBusyForRepository(id))
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'An operation is already running for this repository.',
      );
    return summary;
  }

  private startOperation(
    descriptor: OperationDescriptor,
    work: (handle: OperationHandle) => Promise<OperationOutcome>,
  ): RepositoryOperation {
    try {
      return this.operations.start(descriptor, (handle) =>
        this.operationScope.run(handle.signal, () => work(handle)),
      );
    } catch (error) {
      if (error instanceof OperationBusyError)
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'An operation is already running for this repository.',
        );
      throw error;
    }
  }

  startCommit(ownerId: number, request: RepositoryCommitRequest): RepositoryOperation {
    this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'commit',
        title: request.amend ? 'Amend commit' : 'Commit',
        command: `git commit${request.amend ? ' --amend' : ''}`,
      },
      async (handle) => {
        const value = await this.commit(ownerId, request, handle.signal, (args) =>
          handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' ')),
        );
        return {
          status: value.status === 'committed' ? 'succeeded' : 'failed',
          message:
            value.status === 'committed' ? `Created commit ${value.commitId.slice(0, 7)}.` : value.message,
          output: value.output,
          result: { kind: 'commit', value },
        };
      },
    );
  }

  startReferenceAction(ownerId: number, request: RepositoryReferenceActionRequest): RepositoryOperation {
    this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'reference',
        title: `${request.action.kind.replaceAll('-', ' ')} '${'fullName' in request.action ? request.action.fullName.replace(/^refs\/(heads|remotes|tags)\//u, '') : 'name' in request.action ? request.action.name : 'commitId' in request.action ? request.action.commitId.slice(0, 7) : `${request.action.fullNames.length} selected`}'`,
        command: '',
      },
      async (handle) => {
        const value = await this.applyReferenceAction(
          ownerId,
          request,
          handle.signal,
          (args) => handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' ')),
          handle,
        );
        return {
          status: value.status === 'applied' ? 'succeeded' : 'failed',
          message: value.message,
          output: value.output,
          result: { kind: 'reference', value },
        };
      },
    );
  }

  startMergeRebase(ownerId: number, request: RepositoryMergeRebaseRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const action = request.action;
    const source = action.sourceFullName.replace(/^refs\/(heads|remotes|tags)\//u, '');
    const title =
      action.kind === 'merge'
        ? `Merge '${source}'`
        : `Rebase '${cached.head.name ?? 'current branch'}' on '${source}'`;
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: action.kind,
        title,
        command: `git ${action.kind}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            return await runMergeRebase(this.runner, {
              repositoryId: request.id,
              cwd: summary.worktreePath,
              gitDir: summary.gitDir,
              worktreePath: summary.worktreePath,
              head: summary.head,
              action,
              signal: handle.signal,
              handle,
            });
          } catch (error) {
            if (error instanceof StaleReferenceSnapshotError) {
              throw new ExpectedBackendError(
                'STALE_SNAPSHOT',
                'The branch changed before the merge or rebase could start. Review it again.',
              );
            }
            if (error instanceof MergeRebaseRequestError) {
              throw new ExpectedBackendError('OPERATION_FAILED', error.message);
            }
            throw this.mapGitFailure(error, 'Git could not start the merge or rebase.');
          }
        }),
    );
  }

  async getHistoryOperationPreview(
    ownerId: number,
    request: RepositoryHistoryOperationPreviewRequest,
  ): Promise<RepositoryHistoryOperationPreview> {
    const summary = await this.requireWorktree(ownerId, request.id);
    try {
      return await readHistoryOperationPreview(this.runner, request, {
        repositoryId: request.id,
        cwd: summary.worktreePath,
        gitDir: summary.gitDir,
        worktreePath: summary.worktreePath,
        head: summary.head,
      });
    } catch (error) {
      if (error instanceof HistoryOperationRequestError)
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      throw this.mapGitFailure(error, 'Git could not prepare that history operation.');
    }
  }

  startHistoryOperation(
    ownerId: number,
    request: { readonly id: string; readonly action: RepositoryHistoryOperationAction },
  ): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const action = request.action;
    const target = action.kind === 'reset' ? action.targetCommitId : action.commitId;
    const title =
      action.kind === 'reset'
        ? `Reset '${cached.head.name ?? 'HEAD'}' (${action.mode})`
        : `${action.kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} '${target.slice(0, 7)}'`;
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: action.kind,
        title,
        command: `git ${action.kind}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            return await runHistoryOperation(this.runner, {
              repositoryId: request.id,
              cwd: summary.worktreePath,
              gitDir: summary.gitDir,
              worktreePath: summary.worktreePath,
              head: summary.head,
              action,
              signal: handle.signal,
              handle,
            });
          } catch (error) {
            if (error instanceof StaleHistoryOperationError)
              throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
            if (error instanceof HistoryOperationRequestError)
              throw new ExpectedBackendError('OPERATION_FAILED', error.message);
            throw this.mapGitFailure(error, 'Git could not complete that history operation.');
          }
        }),
    );
  }

  async getInteractiveRebasePlan(
    ownerId: number,
    request: RepositoryInteractiveRebasePlanRequest,
  ): Promise<RepositoryInteractiveRebasePlan> {
    const summary = await this.requireWorktree(ownerId, request.id);
    try {
      return await readInteractiveRebasePlan(
        this.runner,
        { repositoryId: request.id, cwd: summary.worktreePath, gitDir: summary.gitDir },
        request,
      );
    } catch (error) {
      if (error instanceof InteractiveRebaseRequestError)
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      throw this.mapGitFailure(error, 'Git could not read the interactive rebase plan.');
    }
  }

  startInteractiveRebase(ownerId: number, request: RepositoryInteractiveRebaseRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const target = request.ontoCommitId ? ` to ${request.ontoCommitId.slice(0, 7)}` : ' from root';
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'rebase',
        title: `Interactive rebase${target}`,
        command: 'git rebase --interactive',
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            return await runInteractiveRebase(this.runner, {
              repositoryId: request.id,
              cwd: summary.worktreePath,
              gitDir: summary.gitDir,
              request,
              signal: handle.signal,
              handle,
            });
          } catch (error) {
            if (error instanceof StaleInteractiveRebasePlanError)
              throw new ExpectedBackendError('STALE_SNAPSHOT', error.message);
            if (error instanceof InteractiveRebaseRequestError)
              throw new ExpectedBackendError('OPERATION_FAILED', error.message);
            throw this.mapGitFailure(error, 'Git could not start the interactive rebase.');
          }
        }),
    );
  }

  cancelOperation(ownerId: number, operationId: string): RepositoryOperation | null {
    return this.operations.cancel(ownerId, operationId);
  }

  subscribeOperations(listener: OperationListener): () => void {
    return this.operations.subscribe(listener);
  }

  async previewPush(ownerId: number, request: RepositoryPushPreviewRequest) {
    const summary = this.operationRepository(ownerId, request.id);
    const sessionGeneration = this.sessionGenerations.get(`${ownerId}:${request.id}`);
    const ownerGeneration = this.ownerGenerations.get(ownerId);
    const cwd = summary.worktreePath ?? summary.commonDir;
    const preview = await this.pushPreviews.preview(this.runner, cwd, ownerId, request);
    try {
      this.operationRepository(ownerId, request.id);
      if (
        sessionGeneration !== this.sessionGenerations.get(`${ownerId}:${request.id}`) ||
        ownerGeneration !== this.ownerGenerations.get(ownerId)
      )
        throw new ExpectedBackendError(
          'REPOSITORY_NOT_OPEN',
          'This repository session closed during the push review.',
        );
      return preview;
    } catch (error) {
      this.pushPreviews.release(ownerId, request.id);
      throw error;
    }
  }

  /**
   * Accepts one network operation and reports it as running. The work continues in the background:
   * the caller's request returns the accepted record, so an IPC deadline never decides the outcome of
   * a fetch or a push, and the result arrives through operation events.
   */
  async startNetworkOperation(
    ownerId: number,
    request: RepositoryNetworkRequestEnvelope,
    source: RepositoryOperationSource = 'user',
  ): Promise<RepositoryOperation> {
    let summary = this.operationRepository(ownerId, request.id);
    if (request.request.kind === 'pull' && !request.request.expectedHead) {
      summary = { ...summary, head: await this.discoverHead(summary.path) };
    }
    const cwd = summary.worktreePath ?? summary.commonDir;
    let plan: NetworkPlan;
    try {
      plan = planNetworkOperation({ cwd, head: summary.head, request: request.request });
    } catch (error) {
      if (error instanceof NetworkRequestError) {
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      }
      throw this.mapGitFailure(error, 'Git could not start that operation.');
    }
    // Checked after every await, so two requests that arrive together cannot both be accepted.
    if (this.operations.isBusyForRepository(request.id)) {
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'A network operation is already running for this repository.',
      );
    }

    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: plan.kind,
        source,
        title: plan.title,
        command: plan.command,
      },
      async (handle) => {
        return this.withRepositoryMutation(summary.commonDir, async () => {
          if (handle.signal.aborted) throw new GitCancelledError();
          const current = await this.refreshOpenRepository(ownerId, request.id);
          const action = request.request;
          if (action.kind === 'fast-forward') return this.fastForward(ownerId, request.id, action, handle);
          const remotes = await readRemotes(this.runner, cwd);
          if (
            'remote' in action &&
            action.remote &&
            !remotes.some((remote) => remote.name === action.remote)
          ) {
            return {
              status: 'failed' as const,
              failureReason: 'not-found' as const,
              message: 'Choose a configured remote of this repository.',
              output: '',
            };
          }
          const transportRemotes =
            action.kind === 'fetch' && action.remote === null
              ? remotes.map((remote) => remote.name)
              : 'remote' in action && action.remote
                ? [action.remote]
                : [];
          for (const remote of transportRemotes) {
            if (!(await this.remoteTransportAllowed(cwd, remote))) {
              return {
                status: 'failed' as const,
                failureReason: 'other' as const,
                message: `Git Workbench will not run the configured transport for '${remote}'. Replace its URL first.`,
                output: '',
              };
            }
          }
          if (action.kind === 'push') {
            const context = await this.getReferenceContext(ownerId, request.id);
            for (const target of action.targets) {
              if (!context.branches.some((branch) => branch.fullName === target.fullName))
                throw new ExpectedBackendError(
                  'INVALID_REQUEST',
                  'The selected local branch no longer exists.',
                );
              try {
                await this.runner.run(['check-ref-format', `refs/heads/${target.remoteBranch}`], { cwd });
              } catch (error) {
                if (!(error instanceof GitCommandError)) throw error;
                throw new ExpectedBackendError(
                  'INVALID_REQUEST',
                  'Enter a valid destination branch name before pushing.',
                );
              }
            }
            if (new Set(action.targets.map((target) => target.remoteBranch)).size !== action.targets.length)
              throw new ExpectedBackendError('INVALID_REQUEST', 'Choose each destination branch once.');
            if (action.force === 'with-lease') {
              const args = await this.pushPreviews.consume(this.runner, cwd, ownerId, request.id, action);
              plan = { ...plan, args, command: ['git', ...args].join(' ') };
              handle.setCommand?.(plan.command);
            }
          }
          if (action.kind === 'delete-remote-branch')
            await this.runner.run(['check-ref-format', `refs/heads/${action.remoteBranch}`], { cwd });
          if (action.kind === 'pull') {
            const context = await this.getReferenceContext(ownerId, request.id);
            const destination = context.branches.find(
              (branch) => branch.fullName === (action.into ?? `refs/heads/${summary.head.name}`),
            );
            if (
              !current.worktreePath ||
              !destination ||
              destination.target !== (action.expectedHead ?? summary.head.commit) ||
              (action.snapshot
                ? context.snapshot !== action.snapshot
                : current.head.state !== 'branch' ||
                  current.head.name !== summary.head.name ||
                  !destination.isHead)
            ) {
              throw new ExpectedBackendError(
                'STALE_SNAPSHOT',
                'The destination branch changed before Pull could start. Review the pull again.',
              );
            }
            if (destination.worktreePath)
              throw new ExpectedBackendError(
                'OPERATION_FAILED',
                'The destination is checked out in another worktree.',
              );
            if (action.branch)
              await this.runner.run(['check-ref-format', `refs/heads/${action.branch}`], { cwd });
            const pullRemote = action.remote ?? destination?.upstreamRemote;
            if (pullRemote && !(await this.remoteTransportAllowed(cwd, pullRemote)))
              return {
                status: 'failed' as const,
                failureReason: 'other' as const,
                message: `Git Workbench will not run the configured transport for '${pullRemote}'. Replace its URL first.`,
                output: '',
              };
            const recovery = await this.getRecovery(ownerId, request.id);
            if (recovery.pendingOperation || recovery.copies.some((copy) => copy.pending))
              throw new ExpectedBackendError(
                'OPERATION_FAILED',
                'Finish the pending operation or saved changes in Recovery first.',
              );
            return withLocalChanges(
              this.runner,
              { id: request.id, cwd, gitDir: current.gitDir, head: current.head },
              action.autostash ? 'stash' : 'keep',
              action.changesSnapshot,
              plan.title,
              async () => {
                if (!destination.isHead) {
                  const checkout = await applyReferenceAction(this.runner, {
                    repositoryId: request.id,
                    cwd,
                    gitDir: current.gitDir,
                    worktreePath: current.worktreePath!,
                    head: current.head,
                    snapshot: context.snapshot,
                    action: { kind: 'checkout-branch', fullName: destination.fullName },
                    signal: handle.signal,
                    onCommand: (args) =>
                      handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' ')),
                  });
                  if (checkout.status !== 'applied')
                    throw new ExpectedBackendError('OPERATION_FAILED', checkout.message);
                }
                handle.setCommand?.(plan.command);
                const result = await runNetworkOperation(
                  this.runner,
                  plan,
                  cwd,
                  handle,
                  source === 'background' ? 'silent' : 'prompt',
                );
                if (action.autostash && result.status !== 'succeeded')
                  throw new ExpectedBackendError(
                    'OPERATION_FAILED',
                    `${result.message} Saved changes are available in Recovery.`,
                  );
                return result;
              },
              handle.signal,
            );
          }
          const outcome = await runNetworkOperation(
            this.runner,
            plan,
            cwd,
            handle,
            source === 'background' ? 'silent' : 'prompt',
          );
          if (outcome.status === 'succeeded' && action.kind === 'push') {
            for (const target of action.targets.filter(
              (target) => target.setUpstream || action.setUpstream,
            )) {
              const name = target.fullName.slice('refs/heads/'.length);
              await this.runner.run(['config', `branch.${name}.remote`, action.remote], { cwd });
              await this.runner.run(['config', `branch.${name}.merge`, `refs/heads/${target.remoteBranch}`], {
                cwd,
              });
            }
          }
          return outcome;
        });
      },
    );
  }

  private async fastForward(
    ownerId: number,
    id: string,
    action: Extract<RepositoryNetworkRequestEnvelope['request'], { kind: 'fast-forward' }>,
    handle: OperationHandle,
  ) {
    const summary = await this.requireWorktree(ownerId, id);
    const context = await this.getReferenceContext(ownerId, id);
    if (context.snapshot !== action.snapshot)
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'The branch changed. Review the fast-forward again.');
    const branch = context.branches.find((candidate) => candidate.fullName === action.fullName);
    if (!branch || !branch.upstreamRemote || !branch.upstreamBranch)
      throw new ExpectedBackendError('OPERATION_FAILED', 'This branch has no upstream to fast-forward from.');
    if (branch.worktreePath)
      throw new ExpectedBackendError('OPERATION_FAILED', 'This branch is checked out in another worktree.');
    if (context.pendingOperation)
      throw new ExpectedBackendError('OPERATION_FAILED', 'Finish the pending Git operation first.');
    const cwd = summary.worktreePath;
    if (!(await this.remoteTransportAllowed(cwd, branch.upstreamRemote)))
      return {
        status: 'failed' as const,
        failureReason: 'other' as const,
        message: `Git Workbench will not run the configured transport for '${branch.upstreamRemote}'. Replace its URL first.`,
        output: '',
      };
    const fetch = await runNetworkOperation(
      this.runner,
      {
        kind: 'fetch',
        args: [
          'fetch',
          '--progress',
          '--no-auto-gc',
          '--',
          branch.upstreamRemote,
          `refs/heads/${branch.upstreamBranch}`,
        ],
        title: 'Fetch upstream',
        command: 'git fetch',
      },
      cwd,
      handle,
    );
    if (fetch.status !== 'succeeded') return fetch;
    const target = (
      await this.runner.run(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd })
    ).stdout.trim();
    try {
      await this.runner.run(['merge-base', '--is-ancestor', branch.target, target], { cwd });
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'The branch diverged; check it out and merge or rebase instead.',
      );
    }
    const args = branch.isHead
      ? ['merge', '--ff-only', '--no-autostash', target]
      : ['update-ref', '-m', 'Git Workbench fast-forward', branch.fullName, target, branch.target];
    handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' '));
    await this.runner.run(args, { cwd, signal: handle.signal, timeoutMs: 120000 });
    return {
      status: 'succeeded' as const,
      message: `Fast-forwarded '${branch.name}' to '${branch.upstream}'.`,
      output: fetch.output,
    };
  }

  async previewLocalChanges(ownerId: number, id: string): Promise<RepositoryLocalChangesPreview> {
    const summary = await this.requireWorktree(ownerId, id);
    return previewLocalChanges(this.runner, {
      id,
      cwd: summary.worktreePath,
      gitDir: summary.gitDir,
      head: summary.head,
    });
  }

  async getRecovery(ownerId: number, id: string): Promise<RepositoryRecoveryState> {
    const summary = await this.refreshOpenRepository(ownerId, id);
    if (!summary.worktreePath)
      throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree.');
    return readRecovery(this.runner, {
      id,
      cwd: summary.worktreePath,
      gitDir: summary.gitDir,
      head: summary.head,
    });
  }

  async listStashes(ownerId: number, id: string): Promise<RepositoryStashEntry[]> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readStashes(this.runner, summary.worktreePath);
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not read the saved stashes.');
    }
  }

  async getStashDetails(ownerId: number, id: string, stashId: string): Promise<RepositoryStashDetails> {
    const summary = await this.requireWorktree(ownerId, id);
    try {
      return await readStashDetails(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath,
        stashId,
      });
    } catch (error) {
      if (error instanceof StashNotFoundError)
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      throw this.mapGitFailure(error, 'Git could not inspect the selected stash.');
    }
  }

  startStashOperation(ownerId: number, request: RepositoryStashActionRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    const action = request.request;
    const title =
      action.kind === 'save'
        ? action.paths.length > 0
          ? 'Save selected changes as stash'
          : 'Save changes as stash'
        : `${action.kind[0]!.toUpperCase()}${action.kind.slice(1)} stash`;
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'stash',
        title,
        command: `git stash ${action.kind}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          try {
            return await this.runStashAction(request, summary, handle);
          } catch (error) {
            if (error instanceof ExpectedBackendError) throw error;
            throw this.mapGitFailure(error, 'Git could not update the saved stashes.');
          }
        }),
    );
  }

  async patchExportContent(ownerId: number, request: RepositoryPatchExportRequest): Promise<string> {
    const summary = await this.refreshOpenRepository(ownerId, request.id, false);
    if (
      request.target.kind === 'working' &&
      request.target.changesSnapshot &&
      (await this.previewLocalChanges(ownerId, request.id)).snapshot !== request.target.changesSnapshot
    )
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Working changes changed before export. Review them again.',
      );
    const bytes = await readPatch(this.runner, {
      repositoryId: request.id,
      cwd: summary.worktreePath ?? summary.commonDir,
      target: request.target,
    });
    const content = bytes.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes))
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'This patch is not UTF-8 text. Save it to a file to preserve its bytes.',
      );
    return content;
  }

  async previewPatch(
    ownerId: number,
    id: string,
    bytes: Buffer,
    location: string,
  ): Promise<RepositoryPatchPreview> {
    const summary = await this.requireWorktree(ownerId, id);
    const preview = await this.previewLocalChanges(ownerId, id);
    const changes = await this.getWorkingChanges(ownerId, id, true, false);
    if (preview.pendingOperation || changes.counts.conflicted)
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Resolve the current conflicts or finish the pending operation before applying a patch.',
      );
    return this.patches.prepare(
      this.runner,
      ownerId,
      id,
      summary.worktreePath,
      bytes,
      location,
      preview.snapshot,
    );
  }

  releasePatch(ownerId: number, request: RepositoryPatchApplyRequest): null {
    this.patches.release(ownerId, request.id, request.token);
    return null;
  }

  applyPatch(ownerId: number, request: RepositoryPatchApplyRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'patch',
        title: 'Apply Patch',
        command: 'git apply --3way --whitespace=nowarn',
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const entry = this.patches.take(ownerId, request.id, request.token);
          const summary = await this.requireWorktree(ownerId, request.id);
          const current = await this.previewLocalChanges(ownerId, request.id);
          if (current.snapshot !== entry.snapshot)
            throw new ExpectedBackendError(
              'STALE_SNAPSHOT',
              'The repository changed after patch preflight. Select the patch again.',
            );
          await validatePatch(this.runner, summary.worktreePath, entry.bytes);
          try {
            const applied = await this.runner.run(['apply', '--3way', '--whitespace=nowarn', '-'], {
              cwd: summary.worktreePath,
              stdin: entry.bytes,
              signal: handle.signal,
              timeoutMs: 120000,
              maxOutputBytes: 64 * 1024,
            });
            return {
              status: 'succeeded',
              message: 'Patch applied and staged. No commit was created.',
              output: applied.stderr,
            };
          } catch (error) {
            if (!(error instanceof GitCommandError)) throw error;
            return {
              status: 'failed',
              message:
                'Patch application did not complete cleanly. Review Local Changes and resolve any conflicts before committing.',
              output: error.stderr,
            };
          }
        }),
    );
  }

  async savePatch(
    ownerId: number,
    request: RepositoryPatchExportRequest,
    destination: string,
  ): Promise<RepositoryPatchExportResult> {
    const summary = await this.refreshOpenRepository(ownerId, request.id, false);
    if (request.target.kind === 'working' && !summary.worktreePath)
      throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree to export.');
    const cwd = summary.worktreePath ?? summary.commonDir;
    if (!isAbsolute(destination) || destination.includes('\0') || destination.length > 32_768)
      throw new ExpectedBackendError('INVALID_REQUEST', 'Choose a valid absolute patch destination.');
    try {
      if ((await stat(destination).catch(() => undefined))?.isDirectory())
        throw new ExpectedBackendError('OPERATION_FAILED', 'The selected patch destination is a directory.');
      if (request.target.kind === 'working' && request.target.changesSnapshot) {
        const preview = await previewLocalChanges(this.runner, {
          id: request.id,
          cwd,
          gitDir: summary.gitDir,
          head: summary.head,
        });
        if (preview.snapshot !== request.target.changesSnapshot)
          throw new ExpectedBackendError(
            'STALE_SNAPSHOT',
            'Working-tree changes changed before the patch could be saved. Review them again.',
          );
      }
      const content = await readPatch(this.runner, {
        repositoryId: request.id,
        cwd,
        target: request.target,
      });
      const byteLength = Buffer.byteLength(content, 'utf8');
      await writeFile(destination, content, { encoding: 'utf8', mode: 0o600 });
      return {
        status: 'saved',
        path: destination,
        byteLength,
        message: `Saved ${byteLength.toLocaleString()} bytes as a patch.`,
      };
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      if (error instanceof StashNotFoundError)
        throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      if (error instanceof GitCommandError)
        throw this.mapGitFailure(error, 'Git could not create the selected patch.');
      if (error instanceof Error) throw new ExpectedBackendError('OPERATION_FAILED', error.message);
      throw this.mapGitFailure(error, 'Git could not save the selected patch.');
    }
  }

  private async runStashAction(
    request: RepositoryStashActionRequest,
    summary: RepositorySummary,
    handle: OperationHandle,
  ): Promise<OperationOutcome> {
    const action = request.request;
    const context = {
      id: request.id,
      cwd: summary.worktreePath!,
      gitDir: summary.gitDir,
      head: summary.head,
    };
    if (action.kind === 'save') {
      const preview = await previewLocalChanges(this.runner, context);
      if (action.changesSnapshot && action.changesSnapshot !== preview.snapshot)
        throw new ExpectedBackendError(
          'STALE_SNAPSHOT',
          'Working-tree changes changed before the stash could be saved. Review them again.',
        );
      if (preview.pendingOperation)
        return {
          status: 'failed',
          failureReason: 'other',
          message: `Finish or abort the ${preview.pendingOperation} before saving a stash.`,
          output: '',
        };
      const working = await readWorkingChanges(this.runner, {
        repositoryId: request.id,
        cwd: context.cwd,
        includeUntracked: true,
        includeIgnored: false,
      });
      const currentTrackedPaths = [...working.staged, ...working.unstaged].map((change) => change.path);
      const currentUntrackedPaths = working.untracked.map((change) => change.path);
      const includeNew = action.stageNewFiles || action.includeUntracked;
      const selectedPaths =
        action.paths.length > 0
          ? [...new Set(action.paths)]
          : [
              ...new Set(
                includeNew ? [...currentTrackedPaths, ...currentUntrackedPaths] : currentTrackedPaths,
              ),
            ];
      if (selectedPaths.length === 0)
        return {
          status: 'failed',
          failureReason: 'other',
          message: 'There are no local changes to stash.',
          output: '',
        };
      const untracked = new Set(currentUntrackedPaths);
      const allPaths = new Set([...currentTrackedPaths, ...currentUntrackedPaths]);
      if (selectedPaths.some((path) => !allPaths.has(path)))
        throw new ExpectedBackendError(
          'STALE_SNAPSHOT',
          'A selected path is no longer changed. Review the files again.',
        );
      if (!includeNew && selectedPaths.some((path) => untracked.has(path)))
        throw new ExpectedBackendError(
          'INVALID_REQUEST',
          'Choose Stage new files before stashing the selected untracked path.',
        );
      const args = ['stash', 'push'];
      if (action.message.trim()) args.push(`--message=${action.message.trim()}`);
      if (action.includeUntracked && !action.stageNewFiles) args.push('--include-untracked');
      args.push('--', ...selectedPaths);
      handle.setCommand?.(['git', 'stash', 'push'].join(' '));
      const newPaths = action.stageNewFiles ? selectedPaths.filter((path) => untracked.has(path)) : [];
      try {
        // The captured checkbox stages new files before stash, producing an index parent and two
        // parents total. It deliberately differs from Git's three-parent --include-untracked form.
        if (newPaths.length)
          await this.runner.run(['add', '--', ...newPaths], {
            cwd: context.cwd,
            signal: handle.signal,
            timeoutMs: 120_000,
            maxOutputBytes: 64 * 1024,
          });
        await this.runner.run(args, {
          cwd: context.cwd,
          signal: handle.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 4 * 1024 * 1024,
        });
      } catch (error) {
        // Unstage only paths that were untracked in the reviewed snapshot. Their files stay present.
        if (newPaths.length && context.head.commit)
          await this.runner
            .run(['reset', '--quiet', 'HEAD', '--', ...newPaths], { cwd: context.cwd })
            .catch(() => undefined);
        return this.stashCommandFailure(error, 'Git could not save those changes as a stash.');
      }
      const commitId = (
        await this.runner.run(['rev-parse', '--verify', 'refs/stash'], { cwd: context.cwd })
      ).stdout.trim();
      const created = (await readStashes(this.runner, context.cwd)).find(
        (stash) => stash.commitId === commitId,
      );
      return {
        status: 'succeeded',
        message: created
          ? `Saved stash '${created.message || created.selector}'.`
          : 'Saved the local changes as a stash.',
        output: '',
      };
    }

    const entries = await readStashes(this.runner, context.cwd);
    const entry =
      'stashId' in action ? entries.find((candidate) => candidate.commitId === action.stashId) : undefined;
    if (!entry)
      return {
        status: 'failed',
        failureReason: 'not-found',
        message: 'That stash no longer exists. Refresh the stash list.',
        output: '',
      };
    const recovery = await readRecovery(this.runner, context);
    const isRecoveryCopy = recovery.copies.some((copy) => copy.commitId === entry.commitId);
    if (isRecoveryCopy && (action.kind === 'drop' || action.kind === 'pop' || action.kind === 'rename'))
      return {
        status: 'failed',
        failureReason: 'other',
        message: 'That stash is a Recovery copy. Use the Recovery panel so it remains recoverable.',
        output: '',
      };
    if (action.kind === 'rename') {
      const message = entry.branch ? `On ${entry.branch}: ${action.message.trim()}` : action.message.trim();
      try {
        // Store before dropping: a failed or interrupted rename leaves a recoverable duplicate.
        await this.runner.run(['stash', 'store', '--message', message, entry.commitId], {
          cwd: context.cwd,
          signal: handle.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 64 * 1024,
        });
        const updated = await readStashes(this.runner, context.cwd);
        const index = entries.findIndex((candidate) => candidate.selector === entry.selector);
        if (
          updated.length !== entries.length + 1 ||
          updated[0]?.commitId !== entry.commitId ||
          entries.some((candidate, offset) => updated[offset + 1]?.commitId !== candidate.commitId)
        ) {
          return {
            status: 'failed',
            failureReason: 'other',
            message:
              'The stash was renamed, but the list changed before its old entry could be removed. Review the retained entries.',
            output: '',
          };
        }
        await this.runner.run(['stash', 'drop', updated[index + 1]!.selector], {
          cwd: context.cwd,
          signal: handle.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 64 * 1024,
        });
        return {
          status: 'succeeded',
          message: 'Renamed the stash and moved it to the top of the list.',
          output: '',
        };
      } catch (error) {
        return this.stashCommandFailure(
          error,
          'The stash could not be renamed. Its saved contents were retained.',
        );
      }
    }
    if (action.kind === 'drop') {
      handle.setCommand?.(['git', 'stash', 'drop', JSON.stringify(entry.selector)].join(' '));
      try {
        await this.runner.run(['stash', 'drop', entry.selector], {
          cwd: context.cwd,
          signal: handle.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 64 * 1024,
        });
      } catch (error) {
        return this.stashCommandFailure(error, 'Git could not delete that stash.');
      }
      return { status: 'succeeded', message: `Deleted ${entry.selector}.`, output: '' };
    }

    const preview = await previewLocalChanges(this.runner, context);
    if ('changesSnapshot' in action && action.changesSnapshot && action.changesSnapshot !== preview.snapshot)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Working-tree changes changed before the stash could be applied. Review them again.',
      );
    if (preview.pendingOperation)
      return {
        status: 'failed',
        failureReason: 'other',
        message: `Finish or abort the ${preview.pendingOperation} before applying a stash.`,
        output: '',
      };
    if (preview.paths.length > 0)
      return {
        status: 'failed',
        failureReason: 'local-changes',
        message: 'Tracked files have local changes. Save or commit them before applying a stash.',
        output: '',
      };
    handle.setCommand?.(['git', 'stash', 'apply', '--index', JSON.stringify(entry.selector)].join(' '));
    try {
      await this.runner.run(['stash', 'apply', '--index', entry.selector], {
        cwd: context.cwd,
        signal: handle.signal,
        timeoutMs: 120_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
    } catch (error) {
      return this.stashCommandFailure(
        error,
        action.kind === 'pop'
          ? 'The stash could not be applied, so it was retained.'
          : 'The stash could not be applied. It was retained.',
      );
    }
    if (action.kind === 'pop') {
      try {
        await this.runner.run(['stash', 'drop', entry.selector], {
          cwd: context.cwd,
          signal: handle.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 64 * 1024,
        });
      } catch (error) {
        const failure = this.stashCommandFailure(
          error,
          'The stash was applied but could not be deleted; it was retained.',
        );
        return { ...failure, message: `${failure.message} The saved stash remains available.` };
      }
      return { status: 'succeeded', message: `Applied and deleted ${entry.selector}.`, output: '' };
    }
    return { status: 'succeeded', message: `Applied ${entry.selector}; the stash was retained.`, output: '' };
  }

  private stashCommandFailure(error: unknown, fallback: string): OperationOutcome {
    if (error instanceof GitCommandError) {
      const output = displayOutput(error.stdout, error.stderr).slice(0, 65_536);
      return {
        status: 'failed',
        failureReason: /CONFLICT|conflict|unmerged/iu.test(output) ? 'conflict' : 'other',
        message: output ? `${fallback} ${output.slice(0, 400)}` : fallback,
        output,
      };
    }
    if (error instanceof GitCancelledError)
      return {
        status: 'failed',
        failureReason: 'cancelled',
        message: 'The stash operation was cancelled.',
        output: '',
      };
    if (error instanceof GitTimeoutError)
      return {
        status: 'failed',
        failureReason: 'timeout',
        message: 'Git took too long to update the stash.',
        output: '',
      };
    return { status: 'failed', failureReason: 'other', message: fallback, output: '' };
  }

  startRecovery(ownerId: number, request: RepositoryRecoveryRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'recovery',
        title: 'Recover repository',
        command: `Git recovery: ${request.action}`,
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          await recover(
            this.runner,
            { id: request.id, cwd: summary.worktreePath, gitDir: summary.gitDir, head: summary.head },
            request,
            handle.signal,
          );
          return {
            status: 'succeeded',
            message: 'Recovery action completed. Saved Git stashes are retained.',
            output: '',
          };
        }),
    );
  }

  async getRevisionTree(
    ownerId: number,
    id: string,
    commitId: string,
    path: string,
    offset?: number,
  ): Promise<RepositoryRevisionTree> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readRevisionTree(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        commitId,
        path,
        offset,
      });
    } catch (error) {
      throw this.mapRevisionFailure(error, 'Git could not read the selected revision tree.');
    }
  }

  async getRevisionBlob(
    ownerId: number,
    id: string,
    commitId: string,
    path: string,
  ): Promise<RepositoryRevisionBlob> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readRevisionBlob(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        commitId,
        path,
      });
    } catch (error) {
      throw this.mapRevisionFailure(error, 'Git could not read the selected revision file.');
    }
  }

  async getLfsFile(ownerId: number, id: string, commitId: string, path: string): Promise<RepositoryLfsFile> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readLfsFile(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        worktreePath: summary.worktreePath,
        commitId,
        path,
      });
    } catch (error) {
      throw this.mapLfsFailure(error, 'Git could not inspect the selected LFS file.');
    }
  }

  startLfsInitialization(ownerId: number, request: RepositoryLfsInitializationRequest): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    if (!cached.worktreePath)
      throw new ExpectedBackendError('UNAVAILABLE', 'A bare repository has no Git LFS working tree.');
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'lfs',
        title: 'Initialize Git LFS',
        command: 'git lfs install --local',
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.requireWorktree(ownerId, request.id);
          handle.setCommand?.('git lfs install --local');
          handle.setProgress({ phase: 'Installing Git LFS hooks', percent: null });
          try {
            const result = await this.runner.run(['lfs', 'install', '--local'], {
              cwd: summary.worktreePath,
              signal: handle.signal,
              timeoutMs: 120_000,
              maxOutputBytes: 64 * 1024,
            });
            return {
              status: 'succeeded' as const,
              message: 'Initialized Git LFS for this repository.',
              output: displayOutput(result.stdout, result.stderr),
            };
          } catch (error) {
            if (error instanceof GitCommandError) {
              const output = displayOutput(error.stdout, error.stderr).slice(0, 65_536);
              const unavailable = /not a git command|unknown command|not found|cannot find/iu.test(output);
              return {
                status: 'failed' as const,
                failureReason: 'other' as const,
                message: unavailable
                  ? 'Git LFS is not installed. Install git-lfs and retry.'
                  : output
                    ? `Git LFS could not be initialized. ${output.slice(0, 400)}`
                    : 'Git LFS could not be initialized.',
                output,
              };
            }
            throw this.mapGitFailure(error, 'Git LFS could not be initialized.');
          }
        }),
    );
  }

  startLfsPayloadSave(
    ownerId: number,
    request: RepositoryLfsSaveRequest,
    destination: string,
  ): RepositoryOperation {
    const cached = this.operationRepository(ownerId, request.id);
    return this.startOperation(
      {
        ownerId,
        repositoryId: request.id,
        kind: 'lfs',
        title: 'Save historical LFS payload',
        command: 'Git LFS Save As',
      },
      (handle) =>
        this.withRepositoryMutation(cached.commonDir, async () => {
          const summary = await this.refreshOpenRepository(ownerId, request.id, false);
          try {
            const value = await saveLfsPayload(
              this.runner,
              {
                repositoryId: request.id,
                cwd: summary.worktreePath ?? summary.commonDir,
                worktreePath: summary.worktreePath,
                commitId: request.commitId,
                path: request.path,
              },
              destination,
              handle,
            );
            return {
              status: 'succeeded' as const,
              message: `Saved ${value.byteLength.toLocaleString()} bytes of LFS content.`,
              output: `SHA-256 ${value.sha256}`,
              result: { kind: 'lfs' as const, value },
            };
          } catch (error) {
            if (error instanceof LfsPayloadError) {
              return {
                status: 'failed' as const,
                failureReason: 'other' as const,
                message: error.message,
                output: '',
              };
            }
            throw this.mapGitFailure(error, 'The historical LFS payload could not be saved.');
          }
        }),
    );
  }

  async getFileHistory(
    ownerId: number,
    id: string,
    commitId: string,
    path: string,
  ): Promise<RepositoryFileHistory> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readFileHistory(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        commitId,
        path,
      });
    } catch (error) {
      throw this.mapFileHistoryFailure(error, 'Git could not read the selected file history.');
    }
  }

  async getBlame(ownerId: number, id: string, commitId: string, path: string): Promise<RepositoryBlame> {
    const summary = await this.refreshOpenRepository(ownerId, id, false);
    try {
      return await readBlame(this.runner, {
        repositoryId: id,
        cwd: summary.worktreePath ?? summary.commonDir,
        commitId,
        path,
      });
    } catch (error) {
      throw this.mapFileHistoryFailure(error, 'Git could not read blame for the selected file.');
    }
  }

  async removeRecent(id: string): Promise<void> {
    await this.store.remove(id);
  }

  subscribeInvalidations(listener: (ownerId: number, event: RepositoryInvalidation) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  private publishInvalidation(ownerId: number, event: RepositoryInvalidation): void {
    for (const listener of this.invalidationListeners) listener(ownerId, event);
  }

  private watchRepository(ownerId: number, summary: RepositorySummary): void {
    const existing = this.watches.get(summary.id);
    if (existing) {
      existing.owners.add(ownerId);
      return;
    }
    const owners = new Set([ownerId]);
    const roots: { path: string; kind: 'worktree' | 'git' }[] = [{ path: summary.gitDir, kind: 'git' }];
    if (summary.commonDir !== summary.gitDir) roots.push({ path: summary.commonDir, kind: 'git' });
    if (summary.worktreePath) roots.push({ path: summary.worktreePath, kind: 'worktree' });
    const watcher = new DirectoryWatcher(roots, (watching) => {
      this.runner.invalidate();
      for (const owner of owners)
        this.publishInvalidation(owner, {
          kind: 'repository',
          id: summary.id,
          revision: ++this.invalidationRevision,
          watching,
        });
    });
    this.watches.set(summary.id, { watcher, owners });
  }

  private releaseWatch(ownerId: number, id: string): void {
    const entry = this.watches.get(id);
    if (!entry) return;
    entry.owners.delete(ownerId);
    if (!entry.owners.size) {
      entry.watcher.dispose();
      this.watches.delete(id);
    }
  }

  private invalidateManager(): void {
    for (const owner of this.managerOwners) {
      if (this.managerScans.get(owner)?.state.state === 'scanning') this.managerRescanPending.add(owner);
      this.publishInvalidation(owner, { kind: 'manager', revision: ++this.invalidationRevision });
    }
  }

  startManagerScan(ownerId: number): RepositoryManagerScan {
    const previous = this.managerScans.get(ownerId);
    if (previous?.state.state === 'scanning') return previous.state;
    const state: RepositoryManagerScan = {
      generation: (previous?.state.generation ?? 0) + 1,
      state: 'scanning',
      snapshot: previous?.state.snapshot ?? null,
      error: null,
    };
    const job = { state, controller: new AbortController() };
    this.managerScans.set(ownerId, job);
    void this.listManager(ownerId, job.controller.signal).then(
      (snapshot) => {
        if (job.controller.signal.aborted || this.managerScans.get(ownerId) !== job) return;
        job.state = { ...state, state: 'complete', snapshot };
        if (this.managerRescanPending.delete(ownerId)) this.startManagerScan(ownerId);
      },
      (error: unknown) => {
        if (job.controller.signal.aborted || this.managerScans.get(ownerId) !== job) return;
        job.state = {
          ...state,
          state: 'failed',
          error:
            error instanceof ExpectedBackendError
              ? error.message
              : 'Source directories could not be scanned.',
        };
      },
    );
    return state;
  }

  getManagerScan(ownerId: number): RepositoryManagerScan {
    return (
      this.managerScans.get(ownerId)?.state ?? { generation: 0, state: 'idle', snapshot: null, error: null }
    );
  }

  cancelManagerScan(ownerId: number): null {
    this.managerRescanPending.delete(ownerId);
    const job = this.managerScans.get(ownerId);
    if (job?.state.state === 'scanning') {
      job.controller.abort();
      job.state = { ...job.state, state: 'cancelled' };
    }
    return null;
  }

  async editManager(ownerId: number, action: RepositoryManagerAction): Promise<null> {
    if (action.kind === 'add-source') {
      const path = await this.canonicalDirectory(action.path);
      await this.managerStore.add({ id: this.sourceDirectoryId(path), path });
      this.invalidateManager();
      return null;
    }
    const path =
      action.kind === 'edit-repository'
        ? await this.managerLocationPath(ownerId, action.location)
        : undefined;
    await this.managerStore.edit(action, path);
    if (path && action.kind === 'edit-repository') {
      for (const [owner, sessions] of this.sessions)
        for (const [id, summary] of sessions)
          if (summary.path === path) {
            sessions.set(id, { ...summary, name: action.name || basename(path) });
            this.publishInvalidation(owner, {
              kind: 'repository',
              id,
              revision: ++this.invalidationRevision,
              watching: 'active',
            });
          }
    }
    this.invalidateManager();
    return null;
  }

  private async managerLocationPath(ownerId: number, location: RepositoryManagerLocation): Promise<string> {
    const path =
      location.kind === 'recent'
        ? (await this.store.list()).find((entry) => entry.id === location.id)?.path
        : this.managerRepositoryPaths.get(ownerId)?.get(location.id);
    if (!path) throw new ExpectedBackendError('PATH_NOT_FOUND', 'That repository is no longer listed.');
    return path;
  }

  async getManagerOverview(
    ownerId: number,
    location: RepositoryManagerLocation,
  ): Promise<RepositoryManagerOverview> {
    const path = await this.managerLocationPath(ownerId, location);
    const summary = await this.discover(await this.canonicalDirectory(path));
    const cwd = summary.path;
    const refs = async (prefix: string) => {
      const result = await this.runRead(
        [
          'for-each-ref',
          '--count=20',
          '--sort=-committerdate',
          '--format=%(refname:short)%00%(subject)%00%(authorname)%00%(committerdate:iso-strict)',
          prefix,
        ],
        cwd,
      );
      return result.stdout
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name = '', subject = '', author = '', date = ''] = line.split('\0');
          return { name, subject, author, date };
        });
    };
    const [count, first, last, branches, tags, remotes] = await Promise.all([
      this.runRead(['rev-list', '--all', '--count'], cwd),
      this.runRead(['log', '--all', '--max-parents=0', '--format=%aI'], cwd),
      this.runRead(['log', '--all', '-1', '--format=%aI'], cwd),
      refs('refs/heads'),
      refs('refs/tags'),
      readRemotes(this.runner, cwd),
    ]);
    return {
      name: summary.name,
      path: summary.path,
      workingTree: summary.workingTree,
      commitCount: Number(count.stdout.trim()),
      firstCommitAt: first.stdout.trim().split('\n').filter(Boolean).sort()[0] ?? null,
      lastCommitAt: last.stdout.trim() || null,
      branches,
      tags,
      remotes: remotes.slice(0, 100).map((remote) => ({ name: remote.name, url: remote.fetchUrl })),
    };
  }

  async getWorkspaceRecovery(ownerId: number): Promise<WorkspaceRecovery> {
    await this.ensureSessions(ownerId);
    await Promise.all([this.store.list(), this.managerStore.configuration()]);
    const tabs: WorkspaceRecovery['tabs'] = [];
    for (const tab of await this.tabStore.listTabs()) {
      if (!this.sessions.get(ownerId)?.has(tab.id) || (await recentPathStatus(tab.path)) !== 'available')
        tabs.push({
          ...tab,
          name: basename(tab.path),
          reason:
            'The saved repository could not be opened. Retry, locate its new folder, or remove the saved tab.',
        });
    }
    const settings: WorkspaceRecovery['settings'] = [];
    for (const file of this.settingsFiles) {
      const names = await readdir(dirname(file)).catch(() => [] as string[]);
      for (const name of names)
        if (name.startsWith(`${basename(file)}.corrupt-`) || name.startsWith(`${basename(file)}.invalid-`))
          settings.push({ name: basename(file), path: join(dirname(file), name) });
    }
    return { tabs, settings: settings.slice(0, 100) };
  }

  async recoverTab(ownerId: number, request: RecoverRepositoryTab): Promise<RepositorySummary | null> {
    await this.ensureSessions(ownerId);
    const generation = this.ownerGenerations.get(ownerId);
    const savedTab = (await this.tabStore.listTabs()).find((tab) => tab.id === request.id);
    const previous = savedTab ?? (await this.store.list()).find((entry) => entry.id === request.id);
    if (!previous) throw new ExpectedBackendError('INVALID_REQUEST', 'That saved tab is no longer listed.');
    if (!request.path) {
      this.sessions.get(ownerId)?.delete(request.id);
      this.releaseWatch(ownerId, request.id);
      await this.tabStore.forget(request.id);
      return null;
    }
    await this.requireGit();
    const directory = await this.canonicalDirectory(request.path);
    const alias = (await this.managerStore.configuration()).repositories.find(
      (entry) => entry.path === previous.path,
    )?.name;
    const summary = await this.discover(directory, alias || undefined);
    if (generation !== this.ownerGenerations.get(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    if (summary.id !== previous.id) {
      if (savedTab) await this.tabStore.replace(previous.id, { id: summary.id, path: summary.path });
      else await this.tabStore.addTab({ id: summary.id, path: summary.path });
      this.sessions.get(ownerId)?.delete(previous.id);
      this.releaseWatch(ownerId, previous.id);
      await this.store.remove(previous.id);
      await this.managerStore.relocate(previous.path, summary.path);
    } else if (!savedTab) {
      await this.tabStore.addTab({ id: summary.id, path: summary.path });
    }
    await this.remember(summary);
    await this.tabStore.setActiveRepositoryId(summary.id);
    if (generation !== this.ownerGenerations.get(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    this.addSession(ownerId, summary);
    const sessions = this.sessions.get(ownerId)!;
    const order = await this.tabStore.listTabs();
    if (this.sessions.get(ownerId) === sessions)
      this.sessions.set(
        ownerId,
        new Map(
          order.flatMap((tab) => (sessions.has(tab.id) ? [[tab.id, sessions.get(tab.id)!] as const] : [])),
        ),
      );
    void this.refreshBackgroundFetch(ownerId, summary);
    return summary;
  }

  async listManager(ownerId: number, signal?: AbortSignal): Promise<RepositoryManagerSnapshot> {
    await this.ensureSessions(ownerId);
    signal?.throwIfAborted();
    if (!this.sessions.has(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    const ownerGeneration = this.ownerGenerations.get(ownerId);
    this.managerOwners.add(ownerId);
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
      signal?.throwIfAborted();
      if (ownerGeneration !== this.ownerGenerations.get(ownerId))
        throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
      if (!this.sourceWatches.has(sourceDirectory.id))
        this.sourceWatches.set(
          sourceDirectory.id,
          new DirectoryWatcher([{ path: sourceDirectory.path, kind: 'source' }], () =>
            this.invalidateManager(),
          ),
        );
      const scan = await this.scanSource(sourceDirectory, signal);
      this.addManagerSource(snapshot, sourceDirectory, scan);
    }
    const configuration = await this.managerStore.configuration();
    for (const saved of configuration.repositories) {
      signal?.throwIfAborted();
      const existing = snapshot.repositories.find(
        (entry) => this.pathKey(entry.path) === this.pathKey(saved.path),
      );
      if (existing) {
        existing.name = saved.name || existing.name;
        existing.groupId = saved.groupId;
        continue;
      }
      if (snapshot.repositories.length >= managerMaxRepositories) break;
      snapshot.repositories.push({
        id: this.managerRepositoryId(saved.path),
        sourceDirectoryId: null,
        folderId: null,
        name: saved.name || basename(saved.path),
        path: saved.path,
        relativePath: '',
        kind: await lstat(join(saved.path, '.git')).then(
          () => 'worktree' as const,
          () => 'bare' as const,
        ),
        sessionId: openByPath.get(this.pathKey(saved.path)) ?? null,
        groupId: saved.groupId,
        status: await recentPathStatus(saved.path),
      });
    }
    signal?.throwIfAborted();
    if (ownerGeneration !== this.ownerGenerations.get(ownerId))
      throw new ExpectedBackendError('REPOSITORY_NOT_OPEN', 'The repository window was closed.');
    this.managerRepositoryPaths.set(
      ownerId,
      new Map(snapshot.repositories.map((repository) => [repository.id, repository.path])),
    );

    return {
      sourceDirectories: snapshot.sourceDirectories,
      folders: snapshot.folders,
      repositories: snapshot.repositories,
      warnings: snapshot.warnings,
      groups: configuration.groups,
      defaultSourceId: configuration.defaultSourceId,
    };
  }

  async addSourceDirectory(ownerId: number, inputPath: string): Promise<RepositoryManagerSnapshot> {
    const directory = await this.canonicalDirectory(inputPath);
    await this.managerStore.add({ id: this.sourceDirectoryId(directory), path: directory });
    this.invalidateManager();
    return this.listManager(ownerId);
  }

  async removeSourceDirectory(id: string): Promise<void> {
    const removed = await this.managerStore.remove(id);
    this.sourceWatches.get(id)?.dispose();
    this.sourceWatches.delete(id);
    this.invalidateManager();
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
      case 'worktree': {
        const repository = this.sessions.get(ownerId)?.get(location.repositoryId);
        if (!repository)
          throw new ExpectedBackendError(
            'REPOSITORY_NOT_OPEN',
            'Open the repository tab before opening one of its worktrees.',
          );
        const context = await this.getWorktrees(ownerId, location.repositoryId);
        path = context.worktrees.find((worktree) => worktree.id === location.worktreeId)?.path;
        break;
      }
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
    this.cancelManagerScan(ownerId);
    this.managerScans.delete(ownerId);
    this.managerOwners.delete(ownerId);
    this.managerRescanPending.delete(ownerId);
    for (const id of this.watches.keys()) this.releaseWatch(ownerId, id);
    if (!this.managerOwners.size) {
      for (const watcher of this.sourceWatches.values()) watcher.dispose();
      this.sourceWatches.clear();
    }
    this.ai.cancel(ownerId);
    this.patches.release(ownerId);
    this.pushPreviews.release(ownerId);
    for (const [key, controller] of this.statisticsReads)
      if (key.startsWith(`${ownerId}:`)) {
        controller.abort();
        this.statisticsReads.delete(key);
      }
    this.customCommands.disposeOwner(ownerId);
    for (const [key, controller] of this.diffReads)
      if (key.startsWith(`${ownerId}:`)) {
        controller.abort();
        this.diffReads.delete(key);
      }
    this.ownerGenerations.set(ownerId, (this.ownerGenerations.get(ownerId) ?? 0) + 1);
    this.restorePromises.delete(ownerId);
    this.sessions.delete(ownerId);
    this.managerRepositoryPaths.delete(ownerId);
    this.backgroundFetch.removeOwner(ownerId);
    this.operations.disposeOwner(ownerId);
  }

  dispose(): void {
    this.pushPreviews.release();
    for (const entry of this.watches.values()) entry.watcher.dispose();
    this.watches.clear();
    for (const watcher of this.sourceWatches.values()) watcher.dispose();
    this.sourceWatches.clear();
    for (const job of this.managerScans.values()) job.controller.abort();
    this.managerScans.clear();
    this.managerOwners.clear();
    this.managerRescanPending.clear();
    this.invalidationListeners.clear();
    this.runner.dispose();
    this.ai.disable();
    this.patches.clear();
    for (const controller of this.statisticsReads.values()) controller.abort();
    this.statisticsReads.clear();
    this.statistics.clear();
    for (const controller of this.diffReads.values()) controller.abort();
    this.diffReads.clear();
    this.ownerGenerations.clear();
    this.restorePromises.clear();
    this.sessions.clear();
    this.sessionGenerations.clear();
    this.managerRepositoryPaths.clear();
    this.mutationQueues.clear();
    this.topologyKeys.clear();
    this.backgroundFetch.dispose();
    this.releaseOperationSubscription();
    this.operations.dispose();
  }

  async settled(): Promise<void> {
    await Promise.all([this.operations.settled(), this.runner.settled()]);
  }

  private async withRepositoryMutation<T>(
    key: string,
    operation: () => Promise<T>,
    requireTrust = true,
  ): Promise<T> {
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mutationQueues.set(key, current);
    const signal = this.operationScope.getStore();
    try {
      await new Promise<void>((resolve, reject) => {
        const cancel = () => reject(new GitCancelledError());
        signal?.addEventListener('abort', cancel, { once: true });
        void previous.then(() => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        });
        if (signal?.aborted) cancel();
      });
    } catch (error) {
      // Keep the serial barrier until preceding work exits, even though this queued job is cancelled.
      void previous.then(() => {
        release();
        if (this.mutationQueues.get(key) === current) this.mutationQueues.delete(key);
      });
      throw error;
    }
    try {
      if (signal?.aborted) throw new GitCancelledError();
      this.runner.invalidate();
      return await (requireTrust ? this.repositoryRunner.authorized(key, operation) : operation());
    } finally {
      this.runner.invalidate();
      release();
      if (this.mutationQueues.get(key) === current) this.mutationQueues.delete(key);
    }
  }

  private async closeRemovedWorktreeTabs(path: string, commonDir: string): Promise<void> {
    const target = this.pathKey(path);
    const removals: Array<{ readonly ownerId: number; readonly id: string }> = [];
    for (const [ownerId, sessions] of this.sessions) {
      for (const summary of sessions.values()) {
        if (
          summary.worktreePath &&
          this.pathKey(summary.worktreePath) === target &&
          summary.commonDir === commonDir
        )
          removals.push({ ownerId, id: summary.id });
      }
    }
    for (const removal of removals) {
      try {
        await this.close(removal.ownerId, removal.id);
      } catch {
        this.sessions.get(removal.ownerId)?.delete(removal.id);
      }
    }
  }

  private async probeGit(): Promise<GitInfo> {
    try {
      const version = await this.runner.version();
      const capabilities = gitCapabilities(version.version);
      return {
        status: capabilities.supported ? 'available' : 'unsupported',
        version: version.version,
        executable: version.executable,
        minimumVersion: minimumGitVersion,
        capabilities,
      };
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
      throw new ExpectedBackendError(
        'GIT_UNAVAILABLE',
        info.status === 'unsupported'
          ? `Git ${minimumGitVersion} or newer is required. Select a supported Git instance in Preferences.`
          : 'Git is not available on this computer.',
      );
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

  private async discover(directory: string, displayName?: string): Promise<RepositorySummary> {
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
    this.repositoryRunner.register(commonDir, [
      directory,
      absoluteGitDir,
      commonDir,
      ...(worktreePath ? [worktreePath] : []),
    ]);
    const head = await this.discoverHead(directory);
    const workingTree = await this.inspectWorkingTree(bare ? null : worktreePath);
    const displayPath = worktreePath ?? commonDir;
    const alias = (await this.managerStore.configuration()).repositories.find(
      (entry) => entry.path === displayPath,
    )?.name;
    const id = this.repositoryId(worktreePath, commonDir);

    const summary: RepositorySummary = {
      trusted: await this.trust.isTrusted(commonDir),
      id,
      name: alias || displayName || basename(displayPath) || displayPath,
      path: displayPath,
      worktreePath,
      gitDir: absoluteGitDir,
      commonDir,
      bare,
      head,
      workingTree,
    };
    this.topologyKeys.set(id, await this.topologyKey(summary));
    return summary;
  }

  private async discoverHead(directory: string): Promise<RepositoryHead> {
    const fullName = await this.optionalOutput(directory, ['symbolic-ref', '--quiet', 'HEAD']);
    const branch = fullName?.startsWith('refs/heads/') ? fullName.slice('refs/heads/'.length) : fullName;
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
        if (error.stderr.includes('detected dubious ownership'))
          throw new ExpectedBackendError(
            'OPERATION_FAILED',
            'Git refused this repository because of its ownership. Review its ownership and Git safe.directory settings outside the application.',
          );
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

  private async remoteTransportAllowed(cwd: string, remote: string): Promise<boolean> {
    try {
      const result = await this.runner.run(['remote', 'get-url', '--', remote], {
        cwd,
        timeoutMs: repositoryReadTimeoutMs,
        maxOutputBytes: repositoryReadOutputLimit,
      });
      return isAllowedRemoteUrl(result.stdout.trim());
    } catch (error) {
      if (error instanceof GitCommandError) return false;
      throw error;
    }
  }

  private async requireWorktree(
    ownerId: number,
    id: string,
  ): Promise<RepositorySummary & { readonly worktreePath: string }> {
    const summary = await this.refreshOpenRepository(ownerId, id);
    if (!summary.worktreePath) {
      throw new ExpectedBackendError('UNAVAILABLE', 'This repository has no working tree.');
    }
    return { ...summary, worktreePath: summary.worktreePath };
  }

  private async refreshOpenRepository(
    ownerId: number,
    id: string,
    refreshHead = true,
  ): Promise<RepositorySummary> {
    await this.requireGit();
    await this.ensureSessions(ownerId);
    const ownerSessions = this.sessions.get(ownerId);
    const cached = ownerSessions?.get(id);
    const generation = this.sessionGenerations.get(`${ownerId}:${id}`) ?? 0;
    const ownerGeneration = this.ownerGenerations.get(ownerId);
    if (!ownerSessions || !cached) {
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository tab is not open in this window.',
      );
    }

    let summary: RepositorySummary;
    try {
      const key = await this.topologyKey(cached);
      summary =
        key === this.topologyKeys.get(id)
          ? {
              ...cached,
              trusted: await this.trust.isTrusted(cached.commonDir),
              head: refreshHead ? await this.discoverHead(cached.path) : cached.head,
            }
          : await this.discover(cached.path);
    } catch (error) {
      throw this.mapGitFailure(error, 'Git could not refresh the selected repository.');
    }
    if (summary.id !== id) {
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository is no longer open in this window.',
      );
    }
    if (
      this.ownerGenerations.get(ownerId) !== ownerGeneration ||
      !this.sessions.get(ownerId)?.has(id) ||
      generation !== (this.sessionGenerations.get(`${ownerId}:${id}`) ?? 0)
    )
      throw new ExpectedBackendError(
        'REPOSITORY_NOT_OPEN',
        'That repository tab was closed while it was being read.',
      );
    // This request owns its read snapshot. listOpen owns the published tab summary; writing this
    // snapshot back could roll its HEAD/trust/name backwards after a newer refresh or mutation.
    return summary;
  }

  private async refreshSummary(summary: RepositorySummary): Promise<RepositorySummary> {
    summary = { ...summary, trusted: await this.trust.isTrusted(summary.commonDir) };
    if (!summary.trusted)
      return {
        ...summary,
        head: await this.discoverHead(summary.path),
        workingTree: { state: 'unknown', changedFileCount: null },
      };
    if (summary.bare) return { ...summary, head: await this.discoverHead(summary.path) };
    try {
      const [status, refs] = await Promise.all([
        this.runRead(
          [
            '-c',
            'core.fsmonitor=false',
            '-c',
            'core.untrackedCache=false',
            '--no-optional-locks',
            'status',
            '--porcelain=v2',
            '--branch',
            '--untracked-files=normal',
            '-z',
            '--',
          ],
          summary.path,
        ),
        this.runner.run(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream)'], {
          cwd: summary.path,
          maxOutputBytes: 4 * 1024 * 1024,
          timeoutMs: repositoryReadTimeoutMs,
        }),
      ]);
      const fields = status.stdout.split('\0');
      const name = fields.find((field) => field.startsWith('# branch.head '))?.slice(14);
      const oid = fields.find((field) => field.startsWith('# branch.oid '))?.slice(13);
      const commit = oid && /^[a-f0-9]{40,64}$/u.test(oid) ? oid : null;
      const head: RepositoryHead = !name
        ? await this.discoverHead(summary.path)
        : name === '(detached)'
          ? { state: 'detached', name: null, commit }
          : { state: commit ? 'branch' : 'unborn', name, commit };
      const changedFileCount = statusEntryCount(status.stdout);
      return {
        ...summary,
        head,
        workingTree: { state: changedFileCount ? 'dirty' : 'clean', changedFileCount },
        referenceVersion: createHash('sha256').update(JSON.stringify(head)).update(refs.stdout).digest('hex'),
      };
    } catch {
      return {
        ...summary,
        head: { state: 'unknown', name: null, commit: null },
        workingTree: { state: 'unknown', changedFileCount: null },
      };
    }
  }

  private async topologyKey(summary: RepositorySummary): Promise<string> {
    const paths = [summary.path, summary.gitDir, summary.commonDir];
    const identities = await Promise.all(
      paths.map(async (path) => {
        const info = await stat(path);
        return [await realpath(path), info.dev, info.ino];
      }),
    );
    if (summary.worktreePath) {
      const marker = join(summary.worktreePath, '.git');
      const info = await lstat(marker);
      if (info.isFile() && info.size > 32768) throw new Error('Invalid Git directory marker.');
      identities.push([await realpath(marker), info.dev, info.ino]);
      if (info.isFile()) return JSON.stringify([identities, await readFile(marker, 'utf8')]);
    }
    return JSON.stringify(identities);
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
          '--no-optional-locks',
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
    if (error instanceof ExpectedBackendError) return error;
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

  private mapRevisionFailure(error: unknown, fallback: string): ExpectedBackendError {
    if (error instanceof RevisionNotFoundError) {
      return new ExpectedBackendError(
        'OPERATION_FAILED',
        'That commit is no longer available in this repository.',
      );
    }
    if (error instanceof RevisionPathError) {
      return new ExpectedBackendError('OPERATION_FAILED', error.message);
    }
    return this.mapGitFailure(error, fallback);
  }

  private mapLfsFailure(error: unknown, fallback: string): ExpectedBackendError {
    if (error instanceof LfsRevisionNotFoundError) {
      return new ExpectedBackendError(
        'OPERATION_FAILED',
        'That commit is no longer available in this repository.',
      );
    }
    if (error instanceof LfsPathError || error instanceof LfsPayloadError) {
      return new ExpectedBackendError('OPERATION_FAILED', error.message);
    }
    return this.mapGitFailure(error, fallback);
  }

  private mapFileHistoryFailure(error: unknown, fallback: string): ExpectedBackendError {
    if (error instanceof FileHistoryNotFoundError) {
      return new ExpectedBackendError('OPERATION_FAILED', 'That historical revision is no longer available.');
    }
    if (error instanceof FileHistoryPathError) {
      return new ExpectedBackendError('OPERATION_FAILED', error.message);
    }
    return this.mapGitFailure(error, fallback);
  }

  private async remember(summary: RepositorySummary): Promise<void> {
    await this.managerStore.remember(summary.path);
    await this.store.add({
      id: summary.id,
      name: summary.name,
      path: summary.path,
      lastOpenedAt: this.clock().toISOString(),
    });
  }

  private addSession(ownerId: number, summary: RepositorySummary): void {
    const ownerSessions = this.sessions.get(ownerId) ?? new Map<string, RepositorySummary>();
    if (!ownerSessions.has(summary.id))
      this.sessionGenerations.set(
        `${ownerId}:${summary.id}`,
        (this.sessionGenerations.get(`${ownerId}:${summary.id}`) ?? 0) + 1,
      );
    ownerSessions.set(summary.id, summary);
    this.sessions.set(ownerId, ownerSessions);
    this.watchRepository(ownerId, summary);
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
    if (this.ownerGenerations.get(ownerId) === generation) {
      this.sessions.set(ownerId, restored);
      for (const summary of restored.values()) {
        this.watchRepository(ownerId, summary);
        void this.refreshBackgroundFetch(ownerId, summary);
      }
    }
  }

  private repositoryId(worktreePath: string | null, commonDir: string): string {
    const identity = `${worktreePath ?? ''}\0${commonDir}`;
    return `repo-${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
  }

  private async scanSource(
    sourceDirectory: SourceDirectoryRecord,
    signal?: AbortSignal,
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

    const scan = await scanSourceDirectory(sourceDirectory.path, this.sourceScanOptions, signal);
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
    if (records[index]?.startsWith('# ')) continue;
    count += 1;
    // Porcelain v2 rename/copy records carry the original path as a second NUL-delimited field.
    if (records[index]?.startsWith('2 ')) index += 1;
  }
  return count;
}

function worktreeOperationFailure(
  value: RepositoryWorktreeActionResult,
): NonNullable<RepositoryOperation['failureReason']> | undefined {
  if (value.status === 'applied') return undefined;
  return value.reason === 'dirty' ? 'local-changes' : value.reason === 'stale' ? 'other' : 'other';
}

function submoduleOperationFailure(
  value: RepositorySubmoduleActionResult,
): NonNullable<RepositoryOperation['failureReason']> | undefined {
  if (value.status === 'applied') return undefined;
  if (value.reason === 'dirty') return 'local-changes';
  if (value.reason === 'conflict') return 'conflict';
  if (value.reason === 'missing' || value.reason === 'not-found') return 'not-found';
  return 'other';
}

function gitFlowOperationFailure(
  value: RepositoryGitFlowActionResult,
): NonNullable<RepositoryOperation['failureReason']> | undefined {
  if (value.status === 'applied') return undefined;
  if (value.reason === 'dirty') return 'local-changes';
  if (value.reason === 'conflict') return 'conflict';
  if (value.reason === 'identity') return 'other';
  return 'other';
}
