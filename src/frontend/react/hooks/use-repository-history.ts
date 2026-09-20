import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryHistoryCommit,
  RepositoryHistoryFilter,
  RepositoryHistoryReference,
  RepositoryHistoryTracking,
  RepositoryHistoryPage,
  RepositoryHistoryAnchor,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

const historyPageSize = 100;
const allHistoryFilter = { kind: 'all' } as const satisfies RepositoryHistoryFilter;

/**
 * A request to show a commit outside the loaded window. The backend locates a bounded page containing
 * the target (`ready`), or reports a missing target/read limit (`unavailable`); the view then selects it.
 */
export interface HistoryRevealRequest {
  readonly token: number;
  readonly commitId: string;
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly pages: number;
  readonly target?: 'commit' | 'end';
}

function historyFilterKey(filter: RepositoryHistoryFilter): string {
  return filter.kind === 'all'
    ? 'all'
    : filter.kind === 'reference'
      ? `reference:${filter.target}`
      : `commit-search:${filter.field ?? 'message'}:${filter.scope ?? 'repository'}:${filter.query}`;
}

interface HistorySession {
  readonly page: RepositoryHistoryPage;
  readonly filter: RepositoryHistoryFilter;
  readonly selectedCommitId: string | undefined;
}

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The repository history could not be loaded.';
}

export type RepositoryHistory = ReturnType<typeof useRepositoryHistory>;
export type HistoryFilter = RepositoryHistoryFilter;

export function useRepositoryHistory(repositoryId: string | undefined) {
  const [stateRepositoryId, setStateRepositoryId] = useState<string>();
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
  const [windowOffset, setWindowOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [ownedFilter, setOwnedFilter] = useState<{
    readonly repositoryId: string | undefined;
    readonly filter: RepositoryHistoryFilter;
  }>({ repositoryId: undefined, filter: allHistoryFilter });
  const [reveal, setReveal] = useState<HistoryRevealRequest>();
  const sessions = useRef(new Map<string, HistorySession>());
  const revealToken = useRef(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const filter =
    ownedFilter.repositoryId === repositoryId
      ? ownedFilter.filter
      : ((repositoryId ? sessions.current.get(repositoryId)?.filter : undefined) ?? allHistoryFilter);
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
      anchor?: RepositoryHistoryAnchor,
      selectFirst = false,
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
          await api.repository.getHistory({
            id,
            offset,
            limit: historyPageSize,
            filter: requestFilter,
            ...(anchor ? { anchor } : {}),
          }),
        );
        if (!mounted.current || generation.current !== requestGeneration) return;
        setStateRepositoryId(id);
        const previous = sessions.current.get(id);
        const current = previous?.page.commits ?? [];
        const known = new Set(current.map((commit) => commit.id));
        const prepend = !replace && previous !== undefined && page.offset < previous.page.offset;
        const added = page.commits.filter((commit) => !known.has(commit.id));
        const combined = replace ? page.commits : prepend ? [...added, ...current] : [...current, ...added];
        const oldSelection = previous?.selectedCommitId;
        const selected =
          anchor?.kind === 'commit'
            ? anchor.commitId
            : anchor?.kind === 'oldest'
              ? combined.at(-1)?.id
              : selectFirst
                ? combined[0]?.id
                : oldSelection && combined.some((commit) => commit.id === oldSelection)
                  ? oldSelection
                  : (combined.find((commit) => commit.id === page.head.commit)?.id ?? combined[0]?.id);
        const mergedPage = {
          ...page,
          offset: replace || prepend ? page.offset : (previous?.page.offset ?? page.offset),
          commits: combined,
          hasMore: prepend ? previous.page.hasMore : page.hasMore,
          nextOffset: prepend ? previous.page.nextOffset : page.nextOffset,
        };
        sessions.current.set(id, { page: mergedPage, filter: requestFilter, selectedCommitId: selected });
        setCommits(combined);
        setWindowOffset(mergedPage.offset);
        setReferences(page.references);
        setTracking(page.tracking);
        setHeadCommit(page.head.commit);
        setSelectedCommitId(selected);
        if (
          replace &&
          !anchor &&
          oldSelection &&
          oldSelection !== selected &&
          previous &&
          historyFilterKey(previous.filter) === historyFilterKey(requestFilter)
        ) {
          revealToken.current += 1;
          setReveal({ token: revealToken.current, commitId: oldSelection, status: 'loading', pages: 0 });
        }
        setHasMore(mergedPage.hasMore);
        setNextOffset(mergedPage.nextOffset);
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
    setWindowOffset(0);
    setHasMore(false);
    setError(undefined);
    setReveal(undefined);
    if (!repositoryId) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    const cached = sessions.current.get(repositoryId);
    if (cached && historyFilterKey(cached.filter) === historyFilterKey(filter)) {
      setStateRepositoryId(repositoryId);
      setCommits(cached.page.commits);
      setReferences(cached.page.references);
      setTracking(cached.page.tracking);
      setHeadCommit(cached.page.head.commit);
      setSelectedCommitId(cached.selectedCommitId);
      setNextOffset(cached.page.nextOffset);
      setWindowOffset(cached.page.offset);
      setHasMore(cached.page.hasMore);
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

  const loadPrevious = useCallback(() => {
    if (!repositoryId || loading || loadingMore || windowOffset === 0) return;
    void requestPage(
      repositoryId,
      Math.max(0, windowOffset - historyPageSize),
      false,
      generation.current,
      filter,
    );
  }, [filter, loading, loadingMore, repositoryId, requestPage, windowOffset]);

  const requestHome = useCallback(() => {
    if (!repositoryId) return;
    generation.current += 1;
    setError(undefined);
    setLoadingMore(false);
    const cached = sessions.current.get(repositoryId);
    if (cached) sessions.current.set(repositoryId, { ...cached, selectedCommitId: undefined });
    setReveal(undefined);
    void requestPage(repositoryId, 0, true, generation.current, filter, undefined, true);
  }, [filter, repositoryId, requestPage]);

  const selectCommit = useCallback(
    (id: string) => {
      if (commits.some((commit) => commit.id === id)) {
        if (reveal?.status === 'loading') {
          generation.current += 1;
          setLoading(false);
          setLoadingMore(false);
        }
        setReveal(undefined);
        setSelectedCommitId(id);
        const cached = repositoryId ? sessions.current.get(repositoryId) : undefined;
        if (cached && repositoryId) sessions.current.set(repositoryId, { ...cached, selectedCommitId: id });
      }
    },
    [commits, repositoryId, reveal],
  );

  const requestReveal = useCallback((commitId: string) => {
    generation.current += 1;
    setLoading(false);
    setLoadingMore(false);
    setError(undefined);
    revealToken.current += 1;
    setReveal({ token: revealToken.current, commitId, status: 'loading', pages: 0 });
  }, []);

  const requestEnd = useCallback(() => {
    generation.current += 1;
    setLoading(false);
    setLoadingMore(false);
    setError(undefined);
    revealToken.current += 1;
    setReveal({ token: revealToken.current, commitId: '', status: 'loading', pages: 0, target: 'end' });
  }, []);

  const finishReveal = useCallback(
    (token: number) => {
      if (reveal?.token !== token) return;
      if (reveal.status === 'loading') {
        generation.current += 1;
        setLoading(false);
        setLoadingMore(false);
      }
      setReveal(undefined);
    },
    [reveal],
  );

  useEffect(() => {
    if (!reveal || reveal.status !== 'loading' || !repositoryId) return;
    if (error) {
      setReveal({ ...reveal, status: 'unavailable' });
      return;
    }
    if (reveal.target === 'end' && reveal.pages > 0 && !loading && !loadingMore) {
      const last = commits.at(-1);
      setReveal({ ...reveal, commitId: last?.id ?? '', status: last ? 'ready' : 'unavailable' });
      return;
    }
    if (commits.some((commit) => commit.id === reveal.commitId)) {
      setReveal({ ...reveal, status: 'ready' });
      return;
    }
    if (loading || loadingMore) return;
    if (reveal.pages > 0) {
      setReveal({ ...reveal, status: 'unavailable' });
      return;
    }
    setReveal({ ...reveal, pages: reveal.pages + 1 });
    void requestPage(
      repositoryId,
      0,
      true,
      generation.current,
      filter,
      reveal.target === 'end' ? { kind: 'oldest' } : { kind: 'commit', commitId: reveal.commitId },
    );
  }, [commits, error, filter, hasMore, loading, loadingMore, nextOffset, repositoryId, requestPage, reveal]);

  const currentRepository = stateRepositoryId === repositoryId;
  return {
    repositoryId,
    filter,
    filterKey,
    commits: currentRepository ? commits : [],
    references: currentRepository ? references : [],
    tracking,
    headCommit,
    selectedCommit: currentRepository ? commits.find((commit) => commit.id === selectedCommitId) : undefined,
    selectedCommitId: currentRepository ? selectedCommitId : undefined,
    loading,
    loadingMore,
    hasMore,
    windowOffset,
    error,
    setFilter,
    clearFilter,
    refresh,
    loadMore,
    loadPrevious,
    requestHome,
    selectCommit,
    reveal,
    requestReveal,
    requestEnd,
    finishReveal,
  };
}
