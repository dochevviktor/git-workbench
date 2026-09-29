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
  const readGeneration = useRef(0);
  const inFlight = useRef(false);
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
    if (inFlight.current) return;
    const requestGeneration = ++readGeneration.current;
    setLoading(true);
    void read(repositoryId)
      .then((next) => {
        if (!mounted.current || readGeneration.current !== requestGeneration) return;
        setContext(next);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!mounted.current || readGeneration.current !== requestGeneration) return;
        setContext(undefined);
        setError(reason instanceof Error ? reason.message : 'The worktrees could not be read.');
      })
      .finally(() => {
        if (mounted.current && readGeneration.current === requestGeneration) setLoading(false);
      });
  }, [read, repositoryId]);

  useEffect(() => {
    generation.current += 1;
    readGeneration.current += 1;
    inFlight.current = false;
    setBusy(false);
    setContext(undefined);
  }, [repositoryId]);

  useEffect(reload, [refreshSignal, reload]);

  const apply = useCallback(
    async (action: RepositoryWorktreeAction, snapshot?: string): Promise<RepositoryWorktreeActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) throw new Error('Open this application in Electron to manage worktrees.');
      const current = context;
      if (!current) throw new Error('The worktrees could not be read.');
      if (current.repositoryId !== repositoryId || inFlight.current)
        throw new Error('Another action is running or the repository changed.');
      inFlight.current = true;
      readGeneration.current += 1;
      setLoading(false);
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
        if (mounted.current && generation.current === requestGeneration) {
          inFlight.current = false;
          setBusy(false);
          reload();
        }
      }
    },
    [context, read, reload, repositoryId],
  );

  return { context, loading, busy, error, reload, apply };
}
