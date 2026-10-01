import { createContext } from 'react';

export const WorkspaceScope = createContext('default');
export const layoutKeys = [
  'layout.sidebarWidth',
  'history.listHeight',
  'changes.filesWidth',
  'changes.unstagedHeight',
  'details.fileListWidth',
] as const;
export function scopedPreference(key: string, workspace: string) {
  return workspace !== 'default' && (layoutKeys as readonly string[]).includes(key)
    ? `workspace.${workspace}.${key}`
    : key;
}
export function saveWorkspaceLayout(id: string): void {
  const values: Record<string, unknown> = {};
  for (const key of layoutKeys) {
    const value = localStorage.getItem(`git-workbench.${scopedPreference(key, id)}`);
    if (value !== null) values[key] = JSON.parse(value);
  }
  localStorage.setItem(`git-workbench.workspace.${id}.savedLayout`, JSON.stringify({ version: 1, values }));
}
export function restoreWorkspaceLayout(id: string, reset = false): void {
  const raw = localStorage.getItem(`git-workbench.workspace.${id}.savedLayout`);
  if (!reset && !raw) throw new Error('Save a layout for this workspace first.');
  const saved: unknown = !reset && raw ? JSON.parse(raw) : null;
  if (
    !reset &&
    (typeof saved !== 'object' ||
      !saved ||
      !('version' in saved) ||
      saved.version !== 1 ||
      !('values' in saved) ||
      typeof saved.values !== 'object' ||
      !saved.values)
  )
    throw new Error('The saved layout is invalid. Save the current layout again.');
  const values =
    !reset && saved && typeof saved === 'object' && 'values' in saved
      ? (saved.values as Record<string, unknown>)
      : {};
  for (const key of layoutKeys) {
    const destination = `git-workbench.${scopedPreference(key, id)}`;
    if (key in values) localStorage.setItem(destination, JSON.stringify(values[key]));
    else localStorage.removeItem(destination);
  }
  window.dispatchEvent(new Event('workbench-preference-changed'));
}
