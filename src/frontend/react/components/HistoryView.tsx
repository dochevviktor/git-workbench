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
import { MessageBodyIcon } from './Icons';
import { ReferenceChipList } from './ReferenceChipList';
import { Splitter } from './Splitter';
import { SearchMatch } from './SearchMatch';
import { useContextMenu } from './menu/context-menu';
import { compactMenu, contextMenuAnchor, menuSeparator, planned } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

/** The branch and tag commands the commit menu offers, owned by the workspace that renders them. */
export interface HistoryReferenceCommands {
  readonly ready: boolean;
  readonly newBranch: (commit: RepositoryHistoryCommit) => void;
  readonly newTag: (commit: RepositoryHistoryCommit) => void;
  readonly checkoutCommit: (commit: RepositoryHistoryCommit) => void;
  readonly savePatch: (commit: RepositoryHistoryCommit) => void;
}

interface HistoryViewProps {
  readonly history: RepositoryHistory;
  readonly references: HistoryReferenceCommands;
  readonly searchMatches?: ReadonlySet<string>;
  readonly searchQuery?: string;
  readonly detailsCollapsed?: boolean;
}

interface CommitRowProps {
  readonly commit: RepositoryHistoryCommit;
  readonly graph: HistoryGraphRow;
  readonly selected: boolean;
  readonly head: boolean;
  readonly dimmed: boolean;
  readonly contextTarget: boolean;
  readonly searchMatch: boolean;
  readonly searchQuery: string;
  readonly virtualIndex?: number | undefined;
  readonly totalRows: number;
  readonly referencesByName: ReadonlyMap<string, RepositoryHistoryReference>;
  readonly onSelect: (id: string) => void;
  readonly onToggleBranch: () => void;
  readonly onContextMenu: (commit: RepositoryHistoryCommit, event: ReactMouseEvent<HTMLElement>) => void;
}

/** About half of the space below the window chrome, as a first-run default. */
const defaultListHeight = Math.max(240, Math.round((window.innerHeight - 150) * 0.5));
interface HistoryPresentation {
  readonly scrollTop: number;
  readonly collapsed: ReadonlySet<string>;
  readonly collapseAll: boolean;
  readonly expanded: ReadonlySet<string>;
}
// Session-only view memory deliberately resets on normal application restart (P2-015).
const historyPresentations = new Map<string, HistoryPresentation>();

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
  searchMatch,
  searchQuery,
  virtualIndex,
  totalRows,
  referencesByName,
  onSelect,
  onToggleBranch,
  onContextMenu,
}: CommitRowProps) {
  const chips = referenceChips(commit.decorations, referencesByName);
  const author = authorName(commit);
  const date = formatListDate(commit.author.date);
  const hasBody = commit.body.trim().length > 0;
  const classes = ['commit-row'];
  if (selected) classes.push('selected');
  if (head) classes.push('head');
  if (dimmed) classes.push('dimmed');
  if (contextTarget) classes.push('context-target');
  if (graph.collapsed) classes.push('collapsed');
  if (searchMatch) classes.push('search-match');
  if (virtualIndex !== undefined) classes.push('virtual-row');

  return (
    <div
      id={`history-commit-${commit.id}`}
      role="option"
      aria-selected={selected}
      aria-posinset={virtualIndex === undefined ? undefined : virtualIndex + 1}
      aria-setsize={totalRows}
      aria-label={`${commit.subject || 'Commit without a subject'}${hasBody ? ' (has description)' : ''}, ${author}, ${date}, ${shortHash(commit.id)}${
        graph.merge ? ', merge commit' : ''
      }${graph.collapsed ? ', merged branch collapsed' : ''}${head ? ', HEAD' : ''}`}
      className={classes.join(' ')}
      data-testid="history-commit"
      data-commit-id={commit.id}
      style={
        {
          '--graph-width': `${graphWidth(graph)}px`,
          top: virtualIndex === undefined ? undefined : virtualIndex * graphRowHeight,
        } as CSSProperties
      }
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
        <span className="commit-subject">
          <SearchMatch text={commit.subject || '(no subject)'} query={searchMatch ? searchQuery : ''} />
        </span>
        {hasBody && (
          <span className="commit-body-indicator" title="The message has a description" aria-hidden="true">
            <MessageBodyIcon size={12} />
          </span>
        )}
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

export function HistoryView({
  history,
  references: referenceCommands,
  searchMatches,
  searchQuery = '',
  detailsCollapsed = false,
}: HistoryViewProps) {
  const sessionKey = `${history.repositoryId}:${history.filterKey}`;
  const savedPresentation = historyPresentations.get(sessionKey);
  const showContextMenu = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [contextCommitId, setContextCommitId] = useState<string>();
  const [viewport, setViewport] = useState({ top: savedPresentation?.scrollTop ?? 0, height: 600 });
  const restoreScroll = useRef(savedPresentation?.scrollTop ?? 0);
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
    clearFilter,
    selectCommit,
    loadMore,
    hasMore,
    loadingMore,
    reveal: revealRequest,
    finishReveal,
  } = history;
  const [manualCollapsedMergeIds, setManualCollapsedMergeIds] = useState<ReadonlySet<string>>(
    () => savedPresentation?.collapsed ?? new Set(),
  );
  const [collapseAllMode, setCollapseAllMode] = useState(savedPresentation?.collapseAll ?? false);
  const [expandedMergeIds, setExpandedMergeIds] = useState<ReadonlySet<string>>(
    () => savedPresentation?.expanded ?? new Set(),
  );

  useEffect(() => {
    historyPresentations.set(sessionKey, {
      scrollTop: viewport.top,
      collapsed: manualCollapsedMergeIds,
      collapseAll: collapseAllMode,
      expanded: expandedMergeIds,
    });
  }, [collapseAllMode, expandedMergeIds, manualCollapsedMergeIds, sessionKey, viewport.top]);

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
  // Reachability is only known from loaded commits; a filtered history without HEAD dims nothing.
  const headLoaded = headCommit !== null && loadedCommitIds.has(headCommit);
  const currentBranch = references.find((reference) => reference.isHead && reference.kind === 'branch');
  const selectedIndex = commits.findIndex((commit) => commit.id === selectedCommitId);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !commits.length || restoreScroll.current === 0) return;
    element.scrollTop = restoreScroll.current;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
    restoreScroll.current = 0;
  }, [commits.length]);
  const virtualized = commits.length > 200;
  const visibleIndices = useMemo(() => {
    if (!virtualized) return commits.map((_commit, index) => index);
    const first = Math.max(0, Math.floor(viewport.top / graphRowHeight) - 12);
    const end = Math.min(commits.length, Math.ceil((viewport.top + viewport.height) / graphRowHeight) + 12);
    const indices = new Set(
      Array.from({ length: Math.max(0, end - first) }, (_value, index) => first + index),
    );
    // Keep the active descendant mounted even when the user scrolls away from the selection.
    if (selectedIndex >= 0) indices.add(selectedIndex);
    return [...indices].sort((left, right) => left - right);
  }, [commits, selectedIndex, viewport, virtualized]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
    (id: string, block: ScrollLogicalPosition = 'nearest') => {
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
      const visibleIndex = commits.findIndex((commit) => commit.id === id);
      const scroll = scrollRef.current;
      if (virtualized && visibleIndex >= 0 && scroll) {
        const top = visibleIndex * graphRowHeight;
        if (block === 'center') scroll.scrollTop = top - (scroll.clientHeight - graphRowHeight) / 2;
        else if (top < scroll.scrollTop) scroll.scrollTop = top;
        else if (top + graphRowHeight > scroll.scrollTop + scroll.clientHeight)
          scroll.scrollTop = top + graphRowHeight - scroll.clientHeight;
        setViewport({ top: scroll.scrollTop, height: scroll.clientHeight });
      }
      window.requestAnimationFrame(() =>
        document.getElementById(`history-commit-${id}`)?.scrollIntoView({ block }),
      );
    },
    [collapseAllMode, commits, projection.hiddenByMerge, selectCommit, virtualized],
  );

  // A commit chosen elsewhere, such as a search result, is selected once its page has loaded.
  useEffect(() => {
    if (revealRequest?.status !== 'ready') return;
    reveal(revealRequest.commitId, 'center');
    finishReveal(revealRequest.token);
  }, [finishReveal, reveal, revealRequest]);

  /** Fork's graph menu: toggle the merge under the pointer, or every loaded merge at once. */
  const graphMenu = useCallback(
    (commit: RepositoryHistoryCommit, row: HistoryGraphRow | undefined): MenuEntry[] =>
      compactMenu([
        row?.merge && {
          id: 'toggle-branch',
          label: row.collapsed ? 'Expand' : 'Collapse',
          shortcut: row.collapsed ? 'ArrowRight' : 'ArrowLeft',
          run: () => toggleBranch(commit.id, !row.collapsed),
        },
        row?.merge && menuSeparator,
        {
          id: 'expand-all-branches',
          label: 'Expand All',
          disabled: collapsedMergeIds.size === 0,
          disabledReason: 'All loaded merge branches are already expanded.',
          run: expandAllBranches,
        },
        {
          id: 'collapse-all-branches',
          label: 'Collapse All',
          disabled: mergeCommitIds.length === 0 || mergeCommitIds.every((id) => collapsedMergeIds.has(id)),
          disabledReason:
            mergeCommitIds.length === 0
              ? 'This history has no merge branches.'
              : 'All loaded merge branches are already collapsed.',
          run: collapseAllBranches,
        },
      ]),
    [collapseAllBranches, collapsedMergeIds, expandAllBranches, mergeCommitIds, toggleBranch],
  );

  const unavailable = useMemo(
    () =>
      referenceCommands.ready
        ? undefined
        : { disabled: true, disabledReason: 'The branches and tags of this repository are still loading.' },
    [referenceCommands.ready],
  );

  const commitMenu = useCallback(
    (commit: RepositoryHistoryCommit, row: HistoryGraphRow | undefined): MenuEntry[] =>
      compactMenu([
        {
          id: 'create-branch',
          label: 'New Branch…',
          shortcut: 'Mod+Shift+B',
          ...unavailable,
          run: () => referenceCommands.newBranch(commit),
        },
        {
          id: 'create-tag',
          label: 'New Tag…',
          ...unavailable,
          run: () => referenceCommands.newTag(commit),
        },
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
        {
          id: 'checkout',
          label: 'Checkout Commit…',
          ...unavailable,
          run: () => referenceCommands.checkoutCommit(commit),
        },
        { id: 'cherry-pick', label: 'Cherry-pick Commit…', ...planned('Cherry-picking', 'P06') },
        { id: 'revert', label: 'Revert Commit…', ...planned('Reverting commits', 'P06') },
        {
          id: 'save-patch',
          label: 'Save as Patch…',
          disabled: !referenceCommands.ready,
          disabledReason: referenceCommands.ready ? undefined : 'Repository history is still loading.',
          run: () => referenceCommands.savePatch(commit),
        },
        menuSeparator,
        { id: 'copy-sha', label: 'Copy Commit SHA', run: () => copyText(commit.id) },
        { id: 'copy-short-sha', label: 'Copy Short SHA', run: () => copyText(shortHash(commit.id)) },
        {
          id: 'copy-message',
          label: 'Copy Commit Message',
          run: () => copyText(commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject),
        },
        // The graph commands stay reachable from the keyboard-opened commit menu as well.
        menuSeparator,
        ...graphMenu(commit, row),
      ]),
    [currentBranch?.name, graphMenu, referenceCommands, unavailable],
  );

  const openCommitMenu = useCallback(
    (commit: RepositoryHistoryCommit, event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      setContextCommitId(commit.id);
      const row = graph[commits.findIndex((candidate) => candidate.id === commit.id)];
      const cell = event.currentTarget.querySelector('.commit-subject-cell');
      const onGraph =
        row !== undefined &&
        cell !== null &&
        event.clientX !== 0 &&
        event.clientX - cell.getBoundingClientRect().left < graphWidth(row);
      showContextMenu({
        anchor: contextMenuAnchor(event, event.currentTarget),
        items: onGraph ? graphMenu(commit, row) : commitMenu(commit, row),
        label: `${onGraph ? 'Graph' : 'Commit'} ${shortHash(commit.id)}`,
        onClose: () => setContextCommitId(undefined),
      });
    },
    [commitMenu, commits, graph, graphMenu, showContextMenu],
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
        if (history.windowOffset > 0) history.requestHome();
        else moveSelection(0);
        break;
      case 'End':
        if (hasMore) history.requestEnd();
        else moveSelection(commits.length - 1);
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
      style={{ '--history-list-height': detailsCollapsed ? '100%' : `${listHeight}px` } as CSSProperties}
    >
      {filter.kind === 'reference' && (
        <div className="history-filter-strip" role="status">
          <span className="history-filter-label">
            Filtered by:{' '}
            <span className="history-filter-name">
              {`'${references.find((reference) => reference.target === filter.target)?.name ?? shortHash(filter.target)}'`}
            </span>
          </span>
          <button type="button" className="link-button history-filter-clear" onClick={clearFilter}>
            Clear filter
          </button>
        </div>
      )}
      {history.error && (
        <div className="inline-alert" role="alert">
          <span>{history.error}</span>
          <button type="button" className="button" onClick={history.refresh}>
            Retry
          </button>
        </div>
      )}
      {revealRequest?.status === 'loading' && (
        <div className="history-filter-strip" role="status">
          <span>
            {revealRequest.target === 'end' ? 'Loading oldest commit' : 'Locating commit'}…{' '}
            {loadedCommits.length.toLocaleString()} commits loaded
          </span>
          <button type="button" className="link-button" onClick={() => finishReveal(revealRequest.token)}>
            Cancel
          </button>
        </div>
      )}
      {revealRequest?.status === 'unavailable' && (
        <div className="history-filter-strip" role="status">
          <span>
            The commit is unavailable in this history.{' '}
            {filter.kind !== 'all' ? 'Clear the history filter to include other branches.' : ''}
          </span>
          <button type="button" className="link-button" onClick={() => finishReveal(revealRequest.token)}>
            Dismiss
          </button>
        </div>
      )}
      <div
        className="commit-list-scroll"
        ref={scrollRef}
        onScroll={(event) =>
          setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
        }
      >
        {history.windowOffset > 0 && (
          <div className="history-filter-strip">
            <span>History from commit {(history.windowOffset + 1).toLocaleString()}</span>
            <button
              type="button"
              className="link-button"
              disabled={history.loading || loadingMore}
              onClick={history.loadPrevious}
            >
              Load newer commits
            </button>
            <button
              type="button"
              className="link-button"
              disabled={history.loading || loadingMore}
              onClick={history.requestHome}
            >
              Newest
            </button>
          </div>
        )}
        {history.loading && commits.length === 0 ? (
          <p className="list-message">Reading commit history…</p>
        ) : history.error && commits.length === 0 ? (
          <p className="list-message">History is unavailable. Retry to request it again.</p>
        ) : commits.length === 0 ? (
          <p className="list-message">
            {filter.kind === 'all'
              ? 'This repository has no commits yet.'
              : 'The filtered history has no commits to display.'}
          </p>
        ) : (
          <div
            className={virtualized ? 'commit-list virtual-list' : 'commit-list'}
            style={virtualized ? { height: commits.length * graphRowHeight } : undefined}
            role="listbox"
            aria-label="Commits"
            tabIndex={0}
            aria-activedescendant={
              selectedIndex >= 0 && selectedCommitId ? `history-commit-${selectedCommitId}` : undefined
            }
            onKeyDown={onListKeyDown}
          >
            {visibleIndices.map((index) => {
              const commit = commits[index];
              const row = graph[index];
              if (!row || !commit) return null;
              return (
                <CommitRow
                  key={commit.id}
                  commit={commit}
                  graph={row}
                  selected={commit.id === selectedCommitId}
                  head={commit.id === headCommit}
                  dimmed={headLoaded && !reachable.has(commit.id)}
                  contextTarget={commit.id === contextCommitId}
                  searchMatch={searchMatches?.has(commit.id) ?? false}
                  searchQuery={searchQuery}
                  virtualIndex={virtualized ? index : undefined}
                  totalRows={commits.length}
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
      {!detailsCollapsed && (
        <Splitter
          orientation="horizontal"
          label="Resize commit list"
          value={listHeight}
          minimum={96}
          maximum={4000}
          onChange={setListHeight}
        />
      )}
      <CommitDetails
        repositoryId={history.repositoryId}
        commit={selectedCommit}
        lane={selectedIndex >= 0 ? graph[selectedIndex]?.lane : undefined}
        referencesByName={referencesByName}
        loadedCommitIds={loadedCommitIds}
        onSelectCommit={(id) => (loadedCommitIds.has(id) ? reveal(id) : history.requestReveal(id))}
        collapsed={detailsCollapsed}
        searchQuery={selectedCommit && searchMatches?.has(selectedCommit.id) ? searchQuery : ''}
      />
    </section>
  );
}
