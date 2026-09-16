import type {
  RepositoryHistoryCommit,
  RepositoryHistoryDecoration,
  RepositoryHistoryReference,
  RepositoryHistoryTracking,
  RepositorySummary,
} from '../../../common/ipc/contracts';
import { buildHistoryGraph } from '../../../common/history-graph';

interface HistoryViewData {
  readonly commits: readonly RepositoryHistoryCommit[];
  readonly references: readonly RepositoryHistoryReference[];
  readonly tracking: RepositoryHistoryTracking;
  readonly selectedCommit: RepositoryHistoryCommit | undefined;
  readonly selectedCommitId: string | undefined;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly error: string | undefined;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  readonly selectCommit: (id: string) => void;
}

interface HistoryViewProps {
  readonly repository: RepositorySummary;
  readonly history: HistoryViewData;
}

const laneColors = ['one', 'two', 'three', 'four', 'five'] as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function authorLabel(commit: RepositoryHistoryCommit): string {
  return commit.author.name || commit.author.email || 'Unknown author';
}

function shortHash(id: string): string {
  return id.slice(0, 10);
}

function referenceLabel(decoration: RepositoryHistoryDecoration): string {
  return decoration.isHead && decoration.kind === 'branch' ? `HEAD → ${decoration.name}` : decoration.name;
}

function ReferenceChip({ decoration }: { readonly decoration: RepositoryHistoryDecoration }) {
  return (
    <span className={`history-reference-chip ${decoration.kind}`} title={decoration.fullName}>
      {referenceLabel(decoration)}
    </span>
  );
}

function CommitGraph({ row }: { readonly row: ReturnType<typeof buildHistoryGraph>[number] }) {
  const width = Math.max(1, row.laneCount) * 17 + 12;
  const height = 48;
  const laneX = (lane: number) => lane * 17 + 8;
  return (
    <svg
      className="history-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {Array.from({ length: row.laneCount }, (_, lane) => (
        <line
          className={`history-graph-line ${laneColors[lane % laneColors.length]}`}
          key={`lane-${lane}`}
          x1={laneX(lane)}
          y1="0"
          x2={laneX(lane)}
          y2={lane === row.lane && row.root ? 23 : height}
        />
      ))}
      {row.parentLanes.map((parentLane, index) => (
        <line
          className={`history-graph-edge ${laneColors[parentLane % laneColors.length]}`}
          key={`parent-${parentLane}-${index}`}
          x1={laneX(row.lane)}
          y1="23"
          x2={laneX(parentLane)}
          y2={height}
        />
      ))}
      <circle
        className={`history-graph-node ${laneColors[row.lane % laneColors.length]}`}
        cx={laneX(row.lane)}
        cy="23"
        r={row.merge ? 5 : 4}
      />
    </svg>
  );
}

function trackingLabel(tracking: RepositoryHistoryTracking): string | null {
  if (!tracking.upstream) return null;
  if (tracking.ahead === null || tracking.behind === null) return `Tracks ${tracking.upstream}`;
  return `${tracking.ahead} ahead · ${tracking.behind} behind ${tracking.upstream}`;
}

function CommitRow({
  commit,
  graph,
  selected,
  commits,
  onSelect,
}: {
  readonly commit: RepositoryHistoryCommit;
  readonly graph: ReturnType<typeof buildHistoryGraph>[number];
  readonly selected: boolean;
  readonly commits: readonly RepositoryHistoryCommit[];
  readonly onSelect: (id: string) => void;
}) {
  const date = formatDate(commit.committer.date);
  const label = `${commit.subject || 'Commit without a subject'} by ${authorLabel(commit)} on ${date}; ${
    commit.id
  }${graph.merge ? '; merge commit' : ''}`;

  const moveSelection = (direction: 1 | -1) => {
    const index = commits.findIndex((candidate) => candidate.id === commit.id);
    const next = commits[index + direction];
    if (!next) return;
    onSelect(next.id);
    window.requestAnimationFrame(() => document.getElementById(`history-commit-${next.id}`)?.focus());
  };

  return (
    <button
      className={selected ? 'history-commit selected' : 'history-commit'}
      id={`history-commit-${commit.id}`}
      data-testid="history-commit"
      role="option"
      aria-selected={selected}
      aria-label={label}
      title={commit.id}
      onClick={() => onSelect(commit.id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
        }
      }}
    >
      <CommitGraph row={graph} />
      <span className="history-commit-copy">
        <span className="history-commit-subject-row">
          <strong>{commit.subject || '(no subject)'}</strong>
          <span className="history-reference-list">
            {commit.decorations.map((decoration) => (
              <ReferenceChip decoration={decoration} key={decoration.fullName} />
            ))}
          </span>
        </span>
        <span className="history-commit-meta">
          <span>{authorLabel(commit)}</span>
          <time dateTime={commit.committer.date}>{date}</time>
          <code>{shortHash(commit.id)}</code>
          {graph.merge && <span className="history-merge-label">merge</span>}
        </span>
      </span>
    </button>
  );
}

function CommitDetails({ commit }: { readonly commit: RepositoryHistoryCommit | undefined }) {
  if (!commit) {
    return (
      <section className="history-details empty" aria-labelledby="history-details-heading">
        <h2 id="history-details-heading">Commit details</h2>
        <p>Select a commit to inspect its metadata and message.</p>
      </section>
    );
  }

  return (
    <section className="history-details" aria-labelledby="history-details-heading">
      <div className="history-details-heading">
        <div>
          <p className="eyebrow">SELECTED COMMIT</p>
          <h2 id="history-details-heading">{commit.subject || '(no subject)'}</h2>
        </div>
        <code className="history-full-hash" title="Full commit ID">
          {commit.id}
        </code>
      </div>
      <dl className="history-metadata">
        <dt>Author</dt>
        <dd>
          {commit.author.name || 'Unknown'} &lt;{commit.author.email || 'no email'}&gt;
        </dd>
        <dt>Authored</dt>
        <dd>
          <time dateTime={commit.author.date}>{formatDate(commit.author.date)}</time>
        </dd>
        <dt>Committer</dt>
        <dd>
          {commit.committer.name || 'Unknown'} &lt;{commit.committer.email || 'no email'}&gt;
        </dd>
        <dt>Committed</dt>
        <dd>
          <time dateTime={commit.committer.date}>{formatDate(commit.committer.date)}</time>
        </dd>
        <dt>Parents</dt>
        <dd>{commit.parents.length === 0 ? 'Root commit' : commit.parents.join(', ')}</dd>
      </dl>
      {commit.body ? (
        <p className="history-commit-body">{commit.body}</p>
      ) : (
        <p className="history-empty-body">No commit body.</p>
      )}
    </section>
  );
}

export function HistoryView({ repository, history }: HistoryViewProps) {
  const graph = buildHistoryGraph(history.commits);
  const tracking = trackingLabel(history.tracking);

  return (
    <section className="history-view" aria-labelledby="history-view-heading">
      <div className="history-toolbar">
        <div>
          <p className="eyebrow">COMMIT HISTORY</p>
          <h2 id="history-view-heading">{repository.name}</h2>
          <p className="history-toolbar-path" title={repository.path}>
            {repository.path}
          </p>
        </div>
        <div className="history-toolbar-actions">
          {tracking && <span className="history-tracking">{tracking}</span>}
          <button disabled={history.loading} onClick={history.refresh}>
            {history.loading ? 'Refreshing…' : 'Refresh history'}
          </button>
        </div>
      </div>
      {history.error && (
        <div className="history-error" role="alert">
          <span>{history.error}</span>
          <button onClick={history.refresh}>Retry</button>
        </div>
      )}
      <div className="history-list-panel">
        <div className="history-list-heading">
          <strong>Commits</strong>
          <span>
            {history.commits.length === 0 ? 'No commits loaded' : `${history.commits.length} loaded`}
          </span>
        </div>
        {history.loading && history.commits.length === 0 ? (
          <p className="history-empty-message">Reading commit history…</p>
        ) : history.error && history.commits.length === 0 ? (
          <p className="history-empty-message">History is unavailable. Retry to request it again.</p>
        ) : history.commits.length === 0 ? (
          <p className="history-empty-message">This repository has no commits yet.</p>
        ) : (
          <div className="history-commit-list" role="listbox" aria-label="Commit history">
            {history.commits.map((commit, index) => {
              const graphRow = graph[index];
              if (!graphRow) return null;
              return (
                <CommitRow
                  commit={commit}
                  commits={history.commits}
                  graph={graphRow}
                  key={commit.id}
                  onSelect={history.selectCommit}
                  selected={commit.id === history.selectedCommitId}
                />
              );
            })}
          </div>
        )}
        {history.hasMore && (
          <button className="history-load-more" disabled={history.loadingMore} onClick={history.loadMore}>
            {history.loadingMore ? 'Loading more commits…' : 'Load more commits'}
          </button>
        )}
      </div>
      <CommitDetails commit={history.selectedCommit} />
    </section>
  );
}
