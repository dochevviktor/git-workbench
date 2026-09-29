import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryOperation,
  RepositorySubmoduleAction,
  RepositorySubmoduleActionResult,
  RepositorySubmoduleContext,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';

/** Reads submodule topology and follows one operation at a time for the owning repository. */
export function useSubmodules(repositoryId: string | undefined, refreshSignal = 0) {
  const [context, setContext] = useState<RepositorySubmoduleContext>();
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

  const read = useCallback(async (id: string): Promise<RepositorySubmoduleContext | undefined> => {
    const api = window.desktop;
    if (!api) return undefined;
    return unwrapResult(await api.repository.getSubmodules({ id }));
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
        setError(reason instanceof Error ? reason.message : 'The submodules could not be read.');
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

  useEffect(() => {
    if (!repositoryId) return;
    const interval = window.setInterval(reload, 5_000);
    return () => window.clearInterval(interval);
  }, [reload, repositoryId]);

  const apply = useCallback(
    async (
      action: RepositorySubmoduleAction,
      snapshot?: string,
    ): Promise<RepositorySubmoduleActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) throw new Error('Open this application in Electron to manage submodules.');
      const current = context;
      if (!current) throw new Error('The submodules could not be read.');
      if (current.repositoryId !== repositoryId || inFlight.current)
        throw new Error('Another action is running or the repository changed.');
      inFlight.current = true;
      readGeneration.current += 1;
      setLoading(false);
      setBusy(true);
      const requestGeneration = generation.current;
      try {
        const accepted = unwrapResult(
          await api.repository.startSubmoduleOperation({
            id: repositoryId,
            action,
            snapshot: snapshot ?? current.snapshot,
          }),
        );
        const operation: RepositoryOperation = await waitForOperation(api, accepted);
        if (operation.result?.kind !== 'submodule') throw new Error(operation.message);
        const result = operation.result.value;
        if (mounted.current && generation.current === requestGeneration) {
          setContext(result.context);
          setError(undefined);
        }
        return result;
      } finally {
        if (mounted.current && generation.current === requestGeneration) {
          inFlight.current = false;
          setBusy(false);
          reload();
        }
      }
    },
    [context, reload, repositoryId],
  );

  return { context, loading, busy, error, reload, apply };
}
