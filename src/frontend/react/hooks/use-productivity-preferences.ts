import { useEffect, useState } from 'react';
import type { ProductivityPreferences } from '../../../common/ipc/settings';
import { unwrapResult } from '../../../common/ipc/result';

export function useProductivityPreferences() {
  const [value, setValue] = useState<ProductivityPreferences>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    const load = () => {
      void window.desktop?.settings.getProductivity().then((result) => {
        if (!current) return;
        if (result.ok) {
          setValue(result.value);
          setError('');
        } else setError(result.error.message);
      });
    };
    load();
    const release = window.desktop?.settings.onChanged(load);
    return () => {
      current = false;
      release?.();
    };
  }, []);
  const update = async (patch: Partial<Omit<ProductivityPreferences, 'revision'>>) => {
    if (!value || !window.desktop || busy) return;
    setBusy(true);
    setError('');
    try {
      setValue(unwrapResult(await window.desktop.settings.setProductivity({ ...value, ...patch })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cannot save preferences.');
    } finally {
      setBusy(false);
    }
  };
  return { value, error, busy, update };
}
