import * as fs from 'node:fs/promises';
import type * as nodeFs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readCredentialFile } from '../../src/backend/credentials/credential-file';
import { testPlatform } from '../platform';

// Exercise Windows' missing no-follow flag on every host, using real files and handles.
vi.mock('node:fs', async (original) => {
  const module = await original<typeof nodeFs>();
  return { ...module, constants: { ...module.constants, O_NOFOLLOW: 0, O_NONBLOCK: 0 } };
});
vi.mock('node:fs/promises', { spy: true });

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).open);
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'workbench-credential-file-'));
  roots.push(root);
  const path = join(root, 'token');
  await fs.writeFile(path, 'synthetic_fixture_token\n');
  return { root, path };
}

it('reads a bounded regular credential file and rejects empty, oversized and non-file entries', async () => {
  const { root, path } = await fixture();
  expect(await readCredentialFile(path)).toBe('synthetic_fixture_token');
  await expect(readCredentialFile(root)).rejects.toThrow();
  for (const value of ['', 'x'.repeat(4097)]) {
    await fs.writeFile(path, value);
    await expect(readCredentialFile(path)).rejects.toThrow();
  }
  await fs.writeFile(path, 'x'.repeat(4096));
  expect((await readCredentialFile(path)).length).toBe(4096);
});

it.skipIf(!testPlatform.symlinks)('rejects symlinked credentials without O_NOFOLLOW', async () => {
  const { root, path } = await fixture();
  const link = join(root, 'link');
  await fs.symlink(path, link, 'file');
  await expect(readCredentialFile(link)).rejects.toThrow();
});

it('rejects a replacement between selection and opening, closing the rejected handle', async () => {
  const { path } = await fixture();
  const { open } = await vi.importActual<typeof fs>('node:fs/promises');
  let handle: FileHandle | undefined;
  vi.mocked(fs.open).mockImplementationOnce(async (selected, flags, mode) => {
    await fs.rename(path, `${path}.original`);
    await fs.writeFile(path, 'unselected_fixture_token');
    handle = await open(selected, flags, mode);
    return handle;
  });
  await expect(readCredentialFile(path)).rejects.toThrow('changed');
  expect(handle).toBeDefined();
  await expect(handle!.stat()).rejects.toThrow();
});

it.skipIf(!testPlatform.symlinks)(
  'rejects a symlink substituted after opening even to the same inode',
  async () => {
    const { path } = await fixture();
    const { open } = await vi.importActual<typeof fs>('node:fs/promises');
    vi.mocked(fs.open).mockImplementationOnce(async (selected, flags, mode) => {
      const handle = await open(selected, flags, mode);
      await fs.rename(path, `${path}.original`);
      await fs.symlink(`${path}.original`, path, 'file');
      return handle;
    });
    await expect(readCredentialFile(path)).rejects.toThrow('changed');
  },
);
