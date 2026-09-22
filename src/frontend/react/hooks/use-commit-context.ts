import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryCommitContext } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

interface CommitContextState {
  readonly value: RepositoryCommitContext | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refresh: () => void;
}

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The commit details could not be loaded.';
}

/**
 * Loads the commit composer's backend state. `changeToken` lets the view reload after staging without
 * repeating the read on every status poll, so the compare-and-swap token stays current but cheap.
 */
export function useCommitContext(repositoryId: string | undefined, changeToken: string): CommitContextState {
  const [value, setValue] = useState<RepositoryCommitContext>();
  const [loadedKey, setLoadedKey] = useState<string>();
  const key = `${repositoryId ?? ''}\0${changeToken}`;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    if (!repositoryId) {
      setValue(undefined);
      setLoadedKey(key);
      setLoading(false);
      setError(undefined);
      return;
    }

    const api = window.desktop;
    if (!api) {
      setValue(undefined);
      setLoadedKey(key);
      setLoading(false);
      setError('Open this application in Electron to commit changes.');
      return;
    }

    setLoading(true);
    try {
      const next = unwrapResult(await api.repository.getCommitContext({ id: repositoryId }));
      if (!mounted.current || generation.current !== requestGeneration) return;
      setValue(next);
      setLoadedKey(key);
      setError(undefined);
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) {
        setValue(undefined);
        setLoadedKey(key);
        setError(actionError(reason));
      }
    } finally {
      if (mounted.current && generation.current === requestGeneration) setLoading(false);
    }
  }, [repositoryId, key]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void load();
    // The token is part of the dependency list so staging and external changes reload the context.
  }, [changeToken, load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);
  useEffect(() => {
    return window.desktop?.settings.onChanged(refresh);
  }, [refresh]);

  // Invalidate in the render that observes changed staging, before the reload effect runs.
  return {
    value: loadedKey === key ? value : undefined,
    loading: loading || loadedKey !== key,
    error,
    refresh,
  };
}
