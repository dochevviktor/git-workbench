import { useCallback, useRef, useState } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useMenuPlatform } from './context-menu';
import { MenuPopup } from './MenuPopup';
import type { MenuAnchor, MenuCommand, MenuEntry } from './menu-model';

interface MenuButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'onMouseDown' | 'onKeyDown' | 'onClick'
> {
  readonly items: readonly MenuEntry[];
  /** The accessible name of the opened menu. */
  readonly menuLabel: string;
  /** Keeps the button focusable but inert, and explains why in its tooltip. */
  readonly disabledReason?: string | undefined;
}

/** A button that opens a renderer menu below itself and toggles it on repeated presses. */
export function MenuButton({ items, menuLabel, disabledReason, title, children, ...props }: MenuButtonProps) {
  const platform = useMenuPlatform();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [keyboard, setKeyboard] = useState(false);
  const disabled = disabledReason !== undefined;

  const close = useCallback(() => {
    setAnchor(undefined);
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
  const isOutsideIgnored = useCallback((target: Element) => buttonRef.current?.contains(target) ?? false, []);

  const open = (fromKeyboard: boolean) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setKeyboard(fromKeyboard);
    setAnchor({ type: 'below', rect });
  };

  return (
    <>
      <button
        {...props}
        ref={buttonRef}
        type="button"
        aria-disabled={disabled || undefined}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        title={disabledReason ?? title}
        onMouseDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          if (anchor) close();
          else open(false);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          open(true);
        }}
      >
        {children}
      </button>
      {anchor &&
        createPortal(
          <MenuPopup
            items={items}
            anchor={anchor}
            platform={platform}
            label={menuLabel}
            initialActive={keyboard ? 'first' : 'none'}
            onActivate={activate}
            onDismiss={close}
            isOutsideIgnored={isOutsideIgnored}
          />,
          buttonRef.current?.closest('dialog') ?? document.body,
        )}
    </>
  );
}
