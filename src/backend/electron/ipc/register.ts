import { app, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { events, requests } from '../../../common/ipc/contracts';
import type { AppInfo, RequestContract, WindowState } from '../../../common/ipc/contracts';
import { isTrustedDocument } from '../security';
import { executeRequest } from './execute-request';

function windowState(window: BrowserWindow): WindowState {
  return { maximized: window.isMaximized(), focused: window.isFocused() };
}

export function registerAppIpc() {
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
    }
    return null;
  });

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
      const cleanup = () => {
        windows.delete(id);
        window.removeListener('maximize', publishState);
        window.removeListener('unmaximize', publishState);
        window.removeListener('focus', publishState);
        window.removeListener('blur', publishState);
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
