import type {
  AppInfo,
  ClipboardText,
  EditCommand,
  GitInfo,
  RecentRepository,
  RepositoryAmendChanges,
  RepositoryAmendChangesRequest,
  RepositoryCommitChanges,
  RepositoryCommitChangesRequest,
  RepositoryCommitContext,
  RepositoryCommitContextRequest,
  RepositoryCommitRequest,
  RepositoryDiff,
  RepositoryDiffRequest,
  RepositoryDiffCancel,
  RepositoryDiscardPreview,
  RepositoryDiscardPreviewRequest,
  RepositoryInitializeRequest,
  RepositoryHistoryPage,
  RepositoryHistoryRequest,
  RepositoryLocation,
  RepositoryManagerSnapshot,
  RepositoryNetworkRequestEnvelope,
  RepositoryOperation,
  RepositoryLocalChangesPreview,
  RepositoryMergeRebaseRequest,
  RepositoryRecoveryState,
  RepositoryRecoveryRequest,
  RepositoryPatchExportRequest,
  RepositoryPatchExportResult,
  RepositoryPullRequestHandoff,
  RepositoryOperationSession,
  RepositoryOpenRequest,
  RepositoryReferenceActionRequest,
  RepositoryReferenceContext,
  RepositoryReferenceContextRequest,
  RepositoryRemote,
  RepositoryRemoteActionRequest,
  RepositoryRemoteActionResult,
  RepositorySession,
  RepositoryStashActionRequest,
  RepositoryStashDetails,
  RepositoryStashDetailsRequest,
  RepositoryStashEntry,
  RepositoryTabOrientation,
  RepositoryTabPreferences,
  RepositoryCloneRequest,
  RepositoryConnectionRequest,
  RepositoryRevisionBlob,
  RepositoryRevisionBlobRequest,
  RepositoryRevisionTree,
  RepositoryRevisionTreeRequest,
  RepositorySummary,
  RepositoryCommitDetailsRequest,
  RepositoryCommitDetailsContext,
  RepositoryWorkingChanges,
  RepositoryWorkingChangeActionRequest,
  RepositoryWorkingChangeActionResult,
  RepositoryWorkingChangesRequest,
  SourceDirectoryRequest,
  SourceDirectorySession,
  WindowCommand,
  WindowState,
} from './contracts';
import type { IpcResult } from './result';

export type Unsubscribe = () => void;

/** This is the entire capability surface available to a renderer. */
export interface DesktopApi {
  readonly app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  readonly window: {
    getState(): Promise<IpcResult<WindowState>>;
    command(command: WindowCommand): Promise<IpcResult<null>>;
    onStateChanged(listener: (state: WindowState) => void): Unsubscribe;
  };
  readonly edit: {
    command(command: EditCommand): Promise<IpcResult<null>>;
  };
  readonly clipboard: {
    writeText(request: ClipboardText): Promise<IpcResult<null>>;
  };
  readonly repository: {
    openCommitDetails(request: RepositoryCommitDetailsRequest): Promise<IpcResult<null>>;
    getCommitDetailsContext(): Promise<IpcResult<RepositoryCommitDetailsContext>>;
    onActivated(listener: (repository: RepositorySummary) => void): Unsubscribe;
    getGitInfo(): Promise<IpcResult<GitInfo>>;
    pickDirectory(): Promise<IpcResult<string | null>>;
    listRecent(): Promise<IpcResult<RecentRepository[]>>;
    listOpen(): Promise<IpcResult<RepositorySummary[]>>;
    open(request: RepositoryOpenRequest): Promise<IpcResult<RepositorySummary>>;
    initialize(request: RepositoryInitializeRequest): Promise<IpcResult<RepositorySummary>>;
    clone(request: RepositoryCloneRequest): Promise<IpcResult<RepositoryOperation>>;
    testConnection(request: RepositoryConnectionRequest): Promise<IpcResult<RepositoryOperation>>;
    getAutomaticFetch(): Promise<IpcResult<{ enabled: boolean }>>;
    setAutomaticFetch(request: { enabled: boolean }): Promise<IpcResult<{ enabled: boolean }>>;
    close(request: RepositorySession): Promise<IpcResult<null>>;
    getTabPreferences(): Promise<IpcResult<RepositoryTabPreferences>>;
    setTabOrientation(orientation: RepositoryTabOrientation): Promise<IpcResult<RepositoryTabPreferences>>;
    setRepositoryListVisible(request: {
      readonly visible: boolean;
    }): Promise<IpcResult<RepositoryTabPreferences>>;
    reorderTabs(request: { readonly ids: readonly string[] }): Promise<IpcResult<RepositorySummary[]>>;
    selectTab(request: RepositorySession): Promise<IpcResult<RepositoryTabPreferences>>;
    removeRecent(request: RepositorySession): Promise<IpcResult<null>>;
    listManager(): Promise<IpcResult<RepositoryManagerSnapshot>>;
    addSourceDirectory(request: SourceDirectoryRequest): Promise<IpcResult<RepositoryManagerSnapshot>>;
    removeSourceDirectory(request: SourceDirectorySession): Promise<IpcResult<null>>;
    rescanSourceDirectory(request: SourceDirectorySession): Promise<IpcResult<RepositoryManagerSnapshot>>;
    getHistory(request: RepositoryHistoryRequest): Promise<IpcResult<RepositoryHistoryPage>>;
    getCommitChanges(request: RepositoryCommitChangesRequest): Promise<IpcResult<RepositoryCommitChanges>>;
    getDiff(request: RepositoryDiffRequest): Promise<IpcResult<RepositoryDiff>>;
    cancelDiff(request: RepositoryDiffCancel): Promise<IpcResult<null>>;
    previewDiscard(request: RepositoryDiscardPreviewRequest): Promise<IpcResult<RepositoryDiscardPreview>>;
    getWorkingChanges(request: RepositoryWorkingChangesRequest): Promise<IpcResult<RepositoryWorkingChanges>>;
    applyWorkingChange(
      request: RepositoryWorkingChangeActionRequest,
    ): Promise<IpcResult<RepositoryWorkingChangeActionResult>>;
    getCommitContext(request: RepositoryCommitContextRequest): Promise<IpcResult<RepositoryCommitContext>>;
    commit(request: RepositoryCommitRequest): Promise<IpcResult<RepositoryOperation>>;
    getAmendChanges(request: RepositoryAmendChangesRequest): Promise<IpcResult<RepositoryAmendChanges>>;
    getReferenceContext(
      request: RepositoryReferenceContextRequest,
    ): Promise<IpcResult<RepositoryReferenceContext>>;
    applyReferenceAction(request: RepositoryReferenceActionRequest): Promise<IpcResult<RepositoryOperation>>;
    startMergeRebase(request: RepositoryMergeRebaseRequest): Promise<IpcResult<RepositoryOperation>>;
    listRemotes(request: RepositorySession): Promise<IpcResult<RepositoryRemote[]>>;
    applyRemoteAction(
      request: RepositoryRemoteActionRequest,
    ): Promise<IpcResult<RepositoryRemoteActionResult>>;
    startNetworkOperation(request: RepositoryNetworkRequestEnvelope): Promise<IpcResult<RepositoryOperation>>;
    listOperations(): Promise<IpcResult<RepositoryOperation[]>>;
    cancelOperation(request: RepositoryOperationSession): Promise<IpcResult<RepositoryOperation | null>>;
    onOperationChanged(listener: (operation: RepositoryOperation) => void): Unsubscribe;
    previewLocalChanges(request: RepositorySession): Promise<IpcResult<RepositoryLocalChangesPreview>>;
    getRecovery(request: RepositorySession): Promise<IpcResult<RepositoryRecoveryState>>;
    recover(request: RepositoryRecoveryRequest): Promise<IpcResult<RepositoryOperation>>;
    listStashes(request: RepositorySession): Promise<IpcResult<RepositoryStashEntry[]>>;
    getStashDetails(request: RepositoryStashDetailsRequest): Promise<IpcResult<RepositoryStashDetails>>;
    startStashOperation(request: RepositoryStashActionRequest): Promise<IpcResult<RepositoryOperation>>;
    savePatch(request: RepositoryPatchExportRequest): Promise<IpcResult<RepositoryPatchExportResult>>;
    openPullRequest(request: RepositoryPullRequestHandoff): Promise<IpcResult<null>>;
    getRevisionTree(request: RepositoryRevisionTreeRequest): Promise<IpcResult<RepositoryRevisionTree>>;
    getRevisionBlob(request: RepositoryRevisionBlobRequest): Promise<IpcResult<RepositoryRevisionBlob>>;
    openInFileManager(location: RepositoryLocation): Promise<IpcResult<null>>;
  };
}
