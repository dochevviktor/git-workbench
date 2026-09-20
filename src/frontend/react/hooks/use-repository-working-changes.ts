import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryWorkingChanges } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

interface WorkingChangesState {
  readonly value: RepositoryWorkingChanges | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refresh: () => Promise<void>;
}

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The working-tree changes could not be loaded.';
}

/** Loads local changes with a generation guard so a fast repository switch cannot overwrite the view. */
export function useRepositoryWorkingChanges(
  repositoryId: string | undefined,
  includeUntracked: boolean,
  includeIgnored: boolean,
): WorkingChangesState {
  const [value, setValue] = useState<RepositoryWorkingChanges>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    if (!repositoryId) {
      setValue(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const api = window.desktop;
    if (!api) {
      setValue(undefined);
      setLoading(false);
      setError('Open this application in Electron to inspect local changes.');
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const next = unwrapResult(
        await api.repository.getWorkingChanges({
          id: repositoryId,
          includeUntracked,
          includeIgnored,
        }),
      );
      if (!mounted.current || generation.current !== requestGeneration) return;
      setValue(next);
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) {
        setValue(undefined);
        setError(actionError(reason));
      }
    } finally {
      if (mounted.current && generation.current === requestGeneration) setLoading(false);
    }
  }, [includeIgnored, includeUntracked, repositoryId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const interval = window.setInterval(() => void load(), 5_000);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [load]);

  const refresh = useCallback(() => load(), [load]);

  return { value, loading, error, refresh };
}
