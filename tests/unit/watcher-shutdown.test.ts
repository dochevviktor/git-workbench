import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import type { Dir } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const gate = vi.hoisted(() => ({
  path: '',
  handle: undefined as Dir | undefined,
  entered: false,
  pending: Promise.resolve(),
  release: () => {},
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>();
  return {
    ...fs,
    opendir: async (...args: Parameters<typeof fs.opendir>) => {
      const directory = await fs.opendir(...args);
      if (String(args[0]) === gate.path) {
        gate.handle = directory;
        gate.entered = true;
        await gate.pending;
      }
      return directory;
    },
  };
});

it.each(['service', 'window', 'tab'] as const)(
  'waits for open watcher directories after %s shutdown',
  async (route) => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-watcher-shutdown-'));
    const repository = join(root, 'repository');
    const service = new RepositoryService({ storagePath: join(root, 'recent.json') });
    Object.assign(gate, { entered: false, handle: undefined });
    gate.path = join(repository, '.git');
    gate.pending = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    try {
      await mkdir(repository);
      const summary = await service.initialize(1, repository, false);
      await expect.poll(() => gate.entered).toBe(true);
      if (route === 'service') service.dispose();
      else if (route === 'window') service.disposeWindow(1);
      else await service.close(1, summary.id);
      let settled = false;
      const stopped = service.settled().then(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      gate.release();
      await stopped;
      await expect(gate.handle!.read()).rejects.toMatchObject({ code: 'ERR_DIR_CLOSED' });
      await rename(repository, join(root, 'moved'));
    } finally {
      gate.release();
      service.dispose();
      await service.settled();
      await gate.handle?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  },
);
