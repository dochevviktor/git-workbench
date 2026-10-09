import { watch } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { testPlatform } from '../platform';
import { DirectoryWatcher } from '../../src/backend/repositories/directory-watcher';

// Keep real directory enumeration but deliver no native notifications. fs.watch does not
// guarantee that a change made immediately after registration produces an event on every OS.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFs>();
  const { EventEmitter } = await import('node:events');
  class SilentWatcher extends EventEmitter {
    close() {
      this.emit('close');
    }
    ref() {
      return this;
    }
    unref() {
      return this;
    }
  }
  return { ...fs, watch: vi.fn(() => new SilentWatcher()) };
});

it.each([2, 10])('reports initial coverage with limit %i without a native event', async (limit) => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-watcher-coverage-'));
  const source = join(root, 'source');
  let watcher: DirectoryWatcher | undefined;
  vi.useFakeTimers();
  try {
    await mkdir(join(source, 'deep'), { recursive: true });
    const events: string[] = [];
    watcher = new DirectoryWatcher([{ path: source, kind: 'worktree' }], (mode) => events.push(mode), limit);
    await watcher.ready;
    expect(vi.mocked(watch).mock.calls).toHaveLength(limit === 2 ? 2 : 3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(limit === 2 ? ['fallback'] : []);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(limit === 2 ? ['fallback'] : []);
  } finally {
    watcher?.dispose();
    await watcher?.settled();
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(!testPlatform.symlinks)(
  'excludes symlink targets when there is capacity to watch them',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-watcher-symlink-'));
    const source = join(root, 'source');
    const outside = join(root, 'outside');
    let watcher: DirectoryWatcher | undefined;
    try {
      await mkdir(join(source, 'deep'), { recursive: true });
      await mkdir(join(outside, 'nested'), { recursive: true });
      await symlink(outside, join(source, 'link'), 'dir');
      watcher = new DirectoryWatcher([{ path: source, kind: 'worktree' }], () => {}, 10);
      await watcher.ready;
      expect(
        vi
          .mocked(watch)
          .mock.calls.map(([path]) => String(path))
          .sort(),
      ).toEqual([root, source, join(source, 'deep')].sort());
    } finally {
      watcher?.dispose();
      await watcher?.settled();
      await rm(root, { recursive: true, force: true });
    }
  },
);
