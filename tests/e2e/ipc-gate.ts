import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

interface GateState {
  pause: () => void;
  release: () => void;
  entered: number;
  dispose: () => void;
}
interface GateGlobals {
  testIpcGates?: Map<string, GateState>;
}

/** Delay only selected IPC calls. Original handlers still validate and execute real backend work. */
export async function installIpcGate(
  app: ElectronApplication,
  rules: readonly { channel: string; phase: 'before' | 'after' }[],
) {
  const id = randomUUID();
  await app.evaluate(
    ({ ipcMain }, { id, rules }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
        }
      )._invokeHandlers;
      const globals = globalThis as GateGlobals;
      const gates = (globals.testIpcGates ??= new Map());
      let pending: { promise: Promise<void>; release: () => void } | undefined;
      const restore: Array<() => void> = [];
      const state: GateState = {
        entered: 0,
        pause() {
          if (pending) throw new Error('IPC gate is already paused.');
          state.entered = 0;
          let release = () => {};
          const promise = new Promise<void>((resolve) => {
            release = resolve;
          });
          pending = { promise, release };
        },
        release() {
          pending?.release();
          pending = undefined;
        },
        dispose() {
          state.release();
          for (const reset of restore) reset();
          gates.delete(id);
        },
      };
      const wait = async () => {
        if (!pending) return;
        state.entered++;
        await pending.promise;
      };
      for (const { channel, phase } of rules) {
        const original = handlers.get(channel);
        if (!original) throw new Error(`Missing ${channel} handler.`);
        const wrapped = async (...args: unknown[]) => {
          if (phase === 'before') await wait();
          const result = await original(...args);
          if (phase === 'after') await wait();
          return result;
        };
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, wrapped);
        restore.push(() => {
          if (handlers.get(channel) !== wrapped) return;
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, original);
        });
      }
      gates.set(id, state);
    },
    { id, rules: [...rules] },
  );
  return {
    pause: () => app.evaluate((_, id) => (globalThis as GateGlobals).testIpcGates!.get(id)!.pause(), id),
    release: () => app.evaluate((_, id) => (globalThis as GateGlobals).testIpcGates!.get(id)?.release(), id),
    wait: () =>
      expect
        .poll(() =>
          app.evaluate((_, id) => (globalThis as GateGlobals).testIpcGates!.get(id)?.entered ?? 0, id),
        )
        .toBeGreaterThan(0),
    dispose: () => app.evaluate((_, id) => (globalThis as GateGlobals).testIpcGates!.get(id)?.dispose(), id),
  };
}
