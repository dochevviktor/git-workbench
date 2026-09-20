import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryOperation,
  RepositoryWorktreeAction,
  RepositoryWorktreeActionResult,
  RepositoryWorktreeContext,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';

export function useWorktrees(repositoryId: string | undefined, refreshSignal = 0) {
  const [context, setContext] = useState<RepositoryWorktreeContext>();
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

  const read = useCallback(async (id: string): Promise<RepositoryWorktreeContext | undefined> => {
    const api = window.desktop;
    if (!api) return undefined;
    return unwrapResult(await api.repository.getWorktrees({ id }));
  }, []);

  const reload = useCallback(() => {
    if (!repositoryId) {
      setContext(undefined);
      setError(undefined);
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
        setError(reason instanceof Error ? reason.message : 'The worktrees could not be read.');
      })
      .finally(() => {
        if (mounted.current && generation.current === requestGeneration) setLoading(false);
      });
  }, [read, repositoryId]);

  useEffect(() => {
    generation.current += 1;
    setBusy(false);
    reload();
  }, [refreshSignal, reload]);

  const apply = useCallback(
    async (action: RepositoryWorktreeAction, snapshot?: string): Promise<RepositoryWorktreeActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) throw new Error('Open this application in Electron to manage worktrees.');
      const current = context;
      if (!current) throw new Error('The worktrees could not be read.');
      setBusy(true);
      const requestGeneration = generation.current;
      try {
        const accepted = unwrapResult(
          await api.repository.startWorktreeOperation({
            id: repositoryId,
            action,
            snapshot: snapshot ?? current.snapshot,
          }),
        );
        const operation: RepositoryOperation = await waitForOperation(api, accepted);
        if (operation.result?.kind !== 'worktree') throw new Error(operation.message);
        const result = operation.result.value;
        const refreshed = await read(repositoryId).catch(() => undefined);
        if (mounted.current && generation.current === requestGeneration && refreshed) setContext(refreshed);
        return result;
      } finally {
        if (mounted.current && generation.current === requestGeneration) setBusy(false);
      }
    },
    [context, read, repositoryId],
  );

  return { context, loading, busy, error, reload, apply };
}
