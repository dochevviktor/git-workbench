import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTrustedDocument } from './security';

export type FileHistoryWindowKind = 'file-history' | 'blame';

/** Creates a read-only History or Blame inspector on the fixed application renderer document. */
export async function createFileHistoryWindow(
  parent: BrowserWindow,
  kind: FileHistoryWindowKind,
  initialize: (window: BrowserWindow, documentUrl: string) => Promise<void>,
): Promise<BrowserWindow> {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined;
  const documentUrl = devUrl ?? pathToFileURL(rendererFile).href;
  const title = kind === 'file-history' ? 'File History — Git Workbench' : 'Blame — Git Workbench';
  const window = new BrowserWindow({
    parent,
    title,
    width: 1020,
    height: 720,
    minWidth: 720,
    minHeight: 440,
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
        window.setSize(1020, 720);
    }
  };
  try {
    await initialize(window, documentUrl);
    if (parent.isDestroyed() || window.isDestroyed()) throw new Error('The source window was closed.');
    window.once('ready-to-show', show);
    window.webContents.once('did-finish-load', show);
    const hash = kind === 'file-history' ? 'file-history' : 'blame';
    if (devUrl) await window.loadURL(`${devUrl}#${hash}`);
    else await window.loadFile(rendererFile, { hash });
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}
