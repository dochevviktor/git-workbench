import { app, clipboard, dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { events, requests } from '../../../common/ipc/contracts';
import type { AppInfo, RequestContract, WindowState } from '../../../common/ipc/contracts';
import { ExpectedBackendError } from '../../errors';
import type { RepositoryService } from '../../repositories/repository-service';
import { isTrustedDocument } from '../security';
import { executeRequest } from './execute-request';

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

export function registerAppIpc(repositoryService?: RepositoryService) {
  const windows = new Map<number, { window: BrowserWindow; url: string; cleanup: () => void }>();
  const channels: string[] = [];

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
        window !== undefined,
        (input) => {
          if (!window) throw new Error('Missing IPC window');
          return handler(window, input);
        },
        (error) => console.error(`IPC handler failed: ${contract.channel}`, error),
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
    register(requests.getGitInfo, () => repositoryService.getGitInfo());
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
    register(requests.getRepositoryHistory, (window, { id, offset, limit, filter }) =>
      repositoryService.getHistory(window.webContents.id, id, offset, limit, filter),
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

  return {
    attachWindow(window: BrowserWindow, url: string) {
      const id = window.webContents.id;
      windows.get(id)?.cleanup();
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
        repositoryService?.disposeWindow(id);
        windows.delete(id);
        window.removeListener('maximize', publishState);
        window.removeListener('unmaximize', publishState);
        window.removeListener('focus', publishState);
        window.removeListener('blur', publishState);
        window.removeListener('enter-full-screen', publishState);
        window.removeListener('leave-full-screen', publishState);
        window.removeListener('closed', cleanup);
      };
      windows.set(id, { window, url, cleanup });
      window.once('closed', cleanup);
    },
    dispose() {
      for (const channel of channels) ipcMain.removeHandler(channel);
      for (const entry of windows.values()) entry.cleanup();
    },
  };
}
