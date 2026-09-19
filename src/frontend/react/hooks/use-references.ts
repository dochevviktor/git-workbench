import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryReferenceAction,
  RepositoryReferenceActionResult,
  RepositoryReferenceContext,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

export type RepositoryReferences = ReturnType<typeof useReferences>;

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The branches and tags could not be read.';
}

/**
 * Reads the branches, tags, and remotes of the active repository, and runs one reference action at a
 * time. Every action takes its compare-and-swap token from a read issued immediately before it, so
 * the window between reading and writing is as short as the two requests; the main process still
 * re-reads and refuses a token that no longer matches.
 */
export function useReferences(repositoryId: string | undefined, refreshSignal = 0) {
  const [context, setContext] = useState<RepositoryReferenceContext>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async (id: string): Promise<RepositoryReferenceContext | undefined> => {
    const api = window.desktop;
    if (!api) return undefined;
    return unwrapResult(await api.repository.getReferenceContext({ id }));
  }, []);

  const reload = useCallback(() => {
    if (!repositoryId) {
      setContext(undefined);
      return;
    }
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setLoading(true);
    void read(repositoryId)
      .then((next) => {
        if (!mounted.current || generation.current !== requestGeneration) return;
        setContext(next);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!mounted.current || generation.current !== requestGeneration) return;
        setContext(undefined);
        setError(actionError(reason));
      })
      .finally(() => {
        if (mounted.current && generation.current === requestGeneration) setLoading(false);
      });
  }, [read, repositoryId]);

  useEffect(() => {
    generation.current += 1;
    setContext(undefined);
    setError(undefined);
    reload();
  }, [refreshSignal, reload]);

  const apply = useCallback(
    async (action: RepositoryReferenceAction): Promise<RepositoryReferenceActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) {
        throw new Error('Open this application in Electron to change branches and tags.');
      }
      setBusy(true);
      try {
        const current = await read(repositoryId);
        if (!current) throw new Error('The branches and tags could not be read.');
        const result = unwrapResult(
          await api.repository.applyReferenceAction({
            id: repositoryId,
            action,
            snapshot: current.snapshot,
          }),
        );
        const refreshed = await read(repositoryId).catch(() => undefined);
        if (mounted.current && refreshed) setContext(refreshed);
        return result;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [read, repositoryId],
  );

  return { context, loading, busy, error, reload, apply };
}
