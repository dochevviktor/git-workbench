import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryBisectActionRequest, RepositoryBisectContext } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';

export function useBisect(
  repositoryId: string | undefined,
  refreshSignal: number,
  onChanged: (head: string | null) => void,
) {
  const [context, setContext] = useState<RepositoryBisectContext>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const errorRepository = useRef(repositoryId);
  useEffect(() => {
    const current = ++generation.current;
    setContext(undefined);
    if (errorRepository.current !== repositoryId) {
      setError(undefined);
      errorRepository.current = repositoryId;
    }
    const api = window.desktop;
    if (repositoryId && api) {
      void api.repository.getBisect({ id: repositoryId }).then((result) => {
        if (current !== generation.current) return;
        if (result.ok) setContext(result.value);
        else setError(result.error.message);
      });
    }
    return () => {
      generation.current = current + 1;
    };
  }, [repositoryId, refreshSignal]);
  const apply = useCallback(
    async (action: RepositoryBisectActionRequest['action']) => {
      const api = window.desktop;
      if (!api || !context || context.repositoryId !== repositoryId || busy) return;
      const current = generation.current;
      setBusy(true);
      setError(undefined);
      try {
        const accepted = unwrapResult(
          await api.repository.startBisectOperation({
            id: context.repositoryId,
            action,
            snapshot: context.snapshot,
          }),
        );
        const operation = await waitForOperation(api, accepted);
        if (current !== generation.current) return;
        if (operation.result?.kind === 'bisect') setContext(operation.result.value);
        else setError(operation.message);
        onChanged(operation.result?.kind === 'bisect' ? operation.result.value.head : null);
      } catch (reason) {
        if (current === generation.current)
          setError(reason instanceof Error ? reason.message : 'Bisect failed.');
      } finally {
        setBusy(false);
      }
    },
    [busy, context, onChanged, repositoryId],
  );
  return { context: context?.repositoryId === repositoryId ? context : undefined, error, busy, apply };
}
