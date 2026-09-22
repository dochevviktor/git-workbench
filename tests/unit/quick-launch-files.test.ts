import { expect, it, vi } from 'vitest';
import type { RepositoryRevisionTree, RepositoryRevisionTreeEntry } from '../../src/common/ipc/contracts';
import { collectLaunchFiles } from '../../src/frontend/react/lib/quick-launch-files';

const entry = (path: string, type: 'blob' | 'tree' | 'commit' = 'blob'): RepositoryRevisionTreeEntry => ({
  path,
  name: path,
  type,
  mode: '100644',
  objectId: 'a'.repeat(40),
  size: null,
});
const tree = (entries: RepositoryRevisionTreeEntry[], truncated = false): RepositoryRevisionTree => ({
  repositoryId: 'repo',
  commitId: 'a'.repeat(40),
  path: '',
  entries,
  truncated,
});

it('F31 traverses committed directories and excludes submodule contents', async () => {
  const read = vi.fn(async (path: string) =>
    path
      ? tree([entry('docs/Café 日本.md')])
      : tree([entry('docs', 'tree'), entry('child', 'commit'), entry('--$(x).txt')]),
  );
  expect(await collectLaunchFiles(read, new AbortController().signal)).toEqual({
    paths: ['--$(x).txt', 'docs/Café 日本.md'],
    truncated: false,
  });
  expect(read.mock.calls).toEqual([[''], ['docs']]);
});

it('F31 stops scheduling and discards results after dismissal during a tree read', async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => {
    controller.abort();
    return tree([entry('docs', 'tree'), entry('late')]);
  });
  expect(await collectLaunchFiles(read, controller.signal)).toEqual({ paths: [], truncated: false });
  expect(read).toHaveBeenCalledTimes(1);
});

it('F31 surfaces read failures and backend truncation', async () => {
  await expect(
    collectLaunchFiles(async () => {
      throw new Error('Read failed');
    }, new AbortController().signal),
  ).rejects.toThrow('Read failed');
  expect(
    await collectLaunchFiles(async () => tree([entry('visible')], true), new AbortController().signal),
  ).toEqual({ paths: ['visible'], truncated: true });
});

it('F31 bounds directory and file enumeration with an explicit partial result', async () => {
  const dirs = vi.fn(async () => tree([entry('next', 'tree')]));
  expect((await collectLaunchFiles(dirs, new AbortController().signal)).truncated).toBe(true);
  expect(dirs).toHaveBeenCalledTimes(200);
  const files = vi.fn(async () =>
    tree([...Array.from({ length: 3000 }, (_, i) => entry(`file${i}`)), entry('next', 'tree')]),
  );
  const result = await collectLaunchFiles(files, new AbortController().signal);
  expect(result.paths).toHaveLength(5000);
  expect(result.truncated).toBe(true);
  expect(files).toHaveBeenCalledTimes(2);
});

it('F31 stops launching reads after the time budget', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_001);
  try {
    const read = vi.fn(async () => tree([]));
    expect(await collectLaunchFiles(read, new AbortController().signal)).toEqual({
      paths: [],
      truncated: true,
    });
    expect(read).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
