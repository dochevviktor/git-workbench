import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { registerAppIpc } from '../../src/backend/electron/ipc/register';
import { events, requests } from '../../src/common/ipc/contracts';

const { handlers, removeHandler } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>>(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0', isPackaged: false },
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
  readonly minimize = vi.fn();
  readonly maximize = vi.fn();
  readonly unmaximize = vi.fn();
  readonly close = vi.fn();
  readonly webContents;

  constructor(id: number, url = 'file:///app/index.html') {
    super();
    this.webContents = {
      id,
      mainFrame: { url },
      getURL: () => this.webContents.mainFrame.url,
      send: vi.fn(),
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

afterEach(() => handlers.clear());

describe('IPC sender and window lifecycle', () => {
  it('routes commands to their owning window and registers handlers only once', async () => {
    const ipc = registerAppIpc();
    const first = new TestWindow(1);
    const second = new TestWindow(2);
    ipc.attachWindow(first.asWindow(), first.webContents.getURL());
    ipc.attachWindow(second.asWindow(), second.webContents.getURL());
    expect(handlers.size).toBe(3);
    const handler = handlers.get(requests.windowCommand.channel);
    expect(await handler?.(second.event(), { action: 'minimize' })).toEqual({ ok: true, value: null });
    expect(second.minimize).toHaveBeenCalledOnce();
    expect(first.minimize).not.toHaveBeenCalled();
    ipc.dispose();
    expect(removeHandler).toHaveBeenCalledTimes(3);
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
    });
    expect(second.webContents.send).not.toHaveBeenCalled();
    first.emit('closed');
    expect(first.listenerCount('maximize')).toBe(0);
    expect(await handlers.get(requests.getWindowState.channel)?.(first.event())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    ipc.dispose();
  });
});
