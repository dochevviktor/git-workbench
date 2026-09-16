import { createContext, useContext } from 'react';
import type { MenuAnchor, MenuEntry } from './menu-model';

export interface ContextMenuRequest {
  readonly anchor: MenuAnchor;
  readonly items: readonly MenuEntry[];
  readonly label: string;
  /** Keyboard-opened menus highlight their first command. */
  readonly keyboard?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
}

export const ContextMenuContext = createContext<(request: ContextMenuRequest) => void>(() => undefined);

export function useContextMenu(): (request: ContextMenuRequest) => void {
  return useContext(ContextMenuContext);
}
