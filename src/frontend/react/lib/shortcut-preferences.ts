export const customizableShortcuts = [
  ['Quick Launch', 'Mod+P'],
  ['Preferences', 'Mod+,'],
  ['New Tab', 'Mod+T'],
  ['Open Repository', 'Mod+O'],
  ['Clone Repository', 'Mod+N'],
  ['Close Tab', 'Mod+W'],
  ['Reopen Closed Tab', 'Mod+Shift+T'],
  ['New Branch', 'Mod+Shift+B'],
  ['New Tag', 'Mod+Shift+G'],
  ['Show HEAD', 'Mod+0'],
  ['Local Changes', 'Mod+1'],
  ['All Commits', 'Mod+2'],
  ['Show / Hide Details', 'Mod+Shift+D'],
  ['Fetch', 'Mod+Shift+F'],
  ['Refresh', 'F5'],
] as const;
export type ShortcutOverrides = Record<string, string>;
// Custom bindings use the otherwise unassigned Mod+Alt+letter namespace. Editing, pane navigation,
// native menu accelerators and operation-specific shortcuts keep their established bindings.
export function validShortcutOverrides(value: unknown): value is ShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= customizableShortcuts.length &&
    new Set(entries.map(([, binding]) => binding)).size === entries.length &&
    entries.every(
      ([key, binding]) =>
        customizableShortcuts.some(([, original]) => original === key) &&
        typeof binding === 'string' &&
        /^Mod\+Alt\+(Shift\+)?[A-Z]$/u.test(binding) &&
        !['Mod+Alt+T', 'Mod+Alt+O'].includes(binding),
    )
  );
}
export function resolveShortcut(shortcut: string): string {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('git-workbench.shortcuts') ?? 'null');
    const value =
      parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === 1 && 'value' in parsed
        ? parsed.value
        : parsed;
    return validShortcutOverrides(value) ? (value[shortcut] ?? shortcut) : shortcut;
  } catch {
    return shortcut;
  }
}
