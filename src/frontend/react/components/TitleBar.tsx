import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WindowCommand, WindowState } from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { isTextInputEvent } from '../lib/platform';
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from './Icons';
import { MenuPopup } from './menu/MenuPopup';
import type { MenuAnchor, MenuCommand, MenuEntry } from './menu/menu-model';

export interface TitleBarMenu {
  readonly id: string;
  readonly label: string;
  /** A lowercase letter from the label, opened with Alt. */
  readonly mnemonic: string;
  readonly items: readonly MenuEntry[];
}

interface TitleBarProps {
  readonly platform: Platform;
  readonly title: string;
  readonly menus: readonly TitleBarMenu[];
  readonly windowState: WindowState | undefined;
  readonly onWindowCommand: (action: WindowCommand['action']) => void;
}

interface OpenMenu {
  readonly id: string;
  readonly keyboard: boolean;
  readonly anchor: MenuAnchor;
}

function MnemonicLabel({ label, mnemonic, visible }: { label: string; mnemonic: string; visible: boolean }) {
  const index = label.toLocaleLowerCase().indexOf(mnemonic);
  if (!visible || index < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, index)}
      <span className="mnemonic">{label.slice(index, index + 1)}</span>
      {label.slice(index + 1)}
    </>
  );
}

function MenuBar({ menus, platform }: { menus: readonly TitleBarMenu[]; platform: Platform }) {
  const barRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<OpenMenu>();
  const [showMnemonics, setShowMnemonics] = useState(false);
  const openRef = useRef<OpenMenu | undefined>(undefined);
  openRef.current = open;
  // Menus are rebuilt on every application render; listeners read the latest definitions.
  const menusRef = useRef(menus);
  menusRef.current = menus;

  const openMenu = useCallback((id: string, keyboard: boolean) => {
    const button = barRef.current?.querySelector<HTMLElement>(`[data-menubar-id="${id}"]`);
    if (!button) return;
    if (!openRef.current) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setOpen({ id, keyboard, anchor: { type: 'below', rect: button.getBoundingClientRect() } });
  }, []);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = undefined;
    setOpen(undefined);
    const target = restoreFocus.current;
    restoreFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, []);

  const activate = useCallback(
    (command: MenuCommand) => {
      close();
      command.run?.();
    },
    [close],
  );

  const navigate = useCallback(
    (direction: -1 | 1) => {
      const current = menusRef.current;
      const index = current.findIndex((menu) => menu.id === openRef.current?.id);
      const next = current[(index + direction + current.length) % current.length];
      if (next) openMenu(next.id, true);
    },
    [openMenu],
  );

  const isOutsideIgnored = useCallback((target: Element) => barRef.current?.contains(target) ?? false, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextInputEvent(event) || document.querySelector('dialog[open]')) return;
      if (event.key === 'Alt') setShowMnemonics(true);
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const menu = menusRef.current.find((candidate) => event.key.toLocaleLowerCase() === candidate.mnemonic);
      if (!menu) return;
      event.preventDefault();
      openMenu(menu.id, true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setShowMnemonics(false);
    };
    const onBlur = () => setShowMnemonics(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [openMenu]);

  const current = open ? menus.find((menu) => menu.id === open.id) : undefined;

  return (
    <div className="menubar" role="menubar" aria-label="Application menu" ref={barRef}>
      {menus.map((menu) => {
        const expanded = open?.id === menu.id;
        return (
          <button
            key={menu.id}
            type="button"
            role="menuitem"
            className={expanded ? 'menubar-item open' : 'menubar-item'}
            data-menubar-id={menu.id}
            aria-haspopup="menu"
            aria-expanded={expanded}
            aria-keyshortcuts={`Alt+${menu.mnemonic.toLocaleUpperCase()}`}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              if (expanded) close();
              else openMenu(menu.id, false);
            }}
            onMouseEnter={() => {
              if (open && !expanded) openMenu(menu.id, false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              openMenu(menu.id, true);
            }}
          >
            <MnemonicLabel label={menu.label} mnemonic={menu.mnemonic} visible={showMnemonics} />
          </button>
        );
      })}
      {open &&
        current &&
        createPortal(
          <MenuPopup
            key={open.id}
            items={current.items}
            anchor={open.anchor}
            platform={platform}
            label={current.label}
            initialActive={open.keyboard ? 'first' : 'none'}
            onActivate={activate}
            onDismiss={close}
            onNavigateSibling={navigate}
            isOutsideIgnored={isOutsideIgnored}
          />,
          document.body,
        )}
    </div>
  );
}

export function TitleBar({ platform, title, menus, windowState, onWindowCommand }: TitleBarProps) {
  const mac = platform === 'darwin';
  const classes = ['titlebar'];
  if (windowState && !windowState.focused) classes.push('inactive');
  if (mac) classes.push('mac');

  return (
    <header className={classes.join(' ')} data-testid="titlebar">
      {!mac && <MenuBar menus={menus} platform={platform} />}
      <div className="titlebar-title">{title}</div>
      {!mac && (
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="Minimize"
            title="Minimize"
            tabIndex={-1}
            onClick={() => onWindowCommand('minimize')}
          >
            <MinimizeGlyph />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={windowState?.maximized ? 'Restore' : 'Maximize'}
            title={windowState?.maximized ? 'Restore' : 'Maximize'}
            tabIndex={-1}
            onClick={() => onWindowCommand('toggle-maximize')}
          >
            {windowState?.maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
          </button>
          <button
            type="button"
            className="window-control close"
            aria-label="Close"
            title="Close"
            tabIndex={-1}
            onClick={() => onWindowCommand('close')}
          >
            <CloseGlyph />
          </button>
        </div>
      )}
    </header>
  );
}
