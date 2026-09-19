import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryStashEntry } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

interface StashesState {
  readonly value: RepositoryStashEntry[];
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refresh: () => void;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The saved stashes could not be loaded.';
}

/** Loads the reflog-backed stash list with the same repository-switch generation guard as history. */
export function useRepositoryStashes(repositoryId: string | undefined, refreshSignal = 0): StashesState {
  const [value, setValue] = useState<RepositoryStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    if (!repositoryId) {
      setValue([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    const api = window.desktop;
    if (!api) {
      setValue([]);
      setLoading(false);
      setError('Open this application in Electron to inspect saved stashes.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const next = unwrapResult(await api.repository.listStashes({ id: repositoryId }));
      if (!mounted.current || generation.current !== requestGeneration) return;
      setValue(next);
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) {
        setValue([]);
        setError(errorMessage(reason));
      }
    } finally {
      if (mounted.current && generation.current === requestGeneration) setLoading(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load, refreshSignal]);

  const refresh = useCallback(() => void load(), [load]);
  return { value, loading, error, refresh };
}
