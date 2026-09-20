import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryGitFlowAction,
  RepositoryGitFlowActionResult,
  RepositoryGitFlowContext,
  RepositoryOperation,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';

/** Reads Git-flow state and follows one serialized initialize/start/finish operation. */
export function useGitFlow(repositoryId: string | undefined, refreshSignal = 0) {
  const [context, setContext] = useState<RepositoryGitFlowContext>();
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

  const read = useCallback(async (id: string): Promise<RepositoryGitFlowContext | undefined> => {
    const api = window.desktop;
    if (!api) return undefined;
    return unwrapResult(await api.repository.getGitFlow({ id }));
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
        setError(reason instanceof Error ? reason.message : 'The Git-flow state could not be read.');
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
    async (action: RepositoryGitFlowAction, snapshot?: string): Promise<RepositoryGitFlowActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) throw new Error('Open this application in Electron to use Git-flow.');
      const current = context;
      if (!current) throw new Error('The Git-flow state could not be read.');
      setBusy(true);
      const requestGeneration = generation.current;
      try {
        const accepted = unwrapResult(
          await api.repository.startGitFlowOperation({
            id: repositoryId,
            action: { ...action, snapshot: snapshot ?? action.snapshot ?? current.snapshot },
          }),
        );
        const operation: RepositoryOperation = await waitForOperation(api, accepted);
        if (operation.result?.kind !== 'git-flow') throw new Error(operation.message);
        const result = operation.result.value;
        if (mounted.current && generation.current === requestGeneration) {
          setContext(result.context);
          setError(undefined);
        }
        return result;
      } finally {
        if (mounted.current && generation.current === requestGeneration) setBusy(false);
      }
    },
    [context, repositoryId],
  );

  return { context, loading, busy, error, reload, apply };
}
