/** Captured Windows view shortcuts; numbered tabs and zoom use non-conflicting product bindings. */
export const workspaceShortcuts = {
  head: 'Mod+0',
  changes: 'Mod+1',
  history: 'Mod+2',
  details: 'Mod+Shift+D',
  newTag: 'Mod+Shift+G',
  resetZoom: 'Mod+Alt+0',
  tab: (index: number) => `Mod+Alt+${index + 1}`,
} as const;
