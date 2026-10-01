import { useCallback, useEffect, useState } from 'react';
import type { Workspaces, WorkspaceEdit } from '../../../common/ipc/workspaces';
import { unwrapResult } from '../../../common/ipc/result';

export function useWorkspaces() {
  const [value, setValue] = useState<Workspaces>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      if (window.desktop) {
        const next = unwrapResult(await window.desktop.workspace.list());
        setValue((previous) => (previous && previous.revision > next.revision ? previous : next));
      }
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cannot read workspaces.');
    }
  }, []);
  useEffect(() => {
    let current = true;
    const load = () => {
      void window.desktop?.workspace.list().then((result) => {
        if (!current) return;
        if (result.ok) {
          setValue((previous) =>
            previous && previous.revision > result.value.revision ? previous : result.value,
          );
          setError('');
        } else setError(result.error.message);
      });
    };
    load();
    const release = window.desktop?.workspace.onChanged(load);
    window.addEventListener('focus', load);
    return () => {
      current = false;
      release?.();
      window.removeEventListener('focus', load);
    };
  }, []);
  const edit = async (request: WorkspaceEdit) => {
    if (!window.desktop) return;
    const next = unwrapResult(await window.desktop.workspace.edit(request));
    setValue((previous) => (previous && previous.revision > next.revision ? previous : next));
    return next;
  };
  return { value, error, refresh, edit };
}
