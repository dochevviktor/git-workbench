import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryDiff,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

interface RepositoryDiffState {
  readonly value: RepositoryDiff | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refresh: () => void;
}

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The selected diff could not be loaded.';
}

function targetKey(target: RepositoryDiffTarget | undefined): string | undefined {
  if (!target) return undefined;
  return target.kind === 'commit'
    ? `commit:${target.commitId}:${target.previousPath ?? ''}:${target.path}`
    : `working:${target.area}:${target.previousPath ?? ''}:${target.path}`;
}

/** Loads a selected diff and ignores late responses from a previous repository or file selection. */
export function useRepositoryDiff(
  repositoryId: string | undefined,
  target: RepositoryDiffTarget | undefined,
  whitespace: RepositoryDiffWhitespace,
): RepositoryDiffState {
  const [value, setValue] = useState<RepositoryDiff>();
  const [loadedKey, setLoadedKey] = useState<string>();
  const [loadedWhitespace, setLoadedWhitespace] = useState<RepositoryDiffWhitespace>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const targetRef = useRef<RepositoryDiffTarget | undefined>(target);
  targetRef.current = target;
  const key = targetKey(target);

  const load = useCallback(async () => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    const requestedTarget = targetRef.current;
    if (!repositoryId || !requestedTarget) {
      setValue(undefined);
      setLoadedKey(undefined);
      setLoadedWhitespace(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const api = window.desktop;
    if (!api) {
      setValue(undefined);
      setLoadedKey(undefined);
      setLoadedWhitespace(undefined);
      setLoading(false);
      setError('Open this application in Electron to inspect diffs.');
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const next = unwrapResult(
        await api.repository.getDiff({ id: repositoryId, target: requestedTarget, whitespace }),
      );
      if (generation.current !== requestGeneration) return;
      setValue(next);
      setLoadedKey(key);
      setLoadedWhitespace(whitespace);
    } catch (reason: unknown) {
      if (generation.current === requestGeneration) {
        setValue(undefined);
        setLoadedKey(undefined);
        setLoadedWhitespace(undefined);
        setError(actionError(reason));
      }
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [key, repositoryId, whitespace]);

  useEffect(() => {
    generation.current += 1;
    setValue(undefined);
    setLoadedKey(undefined);
    setLoadedWhitespace(undefined);
    setError(undefined);
    if (!repositoryId || !targetRef.current) {
      setLoading(false);
      return;
    }
    void load();
  }, [key, load, repositoryId]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    value: loadedKey === key && loadedWhitespace === whitespace ? value : undefined,
    loading,
    error,
    refresh,
  };
}
