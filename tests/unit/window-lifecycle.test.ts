import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  forwardedRepositoryPaths,
  repositoryPathsFromArguments,
} from '../../src/backend/electron/launch-paths';
import { restoreWindowBounds, WindowStateStore } from '../../src/backend/electron/window-state-store';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('repository launch arguments', () => {
  it('validates forwarded launch paths independently of Chromium-reordered arguments', () => {
    expect(forwardedRepositoryPaths({ version: 1, repositoryPaths: ['/one', '/one', '/two'] })).toEqual([
      '/one',
      '/two',
    ]);
    expect(forwardedRepositoryPaths({ version: 1, repositoryPaths: ['relative'] })).toBeUndefined();
    expect(
      forwardedRepositoryPaths({ version: 1, repositoryPaths: ['/one'], command: 'anything' }),
    ).toBeUndefined();
  });
  it('resolves caller-relative repository paths, skips Electron flags and requires -- for dash names', () => {
    expect(
      repositoryPathsFromArguments(
        [
          '/electron',
          '.',
          '--user-data-dir=/profile',
          '--ozone-platform',
          'headless',
          'repo one',
          '--',
          '-repo',
        ],
        '/work',
        true,
      ),
    ).toEqual(['/work/repo one', '/work/-repo']);
    expect(
      repositoryPathsFromArguments(['/app', '--disable-gpu', '/one', '/one', '--', '-two'], '/work', false),
    ).toEqual(['/one', '/work/-two']);
  });
  it('rejects URLs, NULs and ambiguous switch values and bounds a launch to twenty paths', () => {
    expect(
      repositoryPathsFromArguments(
        ['/app', '--unknown', '/switch-value', 'https://host/repo', 'bad\0path', '--', 'good'],
        '/work',
        false,
      ),
    ).toEqual(['/work/good']);
    expect(
      repositoryPathsFromArguments(
        ['/app', ...Array.from({ length: 30 }, (_, index) => `/repo-${index}`)],
        '/work',
        false,
      ),
    ).toHaveLength(20);
  });
});

describe('P2-015 window restoration', () => {
  const main = { x: 0, y: 0, width: 1920, height: 1040 };
  const left = { x: -1600, y: 0, width: 1600, height: 900 };
  it('restores normal bounds and maximized state on the matching monitor', () => {
    const saved = { bounds: { x: -1500, y: 50, width: 1200, height: 750 }, maximized: true };
    expect(restoreWindowBounds(saved, [main, left])).toEqual(saved);
  });
  it('returns off-screen bounds to the primary monitor and clamps oversize windows', () => {
    expect(restoreWindowBounds(undefined, [{ x: 0, y: 0, width: 1, height: 1 }])).toEqual({
      bounds: { x: 0, y: 0, width: 1280, height: 820 },
      maximized: false,
    });
    expect(
      restoreWindowBounds({ bounds: { x: -8000, y: -9000, width: 4000, height: 3000 }, maximized: false }, [
        main,
      ]),
    ).toEqual({ bounds: main, maximized: false });
    const tiny = { x: 0, y: 0, width: 800, height: 550 };
    expect(restoreWindowBounds(undefined, [tiny])).toEqual({ bounds: tiny, maximized: false });
  });
  it('persists a versioned atomic record and quarantines invalid state without losing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-workbench-window-state-'));
    directories.push(root);
    const path = join(root, 'window-state.json');
    const state = { bounds: { x: 40, y: 50, width: 1100, height: 700 }, maximized: true };
    new WindowStateStore(path).write(state);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, ...state });
    expect(new WindowStateStore(path).read()).toEqual(state);
    await writeFile(path, '{broken');
    expect(new WindowStateStore(path).read()).toBeUndefined();
    const quarantined = (await readdir(root)).find((name) => name.startsWith('window-state.json.invalid-'));
    expect(await readFile(join(root, quarantined!), 'utf8')).toBe('{broken');
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
