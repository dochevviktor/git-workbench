import { app, clipboard, dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { basename } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { readCommandFile } from '../../commands/custom-command-store';
import { readPatchFile, checkedPatch } from '../../repositories/patch-service';
import { events, requests } from '../../../common/ipc/contracts';
import type {
  AppInfo,
  RequestContract,
  WindowState,
  RepositorySummary,
  RepositoryCommitDetailsContext,
  RepositoryFileHistoryContext,
  RepositoryBlameContext,
} from '../../../common/ipc/contracts';
import { ExpectedBackendError } from '../../errors';
import type { RepositoryService } from '../../repositories/repository-service';
import { isTrustedDocument } from '../security';
import { executeRequest } from './execute-request';
import { createCommitDetailsWindow } from '../commit-details-window';
import { canInvokeInspector } from '../commit-inspector-policy';
import { createFileHistoryWindow } from '../file-history-window';
import type { HostingService } from '../../hosting/hosting-service';

const minimumZoomLevel = -3;
const maximumZoomLevel = 5;
const zoomStep = 0.5;

function windowState(window: BrowserWindow): WindowState {
  return { maximized: window.isMaximized(), focused: window.isFocused(), fullScreen: window.isFullScreen() };
}

function requireDevelopment(): void {
  if (app.isPackaged) {
    throw new ExpectedBackendError('FORBIDDEN', 'That command is only available in development builds.');
  }
}

function changeZoom(window: BrowserWindow, delta: number): void {
  const level = window.webContents.getZoomLevel() + delta;
  window.webContents.setZoomLevel(Math.min(maximumZoomLevel, Math.max(minimumZoomLevel, level)));
}

type InspectorEntry =
  | {
      readonly kind: 'commit-details';
      readonly parentId: number;
      readonly context: RepositoryCommitDetailsContext;
    }
  | {
      readonly kind: 'file-history';
      readonly parentId: number;
      readonly context: RepositoryFileHistoryContext;
    }
  | { readonly kind: 'blame'; readonly parentId: number; readonly context: RepositoryBlameContext };
type InspectorAttachment =
  InspectorEntry | { readonly parentId: number; readonly context: RepositoryCommitDetailsContext };

import type { GitInstanceStore } from '../../git/instance-store';

export function registerAppIpc(
  repositoryService?: RepositoryService,
  hostingService?: HostingService,
  gitInstances?: GitInstanceStore,
) {
  const windows = new Map<
    number,
    {
      window: BrowserWindow;
      url: string;
      cleanup: () => void;
      inspector?: InspectorEntry | undefined;
    }
  >();
  const openingInspectors = new Map<number, number>();
  const channels: string[] = [];

  const attachWindow = (window: BrowserWindow, url: string, inspector?: InspectorAttachment) => {
    const id = window.webContents.id;
    windows.get(id)?.cleanup();
    const cancelAi = () => repositoryService?.ai.cancel(id);
    window.webContents.on('did-start-loading', cancelAi);
    const publishState = () => {
      if (!window.isDestroyed() && isTrustedDocument(window.webContents.getURL(), url)) {
        window.webContents.send(events.windowStateChanged.channel, windowState(window));
      }
    };
    window.on('maximize', publishState);
    window.on('unmaximize', publishState);
    window.on('focus', publishState);
    window.on('blur', publishState);
    window.on('enter-full-screen', publishState);
    window.on('leave-full-screen', publishState);
    const cleanup = () => {
      for (const entry of windows.values()) {
        if (entry.inspector?.parentId === id && !entry.window.isDestroyed()) entry.window.close();
      }
      repositoryService?.disposeWindow(id);
      window.webContents.removeListener('did-start-loading', cancelAi);
      hostingService?.cancel(id);
      windows.delete(id);
      window.removeListener('maximize', publishState);
      window.removeListener('unmaximize', publishState);
      window.removeListener('focus', publishState);
      window.removeListener('blur', publishState);
      window.removeListener('enter-full-screen', publishState);
      window.removeListener('leave-full-screen', publishState);
      window.removeListener('closed', cleanup);
    };
    const normalizedInspector: InspectorEntry | undefined =
      inspector && 'kind' in inspector
        ? inspector
        : inspector
          ? { ...inspector, kind: 'commit-details' }
          : undefined;
    windows.set(id, { window, url, cleanup, inspector: normalizedInspector });
    window.once('closed', cleanup);
  };

  const authorizedWindow = (event: IpcMainInvokeEvent): BrowserWindow | undefined => {
    const entry = windows.get(event.sender.id);
    if (
      !entry ||
      entry.window.isDestroyed() ||
      entry.window.webContents !== event.sender ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedDocument(event.senderFrame.url, entry.url)
    ) {
      return undefined;
    }
    return entry.window;
  };

  const register = <Input, Output>(
    contract: RequestContract<Input, Output>,
    handler: (window: BrowserWindow, input: Input) => Output | Promise<Output>,
  ) => {
    ipcMain.handle(contract.channel, (event, payload: unknown) => {
      const window = authorizedWindow(event);
      return executeRequest(
        contract,
        payload,
        window !== undefined &&
          (!windows.get(window.webContents.id)?.inspector ||
            canInvokeInspector(
              windows.get(window.webContents.id)?.inspector?.kind ?? 'commit-details',
              contract.channel,
              payload,
            )),
        (input) => {
          if (!window) throw new Error('Missing IPC window');
          return handler(window, input);
        },
        () => console.error(`IPC handler failed: ${contract.channel}`),
      );
    });
    channels.push(contract.channel);
  };

  register(requests.getAppInfo, (): AppInfo => ({
    name: 'Git Workbench',
    version: app.getVersion(),
    platform: process.platform as AppInfo['platform'],
    mode: app.isPackaged ? 'production' : 'development',
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  register(requests.getWindowState, (window) => windowState(window));
  if (repositoryService) {
    register(requests.getAiSettings, () => repositoryService.ai.settings());
    register(requests.configureAi, (window, request) =>
      repositoryService.ai.configure(window.webContents.id, request.model, async () => {
        const selected = await dialog.showOpenDialog(window, {
          title: 'Select OpenAI API key file (session only)',
          properties: ['openFile'],
        });
        return selected.canceled ? null : (selected.filePaths[0] ?? null);
      }),
    );
    register(requests.disableAi, () => repositoryService.ai.disable());
    register(requests.previewAi, (window, request) =>
      repositoryService.previewAi(window.webContents.id, request),
    );
    register(requests.sendAi, (window, request) => repositoryService.sendAi(window.webContents.id, request));
    register(requests.cancelAi, (window, request) =>
      repositoryService.ai.cancel(window.webContents.id, request.id),
    );
  }
  if (gitInstances) {
    register(requests.getGitInstance, () => gitInstances.read());
    register(requests.saveGitInstance, (_window, request) => gitInstances.save(request));
    register(requests.pickGitInstance, async (window) => {
      const selected = await dialog.showOpenDialog(window, {
        title: 'Select Git executable',
        properties: ['openFile'],
      });
      return selected.canceled ? null : (selected.filePaths[0] ?? null);
    });
  }
  if (repositoryService) {
    register(requests.getGitSettings, (window, request) =>
      repositoryService.getGitSettings(window.webContents.id, request.id),
    );
    register(requests.saveGitSettings, async (window, request) => {
      const result = await repositoryService.saveGitSettings(window.webContents.id, request);
      for (const entry of windows.values()) {
        if (!entry.window.isDestroyed() && isTrustedDocument(entry.window.webContents.getURL(), entry.url))
          entry.window.webContents.send(events.settingsChanged.channel, null);
      }
      return result;
    });
    register(requests.openIssue, async (window, request) => {
      const settings = await repositoryService.getGitSettings(window.webContents.id, request.id);
      if (!settings.issueRule)
        throw new ExpectedBackendError('OPERATION_FAILED', 'Configure repository issue links first.');
      await shell.openExternal(settings.issueRule.url.replace('{id}', request.number));
      return null;
    });
    register(requests.listExternalTools, () => repositoryService.externalTools.store.list());
    register(requests.saveExternalTool, (_window, request) =>
      repositoryService.externalTools.store.save(request),
    );
    register(requests.removeExternalTool, (_window, request) =>
      repositoryService.externalTools.store.remove(request),
    );
    register(requests.runExternalTool, (window, request) =>
      repositoryService.startExternalTool(window.webContents.id, request),
    );
    register(requests.pickExternalTool, async (window) => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Select external tool executable',
        properties: ['openFile'],
      });
      return result.canceled || window.isDestroyed() ? null : (result.filePaths[0] ?? null);
    });
    const store = () => repositoryService.customCommands.store;
    register(requests.listCustomCommands, () => store().list());
    register(requests.saveCustomCommand, (_window, request) => store().save(request));
    register(requests.removeCustomCommand, (_window, request) => store().remove(request));
    register(requests.previewCustomCommand, (window, request) =>
      repositoryService.previewCustomCommand(window.webContents.id, request),
    );
    register(requests.runCustomCommand, (window, request) =>
      repositoryService.startCustomCommand(window.webContents.id, request.token, (url) =>
        shell.openExternal(url),
      ),
    );
    register(requests.pickCustomCommandFile, async (window) => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Select command input file',
        properties: ['openFile'],
      });
      return result.canceled || window.isDestroyed() ? null : (result.filePaths[0] ?? null);
    });
    register(requests.importCustomCommands, async (window) => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Import custom commands (disabled until enabled)',
        properties: ['openFile'],
        filters: [{ name: 'Custom command definitions', extensions: ['json'] }],
      });
      const path = result.filePaths[0];
      if (result.canceled || !path || window.isDestroyed()) return null;
      let data: unknown;
      try {
        data = await readCommandFile(path);
      } catch {
        throw new ExpectedBackendError(
          'INVALID_REQUEST',
          'The selected file is not a readable custom commands JSON file (maximum 2 MiB).',
        );
      }
      if (window.isDestroyed()) return null;
      return store().import(data);
    });
    register(requests.exportCustomCommand, async (window, request) => {
      const content = await store().export(request);
      const result = await dialog.showSaveDialog(window, {
        title: 'Export custom command',
        defaultPath: 'custom-command.json',
        filters: [{ name: 'Custom command definitions', extensions: ['json'] }],
      });
      if (!result.canceled && result.filePath && !window.isDestroyed()) {
        try {
          await writeFile(result.filePath, content, { mode: 0o600 });
        } catch {
          throw new ExpectedBackendError('UNAVAILABLE', 'The custom command could not be exported.');
        }
      }
      return null;
    });
  }
  if (hostingService) {
    register(requests.listHostingActivity, (window, request) =>
      hostingService.listActivity(window.webContents.id, request),
    );
    register(requests.openHostingActivity, async (window, request) => {
      const url = hostingService.activityUrl(window.webContents.id, request);
      try {
        await shell.openExternal(url);
      } catch {
        throw new ExpectedBackendError('UNAVAILABLE', 'The system browser could not be opened.');
      }
      return null;
    });
    register(requests.listHostingAccounts, () => hostingService.list());
    register(requests.connectHostingAccount, (window, request) =>
      hostingService.connect(window.webContents.id, request, async () => {
        const selection = await dialog.showOpenDialog(window, {
          title: 'Select GitHub token file',
          properties: ['openFile', 'showHiddenFiles'],
          buttonLabel: 'Connect',
        });
        return selection.canceled || window.isDestroyed() ? null : (selection.filePaths[0] ?? null);
      }),
    );
    register(requests.disconnectHostingAccount, (_window, { accountId }) =>
      hostingService.disconnect(accountId),
    );
    register(requests.listHostedRepositories, (window, request) =>
      hostingService.listRepositories(window.webContents.id, request),
    );
    register(requests.getHostedCloneTarget, (window, request) =>
      hostingService.cloneTarget(window.webContents.id, request),
    );
    register(requests.openHostedRepository, async (window, request) => {
      const url = hostingService.repositoryUrl(window.webContents.id, request);
      try {
        await shell.openExternal(url);
      } catch {
        throw new ExpectedBackendError('UNAVAILABLE', 'The system browser could not be opened.');
      }
      return null;
    });
    register(requests.cancelHostingRequests, (window) => hostingService.cancel(window.webContents.id));
  }
  register(requests.windowCommand, (window, { action }) => {
    switch (action) {
      case 'minimize':
        window.minimize();
        break;
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case 'close':
        // Give invoke its response before destroying the requesting renderer.
        setImmediate(() => {
          if (!window.isDestroyed()) window.close();
        });
        break;
      case 'toggle-full-screen':
        window.setFullScreen(!window.isFullScreen());
        break;
      case 'zoom-in':
        changeZoom(window, zoomStep);
        break;
      case 'zoom-out':
        changeZoom(window, -zoomStep);
        break;
      case 'reset-zoom':
        window.webContents.setZoomLevel(0);
        break;
      case 'reload':
        requireDevelopment();
        setImmediate(() => {
          if (!window.isDestroyed()) window.webContents.reload();
        });
        break;
      case 'toggle-developer-tools':
        requireDevelopment();
        window.webContents.toggleDevTools();
        break;
      case 'quit':
        setImmediate(() => app.quit());
        break;
    }
    return null;
  });
  register(requests.editCommand, (window, { action }) => {
    const contents = window.webContents;
    switch (action) {
      case 'undo':
        contents.undo();
        break;
      case 'redo':
        contents.redo();
        break;
      case 'cut':
        contents.cut();
        break;
      case 'copy':
        contents.copy();
        break;
      case 'paste':
        contents.paste();
        break;
      case 'select-all':
        contents.selectAll();
        break;
    }
    return null;
  });
  register(requests.writeClipboardText, async (_window, { text }) => {
    await clipboard.writeText(text);
    return null;
  });

  if (repositoryService) {
    register(requests.getRepositoryCommitDetailsContext, (window) => {
      const inspector = windows.get(window.webContents.id)?.inspector;
      if (!inspector || inspector.kind !== 'commit-details')
        throw new ExpectedBackendError('FORBIDDEN', 'This window is not a commit inspector.');
      return inspector.context;
    });
    register(requests.openRepositoryCommitDetails, async (parent, request) => {
      const ownerId = parent.webContents.id;
      const pending = openingInspectors.get(ownerId) ?? 0;
      const openCount = [...windows.values()].filter((entry) => entry.inspector?.parentId === ownerId).length;
      if (pending + openCount >= 8)
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'Close a commit details window before opening another one.',
        );
      openingInspectors.set(ownerId, pending + 1);
      try {
        const page = await repositoryService.getHistory(ownerId, request.id, 0, 1, {
          kind: 'reference',
          target: request.commitId,
        });
        const commit = page.commits.find((candidate) => candidate.id === request.commitId);
        if (!commit) throw new ExpectedBackendError('INVALID_REQUEST', 'That commit is no longer available.');
        if (parent.isDestroyed())
          throw new ExpectedBackendError('UNAVAILABLE', 'The source window was closed.');
        const context: RepositoryCommitDetailsContext = {
          repositoryId: request.id,
          commit,
          references: page.references,
          tab: request.tab,
          path: request.path,
          theme: request.theme,
        };
        await createCommitDetailsWindow(parent, async (child, url) => {
          attachWindow(child, url, { kind: 'commit-details', parentId: ownerId, context });
          await repositoryService.attachInspectionSession(child.webContents.id, ownerId, request.id);
        });
        return null;
      } finally {
        const remaining = (openingInspectors.get(ownerId) ?? 1) - 1;
        if (remaining > 0) openingInspectors.set(ownerId, remaining);
        else openingInspectors.delete(ownerId);
      }
    });
    register(requests.getRepositoryFileHistoryContext, (window) => {
      const inspector = windows.get(window.webContents.id)?.inspector;
      if (!inspector || inspector.kind !== 'file-history')
        throw new ExpectedBackendError('FORBIDDEN', 'This window is not a file-history inspector.');
      return inspector.context;
    });
    register(requests.getRepositoryBlameContext, (window) => {
      const inspector = windows.get(window.webContents.id)?.inspector;
      if (!inspector || inspector.kind !== 'blame')
        throw new ExpectedBackendError('FORBIDDEN', 'This window is not a blame inspector.');
      return inspector.context;
    });
    register(requests.openRepositoryFileHistory, async (parent, request) => {
      const ownerId = parent.webContents.id;
      const pending = openingInspectors.get(ownerId) ?? 0;
      const openCount = [...windows.values()].filter((entry) => entry.inspector?.parentId === ownerId).length;
      if (pending + openCount >= 8)
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'Close an inspection window before opening another one.',
        );
      openingInspectors.set(ownerId, pending + 1);
      try {
        await repositoryService.getFileHistory(ownerId, request.id, request.commitId, request.path);
        if (parent.isDestroyed())
          throw new ExpectedBackendError('UNAVAILABLE', 'The source window was closed.');
        const context: RepositoryFileHistoryContext = {
          repositoryId: request.id,
          commitId: request.commitId,
          path: request.path,
          theme: request.theme,
        };
        await createFileHistoryWindow(parent, 'file-history', async (child, url) => {
          attachWindow(child, url, { kind: 'file-history', parentId: ownerId, context });
          await repositoryService.attachInspectionSession(child.webContents.id, ownerId, request.id);
        });
        return null;
      } finally {
        const remaining = (openingInspectors.get(ownerId) ?? 1) - 1;
        if (remaining > 0) openingInspectors.set(ownerId, remaining);
        else openingInspectors.delete(ownerId);
      }
    });
    register(requests.openRepositoryBlame, async (parent, request) => {
      const ownerId = parent.webContents.id;
      const pending = openingInspectors.get(ownerId) ?? 0;
      const openCount = [...windows.values()].filter((entry) => entry.inspector?.parentId === ownerId).length;
      if (pending + openCount >= 8)
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'Close an inspection window before opening another one.',
        );
      openingInspectors.set(ownerId, pending + 1);
      try {
        await repositoryService.getBlame(ownerId, request.id, request.commitId, request.path);
        if (parent.isDestroyed())
          throw new ExpectedBackendError('UNAVAILABLE', 'The source window was closed.');
        const context: RepositoryBlameContext = {
          repositoryId: request.id,
          commitId: request.commitId,
          path: request.path,
          theme: request.theme,
        };
        await createFileHistoryWindow(parent, 'blame', async (child, url) => {
          attachWindow(child, url, { kind: 'blame', parentId: ownerId, context });
          await repositoryService.attachInspectionSession(child.webContents.id, ownerId, request.id);
        });
        return null;
      } finally {
        const remaining = (openingInspectors.get(ownerId) ?? 1) - 1;
        if (remaining > 0) openingInspectors.set(ownerId, remaining);
        else openingInspectors.delete(ownerId);
      }
    });
    register(requests.getGitInfo, () => repositoryService.getGitInfo());
    register(requests.setRepositoryTrust, (window, request) =>
      repositoryService.setTrust(window.webContents.id, request.id, request.trusted),
    );
    register(requests.pickRepositoryDirectory, (window) =>
      dialog
        .showOpenDialog(window, {
          title: 'Choose a directory',
          properties: ['openDirectory'],
        })
        .then((result) => (result.canceled ? null : (result.filePaths[0] ?? null))),
    );
    register(requests.listRecentRepositories, (window) =>
      repositoryService.listRecent(window.webContents.id),
    );
    register(requests.listOpenRepositories, (window) => repositoryService.listOpen(window.webContents.id));
    register(requests.openRepository, (window, { path }) =>
      repositoryService.open(window.webContents.id, path),
    );
    register(requests.initializeRepository, (window, { path, bare }) =>
      repositoryService.initialize(window.webContents.id, path, bare),
    );
    register(requests.cloneRepository, (window, request) =>
      repositoryService.clone(window.webContents.id, request),
    );
    register(requests.testRepositoryConnection, (window, request) =>
      repositoryService.testConnection(window.webContents.id, request),
    );
    register(requests.getAutomaticFetchPreference, () => repositoryService.getAutomaticFetch());
    register(requests.setAutomaticFetchPreference, (_window, { enabled }) =>
      repositoryService.setAutomaticFetch(enabled),
    );
    register(requests.closeRepository, (window, { id }) =>
      repositoryService.close(window.webContents.id, id).then(() => null),
    );
    register(requests.getRepositoryTabPreferences, (window) =>
      repositoryService.getTabPreferences(window.webContents.id),
    );
    register(requests.setRepositoryTabOrientation, (_window, { tabOrientation }) =>
      repositoryService.setTabOrientation(tabOrientation),
    );
    register(requests.selectRepositoryTab, (window, { id }) =>
      repositoryService.selectTab(window.webContents.id, id),
    );
    register(requests.setRepositoryListVisible, (_window, { visible }) =>
      repositoryService.setTabOrientation(visible ? 'vertical' : 'horizontal'),
    );
    register(requests.reorderRepositoryTabs, (window, { ids }) =>
      repositoryService.reorderTabs(window.webContents.id, ids),
    );
    register(requests.removeRecentRepository, (_window, { id }) =>
      repositoryService.removeRecent(id).then(() => null),
    );
    register(requests.listRepositoryManager, (window) =>
      repositoryService.listManager(window.webContents.id),
    );
    register(requests.addSourceDirectory, (window, { path }) =>
      repositoryService.addSourceDirectory(window.webContents.id, path),
    );
    register(requests.removeSourceDirectory, (_window, { id }) =>
      repositoryService.removeSourceDirectory(id).then(() => null),
    );
    register(requests.rescanSourceDirectory, (window, { id }) =>
      repositoryService.rescanSourceDirectory(window.webContents.id, id),
    );
    register(requests.getRepositoryHistory, (window, { id, offset, limit, filter, anchor, mode }) =>
      repositoryService.getHistory(window.webContents.id, id, offset, limit, filter, anchor, mode),
    );
    register(requests.getRepositoryCommitChanges, (window, { id, commitId }) =>
      repositoryService.getCommitChanges(window.webContents.id, id, commitId),
    );
    // Raster previews retain this capability's owner/frame and committed-only inspector checks.
    register(requests.getRepositoryDiff, (window, { id, target, whitespace, options }) =>
      repositoryService.getDiff(window.webContents.id, id, target, whitespace, options),
    );
    register(requests.previewRepositoryDiscard, (window, request) =>
      repositoryService.previewDiscard(window.webContents.id, request),
    );
    register(requests.cancelRepositoryDiff, (window, request) =>
      repositoryService.cancelDiff(window.webContents.id, request),
    );
    register(requests.getRepositoryWorkingChanges, (window, { id, includeUntracked, includeIgnored }) =>
      repositoryService.getWorkingChanges(window.webContents.id, id, includeUntracked, includeIgnored),
    );
    register(requests.getRepositoryConflicts, (window, request) =>
      repositoryService.getConflicts(window.webContents.id, request),
    );
    register(requests.resolveRepositoryConflict, (window, request) =>
      repositoryService.resolveConflict(request, window.webContents.id),
    );
    register(requests.applyRepositoryWorkingChange, (window, request) =>
      repositoryService.applyWorkingChange(window.webContents.id, request),
    );
    register(requests.getRepositoryCommitContext, (window, { id }) =>
      repositoryService.getCommitContext(window.webContents.id, id),
    );
    register(requests.commitRepositoryChanges, (window, request) =>
      repositoryService.startCommit(window.webContents.id, request),
    );
    register(requests.getRepositoryAmendChanges, (window, { id }) =>
      repositoryService.getAmendChanges(window.webContents.id, id),
    );
    register(requests.listRepositoryRemotes, (window, { id }) =>
      repositoryService.listRemotes(window.webContents.id, id),
    );
    register(requests.applyRepositoryRemoteAction, (window, request) =>
      repositoryService.applyRemoteAction(window.webContents.id, request),
    );
    register(requests.startRepositoryNetworkOperation, (window, request) =>
      repositoryService.startNetworkOperation(window.webContents.id, request),
    );
    register(requests.listRepositoryOperations, (window) =>
      repositoryService.listOperations(window.webContents.id),
    );
    register(requests.previewRepositoryLocalChanges, (window, { id }) =>
      repositoryService.previewLocalChanges(window.webContents.id, id),
    );
    register(requests.getRepositoryRecovery, (window, { id }) =>
      repositoryService.getRecovery(window.webContents.id, id),
    );
    register(requests.listRepositoryStashes, (window, { id }) =>
      repositoryService.listStashes(window.webContents.id, id),
    );
    register(requests.getRepositoryStashDetails, (window, { id, stashId }) =>
      repositoryService.getStashDetails(window.webContents.id, id, stashId),
    );
    register(requests.startRepositoryStashOperation, (window, request) =>
      repositoryService.startStashOperation(window.webContents.id, request),
    );
    register(requests.copyRepositoryPatch, async (window, request) => {
      const content = await repositoryService.patchExportContent(window.webContents.id, request);
      await clipboard.writeText(content);
      return null;
    });
    register(requests.previewRepositoryPatch, async (window, request) => {
      // Authorize the repository before opening a native picker or reading the clipboard.
      await repositoryService.getWorkingChanges(window.webContents.id, request.id, false, false);
      if (request.source === 'clipboard') {
        return repositoryService.previewPatch(
          window.webContents.id,
          request.id,
          checkedPatch(Buffer.from(await clipboard.readText(), 'utf8')),
          'Clipboard',
        );
      }
      const chosen = await dialog.showOpenDialog(window, {
        title: 'Apply Patch',
        properties: ['openFile'],
        filters: [
          { name: 'Git patches', extensions: ['patch', 'diff'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      const path = chosen.filePaths[0];
      if (chosen.canceled || !path) return null;
      return repositoryService.previewPatch(
        window.webContents.id,
        request.id,
        await readPatchFile(path),
        path,
      );
    });
    register(requests.applyRepositoryPatch, (window, request) =>
      repositoryService.applyPatch(window.webContents.id, request),
    );
    register(requests.releaseRepositoryPatch, (window, request) =>
      repositoryService.releasePatch(window.webContents.id, request),
    );
    register(requests.saveRepositoryPatch, async (window, request) => {
      const defaultName =
        request.target.kind === 'commit'
          ? `${request.target.commitId.slice(0, 12)}.patch`
          : request.target.kind === 'stash'
            ? `${request.target.stashId.slice(0, 12)}-stash.patch`
            : 'working-changes.patch';
      const chosen = await dialog.showSaveDialog(window, {
        title: 'Save Patch',
        defaultPath: defaultName,
        filters: [{ name: 'Git patches', extensions: ['patch', 'diff'] }],
      });
      if (chosen.canceled || !chosen.filePath) {
        return {
          status: 'cancelled' as const,
          path: null,
          byteLength: 0,
          message: 'Patch export cancelled.',
        };
      }
      return repositoryService.savePatch(window.webContents.id, request, chosen.filePath);
    });
    register(requests.recoverRepository, (window, request) =>
      repositoryService.startRecovery(window.webContents.id, request),
    );
    register(requests.openRepositoryPullRequest, async (window, request) => {
      const url = await repositoryService.getPullRequestUrl(window.webContents.id, request);
      await shell.openExternal(url);
      return null;
    });
    register(requests.cancelRepositoryOperation, (window, { operationId }) =>
      repositoryService.cancelOperation(window.webContents.id, operationId),
    );
    register(requests.getRepositoryReferenceContext, (window, { id }) =>
      repositoryService.getReferenceContext(window.webContents.id, id),
    );
    register(requests.applyRepositoryReferenceAction, (window, request) =>
      repositoryService.startReferenceAction(window.webContents.id, request),
    );
    register(requests.getRepositoryWorktrees, (window, { id }) =>
      repositoryService.getWorktrees(window.webContents.id, id),
    );
    register(requests.startRepositoryWorktreeOperation, (window, request) =>
      repositoryService.startWorktreeOperation(window.webContents.id, request),
    );
    register(requests.getRepositoryBisect, (window, { id }) =>
      repositoryService.getBisect(window.webContents.id, id),
    );
    register(requests.getRepositorySigningSettings, (window, { id }) =>
      repositoryService.getSigningSettings(window.webContents.id, id),
    );
    register(requests.getRepositoryStatistics, (window, request) =>
      repositoryService.getStatistics(window.webContents.id, request),
    );
    register(requests.cancelRepositoryStatistics, (window, request) =>
      repositoryService.cancelStatistics(window.webContents.id, request),
    );
    register(requests.setRepositorySigningKey, (window, request) =>
      repositoryService.setSigningKey(window.webContents.id, request),
    );
    register(requests.verifyRepositorySignature, (window, request) =>
      repositoryService.verifySignature(window.webContents.id, request),
    );
    register(requests.startRepositoryBisectOperation, (window, request) =>
      repositoryService.startBisectOperation(window.webContents.id, request),
    );
    register(requests.getRepositoryLean, (window, request) =>
      repositoryService.getLean(window.webContents.id, request),
    );
    register(requests.startRepositoryLean, (window, request) =>
      repositoryService.startLean(window.webContents.id, request),
    );
    register(requests.getRepositoryGitFlow, (window, { id }) =>
      repositoryService.getGitFlow(window.webContents.id, id),
    );
    register(requests.startRepositoryGitFlowOperation, (window, request) =>
      repositoryService.startGitFlowOperation(window.webContents.id, request),
    );
    register(requests.getRepositorySubmodules, (window, { id }) =>
      repositoryService.getSubmodules(window.webContents.id, id),
    );
    register(requests.startRepositorySubmoduleOperation, (window, request) =>
      repositoryService.startSubmoduleOperation(window.webContents.id, request),
    );
    register(requests.openRepositorySubmodule, async (window, { id, submoduleId }) => {
      const summary = await repositoryService.openSubmodule(window.webContents.id, id, submoduleId);
      const entry = windows.get(window.webContents.id);
      if (!window.isDestroyed() && entry && isTrustedDocument(window.webContents.getURL(), entry.url))
        window.webContents.send(
          events.repositoryActivated.channel,
          events.repositoryActivated.payload.parse(summary),
        );
      return summary;
    });
    register(requests.startRepositoryMergeRebase, (window, request) =>
      repositoryService.startMergeRebase(window.webContents.id, request),
    );
    register(requests.getRepositoryHistoryOperationPreview, (window, request) =>
      repositoryService.getHistoryOperationPreview(window.webContents.id, request),
    );
    register(requests.startRepositoryHistoryOperation, (window, request) =>
      repositoryService.startHistoryOperation(window.webContents.id, request),
    );
    register(requests.getRepositoryInteractiveRebasePlan, (window, request) =>
      repositoryService.getInteractiveRebasePlan(window.webContents.id, request),
    );
    register(requests.startRepositoryInteractiveRebase, (window, request) =>
      repositoryService.startInteractiveRebase(window.webContents.id, request),
    );
    register(requests.getRepositoryRevisionTree, (window, { id, commitId, path }) =>
      repositoryService.getRevisionTree(window.webContents.id, id, commitId, path),
    );
    register(requests.getRepositoryRevisionBlob, (window, { id, commitId, path }) =>
      repositoryService.getRevisionBlob(window.webContents.id, id, commitId, path),
    );
    register(requests.getRepositoryLfsFile, (window, { id, commitId, path }) =>
      repositoryService.getLfsFile(window.webContents.id, id, commitId, path),
    );
    register(requests.startRepositoryLfsInitialization, (window, request) =>
      repositoryService.startLfsInitialization(window.webContents.id, request),
    );
    register(requests.saveRepositoryLfsPayload, async (window, request) => {
      const chosen = await dialog.showSaveDialog(window, {
        title: 'Save LFS Payload',
        defaultPath: basename(request.path),
        filters: [{ name: 'All files', extensions: ['*'] }],
      });
      if (chosen.canceled || !chosen.filePath) return null;
      return repositoryService.startLfsPayloadSave(window.webContents.id, request, chosen.filePath);
    });
    register(requests.getRepositoryFileHistory, (window, { id, commitId, path }) =>
      repositoryService.getFileHistory(window.webContents.id, id, commitId, path),
    );
    register(requests.getRepositoryBlame, (window, { id, commitId, path }) =>
      repositoryService.getBlame(window.webContents.id, id, commitId, path),
    );
    register(requests.openRepositoryInFileManager, async (window, location) => {
      const path = await repositoryService.resolveLocation(window.webContents.id, location);
      const failure = await shell.openPath(path);
      if (failure) {
        throw new ExpectedBackendError('OPERATION_FAILED', 'The file manager could not open that folder.');
      }
      return null;
    });
  }

  // Operation progress is published to the window that started the work and to no other.
  const releaseOperations = repositoryService?.subscribeOperations((ownerId, operation) => {
    const entry = windows.get(ownerId);
    if (!entry || entry.window.isDestroyed()) return;
    if (!isTrustedDocument(entry.window.webContents.getURL(), entry.url)) return;
    entry.window.webContents.send(events.repositoryOperationChanged.channel, operation);
  });

  return {
    publishRepositoryActivated(window: BrowserWindow, repository: RepositorySummary) {
      const entry = windows.get(window.webContents.id);
      if (!entry || window.isDestroyed() || !isTrustedDocument(window.webContents.getURL(), entry.url))
        return;
      window.webContents.send(
        events.repositoryActivated.channel,
        events.repositoryActivated.payload.parse(repository),
      );
    },
    attachWindow,
    dispose() {
      releaseOperations?.();
      for (const channel of channels) ipcMain.removeHandler(channel);
      for (const entry of windows.values()) entry.cleanup();
    },
  };
}
