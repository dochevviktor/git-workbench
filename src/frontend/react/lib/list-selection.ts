/** Which rows a list has selected, which one the detail pane follows, and where a range starts. */
export interface ListSelection {
  /** Selected keys in list order. */
  readonly keys: readonly string[];
  /** The row whose detail is shown; the last row the user touched. */
  readonly activeKey: string | undefined;
  /** Where a Shift range measures from. */
  readonly anchorKey: string | undefined;
}

export interface SelectionModifiers {
  /** Ctrl or Cmd: add or remove one row without disturbing the rest. */
  readonly toggle: boolean;
  /** Shift: select everything between the anchor and this row. */
  readonly range: boolean;
}

export const emptySelection: ListSelection = { keys: [], activeKey: undefined, anchorKey: undefined };

export function isSelected(selection: ListSelection, key: string): boolean {
  return selection.keys.includes(key);
}

function inOrder(order: readonly string[], keys: Iterable<string>): string[] {
  const wanted = new Set(keys);
  return order.filter((key) => wanted.has(key));
}

/**
 * Applies one click to a list selection. A plain click replaces the selection, Ctrl/Cmd toggles one
 * row, and Shift selects the rows between the anchor and the clicked row.
 */
export function selectKey(
  order: readonly string[],
  selection: ListSelection,
  key: string,
  modifiers: SelectionModifiers = { toggle: false, range: false },
): ListSelection {
  if (!order.includes(key)) return selection;

  if (modifiers.range && selection.anchorKey && order.includes(selection.anchorKey)) {
    const from = order.indexOf(selection.anchorKey);
    const to = order.indexOf(key);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    // Ctrl+Shift extends the existing selection; Shift alone replaces it.
    const keys = modifiers.toggle ? inOrder(order, [...selection.keys, ...range]) : range;
    return { keys, activeKey: key, anchorKey: selection.anchorKey };
  }

  if (modifiers.toggle) {
    const keys = isSelected(selection, key)
      ? selection.keys.filter((candidate) => candidate !== key)
      : inOrder(order, [...selection.keys, key]);
    return { keys, activeKey: key, anchorKey: key };
  }

  return { keys: [key], activeKey: key, anchorKey: key };
}

/** Moves the active row by keyboard, optionally growing the selection from the anchor. */
export function moveSelection(
  order: readonly string[],
  selection: ListSelection,
  target: string,
  extend: boolean,
): ListSelection {
  return selectKey(order, selection, target, { toggle: false, range: extend });
}

/** Drops keys the list no longer contains, for example after staging moves files to the other pane. */
export function pruneSelection(order: readonly string[], selection: ListSelection): ListSelection {
  const keys = inOrder(order, selection.keys);
  if (
    keys.length === selection.keys.length &&
    (!selection.activeKey || order.includes(selection.activeKey)) &&
    (!selection.anchorKey || order.includes(selection.anchorKey))
  ) {
    return selection;
  }
  const activeKey =
    selection.activeKey && order.includes(selection.activeKey) ? selection.activeKey : keys[0];
  return {
    keys,
    activeKey,
    anchorKey: selection.anchorKey && order.includes(selection.anchorKey) ? selection.anchorKey : activeKey,
  };
}

/** Selects the rows a completed action moved elsewhere, so the user keeps their place. */
export function selectKeys(order: readonly string[], keys: readonly string[]): ListSelection {
  const selected = inOrder(order, keys);
  const activeKey = selected[selected.length - 1];
  return { keys: selected, activeKey, anchorKey: activeKey };
}
