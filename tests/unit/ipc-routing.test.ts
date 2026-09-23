import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { registerAppIpc } from '../../src/backend/electron/ipc/register';
import type { RepositoryService } from '../../src/backend/repositories/repository-service';
import { events, requests } from '../../src/common/ipc/contracts';
import type { HostingService } from '../../src/backend/hosting/hosting-service';

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
  contentsDestroyed = false;
  fullScreen = false;
  zoomLevel = 0;
  readonly minimize = vi.fn();
  readonly maximize = vi.fn();
  readonly unmaximize = vi.fn();
  readonly close = vi.fn();
  readonly setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
  });
  private readonly contents;

  get webContents() {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    return this.contents;
  }

  constructor(id: number, url = 'file:///app/index.html') {
    super();
    const webEvents = new EventEmitter();
    this.contents = {
      on: webEvents.on.bind(webEvents),
      removeListener: webEvents.removeListener.bind(webEvents),
      emit: webEvents.emit.bind(webEvents),
      listenerCount: webEvents.listenerCount.bind(webEvents),
      id,
      isDestroyed: () => this.contentsDestroyed,
      mainFrame: { url },
      getURL: (): string => {
        if (this.contentsDestroyed) throw new TypeError('Object has been destroyed');
        return this.contents.mainFrame.url;
      },
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
  it('cleans up a destroyed window once before application disposal', async () => {
    const releaseOperations = vi.fn();
    const service = {
      disposeWindow: vi.fn(),
      subscribeOperations: () => releaseOperations,
      subscribeInvalidations: () => () => undefined,
    } as unknown as RepositoryService;
    const hosting = { cancel: vi.fn() } as unknown as HostingService;
    const ipc = registerAppIpc(service, hosting);
    const window = new TestWindow(60);
    const contents = window.webContents;
    const event = window.event();
    ipc.attachWindow(window.asWindow(), contents.getURL());
    window.destroyed = true;
    window.contentsDestroyed = true;

    expect(() => window.emit('closed')).not.toThrow();
    expect(contents.listenerCount('did-start-loading')).toBe(0);
    expect(window.eventNames()).toEqual([]);
    expect(service.disposeWindow).toHaveBeenCalledExactlyOnceWith(60);
    expect(hosting.cancel).toHaveBeenCalledExactlyOnceWith(60);
    expect(await handlers.get(requests.getWindowState.channel)?.(event)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(() => ipc.publishRepositoryActivated(window.asWindow(), {} as never)).not.toThrow();
    expect(() => {
      ipc.dispose();
      ipc.dispose();
      window.emit('closed');
    }).not.toThrow();
    expect(service.disposeWindow).toHaveBeenCalledTimes(1);
    expect(hosting.cancel).toHaveBeenCalledTimes(1);
    expect(releaseOperations).toHaveBeenCalledTimes(1);
  });

  it('ignores window state events after its renderer has been destroyed', () => {
    const ipc = registerAppIpc();
    const window = new TestWindow(61);
    const contents = window.webContents;
    ipc.attachWindow(window.asWindow(), contents.getURL());
    window.contentsDestroyed = true;
    expect(() => window.emit('focus')).not.toThrow();
    expect(() => ipc.publishRepositoryActivated(window.asWindow(), {} as never)).not.toThrow();
    expect(contents.send).not.toHaveBeenCalled();
    ipc.dispose();
    expect(contents.listenerCount('did-start-loading')).toBe(0);
  });

  it('handles reentrant disposal when closing owned inspector windows', () => {
    const releaseOperations = vi.fn();
    const service = {
      disposeWindow: vi.fn(),
      subscribeOperations: () => releaseOperations,
      subscribeInvalidations: () => () => undefined,
    } as unknown as RepositoryService;
    const ipc = registerAppIpc(service);
    const parent = new TestWindow(62);
    const child = new TestWindow(63);
    const childContents = child.webContents;
    ipc.attachWindow(parent.asWindow(), parent.webContents.getURL());
    ipc.attachWindow(child.asWindow(), childContents.getURL(), { parentId: 62, context: {} as never });
    child.close.mockImplementation(() => {
      child.destroyed = true;
      child.contentsDestroyed = true;
      child.emit('closed');
      ipc.dispose();
    });
    expect(() => ipc.dispose()).not.toThrow();
    expect(service.disposeWindow).toHaveBeenCalledTimes(2);
    expect(service.disposeWindow).toHaveBeenCalledWith(62);
    expect(service.disposeWindow).toHaveBeenCalledWith(63);
    expect(child.close).toHaveBeenCalledOnce();
    expect(childContents.listenerCount('did-start-loading')).toBe(0);
    expect(parent.listenerCount('closed')).toBe(0);
    expect(releaseOperations).toHaveBeenCalledOnce();
  });

  it('authorizes push reviews only in the owning main frame and validates results', async () => {
    const preview = {
      token: '12345678-1234-4234-8234-123456789abc',
      remote: 'origin',
      tagCount: 0,
      targets: [
        {
          fullName: 'refs/heads/main',
          remoteBranch: 'main',
          localId: 'a'.repeat(40),
          remoteId: null,
          replacedCommits: 0,
        },
      ],
    };
    const previewPush = vi.fn(async () => preview);
    const service = {
      previewPush,
      disposeWindow: vi.fn(),
      subscribeOperations: () => () => undefined,
      subscribeInvalidations: () => () => undefined,
    } as unknown as RepositoryService;
    const ipc = registerAppIpc(service);
    const main = new TestWindow(70);
    const child = new TestWindow(71);
    ipc.attachWindow(main.asWindow(), main.webContents.getURL());
    ipc.attachWindow(child.asWindow(), child.webContents.getURL(), { parentId: 70, context: {} as never });
    const handler = handlers.get(requests.previewRepositoryPush.channel)!;
    const request = {
      id: `repo-${'a'.repeat(64)}`,
      remote: 'origin',
      tags: false,
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
    };
    expect(await handler(main.event(), request)).toMatchObject({ ok: true, value: preview });
    expect(previewPush).toHaveBeenCalledWith(70, request);
    expect(await handler(child.event(), request)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await handler({ ...main.event(), senderFrame: { url: main.webContents.getURL() } } as never, request),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await handler(main.event(), { ...request, targets: [] })).toMatchObject({ ok: false });
    previewPush.mockResolvedValueOnce({ ...preview, token: 'invalid' });
    expect(await handler(main.event(), request)).toMatchObject({ ok: false });
    ipc.dispose();
  });

  it('authorizes AI settings only in main windows and releases its exact reload listener', async () => {
    const service = {
      ai: {
        settings: vi.fn(() => ({ enabled: false, model: null, provider: 'openai', storage: 'session' })),
        cancel: vi.fn(() => null),
      },
      disposeWindow: vi.fn(),
      subscribeOperations: () => () => undefined,
      subscribeInvalidations: () => () => undefined,
    } as unknown as RepositoryService;
    const ipc = registerAppIpc(service);
    const window = new TestWindow(50);
    const inspector = new TestWindow(51);
    ipc.attachWindow(window.asWindow(), window.webContents.getURL());
    ipc.attachWindow(inspector.asWindow(), inspector.webContents.getURL(), {
      parentId: 50,
      context: {} as never,
    });
    const handler = handlers.get(requests.getAiSettings.channel)!;
    expect(await handler(window.event())).toMatchObject({ ok: true });
    expect(await handler(inspector.event())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await handler({ ...window.event(), senderFrame: { url: window.webContents.getURL() } } as never),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    window.webContents.emit('did-start-loading');
    expect(service.ai.cancel).toHaveBeenCalledWith(50);
    expect(window.webContents.listenerCount('did-start-loading')).toBe(1);
    ipc.dispose();
    expect(window.webContents.listenerCount('did-start-loading')).toBe(0);
    expect(inspector.webContents.listenerCount('did-start-loading')).toBe(0);
  });
  it('authorizes hosting only for the owner main frame and cancels on close', async () => {
    const hosting = {
      list: vi.fn(async () => ({ accounts: [], secureStorageAvailable: false })),
      cancel: vi.fn(),
    } as unknown as HostingService;
    const ipc = registerAppIpc(undefined, hosting);
    const window = new TestWindow(20);
    const inspector = new TestWindow(21);
    ipc.attachWindow(window.asWindow(), window.webContents.getURL());
    ipc.attachWindow(inspector.asWindow(), inspector.webContents.getURL(), {
      parentId: 20,
      context: {} as never,
    });
    const handler = handlers.get(requests.listHostingAccounts.channel)!;
    expect(await handler(window.event())).toMatchObject({ ok: true });
    expect(await handler(inspector.event())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await handler({ ...window.event(), senderFrame: { url: window.webContents.getURL() } } as never),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await handlers.get(requests.connectHostingAccount.channel)!(window.event(), {
        remember: false,
        token: 'forbidden',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(hosting.list).toHaveBeenCalledOnce();
    for (const contract of [
      requests.listHostingActivity,
      requests.openHostingActivity,
      requests.useHostingAccountForGit,
      requests.openHostingTokenSettings,
      requests.connectHostingAccount,
    ]) {
      const activityHandler = handlers.get(contract.channel)!;
      expect(await activityHandler(inspector.event(), {})).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(
        await activityHandler(
          { ...window.event(), senderFrame: { url: window.webContents.getURL() } } as never,
          {},
        ),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    window.emit('closed');
    expect(hosting.cancel).toHaveBeenCalledWith(20);
    ipc.dispose();
  });
  it('rejects inspector mutations even from its registered top frame', async () => {
    const service = {
      disposeWindow: vi.fn(),
      subscribeOperations: () => () => undefined,
      subscribeInvalidations: () => () => undefined,
    } as unknown as RepositoryService;
    const ipc = registerAppIpc(service);
    const inspector = new TestWindow(8);
    ipc.attachWindow(inspector.asWindow(), inspector.webContents.getURL(), {
      parentId: 1,
      context: {} as never,
    });
    expect(
      await handlers.get(requests.openRepository.channel)?.(inspector.event(), { path: '/repo' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await handlers.get(requests.windowCommand.channel)?.(inspector.event(), { action: 'quit' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await handlers.get(requests.getRepositoryWorkingChanges.channel)?.(inspector.event(), {}),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await handlers.get(requests.getWindowState.channel)?.(inspector.event())).toMatchObject({
      ok: true,
    });
    ipc.dispose();
    expect(service.disposeWindow).toHaveBeenCalledWith(8);
  });

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

  it('publishes CLI activation only to an attached trusted application window', () => {
    const ipc = registerAppIpc();
    const first = new TestWindow(1);
    const second = new TestWindow(2);
    ipc.attachWindow(first.asWindow(), first.webContents.getURL());
    ipc.attachWindow(second.asWindow(), second.webContents.getURL());
    const repository = events.repositoryActivated.payload.parse({
      id: `repo-${'a'.repeat(64)}`,
      name: 'sample',
      path: '/sample',
      worktreePath: '/sample',
      gitDir: '/sample/.git',
      commonDir: '/sample/.git',
      bare: false,
      head: { state: 'unborn', name: 'main', commit: null },
      workingTree: { state: 'clean', changedFileCount: 0 },
    });
    ipc.publishRepositoryActivated(first.asWindow(), repository);
    expect(first.webContents.send).toHaveBeenCalledExactlyOnceWith(
      events.repositoryActivated.channel,
      repository,
    );
    expect(second.webContents.send).not.toHaveBeenCalled();
    first.webContents.mainFrame.url = 'https://untrusted.invalid';
    ipc.publishRepositoryActivated(first.asWindow(), repository);
    expect(first.webContents.send).toHaveBeenCalledTimes(1);
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
      subscribeInvalidations: () => () => undefined,
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
