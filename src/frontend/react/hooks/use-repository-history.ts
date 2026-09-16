import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryHistoryCommit,
  RepositoryHistoryReference,
  RepositoryHistoryTracking,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

const historyPageSize = 50;

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The repository history could not be loaded.';
}

export type RepositoryHistory = ReturnType<typeof useRepositoryHistory>;

export function useRepositoryHistory(repositoryId: string | undefined) {
  const [commits, setCommits] = useState<RepositoryHistoryCommit[]>([]);
  const [references, setReferences] = useState<RepositoryHistoryReference[]>([]);
  const [tracking, setTracking] = useState<RepositoryHistoryTracking>({
    upstream: null,
    ahead: null,
    behind: null,
  });
  const [headCommit, setHeadCommit] = useState<string | null>(null);
  const [selectedCommitId, setSelectedCommitId] = useState<string>();
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const requestPage = useCallback(
    async (id: string, offset: number, replace: boolean, requestGeneration: number) => {
      const api = window.desktop;
      if (!api) {
        if (mounted.current && generation.current === requestGeneration) {
          setError('Open this application in Electron to inspect repository history.');
          setLoading(false);
          setLoadingMore(false);
        }
        return;
      }
      if (replace) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = unwrapResult(await api.repository.getHistory({ id, offset, limit: historyPageSize }));
        if (!mounted.current || generation.current !== requestGeneration) return;
        setCommits((current) => {
          if (replace) return page.commits;
          const known = new Set(current.map((commit) => commit.id));
          return [...current, ...page.commits.filter((commit) => !known.has(commit.id))];
        });
        setReferences(page.references);
        setTracking(page.tracking);
        setHeadCommit(page.head.commit);
        setSelectedCommitId((current) => {
          if (!replace && current) return current;
          if (current && page.commits.some((commit) => commit.id === current)) return current;
          return page.commits[0]?.id;
        });
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
        setError(undefined);
      } catch (reason: unknown) {
        if (mounted.current && generation.current === requestGeneration) setError(actionError(reason));
      } finally {
        if (mounted.current && generation.current === requestGeneration) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setCommits([]);
    setReferences([]);
    setTracking({ upstream: null, ahead: null, behind: null });
    setHeadCommit(null);
    setSelectedCommitId(undefined);
    setNextOffset(null);
    setHasMore(false);
    setError(undefined);
    if (!repositoryId) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    void requestPage(repositoryId, 0, true, requestGeneration);
  }, [repositoryId, requestPage]);

  const refresh = useCallback(() => {
    if (!repositoryId) return;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setError(undefined);
    void requestPage(repositoryId, 0, true, requestGeneration);
  }, [repositoryId, requestPage]);

  const loadMore = useCallback(() => {
    if (!repositoryId || loading || loadingMore || !hasMore || nextOffset === null) return;
    void requestPage(repositoryId, nextOffset, false, generation.current);
  }, [hasMore, loading, loadingMore, nextOffset, repositoryId, requestPage]);

  const selectCommit = useCallback(
    (id: string) => {
      if (commits.some((commit) => commit.id === id)) setSelectedCommitId(id);
    },
    [commits],
  );

  return {
    commits,
    references,
    tracking,
    headCommit,
    selectedCommit: commits.find((commit) => commit.id === selectedCommitId),
    selectedCommitId,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    selectCommit,
  };
}
