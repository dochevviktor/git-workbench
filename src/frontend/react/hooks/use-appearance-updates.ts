import { useEffect } from 'react';

/** Inspectors receive an initial theme from their owner, then follow explicit profile changes. */
export function useAppearanceUpdates() {
  useEffect(() => {
    const update = () => {
      try {
        const stored: unknown = JSON.parse(window.localStorage.getItem('git-workbench.appearance') ?? 'null');
        const value =
          typeof stored === 'object' &&
          stored !== null &&
          'version' in stored &&
          stored.version === 1 &&
          'value' in stored
            ? stored.value
            : stored;
        if (value === 'light' || value === 'dark' || value === 'system')
          document.documentElement.dataset.theme = value;
      } catch {
        /* Keep the current appearance if storage is unavailable. */
      }
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
}
