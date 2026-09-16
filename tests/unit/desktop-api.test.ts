import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopApi } from '../../src/backend/preload/create-desktop-api';
import type { IpcTransport } from '../../src/backend/preload/create-desktop-api';
import { events, requests } from '../../src/common/ipc/contracts';
import type { WindowCommand } from '../../src/common/ipc/contracts';

function fixture() {
  const emitter = new EventEmitter();
  const invoke = vi.fn<IpcTransport['invoke']>().mockResolvedValue({ ok: true, value: null });
  const api = createDesktopApi(
    {
      invoke,
      on: (channel, listener) => {
        emitter.on(channel, listener);
      },
      removeListener: (channel, listener) => {
        emitter.removeListener(channel, listener);
      },
    },
    100,
  );
  return { api, emitter, invoke };
}

afterEach(() => vi.useRealTimers());

describe('preload capability API', () => {
  it('uses a named channel and preserves a structured result', async () => {
    const { api, invoke } = fixture();
    await expect(api.window.command({ action: 'minimize' })).resolves.toEqual({ ok: true, value: null });
    expect(invoke).toHaveBeenCalledWith(requests.windowCommand.channel, { action: 'minimize' });
    expect(Object.keys(api)).toEqual(['app', 'window', 'repository']);
  });

  it('blocks malformed input before crossing IPC', async () => {
    const { api, invoke } = fixture();
    const result = await api.window.command({ action: 'execute-code' } as unknown as WindowCommand);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates repository paths before crossing IPC', async () => {
    const { api, invoke } = fixture();
    const result = await api.repository.open({ path: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates source-directory paths before crossing IPC', async () => {
    const { api, invoke } = fixture();
    const result = await api.repository.addSourceDirectory({ path: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects malformed responses and preserves known backend errors', async () => {
    const { api, invoke } = fixture();
    invoke.mockResolvedValueOnce({ maximized: true });
    expect(await api.window.getState()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const denied = { ok: false, error: { code: 'FORBIDDEN', message: 'Denied.' } };
    invoke.mockResolvedValueOnce(denied);
    expect(await api.window.getState()).toEqual(denied);
  });

  it('converts a disconnected transport to a recoverable error', async () => {
    const { api, invoke } = fixture();
    invoke.mockRejectedValueOnce(new Error('renderer destroyed'));
    expect(await api.app.getInfo()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });

  it('settles requests even when the backend never replies', async () => {
    vi.useFakeTimers();
    const { api, invoke } = fixture();
    invoke.mockImplementation(() => new Promise(() => undefined));
    const result = api.app.getInfo();
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });

  it('validates events, hides the Electron event, and unsubscribes exactly once', () => {
    const { api, emitter } = fixture();
    const listener = vi.fn();
    const channel = events.windowStateChanged.channel;
    const unsubscribe = api.window.onStateChanged(listener);
    emitter.emit(channel, { privileged: true }, { maximized: 'invalid', focused: true });
    expect(listener).not.toHaveBeenCalled();
    emitter.emit(channel, { privileged: true }, { maximized: true, focused: false });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ maximized: true, focused: false });
    unsubscribe();
    unsubscribe();
    expect(emitter.listenerCount(channel)).toBe(0);
    emitter.emit(channel, {}, { maximized: false, focused: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports independent subscribers and repeated mount/unmount cycles', () => {
    const { api, emitter } = fixture();
    const channel = events.windowStateChanged.channel;
    const persistent = vi.fn();
    const stopPersistent = api.window.onStateChanged(persistent);
    for (let index = 0; index < 20; index += 1) api.window.onStateChanged(vi.fn())();
    expect(emitter.listenerCount(channel)).toBe(1);
    emitter.emit(channel, {}, { maximized: false, focused: true });
    expect(persistent).toHaveBeenCalledOnce();
    stopPersistent();
    expect(emitter.listenerCount(channel)).toBe(0);
  });
});
