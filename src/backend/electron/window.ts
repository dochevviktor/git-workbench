import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import { isTrustedDocument } from './security';
import { restoreWindowBounds, WindowStateStore } from './window-state-store';

/**
 * The renderer draws the title bar, menu bar, window controls, and context menus. macOS keeps its
 * native traffic-light buttons, inset into that title bar; other platforms use a frameless window.
 */
function windowChrome(): BrowserWindowConstructorOptions {
  return process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
    : { frame: false };
}

export function createMainWindow(
  attachWindow: (window: BrowserWindow, url: string) => void,
  workspaceId = 'default',
): BrowserWindow {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined;
  const rendererUrl = devUrl ?? pathToFileURL(rendererFile).href;
  const stateStore = new WindowStateStore(
    join(
      app.getPath('userData'),
      workspaceId === 'default' ? 'window-state.json' : `window-state-${workspaceId}.json`,
    ),
  );
  const primary = screen.getPrimaryDisplay();
  const workAreas = [
    primary.workArea,
    ...screen
      .getAllDisplays()
      .filter((display) => display.id !== primary.id)
      .map((display) => display.workArea),
  ];
  const restored = restoreWindowBounds(stateStore.read(), workAreas);
  const hasUsableDisplay = workAreas.some((area) => area.width >= 64 && area.height >= 64);
  const window = new BrowserWindow({
    title: 'Git Workbench',
    ...(hasUsableDisplay
      ? restored.bounds
      : { width: restored.bounds.width, height: restored.bounds.height }),
    minWidth: Math.min(880, restored.bounds.width),
    minHeight: Math.min(600, restored.bounds.height),
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

  let saved = restored;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveState = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    if (!window.isFullScreen()) saved = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
    try {
      stateStore.write(saved);
    } catch (error) {
      console.error('Unable to save window bounds', error);
    }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 250);
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', saveState);
  window.once('closed', () => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  attachWindow(window, rendererUrl);
  // A hidden window on Wayland can miss `ready-to-show`: with the development server the page rendered, but
  // the event arrived only after the window was shown. Show the window once the page has loaded at the latest.
  const showWindow = () => {
    if (restored.maximized && !window.isVisible()) window.maximize();
    if (!window.isVisible()) {
      window.show();
      // A 1×1 virtual display can clamp constructor geometry to the minimum size. Once shown,
      // apply the same bounded fallback; real displays retain their native placement behavior.
      if (!hasUsableDisplay && !restored.maximized) window.setBounds(restored.bounds);
    }
  };
  window.once('ready-to-show', showWindow);
  window.webContents.once('did-finish-load', showWindow);
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
