import { useCallback, useState } from 'react';

const storagePrefix = 'git-workbench.';

function readStored<Value>(key: string, fallback: Value, accept: (value: unknown) => value is Value): Value {
  try {
    const raw = window.localStorage.getItem(storagePrefix + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return accept(parsed) ? parsed : fallback;
  } catch {
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
  const [value, setValue] = useState<Value>(() => readStored(key, fallback, accept));
  const update = useCallback(
    (next: Value) => {
      setValue(next);
      try {
        window.localStorage.setItem(storagePrefix + key, JSON.stringify(next));
      } catch {
        // The preference still applies for this session.
      }
    },
    [key],
  );
  return [value, update] as const;
}

export function isNumberBetween(minimum: number, maximum: number) {
  return (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function isOneOf<Value extends string>(values: readonly Value[]) {
  return (value: unknown): value is Value => typeof value === 'string' && values.includes(value as Value);
}
