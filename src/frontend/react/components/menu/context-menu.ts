import { createContext, useContext } from 'react';
import type { Platform } from '../../lib/platform';
import type { MenuAnchor, MenuEntry } from './menu-model';

export interface ContextMenuRequest {
  readonly anchor: MenuAnchor;
  readonly items: readonly MenuEntry[];
  readonly label: string;
  /** Keyboard-opened menus highlight their first command. */
  readonly keyboard?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
}

/** Updates only the menu that was opened by this request; closing/replacing it invalidates the handle. */
export type UpdateContextMenu = (items: readonly MenuEntry[]) => void;
export const ContextMenuContext = createContext<(request: ContextMenuRequest) => UpdateContextMenu>(
  () => () => undefined,
);

export function useContextMenu(): (request: ContextMenuRequest) => UpdateContextMenu {
  return useContext(ContextMenuContext);
}

/** Menus format shortcuts for the platform reported by the backend. */
export const MenuPlatformContext = createContext<Platform>('linux');

export function useMenuPlatform(): Platform {
  return useContext(MenuPlatformContext);
}
