import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Platform } from '../../lib/platform';
import { ariaShortcut, formatShortcut } from '../../lib/platform';
import { CheckIcon, ChevronRightIcon } from '../Icons';
import { isMenuSeparator } from './menu-model';
import type { MenuAnchor, MenuCommand, MenuEntry } from './menu-model';

export type MenuDismissReason = 'escape' | 'outside' | 'tab' | 'blur';

interface MenuPopupProps {
  readonly items: readonly MenuEntry[];
  readonly anchor: MenuAnchor;
  readonly platform: Platform;
  readonly label: string;
  readonly initialActive?: 'first' | 'none';
  readonly depth?: number;
  readonly onActivate: (command: MenuCommand) => void;
  readonly onDismiss: (reason: MenuDismissReason) => void;
  /** A submenu closes itself back into its parent with ArrowLeft or Escape. */
  readonly onCloseSubmenu?: () => void;
  /** Root menus of a menu bar move to the adjacent top-level menu with ArrowLeft/ArrowRight. */
  readonly onNavigateSibling?: (direction: -1 | 1) => void;
  /** Lets a menu bar handle clicks on its own buttons instead of treating them as outside clicks. */
  readonly isOutsideIgnored?: (target: Element) => boolean;
}

interface OpenSubmenu {
  readonly index: number;
  /** Kept in state so the submenu is positioned once, not on every parent render. */
  readonly anchor: MenuAnchor;
  readonly keyboard: boolean;
}

const viewportMargin = 4;
const hoverDelayMs = 160;

function commandAt(items: readonly MenuEntry[], index: number): MenuCommand | undefined {
  const entry = items[index];
  return entry && !isMenuSeparator(entry) ? entry : undefined;
}

function nextCommandIndex(items: readonly MenuEntry[], from: number, direction: 1 | -1): number {
  if (items.length === 0) return -1;
  for (let step = 1; step <= items.length; step += 1) {
    const index = (from + direction * step + items.length * 2) % items.length;
    if (commandAt(items, index)) return index;
  }
  return -1;
}

function placeMenu(anchor: MenuAnchor, width: number, height: number) {
  const right = window.innerWidth - viewportMargin;
  const bottom = window.innerHeight - viewportMargin;
  let left: number;
  let top: number;
  switch (anchor.type) {
    case 'point':
      left = anchor.x + width > right ? anchor.x - width : anchor.x;
      top = anchor.y + height > bottom ? anchor.y - height : anchor.y;
      break;
    case 'below':
      left = Math.min(anchor.rect.left, right - width);
      top = anchor.rect.bottom + height > bottom ? anchor.rect.top - height : anchor.rect.bottom;
      break;
    case 'beside':
      left = anchor.rect.right + width > right ? anchor.rect.left - width : anchor.rect.right;
      top = Math.min(anchor.rect.top - viewportMargin, bottom - height);
      break;
  }
  return {
    left: Math.max(viewportMargin, left),
    top: Math.max(viewportMargin, top),
  };
}

/**
 * A menu drawn by the renderer so that title-bar menus and context menus share one look on every
 * platform. Focus stays on the menu element and `aria-activedescendant` tracks the highlighted item.
 */
export function MenuPopup({
  items,
  anchor,
  platform,
  label,
  initialActive = 'none',
  depth = 0,
  onActivate,
  onDismiss,
  onCloseSubmenu,
  onNavigateSibling,
  isOutsideIgnored,
}: MenuPopupProps) {
  const idPrefix = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const [active, setActive] = useState(() =>
    initialActive === 'first' ? nextCommandIndex(items, -1, 1) : -1,
  );
  const [submenu, setSubmenu] = useState<OpenSubmenu>();

  // Root menus and keyboard-opened submenus take focus. A submenu opened by hovering waits until
  // the pointer enters it, so the parent keeps handling the keyboard meanwhile.
  const takesFocus = depth === 0 || initialActive === 'first';

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition(placeMenu(anchor, width, height));
    if (takesFocus) element.focus({ preventScroll: true });
  }, [anchor, takesFocus]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    if (depth > 0) return;
    const insideMenu = (target: EventTarget | null) =>
      target instanceof Element &&
      (target.closest('[data-menu-popup]') !== null || (isOutsideIgnored?.(target) ?? false));
    const onPointerDown = (event: MouseEvent) => {
      if (!insideMenu(event.target)) onDismiss('outside');
    };
    const onWheel = (event: WheelEvent) => {
      if (!insideMenu(event.target)) onDismiss('outside');
    };
    const onBlur = () => onDismiss('blur');
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('wheel', onWheel, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [depth, isOutsideIgnored, onDismiss]);

  const itemElement = useCallback(
    (index: number) => menuRef.current?.querySelector<HTMLElement>(`[data-menu-index="${index}"]`) ?? null,
    [],
  );

  const openSubmenu = useCallback(
    (index: number, keyboard: boolean) => {
      const element = itemElement(index);
      if (!element || !commandAt(items, index)?.submenu || commandAt(items, index)?.disabled) return;
      setSubmenu({ index, anchor: { type: 'beside', rect: element.getBoundingClientRect() }, keyboard });
    },
    [itemElement, items],
  );

  const activate = (index: number, keyboard: boolean) => {
    const command = commandAt(items, index);
    if (!command || command.disabled) return;
    if (command.submenu) {
      openSubmenu(index, keyboard);
      return;
    }
    onActivate(command);
  };

  const highlight = (index: number) => {
    setActive(index);
    itemElement(index)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Submenus are rendered as siblings, so only the focused menu receives its own key events.
    if (event.target !== menuRef.current) return;
    switch (event.key) {
      case 'ArrowDown':
        highlight(nextCommandIndex(items, active, 1));
        break;
      case 'ArrowUp':
        highlight(nextCommandIndex(items, active < 0 ? items.length : active, -1));
        break;
      case 'Home':
        highlight(nextCommandIndex(items, -1, 1));
        break;
      case 'End':
        highlight(nextCommandIndex(items, items.length, -1));
        break;
      case 'ArrowRight':
        if (commandAt(items, active)?.submenu) openSubmenu(active, true);
        else onNavigateSibling?.(1);
        break;
      case 'ArrowLeft':
        if (onCloseSubmenu) onCloseSubmenu();
        else onNavigateSibling?.(-1);
        break;
      case 'Enter':
      case ' ':
        if (active >= 0) activate(active, true);
        break;
      case 'Escape':
        if (onCloseSubmenu) onCloseSubmenu();
        else onDismiss('escape');
        break;
      case 'Tab':
        onDismiss('tab');
        break;
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const character = event.key.toLocaleLowerCase();
        for (let step = 1; step <= items.length; step += 1) {
          const index = (active + step + items.length) % items.length;
          if (commandAt(items, index)?.label.toLocaleLowerCase().startsWith(character)) {
            highlight(index);
            break;
          }
        }
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onItemHover = (index: number) => {
    setActive(index);
    window.clearTimeout(hoverTimer.current);
    if (submenu?.index === index) return;
    hoverTimer.current = window.setTimeout(() => {
      if (commandAt(items, index)?.submenu) {
        openSubmenu(index, false);
      } else if (submenu) {
        setSubmenu(undefined);
        menuRef.current?.focus({ preventScroll: true });
      }
    }, hoverDelayMs);
  };

  const submenuCommand = submenu ? commandAt(items, submenu.index) : undefined;

  return (
    <>
      <div
        ref={menuRef}
        className="menu-popup"
        data-menu-popup=""
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        aria-activedescendant={active >= 0 ? `${idPrefix}-${active}` : undefined}
        tabIndex={-1}
        // The first layout pass only measures the menu. It stays focusable, unlike an element with
        // `visibility: hidden`, and is positioned before the browser paints.
        style={
          position
            ? { left: position.left, top: position.top }
            : { left: 0, top: 0, opacity: 0, pointerEvents: 'none' }
        }
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => menuRef.current?.focus({ preventScroll: true })}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((entry, index) => {
          if (isMenuSeparator(entry)) {
            return <div className="menu-separator" role="separator" key={`separator-${index}`} />;
          }
          const role =
            entry.checkable === 'radio'
              ? 'menuitemradio'
              : entry.checkable === 'checkbox'
                ? 'menuitemcheckbox'
                : 'menuitem';
          const classes = ['menu-item'];
          if (index === active) classes.push('active');
          if (entry.disabled) classes.push('disabled');
          if (entry.danger) classes.push('danger');
          return (
            <div
              key={entry.id}
              id={`${idPrefix}-${index}`}
              data-menu-index={index}
              role={role}
              aria-label={entry.label}
              className={classes.join(' ')}
              aria-checked={entry.checkable ? Boolean(entry.checked) : undefined}
              aria-disabled={entry.disabled ? true : undefined}
              aria-haspopup={entry.submenu ? 'menu' : undefined}
              aria-expanded={entry.submenu ? submenu?.index === index : undefined}
              aria-keyshortcuts={entry.shortcut ? ariaShortcut(entry.shortcut, platform) : undefined}
              title={entry.disabled ? entry.disabledReason : undefined}
              onMouseEnter={() => onItemHover(index)}
              onClick={() => activate(index, false)}
            >
              <span className="menu-item-check" aria-hidden="true">
                {entry.checked ? (
                  entry.checkable === 'radio' ? (
                    <span className="menu-radio-dot" />
                  ) : (
                    <CheckIcon size={12} />
                  )
                ) : null}
              </span>
              <span className="menu-item-label">{entry.label}</span>
              <span className="menu-item-shortcut">
                {entry.shortcut ? formatShortcut(entry.shortcut, platform) : null}
              </span>
              <span className="menu-item-arrow" aria-hidden="true">
                {entry.submenu ? <ChevronRightIcon size={12} /> : null}
              </span>
            </div>
          );
        })}
      </div>
      {submenu && submenuCommand?.submenu && (
        <MenuPopup
          key={submenu.index}
          items={submenuCommand.submenu}
          anchor={submenu.anchor}
          platform={platform}
          label={submenuCommand.label}
          initialActive={submenu.keyboard ? 'first' : 'none'}
          depth={depth + 1}
          onActivate={onActivate}
          onDismiss={onDismiss}
          onCloseSubmenu={() => {
            setSubmenu(undefined);
            menuRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}
