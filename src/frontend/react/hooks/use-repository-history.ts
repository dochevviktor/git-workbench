import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryHistoryCommit,
  RepositoryHistoryFilter,
  RepositoryHistoryReference,
  RepositoryHistoryTracking,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

const historyPageSize = 50;
/** Revealing a commit loads at most this many further pages before giving up. */
const maximumRevealPages = 40;
const allHistoryFilter = { kind: 'all' } as const satisfies RepositoryHistoryFilter;

/**
 * A request to show a commit that may not be loaded yet. The hook loads pages until the commit arrives
 * (`ready`) or the history ends or the page limit is reached (`unavailable`); the view then selects it.
 */
export interface HistoryRevealRequest {
  readonly token: number;
  readonly commitId: string;
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly pages: number;
}

function historyFilterKey(filter: RepositoryHistoryFilter): string {
  return filter.kind === 'all'
    ? 'all'
    : filter.kind === 'reference'
      ? `reference:${filter.target}`
      : `commit-search:${filter.query}`;
}

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The repository history could not be loaded.';
}

export type RepositoryHistory = ReturnType<typeof useRepositoryHistory>;
export type HistoryFilter = RepositoryHistoryFilter;

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
  const [ownedFilter, setOwnedFilter] = useState<{
    readonly repositoryId: string | undefined;
    readonly filter: RepositoryHistoryFilter;
  }>({ repositoryId: undefined, filter: allHistoryFilter });
  const [reveal, setReveal] = useState<HistoryRevealRequest>();
  const revealToken = useRef(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const filter = ownedFilter.repositoryId === repositoryId ? ownedFilter.filter : allHistoryFilter;
  const filterKey = historyFilterKey(filter);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const requestPage = useCallback(
    async (
      id: string,
      offset: number,
      replace: boolean,
      requestGeneration: number,
      requestFilter: RepositoryHistoryFilter,
    ) => {
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
        const page = unwrapResult(
          await api.repository.getHistory({ id, offset, limit: historyPageSize, filter: requestFilter }),
        );
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
    setReveal(undefined);
    if (!repositoryId) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    void requestPage(repositoryId, 0, true, requestGeneration, filter);
  }, [filter, repositoryId, requestPage]);

  const setFilter = useCallback(
    (next: RepositoryHistoryFilter) => {
      setOwnedFilter({ repositoryId, filter: next });
    },
    [repositoryId],
  );

  const clearFilter = useCallback(() => {
    setFilter(allHistoryFilter);
  }, [setFilter]);

  const refresh = useCallback(() => {
    if (!repositoryId) return;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setError(undefined);
    void requestPage(repositoryId, 0, true, requestGeneration, filter);
  }, [filter, repositoryId, requestPage]);

  const loadMore = useCallback(() => {
    if (!repositoryId || loading || loadingMore || !hasMore || nextOffset === null) return;
    void requestPage(repositoryId, nextOffset, false, generation.current, filter);
  }, [filter, hasMore, loading, loadingMore, nextOffset, repositoryId, requestPage]);

  const selectCommit = useCallback(
    (id: string) => {
      if (commits.some((commit) => commit.id === id)) setSelectedCommitId(id);
    },
    [commits],
  );

  const requestReveal = useCallback((commitId: string) => {
    revealToken.current += 1;
    setReveal({ token: revealToken.current, commitId, status: 'loading', pages: 0 });
  }, []);

  const finishReveal = useCallback((token: number) => {
    setReveal((current) => (current?.token === token ? undefined : current));
  }, []);

  useEffect(() => {
    if (!reveal || reveal.status !== 'loading' || !repositoryId) return;
    if (commits.some((commit) => commit.id === reveal.commitId)) {
      setReveal({ ...reveal, status: 'ready' });
      return;
    }
    if (loading || loadingMore) return;
    if (!hasMore || nextOffset === null || reveal.pages >= maximumRevealPages) {
      setReveal({ ...reveal, status: 'unavailable' });
      return;
    }
    setReveal({ ...reveal, pages: reveal.pages + 1 });
    void requestPage(repositoryId, nextOffset, false, generation.current, filter);
  }, [commits, filter, hasMore, loading, loadingMore, nextOffset, repositoryId, requestPage, reveal]);

  return {
    repositoryId,
    filter,
    filterKey,
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
    setFilter,
    clearFilter,
    refresh,
    loadMore,
    selectCommit,
    reveal,
    requestReveal,
    finishReveal,
  };
}
