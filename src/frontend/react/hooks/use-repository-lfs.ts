import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryLfsFile, RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** Loads one historical LFS descriptor and keeps Save As operation progress tied to that file. */
export function useRepositoryLfs(
  repositoryId: string | undefined,
  commitId: string | undefined,
  path: string | undefined,
) {
  const key = `${repositoryId ?? ''}:${commitId ?? ''}:${path ?? ''}`;
  const [owner, setOwner] = useState(key);
  const [lfs, setLfs] = useState<RepositoryLfsFile>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saveOperation, setSaveOperation] = useState<RepositoryOperation>();
  const generation = useRef(0);
  const operationEvents = useRef(new Map<string, RepositoryOperation>());

  useEffect(() => {
    setOwner(key);
    generation.current += 1;
    setLfs(undefined);
    setLoading(false);
    setError(undefined);
    setSaveError(undefined);
    setSaveOperation(undefined);
    return () => {
      generation.current += 1;
    };
  }, [key]);

  useEffect(() => {
    const api = window.desktop;
    if (!api) return;
    return api.repository.onOperationChanged((operation) => {
      operationEvents.current.set(operation.id, operation);
      setSaveOperation((current) => (current?.id === operation.id ? operation : current));
    });
  }, []);

  useEffect(() => {
    if (!repositoryId || !commitId || !path) return;
    const requestGeneration = generation.current;
    setLoading(true);
    setError(undefined);
    void window.desktop?.repository
      .getLfsFile({ id: repositoryId, commitId, path })
      .then(unwrapResult)
      .then((value) => {
        if (requestGeneration !== generation.current) return;
        setLfs(value);
      })
      .catch((reason: unknown) => {
        if (requestGeneration === generation.current)
          setError(errorMessage(reason, 'The LFS file could not be inspected.'));
      })
      .finally(() => {
        if (requestGeneration === generation.current) setLoading(false);
      });
  }, [commitId, path, repositoryId]);

  const saveAs = useCallback(async () => {
    if (!repositoryId || !commitId || !path) return;
    const api = window.desktop;
    if (!api) throw new Error('Open this application in Electron to save an LFS payload.');
    setSaveError(undefined);
    try {
      const accepted = unwrapResult(
        await api.repository.saveLfsPayload({ id: repositoryId, commitId, path }),
      );
      if (accepted) setSaveOperation(operationEvents.current.get(accepted.id) ?? accepted);
    } catch (reason: unknown) {
      setSaveError(errorMessage(reason, 'The LFS payload could not be saved.'));
    }
  }, [commitId, path, repositoryId]);

  return {
    lfs: owner === key ? lfs : undefined,
    loading,
    error,
    saveError,
    saveAs,
    saveOperation: owner === key ? saveOperation : undefined,
  };
}
