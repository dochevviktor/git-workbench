import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedDocument } from './security';

/** Only this fixed application document may host commit inspection; no renderer-selected URL or path. */
export async function createCommitDetailsWindow(
  parent: BrowserWindow,
  initialize: (window: BrowserWindow, documentUrl: string) => Promise<void>,
): Promise<BrowserWindow> {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined;
  const documentUrl = devUrl ?? pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    parent,
    title: 'Commit Details — Git Workbench',
    width: 1000,
    height: 600,
    minWidth: 640,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.setMenu(null);
  const closeWithParent = () => {
    if (!window.isDestroyed()) window.close();
  };
  parent.once('closed', closeWithParent);
  window.once('closed', () => {
    parent.removeListener('closed', closeWithParent);
    if (!parent.isDestroyed()) parent.focus();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDocument(url, documentUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const show = () => {
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show();
      if (
        !screen
          .getAllDisplays()
          .some((display) => display.workArea.width >= 64 && display.workArea.height >= 64)
      )
        window.setSize(1000, 600);
    }
  };
  try {
    await initialize(window, documentUrl);
    if (parent.isDestroyed() || window.isDestroyed()) throw new Error('The source window was closed.');
    window.once('ready-to-show', show);
    window.webContents.once('did-finish-load', show);
    if (devUrl) await window.loadURL(`${devUrl}#commit-details`);
    else await window.loadFile(rendererFile, { hash: 'commit-details' });
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}
