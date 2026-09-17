import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { HistoryGraphRow } from '../../../common/history-graph';
import { buildHistoryGraph, findReachableCommits } from '../../../common/history-graph';
import { buildCollapsedHistory, getMergeCommitIds } from '../../../common/history-collapse';
import type { RepositoryHistoryCommit, RepositoryHistoryReference } from '../../../common/ipc/contracts';
import { isNumberBetween, usePersistentState } from '../hooks/use-persistent-state';
import type { RepositoryHistory } from '../hooks/use-repository-history';
import { copyText } from '../lib/clipboard';
import { avatarColor, formatListDate, initials, shortHash } from '../lib/format';
import { graphRowHeight, graphWidth } from '../lib/graph-geometry';
import { referenceChips } from '../lib/references';
import { CommitDetails } from './CommitDetails';
import { CommitGraph } from './CommitGraph';
import { SearchIcon } from './Icons';
import { ReferenceChipList } from './ReferenceChipList';
import { Splitter } from './Splitter';
import { useContextMenu } from './menu/context-menu';
import { compactMenu, contextMenuAnchor, menuSeparator, planned } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

interface HistoryViewProps {
  readonly history: RepositoryHistory;
}

interface CommitRowProps {
  readonly commit: RepositoryHistoryCommit;
  readonly graph: HistoryGraphRow;
  readonly selected: boolean;
  readonly head: boolean;
  readonly dimmed: boolean;
  readonly contextTarget: boolean;
  readonly referencesByName: ReadonlyMap<string, RepositoryHistoryReference>;
  readonly onSelect: (id: string) => void;
  readonly onToggleBranch: () => void;
  readonly onContextMenu: (commit: RepositoryHistoryCommit, event: ReactMouseEvent<HTMLElement>) => void;
}

/** About half of the space below the window chrome, as a first-run default. */
const defaultListHeight = Math.max(240, Math.round((window.innerHeight - 150) * 0.5));

function authorName(commit: RepositoryHistoryCommit): string {
  return commit.author.name || commit.author.email || 'Unknown author';
}

const CommitRow = memo(function CommitRow({
  commit,
  graph,
  selected,
  head,
  dimmed,
  contextTarget,
  referencesByName,
  onSelect,
  onToggleBranch,
  onContextMenu,
}: CommitRowProps) {
  const chips = referenceChips(commit.decorations, referencesByName);
  const author = authorName(commit);
  const date = formatListDate(commit.author.date);
  const classes = ['commit-row'];
  if (selected) classes.push('selected');
  if (head) classes.push('head');
  if (dimmed) classes.push('dimmed');
  if (contextTarget) classes.push('context-target');
  if (graph.collapsed) classes.push('collapsed');

  return (
    <div
      id={`history-commit-${commit.id}`}
      role="option"
      aria-selected={selected}
      aria-label={`${commit.subject || 'Commit without a subject'}, ${author}, ${date}, ${shortHash(commit.id)}${
        graph.merge ? ', merge commit' : ''
      }${graph.collapsed ? ', merged branch collapsed' : ''}${head ? ', HEAD' : ''}`}
      className={classes.join(' ')}
      data-testid="history-commit"
      data-commit-id={commit.id}
      style={{ '--graph-width': `${graphWidth(graph)}px` } as CSSProperties}
      onMouseDown={(event) => {
        if (event.button === 0) {
          onSelect(commit.id);
          event.currentTarget.closest<HTMLElement>('.commit-list')?.focus({ preventScroll: true });
        }
      }}
      onContextMenu={(event) => onContextMenu(commit, event)}
    >
      <div className="commit-cell commit-subject-cell">
        <CommitGraph
          row={graph}
          onSelect={() => onSelect(commit.id)}
          onToggle={graph.merge ? onToggleBranch : undefined}
        />
        {chips.length > 0 && <ReferenceChipList chips={chips} lane={graph.lane} />}
        <span className="commit-subject">{commit.subject || '(no subject)'}</span>
      </div>
      <div
        className="commit-cell commit-author-cell"
        title={`${commit.author.name} <${commit.author.email}>`}
      >
        <span
          className={`avatar avatar-${avatarColor(commit.author.email || commit.author.name)}`}
          aria-hidden="true"
        >
          {initials(commit.author.name, commit.author.email)}
        </span>
        <span className="commit-author-name">{author}</span>
      </div>
      <div className="commit-cell commit-hash-cell">{shortHash(commit.id)}</div>
      <div className="commit-cell commit-date-cell">
        <time dateTime={commit.author.date}>{date}</time>
      </div>
    </div>
  );
});

export function HistoryView({ history }: HistoryViewProps) {
  const showContextMenu = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [contextCommitId, setContextCommitId] = useState<string>();
  const [listHeight, setListHeight] = usePersistentState(
    'history.listHeight',
    defaultListHeight,
    isNumberBetween(96, 4000),
  );
  const {
    commits: loadedCommits,
    references,
    headCommit,
    selectedCommitId,
    filter,
    filterKey,
    setFilter,
    clearFilter,
    selectCommit,
    loadMore,
    hasMore,
    loadingMore,
  } = history;
  const [manualCollapsedMergeIds, setManualCollapsedMergeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapseAllMode, setCollapseAllMode] = useState(false);
  const [expandedMergeIds, setExpandedMergeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [searchText, setSearchText] = useState('');
  const activeSearchQuery = filter.kind === 'commit-search' ? filter.query : '';

  useEffect(() => {
    setSearchText(activeSearchQuery);
  }, [activeSearchQuery]);

  useEffect(() => {
    const normalized = searchText.trim();
    if (normalized === activeSearchQuery) return;
    const timer = window.setTimeout(() => {
      if (normalized.length === 0) clearFilter();
      else setFilter({ kind: 'commit-search', query: normalized.slice(0, 256) });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [activeSearchQuery, clearFilter, searchText, setFilter]);

  useEffect(() => {
    setManualCollapsedMergeIds(new Set());
    setCollapseAllMode(false);
    setExpandedMergeIds(new Set());
  }, [filterKey, history.repositoryId]);

  const mergeCommitIds = useMemo(() => getMergeCommitIds(loadedCommits), [loadedCommits]);
  const requestedCollapsedMergeIds = useMemo(
    () =>
      collapseAllMode
        ? new Set(mergeCommitIds.filter((id) => !expandedMergeIds.has(id)))
        : manualCollapsedMergeIds,
    [collapseAllMode, expandedMergeIds, manualCollapsedMergeIds, mergeCommitIds],
  );
  const projection = useMemo(
    () => buildCollapsedHistory(loadedCommits, requestedCollapsedMergeIds),
    [loadedCommits, requestedCollapsedMergeIds],
  );
  const commits = projection.commits;
  const collapsedMergeIds = projection.collapsedMergeIds;

  const graph = useMemo(() => buildHistoryGraph(projection.graphCommits), [projection.graphCommits]);
  const reachable = useMemo(
    () => findReachableCommits(loadedCommits, headCommit),
    [loadedCommits, headCommit],
  );
  const referencesByName = useMemo(
    () => new Map(references.map((reference) => [reference.fullName, reference])),
    [references],
  );
  const loadedCommitIds = useMemo(() => new Set(loadedCommits.map((commit) => commit.id)), [loadedCommits]);
  const currentBranch = references.find((reference) => reference.isHead && reference.kind === 'branch');
  const selectedIndex = commits.findIndex((commit) => commit.id === selectedCommitId);

  const toggleBranch = useCallback(
    (id: string, collapse: boolean) => {
      if (collapseAllMode) {
        setExpandedMergeIds((current) => {
          const next = new Set(current);
          if (collapse) next.delete(id);
          else next.add(id);
          return next;
        });
      } else {
        setManualCollapsedMergeIds((current) => {
          const next = new Set(current);
          if (collapse) next.add(id);
          else next.delete(id);
          return next;
        });
      }
    },
    [collapseAllMode],
  );

  const collapseAllBranches = useCallback(() => {
    setCollapseAllMode(true);
    setManualCollapsedMergeIds(new Set());
    setExpandedMergeIds(new Set());
  }, []);

  const expandAllBranches = useCallback(() => {
    setCollapseAllMode(false);
    setManualCollapsedMergeIds(new Set());
    setExpandedMergeIds(new Set());
  }, []);

  const reveal = useCallback(
    (id: string) => {
      const owners = projection.hiddenByMerge.get(id);
      if (owners && owners.length > 0) {
        if (collapseAllMode) {
          setExpandedMergeIds((current) => new Set([...current, ...owners]));
        } else {
          setManualCollapsedMergeIds((current) => {
            const next = new Set(current);
            for (const owner of owners) next.delete(owner);
            return next;
          });
        }
      }
      selectCommit(id);
      window.requestAnimationFrame(() =>
        document.getElementById(`history-commit-${id}`)?.scrollIntoView({ block: 'nearest' }),
      );
    },
    [collapseAllMode, projection.hiddenByMerge, selectCommit],
  );

  const commitMenu = useCallback(
    (commit: RepositoryHistoryCommit, row: HistoryGraphRow | undefined): MenuEntry[] =>
      compactMenu([
        row?.merge && {
          id: 'toggle-branch',
          label: row.collapsed ? 'Expand Branch' : 'Collapse Branch',
          shortcut: row.collapsed ? 'ArrowRight' : 'ArrowLeft',
          run: () => toggleBranch(commit.id, !row.collapsed),
        },
        row?.merge && menuSeparator,
        {
          id: 'collapse-all-branches',
          label: 'Collapse All Branches',
          disabled: mergeCommitIds.length === 0 || mergeCommitIds.every((id) => collapsedMergeIds.has(id)),
          disabledReason:
            mergeCommitIds.length === 0
              ? 'This history has no merge branches.'
              : 'All loaded merge branches are already collapsed.',
          run: collapseAllBranches,
        },
        {
          id: 'expand-all-branches',
          label: 'Expand All Branches',
          disabled: collapsedMergeIds.size === 0,
          disabledReason: 'All loaded merge branches are already expanded.',
          run: expandAllBranches,
        },
        menuSeparator,
        { id: 'create-branch', label: 'Create New Branch…', ...planned('Creating branches', 'P05') },
        { id: 'create-tag', label: 'Create New Tag…', ...planned('Creating tags', 'P05') },
        menuSeparator,
        {
          id: 'interactive-rebase',
          label: 'Interactive Rebase',
          submenu: [],
          ...planned('Interactive rebase', 'P07'),
        },
        menuSeparator,
        {
          id: 'reset',
          label: `Reset '${currentBranch?.name ?? 'HEAD'}' to Here…`,
          ...planned('Resetting', 'P06'),
        },
        menuSeparator,
        { id: 'checkout', label: 'Checkout Commit…', ...planned('Checking out commits', 'P05') },
        { id: 'cherry-pick', label: 'Cherry-pick Commit…', ...planned('Cherry-picking', 'P06') },
        { id: 'revert', label: 'Revert Commit…', ...planned('Reverting commits', 'P06') },
        { id: 'save-patch', label: 'Save as Patch…', ...planned('Patch export', 'P08') },
        menuSeparator,
        { id: 'copy-sha', label: 'Copy Commit SHA', run: () => copyText(commit.id) },
        { id: 'copy-short-sha', label: 'Copy Short SHA', run: () => copyText(shortHash(commit.id)) },
        {
          id: 'copy-message',
          label: 'Copy Commit Message',
          run: () => copyText(commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject),
        },
      ]),
    [
      collapseAllBranches,
      collapsedMergeIds,
      currentBranch?.name,
      expandAllBranches,
      mergeCommitIds,
      toggleBranch,
    ],
  );

  const openCommitMenu = useCallback(
    (commit: RepositoryHistoryCommit, event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      setContextCommitId(commit.id);
      const row = graph[commits.findIndex((candidate) => candidate.id === commit.id)];
      showContextMenu({
        anchor: contextMenuAnchor(event, event.currentTarget),
        items: commitMenu(commit, row),
        label: `Commit ${shortHash(commit.id)}`,
        onClose: () => setContextCommitId(undefined),
      });
    },
    [commitMenu, commits, graph, showContextMenu],
  );

  const moveSelection = (index: number) => {
    const next = commits[Math.max(0, Math.min(commits.length - 1, index))];
    if (next) reveal(next.id);
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / graphRowHeight) - 1);
    switch (event.key) {
      case 'ArrowDown':
        moveSelection(selectedIndex + 1);
        break;
      case 'ArrowUp':
        moveSelection(selectedIndex - 1);
        break;
      case 'PageDown':
        moveSelection(selectedIndex + page);
        break;
      case 'PageUp':
        moveSelection(selectedIndex - page);
        break;
      case 'Home':
        moveSelection(0);
        break;
      case 'End':
        moveSelection(commits.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const row = graph[selectedIndex];
        if (!row?.merge) return;
        const collapse = event.key === 'ArrowLeft';
        if (row.collapsed === collapse) return;
        toggleBranch(row.commitId, collapse);
        event.preventDefault();
        return;
      }
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) return;
        const commit = commits[selectedIndex];
        const row = commit ? document.getElementById(`history-commit-${commit.id}`) : null;
        if (!commit || !row) return;
        const rect = row.getBoundingClientRect();
        setContextCommitId(commit.id);
        showContextMenu({
          anchor: { type: 'point', x: rect.left + 48, y: rect.bottom },
          items: commitMenu(commit, graph[selectedIndex]),
          label: `Commit ${shortHash(commit.id)}`,
          keyboard: true,
          onClose: () => setContextCommitId(undefined),
        });
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: '0px 0px 480px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadingMore]);

  const selectedCommit = history.selectedCommit;

  return (
    <section
      className="history-view"
      aria-label="Commit history"
      style={{ '--history-list-height': `${listHeight}px` } as CSSProperties}
    >
      <div className="history-filter-bar">
        <label className="history-search">
          <SearchIcon size={14} />
          <input
            id="history-commit-search"
            type="search"
            value={searchText}
            maxLength={256}
            placeholder="Search commits"
            aria-label="Search commits"
            spellCheck={false}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchText) {
                event.preventDefault();
                setSearchText('');
              }
            }}
          />
          {searchText && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear commit search"
              title="Clear commit search"
              onClick={() => setSearchText('')}
            >
              ×
            </button>
          )}
        </label>
        {filter.kind === 'reference' && (
          <div className="history-scope" role="status">
            <span>
              History:{' '}
              {references.find((reference) => reference.target === filter.target)?.name ??
                shortHash(filter.target)}
            </span>
            <button type="button" className="button button-small" onClick={clearFilter}>
              Show all commits
            </button>
          </div>
        )}
      </div>
      {history.error && (
        <div className="inline-alert" role="alert">
          <span>{history.error}</span>
          <button type="button" className="button" onClick={history.refresh}>
            Retry
          </button>
        </div>
      )}
      <div className="commit-list-scroll" ref={scrollRef}>
        {history.loading && commits.length === 0 ? (
          <p className="list-message">Reading commit history…</p>
        ) : history.error && commits.length === 0 ? (
          <p className="list-message">History is unavailable. Retry to request it again.</p>
        ) : commits.length === 0 ? (
          <p className="list-message">
            {filter.kind === 'commit-search'
              ? `No commits match “${filter.query}”.`
              : filter.kind === 'reference'
                ? 'This reference has no commits to display.'
                : 'This repository has no commits yet.'}
          </p>
        ) : (
          <div
            className="commit-list"
            role="listbox"
            aria-label="Commits"
            tabIndex={0}
            aria-activedescendant={
              selectedIndex >= 0 && selectedCommitId ? `history-commit-${selectedCommitId}` : undefined
            }
            onKeyDown={onListKeyDown}
          >
            {commits.map((commit, index) => {
              const row = graph[index];
              if (!row) return null;
              return (
                <CommitRow
                  key={commit.id}
                  commit={commit}
                  graph={row}
                  selected={commit.id === selectedCommitId}
                  head={commit.id === headCommit}
                  dimmed={headCommit !== null && !reachable.has(commit.id)}
                  contextTarget={commit.id === contextCommitId}
                  referencesByName={referencesByName}
                  onSelect={reveal}
                  onToggleBranch={() => toggleBranch(commit.id, !row.collapsed)}
                  onContextMenu={openCommitMenu}
                />
              );
            })}
          </div>
        )}
        <div ref={sentinelRef} className="commit-list-sentinel" aria-live="polite">
          {loadingMore ? 'Loading more commits…' : null}
        </div>
      </div>
      <Splitter
        orientation="horizontal"
        label="Resize commit list"
        value={listHeight}
        minimum={96}
        maximum={4000}
        onChange={setListHeight}
      />
      <CommitDetails
        commit={selectedCommit}
        lane={selectedIndex >= 0 ? graph[selectedIndex]?.lane : undefined}
        referencesByName={referencesByName}
        loadedCommitIds={loadedCommitIds}
        onSelectCommit={reveal}
      />
    </section>
  );
}
