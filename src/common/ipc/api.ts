import type { Statistics, StatisticsRequest } from './statistics';
import type { LfsContext, LfsOperationRequest } from './lfs';
import type { AiSettings, AiPreviewRequest, AiPreview, AiSend, AiResult } from './ai';
import type {
  RepositorySubmoduleComparisonRequest,
  RepositorySubmoduleComparison,
  RepositoryHistoricalFileRequest,
  RepositoryManagerScan,
  RepositoryManagerAction,
  RepositoryManagerLocation,
  RepositoryManagerOverview,
  RepositoryInvalidation,
  WorkspaceRecovery,
  RecoverRepositoryTab,
  RepositorySigningSettings,
  RepositorySigningSettingsRequest,
  RepositoryVerifySignatureRequest,
  RepositorySignature,
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
  RepositoryConflictRequest,
  RepositoryConflictState,
  RepositoryDiff,
  RepositoryDiffRequest,
  RepositoryDiffCancel,
  RepositoryDiscardPreview,
  RepositoryDiscardPreviewRequest,
  RepositoryInitializeRequest,
  RepositoryHistoryPage,
  RepositoryHistoryRequest,
  RepositoryInteractiveRebasePlan,
  RepositoryInteractiveRebasePlanRequest,
  RepositoryInteractiveRebaseRequest,
  RepositoryHistoryOperationAction,
  RepositoryHistoryOperationPreview,
  RepositoryHistoryOperationPreviewRequest,
  RepositoryLocation,
  RepositoryManagerSnapshot,
  RepositoryNetworkRequestEnvelope,
  RepositoryPushPreviewRequest,
  RepositoryPushPreview,
  RepositoryOperation,
  RepositoryLocalChangesPreview,
  RepositoryMergeRebaseRequest,
  RepositoryMergeRebasePreviewRequest,
  RepositoryMergeRebasePreview,
  RepositoryRecoveryState,
  RepositoryRecoveryRequest,
  RepositoryResolveConflictRequest,
  RepositoryPatchExportRequest,
  RepositoryPatchImportRequest,
  RepositoryPatchPreview,
  RepositoryPatchApplyRequest,
  RepositoryPatchExportResult,
  RepositoryPullRequestHandoff,
  RepositoryOperationSession,
  RepositoryOpenRequest,
  RepositoryReferenceActionRequest,
  RepositoryReferenceContext,
  RepositoryReferenceContextRequest,
  RepositoryBisectActionRequest,
  RepositoryBisectContext,
  RepositoryLeanRead,
  RepositoryLeanContext,
  RepositoryLeanAction,
  RepositoryGitFlowActionRequest,
  RepositoryGitFlowContext,
  RepositoryWorktreeActionRequest,
  RepositoryWorktreeContext,
  RepositorySubmoduleActionRequest,
  RepositorySubmoduleContext,
  RepositoryOpenSubmoduleRequest,
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
  RepositoryLfsFile,
  RepositoryLfsFileRequest,
  RepositoryLfsInitializationRequest,
  RepositoryLfsSaveRequest,
  RepositorySummary,
  RepositoryCommitDetailsRequest,
  RepositoryCommitDetailsContext,
  RepositoryFileHistoryOpenRequest,
  RepositoryFileHistoryRequest,
  RepositoryFileHistory,
  RepositoryFileHistoryContext,
  RepositoryBlameOpenRequest,
  RepositoryBlameRequest,
  RepositoryBlame,
  RepositoryBlameContext,
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
import type {
  CustomCommand,
  CustomSave,
  CustomSelection,
  CustomPreviewRequest,
  CustomPreview,
} from './custom-commands';
import type {
  ExternalTool,
  ExternalToolSave,
  ExternalToolSelection,
  ExternalToolRun,
} from './external-tools';
import type {
  HostingAccount,
  HostingAccounts,
  HostingConnectRequest,
  HostingRepositoriesRequest,
  HostedRepositories,
  HostingRepositoryRequest,
  HostingCloneSelection,
  HostingCloneTarget,
  HostingActivityRequest,
  HostingActivityPage,
  HostingActivitySelection,
  HostingOAuthRequest,
  HostingOAuthState,
  HostingOAuthResult,
  HostingNotificationPreference,
  HostingNotificationSnapshot,
} from './hosting';

import type { SettingsTarget, SaveGitSettings, GitSettings, GitInstance } from './settings';
export type Unsubscribe = () => void;

/** This is the entire capability surface available to a renderer. */
export interface DesktopApi {
  readonly ai: {
    getSettings(): Promise<IpcResult<AiSettings>>;
    configure(request: { model: string }): Promise<IpcResult<AiSettings>>;
    disable(): Promise<IpcResult<AiSettings>>;
    preview(request: AiPreviewRequest): Promise<IpcResult<AiPreview>>;
    send(request: AiSend): Promise<IpcResult<AiResult>>;
    cancel(request: { id?: string }): Promise<IpcResult<null>>;
  };
  readonly settings: {
    getGitInstance(): Promise<IpcResult<GitInstance>>;
    saveGitInstance(request: GitInstance): Promise<IpcResult<GitInstance>>;
    pickGitInstance(): Promise<IpcResult<string | null>>;
    onChanged(listener: () => void): Unsubscribe;
    getGit(request: SettingsTarget): Promise<IpcResult<GitSettings>>;
    saveGit(request: SaveGitSettings): Promise<IpcResult<GitSettings>>;
    openIssue(request: { id: string; number: string }): Promise<IpcResult<null>>;
  };
  readonly customCommands: {
    list(): Promise<IpcResult<CustomCommand[]>>;
    save(request: CustomSave): Promise<IpcResult<CustomCommand[]>>;
    remove(request: CustomSelection): Promise<IpcResult<CustomCommand[]>>;
    import(): Promise<IpcResult<CustomCommand[] | null>>;
    export(request: CustomSelection): Promise<IpcResult<null>>;
    pickFile(): Promise<IpcResult<string | null>>;
    preview(request: CustomPreviewRequest): Promise<IpcResult<CustomPreview>>;
    run(request: { token: string }): Promise<IpcResult<RepositoryOperation>>;
  };
  readonly externalTools: {
    list(): Promise<IpcResult<ExternalTool[]>>;
    save(request: ExternalToolSave): Promise<IpcResult<ExternalTool[]>>;
    remove(request: ExternalToolSelection): Promise<IpcResult<ExternalTool[]>>;
    pickExecutable(): Promise<IpcResult<string | null>>;
    run(request: ExternalToolRun): Promise<IpcResult<RepositoryOperation>>;
  };
  readonly hosting: {
    getNotifications(): Promise<IpcResult<HostingNotificationSnapshot>>;
    setNotifications(request: HostingNotificationPreference): Promise<IpcResult<null>>;
    refreshNotifications(request: { accountId: string }): Promise<IpcResult<null>>;
    openNotification(request: HostingActivitySelection): Promise<IpcResult<null>>;
    manageCredential(request: { accountId: string }): Promise<IpcResult<null>>;
    onNotificationsChanged(listener: () => void): Unsubscribe;
    listActivity(request: HostingActivityRequest): Promise<IpcResult<HostingActivityPage>>;
    openActivity(request: HostingActivitySelection): Promise<IpcResult<null>>;
    listAccounts(): Promise<IpcResult<HostingAccounts>>;
    connect(request: HostingConnectRequest): Promise<IpcResult<HostingAccount | null>>;
    beginOAuth(request: HostingOAuthRequest): Promise<IpcResult<HostingOAuthState>>;
    pollOAuth(): Promise<IpcResult<HostingOAuthResult>>;
    disconnect(request: { accountId: string }): Promise<IpcResult<null>>;
    useForGit(request: { accountId: string }): Promise<IpcResult<null>>;
    openTokenSettings(): Promise<IpcResult<null>>;
    listRepositories(request: HostingRepositoriesRequest): Promise<IpcResult<HostedRepositories>>;
    getCloneTarget(request: HostingCloneSelection): Promise<IpcResult<HostingCloneTarget>>;
    openRepository(request: HostingRepositoryRequest): Promise<IpcResult<null>>;
    cancel(): Promise<IpcResult<null>>;
  };
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
    openFileHistory(request: RepositoryFileHistoryOpenRequest): Promise<IpcResult<null>>;
    getFileHistoryContext(): Promise<IpcResult<RepositoryFileHistoryContext>>;
    getFileHistory(request: RepositoryFileHistoryRequest): Promise<IpcResult<RepositoryFileHistory>>;
    cancelInvestigation(request: RepositoryDiffCancel): Promise<IpcResult<null>>;
    saveRevisionFile(
      request: RepositoryHistoricalFileRequest,
    ): Promise<IpcResult<RepositoryPatchExportResult>>;
    openBlame(request: RepositoryBlameOpenRequest): Promise<IpcResult<null>>;
    getBlameContext(): Promise<IpcResult<RepositoryBlameContext>>;
    getBlame(request: RepositoryBlameRequest): Promise<IpcResult<RepositoryBlame>>;
    onActivated(listener: (repository: RepositorySummary) => void): Unsubscribe;
    getGitInfo(): Promise<IpcResult<GitInfo>>;
    setTrust(request: { readonly id: string; readonly trusted: boolean }): Promise<IpcResult<null>>;
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
    startManagerScan(): Promise<IpcResult<RepositoryManagerScan>>;
    getManagerScan(): Promise<IpcResult<RepositoryManagerScan>>;
    cancelManagerScan(): Promise<IpcResult<null>>;
    editManager(request: RepositoryManagerAction): Promise<IpcResult<null>>;
    getManagerOverview(request: RepositoryManagerLocation): Promise<IpcResult<RepositoryManagerOverview>>;
    getWorkspaceRecovery(): Promise<IpcResult<WorkspaceRecovery>>;
    recoverTab(request: RecoverRepositoryTab): Promise<IpcResult<RepositorySummary | null>>;
    revealWorkspaceStorage(): Promise<IpcResult<null>>;
    onInvalidated(listener: (event: RepositoryInvalidation) => void): Unsubscribe;
    addSourceDirectory(request: SourceDirectoryRequest): Promise<IpcResult<RepositoryManagerSnapshot>>;
    removeSourceDirectory(request: SourceDirectorySession): Promise<IpcResult<null>>;
    rescanSourceDirectory(request: SourceDirectorySession): Promise<IpcResult<RepositoryManagerSnapshot>>;
    getHistory(request: RepositoryHistoryRequest): Promise<IpcResult<RepositoryHistoryPage>>;
    getCommitChanges(request: RepositoryCommitChangesRequest): Promise<IpcResult<RepositoryCommitChanges>>;
    /** includeImages returns bounded raster bytes on this same authorized target, never file URLs. */
    getDiff(request: RepositoryDiffRequest): Promise<IpcResult<RepositoryDiff>>;
    cancelDiff(request: RepositoryDiffCancel): Promise<IpcResult<null>>;
    previewDiscard(request: RepositoryDiscardPreviewRequest): Promise<IpcResult<RepositoryDiscardPreview>>;
    getWorkingChanges(request: RepositoryWorkingChangesRequest): Promise<IpcResult<RepositoryWorkingChanges>>;
    getConflicts(request: RepositoryConflictRequest): Promise<IpcResult<RepositoryConflictState>>;
    resolveConflict(request: RepositoryResolveConflictRequest): Promise<IpcResult<RepositoryConflictState>>;
    startConflictResolution(
      request: RepositoryResolveConflictRequest,
    ): Promise<IpcResult<RepositoryOperation>>;
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
    getWorktrees(request: RepositorySession): Promise<IpcResult<RepositoryWorktreeContext>>;
    startWorktreeOperation(request: RepositoryWorktreeActionRequest): Promise<IpcResult<RepositoryOperation>>;
    getBisect(request: RepositorySession): Promise<IpcResult<RepositoryBisectContext>>;
    getSigningSettings(request: RepositorySession): Promise<IpcResult<RepositorySigningSettings>>;
    getStatistics(request: StatisticsRequest): Promise<IpcResult<Statistics>>;
    cancelStatistics(request: { id: string; readId: string }): Promise<IpcResult<null>>;
    setSigningKey(request: RepositorySigningSettingsRequest): Promise<IpcResult<RepositorySigningSettings>>;
    verifySignature(request: RepositoryVerifySignatureRequest): Promise<IpcResult<RepositorySignature>>;
    startBisectOperation(request: RepositoryBisectActionRequest): Promise<IpcResult<RepositoryOperation>>;
    getLean(request: RepositoryLeanRead): Promise<IpcResult<RepositoryLeanContext>>;
    startLean(request: RepositoryLeanAction): Promise<IpcResult<RepositoryOperation>>;
    getGitFlow(request: RepositorySession): Promise<IpcResult<RepositoryGitFlowContext>>;
    startGitFlowOperation(request: RepositoryGitFlowActionRequest): Promise<IpcResult<RepositoryOperation>>;
    getSubmodules(request: RepositorySession): Promise<IpcResult<RepositorySubmoduleContext>>;
    getSubmoduleComparison(
      request: RepositorySubmoduleComparisonRequest,
    ): Promise<IpcResult<RepositorySubmoduleComparison>>;
    startSubmoduleOperation(
      request: RepositorySubmoduleActionRequest,
    ): Promise<IpcResult<RepositoryOperation>>;
    openSubmodule(request: RepositoryOpenSubmoduleRequest): Promise<IpcResult<RepositorySummary>>;
    startMergeRebase(request: RepositoryMergeRebaseRequest): Promise<IpcResult<RepositoryOperation>>;
    getMergeRebasePreview(
      request: RepositoryMergeRebasePreviewRequest,
    ): Promise<IpcResult<RepositoryMergeRebasePreview>>;
    getHistoryOperationPreview(
      request: RepositoryHistoryOperationPreviewRequest,
    ): Promise<IpcResult<RepositoryHistoryOperationPreview>>;
    startHistoryOperation(request: {
      readonly id: string;
      readonly action: RepositoryHistoryOperationAction;
    }): Promise<IpcResult<RepositoryOperation>>;
    getInteractiveRebasePlan(
      request: RepositoryInteractiveRebasePlanRequest,
    ): Promise<IpcResult<RepositoryInteractiveRebasePlan>>;
    startInteractiveRebase(
      request: RepositoryInteractiveRebaseRequest,
    ): Promise<IpcResult<RepositoryOperation>>;
    listRemotes(request: RepositorySession): Promise<IpcResult<RepositoryRemote[]>>;
    applyRemoteAction(
      request: RepositoryRemoteActionRequest,
    ): Promise<IpcResult<RepositoryRemoteActionResult>>;
    startNetworkOperation(request: RepositoryNetworkRequestEnvelope): Promise<IpcResult<RepositoryOperation>>;
    previewPush(request: RepositoryPushPreviewRequest): Promise<IpcResult<RepositoryPushPreview>>;
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
    copyPatch(request: RepositoryPatchExportRequest): Promise<IpcResult<null>>;
    previewPatch(request: RepositoryPatchImportRequest): Promise<IpcResult<RepositoryPatchPreview | null>>;
    applyPatch(request: RepositoryPatchApplyRequest): Promise<IpcResult<RepositoryOperation>>;
    releasePatch(request: RepositoryPatchApplyRequest): Promise<IpcResult<null>>;
    openPullRequest(request: RepositoryPullRequestHandoff): Promise<IpcResult<null>>;
    /** Read one immutable directory page; nextOffset continues the same commit/path. */
    getRevisionTree(request: RepositoryRevisionTreeRequest): Promise<IpcResult<RepositoryRevisionTree>>;
    getRevisionBlob(request: RepositoryRevisionBlobRequest): Promise<IpcResult<RepositoryRevisionBlob>>;
    getLfsFile(request: RepositoryLfsFileRequest): Promise<IpcResult<RepositoryLfsFile>>;
    getLfsContext(request: { id: string }): Promise<IpcResult<LfsContext>>;
    startLfsOperation(request: LfsOperationRequest): Promise<IpcResult<RepositoryOperation>>;
    startLfsInitialization(
      request: RepositoryLfsInitializationRequest,
    ): Promise<IpcResult<RepositoryOperation>>;
    saveLfsPayload(request: RepositoryLfsSaveRequest): Promise<IpcResult<RepositoryOperation | null>>;
    openInFileManager(location: RepositoryLocation): Promise<IpcResult<null>>;
  };
}
