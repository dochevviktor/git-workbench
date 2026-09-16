import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EditCommand } from '../../../../common/ipc/contracts';
import type { Platform } from '../../lib/platform';
import { ContextMenuContext } from './context-menu';
import type { ContextMenuRequest } from './context-menu';
import { menuSeparator } from './menu-model';
import type { MenuCommand, MenuEntry } from './menu-model';
import { MenuPopup } from './MenuPopup';

interface ContextMenuHostProps {
  readonly platform: Platform;
  readonly children: ReactNode;
}

function runEditCommand(action: EditCommand['action']) {
  void window.desktop?.edit.command({ action });
}

function editableTarget(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
  if (element instanceof HTMLInputElement && !['text', 'search', 'url', 'email', ''].includes(element.type)) {
    return null;
  }
  return element;
}

function textEditingMenu(element: HTMLElement): MenuEntry[] {
  const field =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  const readOnly = field ? field.readOnly || field.disabled : false;
  const hasSelection = field
    ? (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0)
    : (window.getSelection()?.toString().length ?? 0) > 0;
  return [
    { id: 'undo', label: 'Undo', shortcut: 'Mod+Z', disabled: readOnly, run: () => runEditCommand('undo') },
    {
      id: 'redo',
      label: 'Redo',
      shortcut: 'Mod+Shift+Z',
      disabled: readOnly,
      run: () => runEditCommand('redo'),
    },
    menuSeparator,
    {
      id: 'cut',
      label: 'Cut',
      shortcut: 'Mod+X',
      disabled: readOnly || !hasSelection,
      run: () => runEditCommand('cut'),
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: 'Mod+C',
      disabled: !hasSelection,
      run: () => runEditCommand('copy'),
    },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: 'Mod+V',
      disabled: readOnly,
      run: () => runEditCommand('paste'),
    },
    menuSeparator,
    { id: 'select-all', label: 'Select All', shortcut: 'Mod+A', run: () => runEditCommand('select-all') },
  ];
}

/**
 * Owns the single open context menu. Components request menus through `useContextMenu`; right
 * clicks that no component handled fall back to text editing or copying the selected text.
 */
export function ContextMenuHost({ platform, children }: ContextMenuHostProps) {
  const [request, setRequest] = useState<ContextMenuRequest>();
  const [generation, setGeneration] = useState(0);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const requestRef = useRef<ContextMenuRequest | undefined>(undefined);
  requestRef.current = request;

  const show = useCallback((next: ContextMenuRequest) => {
    requestRef.current?.onClose?.();
    if (!requestRef.current) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // A new generation remounts the popup so highlight and submenu state never leak between menus.
    setGeneration((value) => value + 1);
    setRequest(next);
  }, []);

  const close = useCallback(() => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = undefined;
    setRequest(undefined);
    current.onClose?.();
    const target = restoreFocus.current;
    restoreFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, []);

  const activate = useCallback(
    (command: MenuCommand) => {
      // Restore focus first so editing commands act on the element the menu was opened for.
      close();
      command.run?.();
    },
    [close],
  );

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const anchor = { type: 'point', x: event.clientX, y: event.clientY } as const;
      const editable = editableTarget(event.target);
      if (editable) {
        show({ anchor, items: textEditingMenu(editable), label: 'Text editing' });
        return;
      }
      const selection = window.getSelection()?.toString() ?? '';
      if (selection.length > 0) {
        show({
          anchor,
          label: 'Selection',
          items: [
            {
              id: 'copy-selection',
              label: 'Copy',
              shortcut: 'Mod+C',
              run: () => void window.desktop?.clipboard.writeText({ text: selection.slice(0, 1_048_576) }),
            },
          ],
        });
      }
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [show]);

  return (
    <ContextMenuContext.Provider value={show}>
      {children}
      {request && (
        <MenuPopup
          key={generation}
          items={request.items}
          anchor={request.anchor}
          platform={platform}
          label={request.label}
          initialActive={request.keyboard ? 'first' : 'none'}
          onActivate={activate}
          onDismiss={close}
        />
      )}
    </ContextMenuContext.Provider>
  );
}
