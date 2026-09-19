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
  RepositoryCommitResult,
  RepositoryDiff,
  RepositoryDiffRequest,
  RepositoryInitializeRequest,
  RepositoryHistoryPage,
  RepositoryHistoryRequest,
  RepositoryLocation,
  RepositoryManagerSnapshot,
  RepositoryNetworkRequestEnvelope,
  RepositoryOperation,
  RepositoryOperationSession,
  RepositoryOpenRequest,
  RepositoryReferenceActionRequest,
  RepositoryReferenceActionResult,
  RepositoryReferenceContext,
  RepositoryReferenceContextRequest,
  RepositoryRemote,
  RepositoryRemoteActionRequest,
  RepositoryRemoteActionResult,
  RepositorySession,
  RepositoryTabOrientation,
  RepositoryTabPreferences,
  RepositoryRevisionBlob,
  RepositoryRevisionBlobRequest,
  RepositoryRevisionTree,
  RepositoryRevisionTreeRequest,
  RepositorySummary,
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
    getGitInfo(): Promise<IpcResult<GitInfo>>;
    pickDirectory(): Promise<IpcResult<string | null>>;
    listRecent(): Promise<IpcResult<RecentRepository[]>>;
    listOpen(): Promise<IpcResult<RepositorySummary[]>>;
    open(request: RepositoryOpenRequest): Promise<IpcResult<RepositorySummary>>;
    initialize(request: RepositoryInitializeRequest): Promise<IpcResult<RepositorySummary>>;
    close(request: RepositorySession): Promise<IpcResult<null>>;
    getTabPreferences(): Promise<IpcResult<RepositoryTabPreferences>>;
    setTabOrientation(orientation: RepositoryTabOrientation): Promise<IpcResult<RepositoryTabPreferences>>;
    selectTab(request: RepositorySession): Promise<IpcResult<RepositoryTabPreferences>>;
    removeRecent(request: RepositorySession): Promise<IpcResult<null>>;
    listManager(): Promise<IpcResult<RepositoryManagerSnapshot>>;
    addSourceDirectory(request: SourceDirectoryRequest): Promise<IpcResult<RepositoryManagerSnapshot>>;
    removeSourceDirectory(request: SourceDirectorySession): Promise<IpcResult<null>>;
    rescanSourceDirectory(request: SourceDirectorySession): Promise<IpcResult<RepositoryManagerSnapshot>>;
    getHistory(request: RepositoryHistoryRequest): Promise<IpcResult<RepositoryHistoryPage>>;
    getCommitChanges(request: RepositoryCommitChangesRequest): Promise<IpcResult<RepositoryCommitChanges>>;
    getDiff(request: RepositoryDiffRequest): Promise<IpcResult<RepositoryDiff>>;
    getWorkingChanges(request: RepositoryWorkingChangesRequest): Promise<IpcResult<RepositoryWorkingChanges>>;
    applyWorkingChange(
      request: RepositoryWorkingChangeActionRequest,
    ): Promise<IpcResult<RepositoryWorkingChangeActionResult>>;
    getCommitContext(request: RepositoryCommitContextRequest): Promise<IpcResult<RepositoryCommitContext>>;
    commit(request: RepositoryCommitRequest): Promise<IpcResult<RepositoryCommitResult>>;
    getAmendChanges(request: RepositoryAmendChangesRequest): Promise<IpcResult<RepositoryAmendChanges>>;
    getReferenceContext(
      request: RepositoryReferenceContextRequest,
    ): Promise<IpcResult<RepositoryReferenceContext>>;
    applyReferenceAction(
      request: RepositoryReferenceActionRequest,
    ): Promise<IpcResult<RepositoryReferenceActionResult>>;
    listRemotes(request: RepositorySession): Promise<IpcResult<RepositoryRemote[]>>;
    applyRemoteAction(
      request: RepositoryRemoteActionRequest,
    ): Promise<IpcResult<RepositoryRemoteActionResult>>;
    startNetworkOperation(request: RepositoryNetworkRequestEnvelope): Promise<IpcResult<RepositoryOperation>>;
    listOperations(): Promise<IpcResult<RepositoryOperation[]>>;
    cancelOperation(request: RepositoryOperationSession): Promise<IpcResult<RepositoryOperation | null>>;
    onOperationChanged(listener: (operation: RepositoryOperation) => void): Unsubscribe;
    getRevisionTree(request: RepositoryRevisionTreeRequest): Promise<IpcResult<RepositoryRevisionTree>>;
    getRevisionBlob(request: RepositoryRevisionBlobRequest): Promise<IpcResult<RepositoryRevisionBlob>>;
    openInFileManager(location: RepositoryLocation): Promise<IpcResult<null>>;
  };
}
