import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryReferenceAction,
  RepositoryReferenceActionResult,
  RepositoryReferenceContext,
  RepositoryRemote,
  RepositoryRemoteAction,
  RepositoryRemoteActionResult,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';

export type RepositoryReferences = ReturnType<typeof useReferences>;

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The branches and tags could not be read.';
}

/**
 * Reads the branches, tags, and remotes of the active repository, and runs one reference action at a
 * time. Actions retain the snapshot the user reviewed. Mutation completions have the same generation
 * guards as reads, so a late result cannot replace another repository's state.
 */
export function useReferences(repositoryId: string | undefined, refreshSignal = 0) {
  const [context, setContext] = useState<RepositoryReferenceContext>();
  const [remotes, setRemotes] = useState<RepositoryRemote[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const operationGeneration = useRef(0);
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

  const readRemotes = useCallback(async (id: string): Promise<RepositoryRemote[]> => {
    const api = window.desktop;
    if (!api) return [];
    return unwrapResult(await api.repository.listRemotes({ id }));
  }, []);

  const reload = useCallback(() => {
    if (!repositoryId) {
      setContext(undefined);
      setRemotes([]);
      return;
    }
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setLoading(true);
    void Promise.all([read(repositoryId), readRemotes(repositoryId).catch(() => [])])
      .then(([next, knownRemotes]) => {
        if (!mounted.current || generation.current !== requestGeneration) return;
        setContext(next);
        setRemotes(knownRemotes);
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
  }, [read, readRemotes, repositoryId]);

  useEffect(() => {
    generation.current += 1;
    operationGeneration.current += 1;
    setBusy(false);
    setContext(undefined);
    setRemotes([]);
    setError(undefined);
  }, [repositoryId]);

  useEffect(() => {
    // Keep the last complete snapshot while refreshing this repository. Menus capture their
    // entries when opened; clearing it here could freeze a loading-only menu indefinitely.
    reload();
  }, [refreshSignal, reload]);

  const apply = useCallback(
    async (
      action: RepositoryReferenceAction,
      snapshot?: string,
    ): Promise<RepositoryReferenceActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) {
        throw new Error('Open this application in Electron to change branches and tags.');
      }
      setBusy(true);
      const requestGeneration = generation.current;
      const actionGeneration = operationGeneration.current;
      try {
        const current = context;
        if (!current) throw new Error('The branches and tags could not be read.');
        const accepted = unwrapResult(
          await api.repository.applyReferenceAction({
            id: repositoryId,
            action,
            snapshot: snapshot ?? current.snapshot,
          }),
        );
        const operation = await waitForOperation(api, accepted);
        if (operation.result?.kind !== 'reference') throw new Error(operation.message);
        const result = operation.result.value;
        const refreshed = await read(repositoryId).catch(() => undefined);
        if (mounted.current && generation.current === requestGeneration && refreshed) setContext(refreshed);
        return result;
      } finally {
        if (mounted.current && operationGeneration.current === actionGeneration) setBusy(false);
      }
    },
    [context, read, repositoryId],
  );

  const applyRemote = useCallback(
    async (action: RepositoryRemoteAction): Promise<RepositoryRemoteActionResult> => {
      const api = window.desktop;
      if (!repositoryId || !api) throw new Error('Open this application in Electron to change remotes.');
      setBusy(true);
      const requestGeneration = generation.current;
      const actionGeneration = operationGeneration.current;
      try {
        const result = unwrapResult(await api.repository.applyRemoteAction({ id: repositoryId, action }));
        if (mounted.current && generation.current === requestGeneration) setRemotes(result.remotes);
        // A removed remote also removes its remote-tracking branches, so the references are reread.
        const refreshed = await read(repositoryId).catch(() => undefined);
        if (mounted.current && generation.current === requestGeneration && refreshed) setContext(refreshed);
        return result;
      } finally {
        if (mounted.current && operationGeneration.current === actionGeneration) setBusy(false);
      }
    },
    [read, repositoryId],
  );

  return { context, remotes, loading, busy, error, reload, apply, applyRemote };
}
