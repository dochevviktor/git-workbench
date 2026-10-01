import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type {
  RepositoryCommitChange,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
} from '../../../common/ipc/contracts';
import { useRepositoryDiff } from '../hooks/use-repository-diff';
import { DiffViewer } from './DiffViewer';
import type { DiffDisplayMode } from './DiffViewer';
import { ChevronDownIcon, ChevronRightIcon, FileIcon } from './Icons';
import { StatusBadge } from './StatusBadge';

function InlineChange({
  repositoryId,
  commitId,
  change,
}: {
  readonly repositoryId: string;
  readonly commitId: string;
  readonly change: RepositoryCommitChange;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<DiffDisplayMode>('unified');
  const [whitespace, setWhitespace] = useState<RepositoryDiffWhitespace>('normal');
  const [symbols, setSymbols] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), {
      root: element.closest('.details-panel'),
      rootMargin: '160px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const target = useMemo<RepositoryDiffTarget | undefined>(
    () =>
      visible
        ? {
            kind: 'commit',
            commitId,
            path: change.path,
            previousPath: change.previousPath,
          }
        : undefined,
    [visible, commitId, change],
  );
  const diff = useRepositoryDiff(repositoryId, target, whitespace);
  return (
    <div ref={container} className="inline-commit-diff" aria-label={`Changes to ${change.path}`}>
      {visible && (
        <DiffViewer
          value={diff.value}
          loading={diff.loading}
          error={diff.error}
          onRetry={diff.refresh}
          mode={mode}
          onModeChange={setMode}
          whitespace={whitespace}
          onWhitespaceChange={setWhitespace}
          showWhitespace={symbols}
          onShowWhitespaceChange={setSymbols}
          controls={diff.controls}
          positionKey={`summary:${repositoryId}:${commitId}:${change.path}`}
        />
      )}
    </div>
  );
}

/** Summary disclosures use the same bounded committed diffs as the Changes tab. */
export function CommitFileSummary({
  repositoryId,
  commitId,
  changes,
  onShowChanges,
  onContextMenu,
}: {
  readonly repositoryId: string;
  readonly commitId: string;
  readonly changes: readonly RepositoryCommitChange[];
  readonly onShowChanges: (change: RepositoryCommitChange) => void;
  readonly onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
}) {
  const [all, setAll] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(100);
  return (
    <>
      <div className="details-files-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setAll(!all);
            setToggled(new Set());
          }}
        >
          {all ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
      <ul
        className="details-file-list"
        aria-label={`${changes.length} changed ${changes.length === 1 ? 'file' : 'files'}`}
      >
        {changes.slice(0, visibleCount).map((change) => {
          const expanded = all !== toggled.has(change.path);
          return (
            <li
              key={change.path}
              data-testid="commit-file"
              data-commit-path={change.path}
              onContextMenu={(event) => onContextMenu(change.path, event)}
            >
              <div className="details-file">
                <button
                  type="button"
                  className="icon-button details-file-disclosure"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} changes to ${change.path}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setToggled((current) => {
                      const next = new Set(current);
                      if (next.has(change.path)) next.delete(change.path);
                      else next.add(change.path);
                      return next;
                    })
                  }
                >
                  {expanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                </button>
                <StatusBadge status={change.status} />
                <FileIcon size={14} />
                <button
                  type="button"
                  className="details-file-path"
                  title="Show in Changes"
                  onClick={() => onShowChanges(change)}
                >
                  {change.previousPath && <span className="muted">{change.previousPath} → </span>}
                  {change.path}
                </button>
              </div>
              {expanded && <InlineChange repositoryId={repositoryId} commitId={commitId} change={change} />}
            </li>
          );
        })}
      </ul>
      {visibleCount < changes.length && (
        <button type="button" className="text-button" onClick={() => setVisibleCount((count) => count + 100)}>
          Show more changed files ({visibleCount} of {changes.length})
        </button>
      )}
    </>
  );
}
