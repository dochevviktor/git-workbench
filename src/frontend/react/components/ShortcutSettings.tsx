import { useState } from 'react';
import { usePersistentState } from '../hooks/use-persistent-state';
import { customizableShortcuts, validShortcutOverrides } from '../lib/shortcut-preferences';
import type { ShortcutOverrides } from '../lib/shortcut-preferences';
import { isTextInputEvent } from '../lib/platform';

const empty: ShortcutOverrides = {};
export function ShortcutSettings() {
  const [bindings, setBindings] = usePersistentState('shortcuts', empty, validShortcutOverrides);
  const [error, setError] = useState('');
  return (
    <section className="settings-page">
      <p className="muted">
        Focus a shortcut and press Ctrl+Alt+letter (Cmd+Option on macOS), optionally with Shift. Menus and
        Quick Launch show the same binding. Escape leaves the field; Reset restores the original.
      </p>
      {customizableShortcuts.map(([name, original]) => (
        <div className="shortcut-setting" key={original}>
          <label>
            {name}
            <input
              readOnly
              aria-label={`${name} shortcut`}
              value={bindings[original] ?? original}
              onKeyDown={(event) => {
                if (isTextInputEvent(event.nativeEvent)) return;
                if (event.key === 'Tab' || event.key === 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                if ((!event.ctrlKey && !event.metaKey) || !event.altKey || !/^[a-z]$/iu.test(event.key)) {
                  setError('Use Ctrl+Alt+letter (Cmd+Option on macOS), optionally with Shift.');
                  return;
                }
                const next = {
                  ...bindings,
                  [original]: `Mod+Alt+${event.shiftKey ? 'Shift+' : ''}${event.key.toUpperCase()}`,
                };
                if (!validShortcutOverrides(next)) {
                  setError('That shortcut is already assigned or reserved for an external tool.');
                  return;
                }
                setBindings(next);
                setError('');
              }}
            />
          </label>
          <button
            className="button"
            disabled={!bindings[original]}
            onClick={() => {
              const next = { ...bindings };
              delete next[original];
              setBindings(next);
              setError('');
            }}
          >
            Reset
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <button
        className="button"
        onClick={() => {
          setBindings({});
          setError('');
        }}
      >
        Restore all shortcuts
      </button>
    </section>
  );
}
