import { describe, expect, it } from 'vitest';
import type { RepositoryHistoryDecoration, RepositoryHistoryReference } from '../../src/common/ipc/contracts';
import { compactMenu, menuSeparator, planned } from '../../src/frontend/react/components/menu/menu-model';
import { changeDetail, statusBadge } from '../../src/frontend/react/lib/change-status';
import { buildPathTree, flattenPathTree, splitPath } from '../../src/frontend/react/lib/file-tree';
import {
  emptySelection,
  pruneSelection,
  selectKey,
  selectKeys,
} from '../../src/frontend/react/lib/list-selection';
import { ariaShortcut, formatShortcut, matchesShortcut } from '../../src/frontend/react/lib/platform';
import {
  localBranchNameFor,
  referenceChips,
  referenceNameProblem,
  referenceSections,
} from '../../src/frontend/react/lib/references';
import type { ReferenceTreeNode } from '../../src/frontend/react/lib/references';

const target = 'a'.repeat(40);

function reference(
  fullName: string,
  kind: RepositoryHistoryReference['kind'],
  extra: Partial<RepositoryHistoryReference> = {},
): RepositoryHistoryReference {
  const prefixes = ['refs/heads/', 'refs/remotes/', 'refs/tags/'];
  const prefix = prefixes.find((candidate) => fullName.startsWith(candidate));
  return {
    // Mirrors the backend's display names, including the special stash reference.
    name: fullName === 'refs/stash' ? 'stash' : prefix ? fullName.slice(prefix.length) : fullName,
    fullName,
    kind,
    target,
    isHead: false,
    upstream: null,
    upstreamGone: false,
    ahead: null,
    behind: null,
    ...extra,
  };
}

function decoration(value: RepositoryHistoryReference): RepositoryHistoryDecoration {
  return {
    name: value.name,
    fullName: value.fullName,
    kind: value.kind,
    target: value.target,
    isHead: value.isHead,
  };
}

function names(nodes: readonly ReferenceTreeNode[]): unknown[] {
  return nodes.map((node) => (node.type === 'folder' ? { [node.name]: names(node.children) } : node.name));
}

function keyEvent(
  key: string,
  modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>>,
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe('commit reference labels', () => {
  it('merges a branch with its upstream when both point at the commit', () => {
    const main = reference('refs/heads/main', 'branch', { isHead: true, upstream: 'origin/main' });
    const originMain = reference('refs/remotes/origin/main', 'remote');
    const originHead = reference('refs/remotes/origin/HEAD', 'remote');
    const feature = reference('refs/heads/feature', 'branch');
    const originFeature = reference('refs/remotes/origin/feature', 'remote');
    const tag = reference('refs/tags/v1.0.0', 'tag');
    const byName = new Map(
      [main, originMain, originHead, feature, originFeature, tag].map((item) => [item.fullName, item]),
    );

    const chips = referenceChips(
      [tag, originFeature, originHead, feature, originMain, main].map(decoration),
      byName,
    );

    expect(chips.map((chip) => [chip.label, chip.kind, chip.current, chip.tracksRemote])).toEqual([
      ['main', 'branch', true, true],
      ['feature', 'branch', false, false],
      ['origin/feature', 'remote', false, false],
      ['v1.0.0', 'tag', false, false],
    ]);
  });

  it('keeps a remote label separate when the local branch has moved on', () => {
    const main = reference('refs/heads/main', 'branch', { isHead: true, upstream: 'origin/main' });
    const originMain = reference('refs/remotes/origin/main', 'remote');
    const chips = referenceChips([decoration(originMain)], new Map([[main.fullName, main]]));
    expect(chips).toMatchObject([{ label: 'origin/main', kind: 'remote', tracksRemote: false }]);
  });
});

describe('sidebar reference tree', () => {
  const references = [
    reference('refs/heads/main', 'branch', { isHead: true }),
    reference('refs/heads/feature/login', 'branch'),
    reference('refs/heads/feature/api/v2', 'branch'),
    reference('refs/remotes/origin/HEAD', 'remote'),
    reference('refs/remotes/origin/main', 'remote'),
    reference('refs/remotes/origin/feature/login', 'remote'),
    reference('refs/remotes/upstream/main', 'remote'),
    reference('refs/tags/v1.0.0', 'tag'),
    reference('refs/stash', 'stash'),
    reference('refs/notes/commits', 'other'),
  ];

  it('groups references into sections and slash-separated folders', () => {
    const sections = referenceSections(references, '');

    expect(names(sections.branches)).toEqual([{ feature: [{ api: ['v2'] }, 'login'] }, 'main']);
    expect(names(sections.remotes)).toEqual([
      { origin: [{ feature: ['login'] }, 'main'] },
      { upstream: ['main'] },
    ]);
    expect(names(sections.tags)).toEqual(['v1.0.0']);
    expect(names(sections.stashes)).toEqual(['stash']);
    expect(sections.counts).toEqual({ branches: 3, remotes: 3, tags: 1, stashes: 1 });
  });

  it('filters by name without regard to case', () => {
    const sections = referenceSections(references, '  LOGIN ');

    expect(names(sections.branches)).toEqual([{ feature: ['login'] }]);
    expect(names(sections.remotes)).toEqual([{ origin: [{ feature: ['login'] }] }]);
    expect(sections.counts).toEqual({ branches: 1, remotes: 1, tags: 0, stashes: 0 });
  });
});

describe('keyboard shortcuts', () => {
  it('formats shortcuts for each platform', () => {
    expect(formatShortcut('Mod+Shift+T', 'linux')).toBe('Ctrl+Shift+T');
    expect(formatShortcut('Mod+Shift+I', 'win32')).toBe('Ctrl+Shift+I');
    expect(formatShortcut('Mod+Shift+T', 'darwin')).toBe('⇧⌘T');
    expect(formatShortcut('Ctrl+Shift+Tab', 'darwin')).toBe('⌃⇧Tab');
    expect(formatShortcut('Mod+Plus', 'linux')).toBe('Ctrl++');
    expect(formatShortcut('ArrowLeft', 'linux')).toBe('←');
    expect(formatShortcut('ArrowRight', 'darwin')).toBe('→');
    expect(ariaShortcut('Mod+Shift+T', 'linux')).toBe('Control+Shift+T');
    expect(ariaShortcut('Mod+W', 'darwin')).toBe('Meta+W');
  });

  it('matches modifiers exactly', () => {
    expect(matchesShortcut(keyEvent('t', { ctrlKey: true }), 'Mod+T', 'linux')).toBe(true);
    expect(matchesShortcut(keyEvent('T', { ctrlKey: true, shiftKey: true }), 'Mod+T', 'linux')).toBe(false);
    expect(matchesShortcut(keyEvent('T', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+T', 'linux')).toBe(
      true,
    );
    expect(matchesShortcut(keyEvent('t', { metaKey: true }), 'Mod+T', 'linux')).toBe(false);
    expect(matchesShortcut(keyEvent('t', { metaKey: true }), 'Mod+T', 'darwin')).toBe(true);
    expect(matchesShortcut(keyEvent('Tab', { ctrlKey: true }), 'Ctrl+Tab', 'darwin')).toBe(true);
    expect(matchesShortcut(keyEvent('F5', {}), 'F5', 'linux')).toBe(true);
    expect(matchesShortcut(keyEvent('F5', { altKey: true }), 'F5', 'linux')).toBe(false);
  });

  it('leaves IME confirmation and AltGr text entry to the input method', () => {
    const event = keyEvent('k', { ctrlKey: true, altKey: true });
    expect(matchesShortcut({ ...event, isComposing: true }, 'Mod+Alt+K', 'linux')).toBe(false);
    expect(matchesShortcut({ ...event, keyCode: 229 }, 'Mod+Alt+K', 'linux')).toBe(false);
    expect(
      matchesShortcut({ ...event, getModifierState: (key) => key === 'AltGraph' }, 'Mod+Alt+K', 'linux'),
    ).toBe(false);
    expect(matchesShortcut(event, 'Mod+Alt+K', 'linux')).toBe(true);
  });

  it('recognizes macOS Command+Option keys when Option produces a symbol or dead key', () => {
    const event = { ...keyEvent('˚', { metaKey: true, altKey: true }), code: 'KeyK' };
    expect(matchesShortcut(event, 'Mod+Alt+K', 'darwin')).toBe(true);
    expect(matchesShortcut({ ...event, key: 'Dead' }, 'Mod+Alt+K', 'darwin')).toBe(true);
    expect(matchesShortcut({ ...event, key: 'º', code: 'Digit0' }, 'Mod+Alt+0', 'darwin')).toBe(true);
    expect(matchesShortcut({ ...event, key: 'a', code: 'KeyQ' }, 'Mod+Alt+A', 'darwin')).toBe(true);
    expect(matchesShortcut({ ...event, isComposing: true }, 'Mod+Alt+K', 'darwin')).toBe(false);
    expect(matchesShortcut({ ...event, getModifierState: () => true }, 'Mod+Alt+K', 'darwin')).toBe(false);
    expect(matchesShortcut({ ...event, metaKey: false, ctrlKey: true }, 'Mod+Alt+K', 'win32')).toBe(false);
  });

  it('ignores the Shift state that punctuation keys need', () => {
    expect(matchesShortcut(keyEvent('+', { ctrlKey: true, shiftKey: true }), 'Mod+Plus', 'linux')).toBe(true);
    expect(matchesShortcut(keyEvent('=', { ctrlKey: true }), 'Mod+=', 'linux')).toBe(true);
    expect(matchesShortcut(keyEvent('-', { ctrlKey: true }), 'Mod+-', 'linux')).toBe(true);
  });
});

describe('menu model', () => {
  it('drops empty entries and redundant separators', () => {
    const open = { id: 'open', label: 'Open' };
    const close = { id: 'close', label: 'Close' };
    expect(
      compactMenu([
        menuSeparator,
        false,
        open,
        menuSeparator,
        undefined,
        menuSeparator,
        close,
        menuSeparator,
        null,
      ]),
    ).toEqual([open, menuSeparator, close]);
  });

  it('explains unavailable commands', () => {
    expect(planned('Fetching', 'P05')).toEqual({
      disabled: true,
      disabledReason: 'Fetching is not available yet (planned for P05).',
    });
  });
});

describe('changed file trees', () => {
  const paths = ['src/ui/theme.ts', 'README.md', 'src/app.ts', 'build/', 'src/ui/a b\nc.ts', 'docs/guide.md'];
  const tree = buildPathTree(
    paths,
    (path) => path,
    (path) => `file:${encodeURIComponent(path)}`,
  );

  it('lists folders before files and nests slash-separated paths', () => {
    const rows = flattenPathTree(tree, new Set());
    expect(rows.map((row) => `${'  '.repeat(row.level - 1)}${row.node.name}`)).toEqual([
      'docs',
      '  guide.md',
      'src',
      '  ui',
      '    a b\nc.ts',
      '    theme.ts',
      '  app.ts',
      'build/',
      'README.md',
    ]);
    expect(rows.find((row) => row.node.name === 'theme.ts')?.parentKey).toBe('folder:src%2Fui');
  });

  it('hides the contents of collapsed folders and keeps keys safe for element IDs', () => {
    const rows = flattenPathTree(tree, new Set(['folder:src']));
    expect(rows.map((row) => row.node.name)).toEqual(['docs', 'guide.md', 'src', 'build/', 'README.md']);
    expect(rows.find((row) => row.node.name === 'src')?.expanded).toBe(false);
    expect(
      buildPathTree(
        ['a b/c'],
        (path) => path,
        (path) => path,
      )[0]?.key,
    ).toBe('folder:a%20b');
  });

  it('splits names from their folders, keeping a directory marker', () => {
    expect(splitPath('src/ui/theme.ts')).toEqual({ name: 'theme.ts', location: 'src/ui' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', location: '' });
    expect(splitPath('cache/build/')).toEqual({ name: 'build/', location: 'cache' });
  });

  it('labels every status so the badge color is never the only cue', () => {
    expect(statusBadge('modified')).toEqual({ symbol: 'M', tone: 'modified', label: 'Modified' });
    expect(statusBadge('untracked')).toMatchObject({ symbol: '+', tone: 'added', label: 'Untracked' });
    expect(statusBadge('unmerged')).toMatchObject({ tone: 'conflict', label: 'Conflict' });
    for (const status of [
      'added',
      'copied',
      'deleted',
      'renamed',
      'type-changed',
      'ignored',
      'unknown',
    ] as const) {
      expect(statusBadge(status).label.length).toBeGreaterThan(0);
    }
  });
});

describe('file header detail', () => {
  const unchanged = { previousPath: null, similarity: null, oldMode: '100644', newMode: '100644' };

  it('stays empty when nothing unusual happened', () => {
    expect(changeDetail(unchanged)).toBeUndefined();
  });

  it('names the rename source with its similarity and a mode change', () => {
    expect(
      changeDetail({ previousPath: 'old/name.ts', similarity: 92, oldMode: '100644', newMode: '100755' }),
    ).toBe('from old/name.ts (92% similar) · mode 100644 → 100755');
  });

  it('omits an unknown similarity and an unknown mode', () => {
    expect(changeDetail({ previousPath: 'old.ts', similarity: null, oldMode: null, newMode: '100644' })).toBe(
      'from old.ts',
    );
  });
});

describe('list selection', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('replaces the selection on a plain click', () => {
    const first = selectKey(order, emptySelection, 'b');
    expect(first).toEqual({ keys: ['b'], activeKey: 'b', anchorKey: 'b' });
    expect(selectKey(order, first, 'd')).toEqual({ keys: ['d'], activeKey: 'd', anchorKey: 'd' });
  });

  it('adds and removes single rows with the toggle modifier', () => {
    const toggle = { toggle: true, range: false };
    const two = selectKey(order, selectKey(order, emptySelection, 'a'), 'c', toggle);
    expect(two.keys).toEqual(['a', 'c']);
    expect(selectKey(order, two, 'a', toggle).keys).toEqual(['c']);
  });

  it('selects a range from the anchor in list order, in either direction', () => {
    const anchored = selectKey(order, emptySelection, 'c');
    const upwards = selectKey(order, anchored, 'a', { toggle: false, range: true });
    expect(upwards.keys).toEqual(['a', 'b', 'c']);
    expect(upwards.anchorKey).toBe('c');
    expect(selectKey(order, anchored, 'd', { toggle: false, range: true }).keys).toEqual(['c', 'd']);
  });

  it('keeps the earlier selection when a range extends it', () => {
    const first = selectKey(order, emptySelection, 'a');
    const anchored = selectKey(order, first, 'c', { toggle: true, range: false });
    expect(selectKey(order, anchored, 'd', { toggle: true, range: true }).keys).toEqual(['a', 'c', 'd']);
  });

  it('drops keys the list no longer has and keeps the rest', () => {
    const selection = selectKey(order, selectKey(order, emptySelection, 'a'), 'c', {
      toggle: true,
      range: false,
    });
    const pruned = pruneSelection(['a', 'd'], selection);
    expect(pruned.keys).toEqual(['a']);
    expect(pruned.activeKey).toBe('a');
  });

  it('ignores a key the list does not contain', () => {
    expect(selectKey(order, emptySelection, 'missing')).toBe(emptySelection);
  });

  it('follows files that moved to another list', () => {
    const moved = selectKeys(['staged:one', 'staged:two'], ['staged:two', 'staged:missing']);
    expect(moved).toEqual({
      keys: ['staged:two'],
      activeKey: 'staged:two',
      anchorKey: 'staged:two',
    });
  });
});

describe('reference name validation', () => {
  it('accepts the names Git accepts', () => {
    for (const name of ['topic', 'feature/login', 'release/v1.0-rc1', 'user.name/fix']) {
      expect(referenceNameProblem(name, 'branch')).toBeNull();
    }
  });

  it('explains the names Git rejects', () => {
    const rejected = [
      '-force',
      'with space',
      'two..dots',
      'caret^',
      'tilde~1',
      'colon:name',
      'question?',
      'star*',
      'bracket[',
      'back\\slash',
      'at@{one}',
      '@',
      '/leading',
      'trailing/',
      'double//slash',
      'ends.',
      '.hidden/name',
      'name.lock',
    ];
    for (const name of rejected) {
      expect(referenceNameProblem(name, 'branch'), name).not.toBeNull();
    }
    expect(referenceNameProblem('', 'branch')).toBeNull();
    expect(referenceNameProblem('with space', 'tag')).toContain('A tag name');
  });

  it('suggests the local name for a remote-tracking branch', () => {
    expect(localBranchNameFor('origin/topic', ['origin'])).toBe('topic');
    expect(localBranchNameFor('origin/feature/login', ['origin'])).toBe('feature/login');
    // A remote whose name contains a slash is matched before the first separator is used.
    expect(localBranchNameFor('my/remote/topic', ['my/remote'])).toBe('topic');
    expect(localBranchNameFor('unknown/topic', [])).toBe('topic');
  });
});
