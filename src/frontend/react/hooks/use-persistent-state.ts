import { useCallback, useContext, useEffect, useState } from 'react';
import { WorkspaceScope, scopedPreference } from '../lib/workspace-layout';

const storagePrefix = 'git-workbench.';

function readStored<Value>(key: string, fallback: Value, accept: (value: unknown) => value is Value): Value {
  try {
    const raw = window.localStorage.getItem(storagePrefix + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    const stored =
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      parsed.version === 1 &&
      'value' in parsed
        ? parsed.value
        : parsed;
    if (accept(stored)) return stored;
    window.localStorage.setItem(`${storagePrefix}recovery.${key}.${Date.now()}`, raw);
    window.localStorage.removeItem(storagePrefix + key);
    return fallback;
  } catch {
    try {
      const raw = window.localStorage.getItem(storagePrefix + key);
      if (raw !== null) {
        window.localStorage.setItem(`${storagePrefix}recovery.${key}.${Date.now()}`, raw);
        window.localStorage.removeItem(storagePrefix + key);
      }
    } catch {
      /* Retain the original when storage cannot be written. */
    }
    return fallback;
  }
}

/**
 * Renderer-only presentation preferences such as pane sizes and appearance. Storage can be missing
 * or blocked, so every read and write falls back to the in-memory value.
 */
export function usePersistentState<Value>(
  key: string,
  fallback: Value,
  accept: (value: unknown) => value is Value,
): readonly [Value, (value: Value) => void] {
  const workspace = useContext(WorkspaceScope);
  key = scopedPreference(key, workspace);
  const [value, setValue] = useState<Value>(() => readStored(key, fallback, accept));
  useEffect(() => {
    const changed = () => setValue(readStored(key, fallback, accept));
    window.addEventListener('storage', changed);
    window.addEventListener('workbench-preference-changed', changed);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('workbench-preference-changed', changed);
    };
  }, [key, fallback, accept]);
  const update = useCallback(
    (next: Value) => {
      setValue(next);
      try {
        window.localStorage.setItem(storagePrefix + key, JSON.stringify({ version: 1, value: next }));
        window.dispatchEvent(new Event('workbench-preference-changed'));
      } catch {
        // The preference still applies for this session.
      }
    },
    [key],
  );
  return [value, update] as const;
}

/** Moving a saved repository preserves its draft/presentation keys without overwriting an existing draft. */
export function relocateRepositoryPreferences(oldId: string, newId: string): void {
  const prefix = `${storagePrefix}repository.${oldId}.`;
  for (const key of Object.keys(window.localStorage))
    if (key.startsWith(prefix)) {
      const target = `${storagePrefix}repository.${newId}.${key.slice(prefix.length)}`;
      if (window.localStorage.getItem(target) === null)
        window.localStorage.setItem(target, window.localStorage.getItem(key)!);
    }
  window.dispatchEvent(new Event('workbench-preference-changed'));
}

export function isNumberBetween(minimum: number, maximum: number) {
  return (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function isOneOf<Value extends string>(values: readonly Value[]) {
  return (value: unknown): value is Value => typeof value === 'string' && values.includes(value as Value);
}
