import type { z } from 'zod';
import type { DesktopApi, Unsubscribe } from '../../common/ipc/api';
import { events, requests } from '../../common/ipc/contracts';
import type { RequestContract } from '../../common/ipc/contracts';
import { failure, resultSchema } from '../../common/ipc/result';
import type { IpcResult } from '../../common/ipc/result';

type TransportListener = (event: unknown, payload: unknown) => void;

export interface IpcTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: TransportListener): void;
  removeListener(channel: string, listener: TransportListener): void;
}

export function createDesktopApi(transport: IpcTransport, timeoutMs = 15_000): DesktopApi {
  const invoke = <Input, Output>(
    contract: RequestContract<Input, Output>,
    input: Input,
    deadlineMs = timeoutMs,
  ): Promise<IpcResult<Output>> => {
    const parsedInput = contract.input.safeParse(input);
    if (!parsedInput.success) {
      return Promise.resolve(failure('INVALID_REQUEST', 'The request is not valid.'));
    }

    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve(failure('TIMEOUT', 'The application did not respond in time.')),
        deadlineMs,
      );

      // Also catch a synchronous transport failure (for example a destroyed renderer).
      void Promise.resolve()
        .then(() => transport.invoke(contract.channel, parsedInput.data))
        .then((response) => {
          const parsed = resultSchema(contract.output).safeParse(response);
          resolve(
            parsed.success
              ? parsed.data
              : failure('INTERNAL_ERROR', 'The application returned an invalid response.'),
          );
        })
        .catch(() => resolve(failure('UNAVAILABLE', 'The application connection is unavailable.')))
        .finally(() => clearTimeout(timer));
    });
  };

  const subscribe = <Payload>(
    contract: { channel: string; payload: z.ZodType<Payload> },
    listener: (payload: Payload) => void,
  ): Unsubscribe => {
    const wrapped: TransportListener = (_event, payload) => {
      const parsed = contract.payload.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    transport.on(contract.channel, wrapped);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      // The same function reference must be passed to removeListener.
      transport.removeListener(contract.channel, wrapped);
    };
  };

  return {
    customCommands: {
      list: () => invoke(requests.listCustomCommands, undefined),
      save: (request) => invoke(requests.saveCustomCommand, request),
      remove: (request) => invoke(requests.removeCustomCommand, request),
      import: () => invoke(requests.importCustomCommands, undefined, 310_000),
      export: (request) => invoke(requests.exportCustomCommand, request, 310_000),
      pickFile: () => invoke(requests.pickCustomCommandFile, undefined, 310_000),
      preview: (request) => invoke(requests.previewCustomCommand, request),
      run: (request) => invoke(requests.runCustomCommand, request),
    },
    hosting: {
      listActivity: (request) => invoke(requests.listHostingActivity, request),
      openActivity: (request) => invoke(requests.openHostingActivity, request),
      listAccounts: () => invoke(requests.listHostingAccounts, undefined),
      // Native file selection can take longer than a short control request. Main also bounds its lifetime.
      connect: (request) => invoke(requests.connectHostingAccount, request, 310_000),
      disconnect: (request) => invoke(requests.disconnectHostingAccount, request),
      listRepositories: (request) => invoke(requests.listHostedRepositories, request),
      getCloneTarget: (request) => invoke(requests.getHostedCloneTarget, request),
      openRepository: (request) => invoke(requests.openHostedRepository, request),
      cancel: () => invoke(requests.cancelHostingRequests, undefined),
    },
    app: { getInfo: () => invoke(requests.getAppInfo, undefined) },
    window: {
      getState: () => invoke(requests.getWindowState, undefined),
      command: (command) => invoke(requests.windowCommand, command),
      onStateChanged: (listener) => subscribe(events.windowStateChanged, listener),
    },
    edit: { command: (command) => invoke(requests.editCommand, command) },
    clipboard: { writeText: (request) => invoke(requests.writeClipboardText, request) },
    repository: {
      openCommitDetails: (request) => invoke(requests.openRepositoryCommitDetails, request),
      getCommitDetailsContext: () => invoke(requests.getRepositoryCommitDetailsContext, undefined),
      openFileHistory: (request) => invoke(requests.openRepositoryFileHistory, request),
      getFileHistoryContext: () => invoke(requests.getRepositoryFileHistoryContext, undefined),
      getFileHistory: (request) => invoke(requests.getRepositoryFileHistory, request),
      openBlame: (request) => invoke(requests.openRepositoryBlame, request),
      getBlameContext: () => invoke(requests.getRepositoryBlameContext, undefined),
      getBlame: (request) => invoke(requests.getRepositoryBlame, request),
      onActivated: (listener) => subscribe(events.repositoryActivated, listener),
      getGitInfo: () => invoke(requests.getGitInfo, undefined),
      pickDirectory: () => invoke(requests.pickRepositoryDirectory, undefined),
      listRecent: () => invoke(requests.listRecentRepositories, undefined),
      listOpen: () => invoke(requests.listOpenRepositories, undefined),
      open: (request) => invoke(requests.openRepository, request),
      initialize: (request) => invoke(requests.initializeRepository, request),
      clone: (request) => invoke(requests.cloneRepository, request),
      testConnection: (request) => invoke(requests.testRepositoryConnection, request),
      getAutomaticFetch: () => invoke(requests.getAutomaticFetchPreference, undefined),
      setAutomaticFetch: (request) => invoke(requests.setAutomaticFetchPreference, request),
      close: (request) => invoke(requests.closeRepository, request),
      getTabPreferences: () => invoke(requests.getRepositoryTabPreferences, undefined),
      setTabOrientation: (orientation) =>
        invoke(requests.setRepositoryTabOrientation, { tabOrientation: orientation }),
      selectTab: (request) => invoke(requests.selectRepositoryTab, request),
      setRepositoryListVisible: (request) => invoke(requests.setRepositoryListVisible, request),
      reorderTabs: (request) => invoke(requests.reorderRepositoryTabs, { ids: [...request.ids] }),
      removeRecent: (request) => invoke(requests.removeRecentRepository, request),
      listManager: () => invoke(requests.listRepositoryManager, undefined),
      addSourceDirectory: (request) => invoke(requests.addSourceDirectory, request),
      removeSourceDirectory: (request) => invoke(requests.removeSourceDirectory, request),
      rescanSourceDirectory: (request) => invoke(requests.rescanSourceDirectory, request),
      getHistory: (request) => invoke(requests.getRepositoryHistory, request),
      getCommitChanges: (request) => invoke(requests.getRepositoryCommitChanges, request),
      getDiff: (request) => invoke(requests.getRepositoryDiff, request),
      cancelDiff: (request) => invoke(requests.cancelRepositoryDiff, request),
      previewDiscard: (request) => invoke(requests.previewRepositoryDiscard, request),
      getWorkingChanges: (request) => invoke(requests.getRepositoryWorkingChanges, request),
      getConflicts: (request) => invoke(requests.getRepositoryConflicts, request),
      resolveConflict: (request) => invoke(requests.resolveRepositoryConflict, request),
      applyWorkingChange: (request) => invoke(requests.applyRepositoryWorkingChange, request),
      getCommitContext: (request) => invoke(requests.getRepositoryCommitContext, request),
      commit: (request) => invoke(requests.commitRepositoryChanges, request),
      getAmendChanges: (request) => invoke(requests.getRepositoryAmendChanges, request),
      getReferenceContext: (request) => invoke(requests.getRepositoryReferenceContext, request),
      applyReferenceAction: (request) => invoke(requests.applyRepositoryReferenceAction, request),
      getWorktrees: (request) => invoke(requests.getRepositoryWorktrees, request),
      startWorktreeOperation: (request) => invoke(requests.startRepositoryWorktreeOperation, request),
      getBisect: (request) => invoke(requests.getRepositoryBisect, request),
      getSigningSettings: (request) => invoke(requests.getRepositorySigningSettings, request),
      setSigningKey: (request) => invoke(requests.setRepositorySigningKey, request),
      verifySignature: (request) => invoke(requests.verifyRepositorySignature, request),
      startBisectOperation: (request) => invoke(requests.startRepositoryBisectOperation, request),
      getGitFlow: (request) => invoke(requests.getRepositoryGitFlow, request),
      startGitFlowOperation: (request) => invoke(requests.startRepositoryGitFlowOperation, request),
      getSubmodules: (request) => invoke(requests.getRepositorySubmodules, request),
      startSubmoduleOperation: (request) => invoke(requests.startRepositorySubmoduleOperation, request),
      openSubmodule: (request) => invoke(requests.openRepositorySubmodule, request),
      startMergeRebase: (request) => invoke(requests.startRepositoryMergeRebase, request),
      getHistoryOperationPreview: (request) => invoke(requests.getRepositoryHistoryOperationPreview, request),
      startHistoryOperation: (request) => invoke(requests.startRepositoryHistoryOperation, request),
      getInteractiveRebasePlan: (request) => invoke(requests.getRepositoryInteractiveRebasePlan, request),
      startInteractiveRebase: (request) => invoke(requests.startRepositoryInteractiveRebase, request),
      listRemotes: (request) => invoke(requests.listRepositoryRemotes, request),
      applyRemoteAction: (request) => invoke(requests.applyRepositoryRemoteAction, request),
      startNetworkOperation: (request) => invoke(requests.startRepositoryNetworkOperation, request),
      previewLocalChanges: (request) => invoke(requests.previewRepositoryLocalChanges, request),
      getRecovery: (request) => invoke(requests.getRepositoryRecovery, request),
      recover: (request) => invoke(requests.recoverRepository, request),
      listStashes: (request) => invoke(requests.listRepositoryStashes, request),
      getStashDetails: (request) => invoke(requests.getRepositoryStashDetails, request),
      startStashOperation: (request) => invoke(requests.startRepositoryStashOperation, request),
      savePatch: (request) => invoke(requests.saveRepositoryPatch, request),
      openPullRequest: (request) => invoke(requests.openRepositoryPullRequest, request),
      listOperations: () => invoke(requests.listRepositoryOperations, undefined),
      cancelOperation: (request) => invoke(requests.cancelRepositoryOperation, request),
      onOperationChanged: (listener) => subscribe(events.repositoryOperationChanged, listener),
      getRevisionTree: (request) => invoke(requests.getRepositoryRevisionTree, request),
      getRevisionBlob: (request) => invoke(requests.getRepositoryRevisionBlob, request),
      getLfsFile: (request) => invoke(requests.getRepositoryLfsFile, request),
      startLfsInitialization: (request) => invoke(requests.startRepositoryLfsInitialization, request),
      saveLfsPayload: (request) => invoke(requests.saveRepositoryLfsPayload, request),
      openInFileManager: (location) => invoke(requests.openRepositoryInFileManager, location),
    },
  };
}
