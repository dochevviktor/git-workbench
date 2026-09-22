import { describe, expect, it, vi } from 'vitest';
import { filterLaunchItems, fuzzyScore, launchMenuItems } from '../../src/frontend/react/lib/quick-launch';

describe('F31 command lookup', () => {
  it('ranks contiguous matches before fuzzy subsequences and preserves ties', () => {
    const items = ['React base', 'Rebase…', 'read branch selection', 'Refresh'].map((label) => ({
      id: label,
      label,
      group: 'Commands',
    }));
    expect(filterLaunchItems(items, 'rebase').map((item) => item.label)).toEqual([
      'Rebase…',
      'React base',
      'read branch selection',
    ]);
    expect(filterLaunchItems(items, '')).toEqual(items);
    expect(filterLaunchItems(items, 'no match')).toEqual([]);
    expect(fuzzyScore('docs/Café 日本.md', 'CAFE\u0301 日')).toBeDefined();
    expect(fuzzyScore('--$(command) [draft].md', '$(command)')).toBeDefined();
  });

  it('uses menu availability and callbacks without exposing placeholders or overriding disabled parents', () => {
    const run = vi.fn();
    const items = launchMenuItems([
      { id: 'quick-launch', label: 'Quick Launch', run },
      { id: 'future', label: 'Future', disabled: true },
      {
        id: 'branch',
        label: 'Branch',
        disabled: true,
        disabledReason: 'No repository',
        submenu: [{ id: 'create', label: 'Create', shortcut: 'Mod+B', run }],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: '/branch/create',
      disabled: true,
      disabledReason: 'No repository',
      shortcut: 'Mod+B',
      run,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('searches repository paths and keeps duplicate names distinct', () => {
    const items = ['/one/repo', '/two/repo'].map((detail) => ({
      id: detail,
      label: 'repo',
      detail,
      group: 'Recent Repositories',
    }));
    expect(filterLaunchItems(items, '/two')).toEqual([items[1]]);
  });
});
