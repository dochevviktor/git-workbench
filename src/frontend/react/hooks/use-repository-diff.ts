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
  return JSON.stringify(target);
}

/** Loads a selected diff and ignores late responses from a previous repository or file selection. */
export function useRepositoryDiff(
  repositoryId: string | undefined,
  target: RepositoryDiffTarget | undefined,
  whitespace: RepositoryDiffWhitespace,
  refreshSignal = 0,
): RepositoryDiffState {
  const [value, setValue] = useState<RepositoryDiff>();
  const [loadedKey, setLoadedKey] = useState<string>();
  const [loadedWhitespace, setLoadedWhitespace] = useState<RepositoryDiffWhitespace>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const targetRef = useRef<RepositoryDiffTarget | undefined>(target);
  targetRef.current = target;
  const key = `${repositoryId ?? ''}:${targetKey(target) ?? ''}`;
  const liveTarget = target !== undefined && target.kind !== 'commit';
  const inFlight = useRef(false);

  const load = useCallback(
    async (background = false) => {
      if (background && inFlight.current) return;
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

      inFlight.current = true;
      if (!background) setLoading(true);
      setError(undefined);
      try {
        const next = unwrapResult(
          await api.repository.getDiff({ id: repositoryId, target: requestedTarget, whitespace }),
        );
        if (generation.current !== requestGeneration) return;
        setValue((previous) =>
          previous?.snapshot === next.snapshot &&
          previous?.content === next.content &&
          previous?.state === next.state &&
          previous?.repositoryId === next.repositoryId
            ? previous
            : next,
        );
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
        if (generation.current === requestGeneration) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [key, repositoryId, whitespace],
  );

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
  }, [key, load, repositoryId, refreshSignal]);

  useEffect(() => {
    if (!liveTarget) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load, liveTarget]);

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
