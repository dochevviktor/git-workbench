import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { registerAppIpc } from '../../src/backend/electron/ipc/register';
import type { RepositoryService } from '../../src/backend/repositories/repository-service';
import { events, requests } from '../../src/common/ipc/contracts';

const { handlers, removeHandler, writeText, openPath, packaged } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>>(),
  removeHandler: vi.fn(),
  writeText: vi.fn(),
  openPath: vi.fn(),
  packaged: { value: false },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0',
    get isPackaged() {
      return packaged.value;
    },
  },
  clipboard: { writeText },
  shell: { openPath },
  dialog: {},
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>,
    ) => {
      if (handlers.has(channel)) throw new Error('Duplicate IPC handler');
      handlers.set(channel, handler);
    },
    removeHandler,
  },
}));

class TestWindow extends EventEmitter {
  destroyed = false;
  fullScreen = false;
  zoomLevel = 0;
  readonly minimize = vi.fn();
  readonly maximize = vi.fn();
  readonly unmaximize = vi.fn();
  readonly close = vi.fn();
  readonly setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
  });
  readonly webContents;

  constructor(id: number, url = 'file:///app/index.html') {
    super();
    this.webContents = {
      id,
      mainFrame: { url },
      getURL: () => this.webContents.mainFrame.url,
      send: vi.fn(),
      getZoomLevel: () => this.zoomLevel,
      setZoomLevel: vi.fn((level: number) => {
        this.zoomLevel = level;
      }),
      toggleDevTools: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
    };
  }

  isDestroyed() {
    return this.destroyed;
  }
  isMaximized() {
    return false;
  }
  isFocused() {
    return true;
  }
  isFullScreen() {
    return this.fullScreen;
  }
  asWindow() {
    return this as unknown as BrowserWindow;
  }
  event() {
    return {
      sender: this.webContents,
      senderFrame: this.webContents.mainFrame,
    } as unknown as IpcMainInvokeEvent;
  }
}

afterEach(() => {
  handlers.clear();
  packaged.value = false;
});

describe('IPC sender and window lifecycle', () => {
  it('routes commands to their owning window and registers handlers only once', async () => {
    const ipc = registerAppIpc();
    const first = new TestWindow(1);
    const second = new TestWindow(2);
    ipc.attachWindow(first.asWindow(), first.webContents.getURL());
    ipc.attachWindow(second.asWindow(), second.webContents.getURL());
    expect(handlers.size).toBe(5);
    const handler = handlers.get(requests.windowCommand.channel);
    expect(await handler?.(second.event(), { action: 'minimize' })).toEqual({ ok: true, value: null });
    expect(second.minimize).toHaveBeenCalledOnce();
    expect(first.minimize).not.toHaveBeenCalled();
    ipc.dispose();
    expect(removeHandler).toHaveBeenCalledTimes(5);
    expect(first.listenerCount('focus')).toBe(0);
    expect(second.listenerCount('closed')).toBe(0);
  });

  it('denies unregistered windows, subframes, and navigated documents', async () => {
    const ipc = registerAppIpc();
    const window = new TestWindow(1);
    const handler = handlers.get(requests.getWindowState.channel);
    expect(await handler?.(window.event())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    ipc.attachWindow(window.asWindow(), window.webContents.getURL());
    const subframe = {
      ...window.event(),
      senderFrame: { url: window.webContents.getURL() },
    } as IpcMainInvokeEvent;
    expect(await handler?.(subframe)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    window.webContents.mainFrame.url = 'https://example.com/';
    expect(await handler?.(window.event())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    ipc.dispose();
  });

  it('targets events to the originating window and releases closed windows', async () => {
    const ipc = registerAppIpc();
    const first = new TestWindow(1);
    const second = new TestWindow(2);
    ipc.attachWindow(first.asWindow(), first.webContents.getURL());
    ipc.attachWindow(second.asWindow(), second.webContents.getURL());
    first.emit('maximize');
    expect(first.webContents.send).toHaveBeenCalledWith(events.windowStateChanged.channel, {
      maximized: false,
      focused: true,
      fullScreen: false,
    });
    first.fullScreen = true;
    first.emit('enter-full-screen');
    expect(first.webContents.send).toHaveBeenLastCalledWith(events.windowStateChanged.channel, {
      maximized: false,
      focused: true,
      fullScreen: true,
    });
    expect(second.webContents.send).not.toHaveBeenCalled();
    first.emit('closed');
    expect(first.listenerCount('maximize')).toBe(0);
    expect(first.listenerCount('leave-full-screen')).toBe(0);
    expect(await handlers.get(requests.getWindowState.channel)?.(first.event())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    ipc.dispose();
  });

  it('applies view, editing, and clipboard commands only to the requesting window', async () => {
    const ipc = registerAppIpc();
    const first = new TestWindow(1);
    const second = new TestWindow(2);
    ipc.attachWindow(first.asWindow(), first.webContents.getURL());
    ipc.attachWindow(second.asWindow(), second.webContents.getURL());
    const windowCommand = handlers.get(requests.windowCommand.channel);
    const editCommand = handlers.get(requests.editCommand.channel);

    await windowCommand?.(first.event(), { action: 'zoom-in' });
    await windowCommand?.(first.event(), { action: 'zoom-in' });
    expect(first.zoomLevel).toBe(1);
    for (let index = 0; index < 20; index += 1) await windowCommand?.(first.event(), { action: 'zoom-out' });
    expect(first.zoomLevel).toBe(-3);
    await windowCommand?.(first.event(), { action: 'reset-zoom' });
    expect(first.zoomLevel).toBe(0);
    await windowCommand?.(first.event(), { action: 'toggle-full-screen' });
    expect(first.setFullScreen).toHaveBeenCalledWith(true);
    expect(second.setFullScreen).not.toHaveBeenCalled();

    expect(await editCommand?.(second.event(), { action: 'paste' })).toEqual({ ok: true, value: null });
    expect(second.webContents.paste).toHaveBeenCalledOnce();
    expect(first.webContents.paste).not.toHaveBeenCalled();
    await editCommand?.(second.event(), { action: 'select-all' });
    expect(second.webContents.selectAll).toHaveBeenCalledOnce();

    expect(
      await handlers.get(requests.writeClipboardText.channel)?.(first.event(), { text: 'a1b2c3' }),
    ).toEqual({ ok: true, value: null });
    expect(writeText).toHaveBeenCalledWith('a1b2c3');
    ipc.dispose();
  });

  it('keeps developer commands out of packaged builds', async () => {
    const ipc = registerAppIpc();
    const window = new TestWindow(1);
    ipc.attachWindow(window.asWindow(), window.webContents.getURL());
    const windowCommand = handlers.get(requests.windowCommand.channel);

    await windowCommand?.(window.event(), { action: 'toggle-developer-tools' });
    expect(window.webContents.toggleDevTools).toHaveBeenCalledOnce();
    packaged.value = true;
    expect(await windowCommand?.(window.event(), { action: 'toggle-developer-tools' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await windowCommand?.(window.event(), { action: 'reload' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(window.webContents.toggleDevTools).toHaveBeenCalledOnce();
    ipc.dispose();
  });

  it('opens only backend-resolved repository locations in the file manager', async () => {
    const resolveLocation = vi.fn(async () => '/repositories/sample');
    const service = {
      resolveLocation,
      disposeWindow: vi.fn(),
      subscribeOperations: vi.fn(() => () => undefined),
    } as unknown as RepositoryService;
    const ipc = registerAppIpc(service);
    const window = new TestWindow(4);
    ipc.attachWindow(window.asWindow(), window.webContents.getURL());
    const handler = handlers.get(requests.openRepositoryInFileManager.channel);
    const location = { kind: 'open', id: `repo-${'a'.repeat(64)}` };

    openPath.mockResolvedValueOnce('');
    expect(await handler?.(window.event(), location)).toEqual({ ok: true, value: null });
    expect(resolveLocation).toHaveBeenCalledWith(4, location);
    expect(openPath).toHaveBeenCalledWith('/repositories/sample');

    openPath.mockResolvedValueOnce('No application is associated with this folder.');
    expect(await handler?.(window.event(), location)).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_FAILED' },
    });
    expect(await handler?.(window.event(), { kind: 'open', path: '/etc' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(openPath).toHaveBeenCalledTimes(2);
    ipc.dispose();
  });
});
