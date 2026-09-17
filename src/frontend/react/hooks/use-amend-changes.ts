import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryAmendChanges } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

interface AmendChangesState {
  readonly value: RepositoryAmendChanges | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refresh: () => void;
}

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The amended commit could not be read.';
}

/**
 * Reads what an amended commit would contain: the index compared with HEAD's parent. It loads only
 * while the composer is in amend mode, and reloads when staging or HEAD moves.
 */
export function useAmendChanges(
  repositoryId: string | undefined,
  enabled: boolean,
  changeToken: string,
): AmendChangesState {
  const [value, setValue] = useState<RepositoryAmendChanges>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    if (!repositoryId || !enabled) {
      setValue(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const api = window.desktop;
    if (!api) {
      setValue(undefined);
      setLoading(false);
      setError('Open this application in Electron to preview an amended commit.');
      return;
    }

    setLoading(true);
    try {
      const next = unwrapResult(await api.repository.getAmendChanges({ id: repositoryId }));
      if (!mounted.current || generation.current !== requestGeneration) return;
      setValue(next);
      setError(undefined);
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) {
        setValue(undefined);
        setError(actionError(reason));
      }
    } finally {
      if (mounted.current && generation.current === requestGeneration) setLoading(false);
    }
  }, [enabled, repositoryId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void load();
    // Staging and new commits change the token, so the preview never shows a stale amended commit.
  }, [changeToken, load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { value, loading, error, refresh };
}
