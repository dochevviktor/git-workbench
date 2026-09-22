import type { MenuEntry } from '../components/menu/menu-model';

export interface LaunchItem {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly detail?: string | undefined;
  readonly shortcut?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly run?: (() => void) | undefined;
  readonly choices?: ((signal: AbortSignal) => Promise<LaunchChoices>) | undefined;
}

export interface LaunchChoices {
  readonly items: readonly LaunchItem[];
  readonly notice?: string;
}

/** Independent ranking: contiguous matches first, then compact ordered subsequences. */
export function fuzzyScore(label: string, query: string): number | undefined {
  const text = label.normalize('NFC').toLocaleLowerCase();
  const needle = query.trim().normalize('NFC').toLocaleLowerCase();
  if (!needle) return 0;
  const exact = text.indexOf(needle);
  if (exact >= 0) return exact;
  let position = 0;
  let score = 1000;
  for (const character of needle) {
    const next = text.indexOf(character, position);
    if (next < 0) return undefined;
    score += next - position;
    position = next + character.length;
  }
  return score;
}

export function filterLaunchItems(items: readonly LaunchItem[], query: string): LaunchItem[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(`${item.label} ${item.detail ?? ''}`, query) }))
    .filter((entry): entry is { item: LaunchItem; score: number } => entry.score !== undefined)
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);
}

/** Reuse actual menu callbacks and availability, including disabled ancestors. */
export function launchMenuItems(entries: readonly MenuEntry[], prefix = ''): LaunchItem[] {
  return entries.flatMap<LaunchItem>((entry) => {
    if (entry.type === 'separator' || entry.id === 'quick-launch' || entry.id === 'open-recent') return [];
    const id = `${prefix}/${entry.id}`;
    if (entry.submenu) {
      return launchMenuItems(entry.submenu, id).map((child) => ({
        ...child,
        detail: `${entry.label}${child.detail ? ` · ${child.detail}` : ''}`,
        disabled: entry.disabled || child.disabled,
        disabledReason: entry.disabled ? entry.disabledReason : child.disabledReason,
      }));
    }
    if (!entry.run) return [];
    return [{ ...entry, id, group: 'Commands' }];
  });
}
