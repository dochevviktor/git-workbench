import { useEffect, useId, useRef, useState } from 'react';
import { filterLaunchItems } from '../lib/quick-launch';
import type { LaunchChoices, LaunchItem } from '../lib/quick-launch';
import { formatShortcut, isTextInputEvent } from '../lib/platform';
import type { Platform } from '../lib/platform';
import './quick-launch.css';

export function QuickLaunch({
  items,
  platform,
  contextKey,
  onClose,
}: {
  readonly items: readonly LaunchItem[];
  readonly platform: Platform;
  readonly contextKey: string;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const [command, setCommand] = useState<LaunchItem>();
  const [commandContext, setCommandContext] = useState(contextKey);
  const [choices, setChoices] = useState<LaunchChoices>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const matches = filterLaunchItems(command ? (choices?.items ?? []) : items, query);
  const visible = matches.slice(0, 200);
  const index = Math.min(selected, Math.max(0, visible.length - 1));

  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => {
      controller.current?.abort();
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [index, listId, query, choices]);
  useEffect(() => {
    if (command && commandContext !== contextKey) onClose();
  }, [command, commandContext, contextKey, onClose]);

  const back = () => {
    controller.current?.abort();
    setCommand(undefined);
    setChoices(undefined);
    setError(undefined);
    setQuery('');
    setSelected(0);
    input.current?.focus();
  };
  const choose = (item: LaunchItem | undefined) => {
    if (!item || item.disabled) return;
    if (item.choices) {
      const abort = new AbortController();
      controller.current?.abort();
      controller.current = abort;
      setCommand(item);
      setCommandContext(contextKey);
      setChoices(undefined);
      setError(undefined);
      setQuery('');
      setSelected(0);
      void item
        .choices(abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) setChoices(result);
        })
        .catch((reason: unknown) => {
          if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Lookup failed.');
        });
      input.current?.focus();
    } else {
      dialog.current?.close();
      onClose();
      item.run?.();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="quick-launch"
      aria-label="Quick Launch"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="quick-launch-search">
        {command && (
          <button type="button" onClick={back} title="Back to commands">
            {command.label} ←
          </button>
        )}
        <input
          ref={input}
          role="combobox"
          aria-label={command ? 'Choose parameter' : 'Search commands and repositories'}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible[index] ? `${listId}-${index}` : undefined}
          placeholder={command ? 'Choose parameter' : 'Command or repository'}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (isTextInputEvent(event.nativeEvent)) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected(
                (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % (visible.length || 1),
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(visible[index]);
            } else if (event.key === 'Backspace' && !query && command) {
              event.preventDefault();
              back();
            }
          }}
        />
        <button type="button" aria-label="Close Quick Launch" onClick={onClose}>
          ×
        </button>
      </div>
      <div
        className="quick-launch-results"
        id={listId}
        role="listbox"
        aria-label={command?.label ?? 'Commands and repositories'}
      >
        {visible.map((item, itemIndex) => (
          <div key={item.id}>
            {(itemIndex === 0 || visible[itemIndex - 1]?.group !== item.group) && (
              <div className="quick-launch-group" role="presentation">
                {item.group}
              </div>
            )}
            <div
              id={`${listId}-${itemIndex}`}
              role="option"
              aria-selected={itemIndex === index}
              aria-disabled={item.disabled || undefined}
              className="quick-launch-option"
              title={
                item.disabled ? (item.disabledReason ?? 'Unavailable in the current context.') : item.detail
              }
              onMouseMove={() => setSelected(itemIndex)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              <span>
                {item.label}
                {item.detail && <small> — {item.detail}</small>}
              </span>
              {item.shortcut && <kbd>{formatShortcut(item.shortcut, platform)}</kbd>}
            </div>
          </div>
        ))}
      </div>
      <div className="quick-launch-status" role="status">
        {error ??
          (command && !choices
            ? 'Loading…'
            : visible.length === 0
              ? `No matches. ${choices?.notice ?? ''}`
              : visible[index]?.disabled
                ? (visible[index]?.disabledReason ?? 'Unavailable in the current context.')
                : (choices?.notice ??
                  (matches.length > 200
                    ? 'Showing 200 matches. Type to narrow the results.'
                    : '↑ ↓ Select · Enter Open · Esc Close')))}
        {error && command && (
          <button type="button" onClick={() => choose(command)}>
            Retry
          </button>
        )}
      </div>
    </dialog>
  );
}
