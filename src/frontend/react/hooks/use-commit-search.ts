import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryHistoryCommit, RepositoryHistoryFilter } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

const searchPageSize = 50;
const searchDelayMs = 220;
export const commitSearchQueryLimit = 256;

export type CommitSearch = ReturnType<typeof useCommitSearch>;
type SearchFilter = Extract<RepositoryHistoryFilter, { kind: 'commit-search' }>;
export type CommitSearchField = NonNullable<SearchFilter['field']>;
export type CommitSearchScope = NonNullable<SearchFilter['scope']>;

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The commit search could not be completed.';
}

/**
 * Runs the backend scoped search for the sidebar search panel. Results are separate from the
 * commit list, which keeps showing its own history; a generation guard drops replies to older queries.
 */
export function useCommitSearch(repositoryId: string | undefined) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [field, setField] = useState<CommitSearchField>('message');
  const [scope, setScope] = useState<CommitSearchScope>('repository');
  const [results, setResults] = useState<RepositoryHistoryCommit[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const normalized = text.trim().slice(0, commitSearchQueryLimit);
    const timer = window.setTimeout(() => setQuery(normalized), normalized ? searchDelayMs : 0);
    return () => window.clearTimeout(timer);
  }, [text]);

  const requestPage = useCallback(
    async (id: string, searchQuery: string, offset: number, requestGeneration: number) => {
      const api = window.desktop;
      if (!api) {
        setError('Open this application in Electron to search commits.');
        return;
      }
      setLoading(true);
      try {
        const page = unwrapResult(
          await api.repository.getHistory({
            id,
            offset,
            limit: searchPageSize,
            filter: { kind: 'commit-search', query: searchQuery, field, scope },
          }),
        );
        if (!mounted.current || generation.current !== requestGeneration) return;
        setResults((current) => {
          if (offset === 0) return page.commits;
          const known = new Set(current.map((commit) => commit.id));
          return [...current, ...page.commits.filter((commit) => !known.has(commit.id))];
        });
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
        setError(undefined);
      } catch (reason: unknown) {
        if (mounted.current && generation.current === requestGeneration) setError(actionError(reason));
      } finally {
        if (mounted.current && generation.current === requestGeneration) setLoading(false);
      }
    },
    [field, scope],
  );

  useEffect(() => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setResults([]);
    setHasMore(false);
    setNextOffset(null);
    setError(undefined);
    setLoading(false);
    if (!repositoryId || !query) return;
    void requestPage(repositoryId, query, 0, requestGeneration);
  }, [query, repositoryId, requestPage]);

  const loadMore = useCallback(() => {
    if (!repositoryId || !query || loading || !hasMore || nextOffset === null) return;
    void requestPage(repositoryId, query, nextOffset, generation.current);
  }, [hasMore, loading, nextOffset, query, repositoryId, requestPage]);

  const retry = useCallback(() => {
    if (!repositoryId || !query) return;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    void requestPage(repositoryId, query, 0, requestGeneration);
  }, [query, repositoryId, requestPage]);

  return {
    text,
    setText,
    field,
    setField,
    scope,
    setScope,
    submit: () => setQuery(text.trim().slice(0, commitSearchQueryLimit)),
    /** The query the current results belong to; empty while no search is active. */
    query,
    pending: text.trim().slice(0, commitSearchQueryLimit) !== query,
    results,
    hasMore,
    loading,
    error,
    loadMore,
    retry,
  };
}
