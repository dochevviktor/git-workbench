import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryNetworkRequest,
  RepositoryMergeRebaseAction,
  RepositoryOperation,
  RepositoryStashAction,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { mergeOperation } from '../lib/operations';

export type RepositoryOperations = ReturnType<typeof useOperations>;

/**
 * Follows the long-running Git operations of this window. Starting one returns as soon as the backend
 * accepts it; everything after that arrives as an event, so a slow fetch never blocks the request that
 * began it and its outcome survives a view change.
 */
export function useOperations() {
  const [operations, setOperations] = useState<RepositoryOperation[]>([]);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const api = window.desktop;
    if (!api) return;
    // Subscribing before the first read means an event cannot be missed between the two.
    const unsubscribe = api.repository.onOperationChanged((operation) => {
      if (mounted.current) setOperations((current) => mergeOperation(current, operation));
    });
    void api.repository
      .listOperations()
      .then((result) => {
        if (!mounted.current) return;
        const known = unwrapResult(result);
        setOperations((current) => known.reduce(mergeOperation, current));
      })
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  const start = useCallback(
    async (repositoryId: string, request: RepositoryNetworkRequest): Promise<RepositoryOperation> => {
      const api = window.desktop;
      if (!api) throw new Error('Open this application in Electron to reach a remote.');
      const accepted = unwrapResult(
        await api.repository.startNetworkOperation({ id: repositoryId, request }),
      );
      if (mounted.current) setOperations((current) => mergeOperation(current, accepted));
      return accepted;
    },
    [],
  );

  const startStash = useCallback(
    async (repositoryId: string, request: RepositoryStashAction): Promise<RepositoryOperation> => {
      const api = window.desktop;
      if (!api) throw new Error('Open this application in Electron to manage saved stashes.');
      const accepted = unwrapResult(await api.repository.startStashOperation({ id: repositoryId, request }));
      if (mounted.current) setOperations((current) => mergeOperation(current, accepted));
      return accepted;
    },
    [],
  );

  const startMergeRebase = useCallback(
    async (repositoryId: string, action: RepositoryMergeRebaseAction): Promise<RepositoryOperation> => {
      const api = window.desktop;
      if (!api) throw new Error('Open this application in Electron to merge or rebase.');
      const accepted = unwrapResult(await api.repository.startMergeRebase({ id: repositoryId, action }));
      if (mounted.current) setOperations((current) => mergeOperation(current, accepted));
      return accepted;
    },
    [],
  );

  const cancel = useCallback((operationId: string) => {
    const api = window.desktop;
    if (!api) return;
    void api.repository
      .cancelOperation({ operationId })
      .then((result) => {
        const operation = unwrapResult(result);
        if (operation && mounted.current) setOperations((current) => mergeOperation(current, operation));
      })
      .catch((reason: unknown) => {
        if (mounted.current) {
          setError(reason instanceof Error ? reason.message : 'The operation could not be cancelled.');
        }
      });
  }, []);

  const clearError = useCallback(() => setError(undefined), []);

  return { operations, error, start, startStash, startMergeRebase, cancel, clearError };
}

export function runningOperation(
  operations: readonly RepositoryOperation[],
  repositoryId: string | undefined,
): RepositoryOperation | undefined {
  if (!repositoryId) return undefined;
  return operations.find(
    (operation) => operation.repositoryId === repositoryId && operation.status === 'running',
  );
}
