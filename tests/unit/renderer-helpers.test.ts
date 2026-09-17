import { describe, expect, it } from 'vitest';
import type { RepositoryHistoryDecoration, RepositoryHistoryReference } from '../../src/common/ipc/contracts';
import { compactMenu, menuSeparator, planned } from '../../src/frontend/react/components/menu/menu-model';
import { changeDetail, statusBadge } from '../../src/frontend/react/lib/change-status';
import { buildPathTree, flattenPathTree, splitPath } from '../../src/frontend/react/lib/file-tree';
import { ariaShortcut, formatShortcut, matchesShortcut } from '../../src/frontend/react/lib/platform';
import { referenceChips, referenceSections } from '../../src/frontend/react/lib/references';
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
