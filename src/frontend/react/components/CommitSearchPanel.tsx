import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { commitSearchQueryLimit, useCommitSearch } from '../hooks/use-commit-search';
import type { CommitSearchField } from '../hooks/use-commit-search';
import type { HistoryRevealRequest } from '../hooks/use-repository-history';
import { avatarColor, formatShortDate, initials } from '../lib/format';
import { ChevronDownIcon, CloseIcon, SearchIcon } from './Icons';
import { MenuButton } from './menu/MenuButton';
import { menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';
import { SearchMatch } from './SearchMatch';
import { useVirtualRows } from '../hooks/use-virtual-rows';

interface CommitSearchPanelProps {
  readonly repositoryId: string;
  readonly reveal: HistoryRevealRequest | undefined;
  /** True while the commit list shows a filtered history that may not contain every result. */
  readonly historyFiltered: boolean;
  readonly onRevealCommit: (commitId: string) => void;
  readonly onMatchesChanged?: ((matches: readonly string[], query: string) => void) | undefined;
}

const searchFields: readonly { readonly field: CommitSearchField; readonly label: string }[] = [
  { field: 'message', label: 'Commit Message' },
  { field: 'author', label: 'Author' },
  { field: 'path', label: 'Path' },
  { field: 'content', label: 'Diff Content' },
  { field: 'hash', label: 'Commit SHA' },
];

function resultId(commitId: string): string {
  return `commit-search-result-${commitId}`;
}

/**
 * Fork keeps commit search in the sidebar: the query and its scope sit above a result list, and choosing a
 * result selects that commit in the unfiltered commit list.
 */
export function CommitSearchPanel({
  repositoryId,
  reveal,
  historyFiltered,
  onRevealCommit,
  onMatchesChanged,
}: CommitSearchPanelProps) {
  const search = useCommitSearch(repositoryId);
  const { results, hasMore, loading, loadMore } = search;
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string>();
  const activeIndex = results.findIndex((commit) => commit.id === activeId);
  const rows = useVirtualRows(results.length, activeIndex, 22);
  const listRef = rows.root;
  const scopeItems: readonly MenuEntry[] = [
    ...searchFields.map(({ field, label }) => ({
      id: `scope-${field}`,
      label,
      checkable: 'radio' as const,
      checked: search.field === field,
      run: () => search.setField(field),
    })),
    menuSeparator,
    {
      id: 'search-repository',
      label: 'Repository',
      checkable: 'radio',
      checked: search.scope === 'repository',
      run: () => search.setScope('repository'),
    },
    {
      id: 'search-current-branch',
      label: 'Current Branch',
      checkable: 'radio',
      checked: search.scope === 'current-branch',
      run: () => search.setScope('current-branch'),
    },
  ];

  useEffect(() => {
    onMatchesChanged?.(
      results.map((commit) => commit.id),
      search.field === 'message' ? search.query : '',
    );
  }, [onMatchesChanged, results, search.field, search.query]);

  useEffect(() => () => onMatchesChanged?.([], ''), [onMatchesChanged, repositoryId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, listRef]);

  const choose = (commitId: string) => {
    setActiveId(commitId);
    onRevealCommit(commitId);
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let index: number;
    switch (event.key) {
      case 'ArrowDown':
        index = activeIndex + 1;
        break;
      case 'ArrowUp':
        index = activeIndex - 1;
        break;
      case 'Home':
        index = 0;
        break;
      case 'End':
        index = results.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const commit = results[Math.max(0, Math.min(results.length - 1, index))];
    if (!commit) return;
    choose(commit.id);
    rows.reveal(results.indexOf(commit));
    window.requestAnimationFrame(() =>
      document.getElementById(resultId(commit.id))?.scrollIntoView({ block: 'nearest' }),
    );
  };

  const status = !search.query
    ? null
    : search.cancelled
      ? 'Search cancelled'
      : loading && results.length === 0
        ? 'Searching…'
        : `${results.length}${hasMore ? '+' : ''} ${results.length === 1 && !hasMore ? 'result' : 'results'}`;
  const unavailable = reveal?.status === 'unavailable' && reveal.commitId === activeId;

  return (
    <section className="commit-search" aria-labelledby="commit-search-title">
      <h2 id="commit-search-title" className="commit-search-title">
        Search Commits
      </h2>
      <label className="sidebar-filter commit-search-field">
        <SearchIcon size={13} />
        <input
          ref={inputRef}
          type="search"
          value={search.text}
          maxLength={commitSearchQueryLimit}
          placeholder="Search"
          aria-label="Search commits"
          spellCheck={false}
          onChange={(event) => search.setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              search.submit();
            } else if (event.key === 'Escape' && search.text) {
              event.preventDefault();
              search.setText('');
            } else if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault();
              listRef.current?.focus();
              if (activeIndex < 0 && results[0]) choose(results[0].id);
            }
          }}
        />
        {search.text && (
          <button
            type="button"
            className="icon-button commit-search-clear"
            aria-label="Clear commit search"
            title="Clear commit search"
            onClick={() => {
              search.setText('');
              inputRef.current?.focus();
            }}
          >
            <CloseIcon size={10} />
          </button>
        )}
      </label>
      <div className="commit-search-scope">
        <MenuButton className="commit-search-scope-button" items={scopeItems} menuLabel="Search in">
          {searchFields.find(({ field }) => field === search.field)?.label}
          <ChevronDownIcon size={9} />
        </MenuButton>
        {search.recent.length > 0 && (
          <MenuButton
            className="icon-button"
            aria-label="Recent searches"
            title="Recent searches"
            menuLabel="Recent searches"
            items={[
              ...search.recent.map((entry, index) => ({
                id: `recent-${index}`,
                label: `${entry.query} · ${searchFields.find((item) => item.field === entry.field)?.label}${entry.scope === 'current-branch' ? ' · Current Branch' : ''}`,
                run: () => search.useRecent(entry),
              })),
              menuSeparator,
              { id: 'clear-recent-searches', label: 'Clear Recent Searches', run: search.clearRecent },
            ]}
          >
            <ChevronDownIcon size={9} />
          </MenuButton>
        )}
        <span className="commit-search-count" role="status" aria-live="polite">
          {status}
        </span>
        {loading && (
          <button
            type="button"
            className="pane-icon-button"
            aria-label="Cancel search"
            onClick={search.cancel}
          >
            <CloseIcon size={10} />
          </button>
        )}
      </div>
      {search.field === 'hash' && (
        <p className="commit-search-scope-detail">Full SHA or prefix (at least 4 characters)</p>
      )}
      {(search.scope === 'current-branch' || search.field === 'content') && (
        <p className="commit-search-scope-detail">
          {search.scope === 'current-branch' ? 'Current Branch' : 'Repository'}
          {search.field === 'content' ? ' · Case-sensitive changed text' : ''}
        </p>
      )}
      {search.error && (
        <div className="inline-alert commit-search-alert" role="alert">
          <span>{search.error}</span>
          <button type="button" className="button button-small" onClick={search.retry}>
            Retry
          </button>
        </div>
      )}
      {search.cancelled && (
        <button type="button" className="button button-small" onClick={search.retry}>
          Search again
        </button>
      )}
      {unavailable && (
        <p className="commit-search-note" role="status">
          {historyFiltered
            ? 'This commit is outside the filtered history. Clear the filter to show it.'
            : 'This commit could not be located. Check the history error or refresh the repository.'}
        </p>
      )}
      <div
        ref={listRef}
        onScroll={rows.update}
        className="commit-search-results"
        role="listbox"
        aria-label="Commit search results"
        tabIndex={0}
        aria-activedescendant={activeIndex >= 0 && activeId ? resultId(activeId) : undefined}
        onKeyDown={onListKeyDown}
      >
        <div
          className={rows.virtual ? 'virtual-tree-rows' : undefined}
          style={rows.virtual ? { height: results.length * 22 } : undefined}
          role="presentation"
        >
          {rows.indices.map((index) => {
            const commit = results[index]!;
            return (
              <div
                key={commit.id}
                id={resultId(commit.id)}
                role="option"
                aria-posinset={index + 1}
                aria-setsize={results.length}
                style={
                  rows.virtual ? { position: 'absolute', top: index * 22, left: 0, right: 0 } : undefined
                }
                aria-selected={commit.id === activeId}
                className={commit.id === activeId ? 'commit-search-result active' : 'commit-search-result'}
                data-testid="commit-search-result"
                title={commit.subject}
                onMouseDown={(event) => {
                  if (event.button === 0) choose(commit.id);
                }}
              >
                <span
                  className={`avatar avatar-${avatarColor(commit.author.email || commit.author.name)}`}
                  aria-hidden="true"
                >
                  {initials(commit.author.name, commit.author.email)}
                </span>
                <span className="commit-search-subject">
                  <SearchMatch
                    text={commit.subject || '(no subject)'}
                    query={search.field === 'message' ? search.query : ''}
                  />
                </span>
                <time className="commit-search-date" dateTime={commit.author.date}>
                  {formatShortDate(commit.author.date)}
                </time>
              </div>
            );
          })}
        </div>
        {search.query &&
          !loading &&
          !search.cancelled &&
          !search.pending &&
          !search.error &&
          results.length === 0 && <p className="commit-search-empty">No commits match “{search.query}”.</p>}
        <div ref={sentinelRef} className="commit-search-sentinel" />
      </div>
    </section>
  );
}
