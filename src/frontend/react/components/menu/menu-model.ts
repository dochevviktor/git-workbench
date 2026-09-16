export interface MenuCommand {
  readonly type?: 'command';
  readonly id: string;
  readonly label: string;
  /** Written in the `Mod+Shift+T` form understood by `formatShortcut`. */
  readonly shortcut?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Shown as a tooltip so an unavailable command explains itself. */
  readonly disabledReason?: string | undefined;
  readonly checkable?: 'checkbox' | 'radio' | undefined;
  readonly checked?: boolean | undefined;
  readonly danger?: boolean | undefined;
  readonly submenu?: readonly MenuEntry[] | undefined;
  readonly run?: (() => void) | undefined;
}

export interface MenuSeparator {
  readonly type: 'separator';
}

export type MenuEntry = MenuCommand | MenuSeparator;

export const menuSeparator: MenuSeparator = { type: 'separator' };

export function isMenuSeparator(entry: MenuEntry): entry is MenuSeparator {
  return entry.type === 'separator';
}

/** Marks a command whose workflow is part of a later implementation phase. */
export function planned(workflow: string, phase: string): Pick<MenuCommand, 'disabled' | 'disabledReason'> {
  return { disabled: true, disabledReason: `${workflow} is not available yet (planned for ${phase}).` };
}

/** Removes leading, trailing, and repeated separators left behind by conditional entries. */
export function compactMenu(entries: readonly (MenuEntry | false | null | undefined)[]): MenuEntry[] {
  const result: MenuEntry[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (isMenuSeparator(entry) && (result.length === 0 || isMenuSeparator(result[result.length - 1]!))) {
      continue;
    }
    result.push(entry);
  }
  while (result.length > 0 && isMenuSeparator(result[result.length - 1]!)) result.pop();
  return result;
}

export type MenuAnchor =
  | { readonly type: 'point'; readonly x: number; readonly y: number }
  | { readonly type: 'below'; readonly rect: DOMRectReadOnly }
  | { readonly type: 'beside'; readonly rect: DOMRectReadOnly };

/** Uses the pointer position, or the element bounds when a keyboard opened the context menu. */
export function contextMenuAnchor(event: { clientX: number; clientY: number }, element: Element): MenuAnchor {
  if (event.clientX !== 0 || event.clientY !== 0)
    return { type: 'point', x: event.clientX, y: event.clientY };
  const rect = element.getBoundingClientRect();
  return { type: 'point', x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
}
