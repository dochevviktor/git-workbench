import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu } from 'electron';
import { isTrustedDocument } from './security';

export function createMainWindow(attachWindow: (window: BrowserWindow, url: string) => void): BrowserWindow {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined;
  const rendererUrl = devUrl ?? pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    title: 'Git Workbench',
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#171b22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });

  attachWindow(window, rendererUrl);
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDocument(url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'copy', enabled: params.selectionText.length > 0 },
      ...(params.isEditable
        ? [{ role: 'cut' as const }, { role: 'paste' as const }, { role: 'selectAll' as const }]
        : []),
      ...(!app.isPackaged
        ? [
            { type: 'separator' as const },
            { label: 'Inspect element', click: () => window.webContents.inspectElement(params.x, params.y) },
          ]
        : []),
    ]);
    menu.popup({ window });
  });

  const loaded = devUrl ? window.loadURL(devUrl) : window.loadFile(rendererFile);
  void loaded.catch((error: unknown) => {
    console.error('Unable to load the application window', error);
    app.exit(1);
  });
  return window;
}
