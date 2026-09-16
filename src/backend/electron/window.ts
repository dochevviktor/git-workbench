import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, nativeTheme } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import { isTrustedDocument } from './security';

/**
 * The renderer draws the title bar, menu bar, window controls, and context menus. macOS keeps its
 * native traffic-light buttons, inset into that title bar; other platforms use a frameless window.
 */
function windowChrome(): BrowserWindowConstructorOptions {
  return process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
    : { frame: false };
}

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
    ...windowChrome(),
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

  attachWindow(window, rendererUrl);
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDocument(url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const loaded = devUrl ? window.loadURL(devUrl) : window.loadFile(rendererFile);
  void loaded.catch((error: unknown) => {
    console.error('Unable to load the application window', error);
    app.exit(1);
  });
  return window;
}
