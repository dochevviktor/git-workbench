import { useEffect, useMemo, useState } from 'react';
import type { RepositorySubmodule, RepositorySubmoduleComparison } from '../../../common/ipc/contracts';
import { buildHistoryGraph } from '../../../common/history-graph';
import { unwrapResult } from '../../../common/ipc/result';
import { formatListDate, initials, shortHash } from '../lib/format';
import { SubmoduleIcon } from './Icons';
import { CommitGraph } from './CommitGraph';

interface SubmodulePreviewProps {
  readonly repositoryId: string;
  readonly area: 'staged' | 'unstaged';
  readonly refreshSignal: number;
  readonly submodule: RepositorySubmodule;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onUpdate: () => void;
}

/** Compact revision summaries and a real, bounded child commit graph, P2-002:F1/F2. */
export function SubmodulePreview({
  repositoryId,
  area,
  refreshSignal,
  submodule,
  busy,
  onOpen,
  onUpdate,
}: SubmodulePreviewProps) {
  const [comparison, setComparison] = useState<RepositorySubmoduleComparison>();
  const [error, setError] = useState<string>();
  const { id, revisions, initialized, path } = submodule;
  useEffect(() => {
    let current = true;
    setComparison(undefined);
    setError(undefined);
    void window.desktop?.repository
      .getSubmoduleComparison({ id: repositoryId, submoduleId: id, area })
      .then(unwrapResult)
      .then((value) => {
        if (current) setComparison(value);
      })
      .catch((reason: unknown) => {
        if (current)
          setError(reason instanceof Error ? reason.message : 'The submodule commits could not be read.');
      });
    return () => {
      current = false;
    };
  }, [
    repositoryId,
    id,
    area,
    refreshSignal,
    revisions.head,
    revisions.index,
    revisions.working,
    initialized,
  ]);
  const before = area === 'staged' ? revisions.head : revisions.index;
  const after = area === 'staged' ? revisions.index : revisions.working;
  const graph = useMemo(() => buildHistoryGraph(comparison?.commits ?? []), [comparison]);
  const dirty = area === 'unstaged' && (submodule.dirtyFileCount ?? 0) > 0;
  const unavailable = !initialized
    ? 'Not initialized'
    : submodule.state === 'missing-commit'
      ? 'Recorded commit unavailable locally'
      : null;
  const summary = (commitId: string | null, side: 'before' | 'after') => {
    const commit = comparison?.commits.find((item) => item.id === commitId);
    const label =
      side === 'before'
        ? area === 'staged'
          ? 'Parent baseline'
          : 'Parent index'
        : area === 'staged'
          ? 'Parent index'
          : 'Child checkout';
    return (
      <div className={`submodule-revision-row ${side}`} aria-label={label} title={label}>
        <span className="submodule-author-mark" aria-hidden="true">
          {commit ? initials(commit.author, '') : '—'}
        </span>
        <span className="submodule-author">{commit?.author ?? label}</span>
        <code title={commitId ?? undefined}>{commitId ? shortHash(commitId) : '—'}</code>
        <time>{commit ? formatListDate(commit.date) : ''}</time>
        <strong>
          {commit?.subject ??
            (commitId ? (comparison ? 'Commit unavailable locally' : 'Loading commit…') : 'Not available')}
        </strong>
      </div>
    );
  };
  return (
    <div className="submodule-preview" data-testid="submodule-preview">
      <div className="preview-header">
        <SubmoduleIcon size={14} />
        <span className="preview-path">{path}</span>
      </div>
      <header className="submodule-preview-header">
        <strong>Submodule &apos;{submodule.name}&apos; changed</strong>
        {comparison?.ahead ? <span className="submodule-state">{comparison.ahead}↑</span> : null}
        {comparison?.behind ? <span className="submodule-state">{comparison.behind}↓</span> : null}
        {dirty && (
          <span className="submodule-state dirty">
            {submodule.dirtyFileCount} uncommitted {submodule.dirtyFileCount === 1 ? 'file' : 'files'}
          </span>
        )}
        {unavailable && <span className="submodule-state">{unavailable}</span>}
      </header>
      <div className="submodule-revisions" aria-label="Submodule revisions">
        {summary(before, 'before')}
        {summary(after, 'after')}
      </div>
      {error && (
        <p className="submodule-detail" role="alert">
          {error}
        </p>
      )}
      <div className="submodule-history" aria-label="Submodule commit history">
        {comparison?.commits.map((commit, index) => (
          <div className="submodule-history-row" key={commit.id}>
            <CommitGraph row={graph[index]!} />
            <span className="submodule-subject" title={commit.subject}>
              {commit.subject}
            </span>
            <span className="submodule-author">{commit.author}</span>
            <code className={commit.id === after ? 'after' : commit.id === before ? 'before' : ''}>
              {shortHash(commit.id)}
            </code>
            <time>{formatListDate(commit.date)}</time>
          </div>
        ))}
        {comparison?.truncated && (
          <p className="submodule-detail">
            Showing the first 100 commits. Open Submodule for its full history.
          </p>
        )}
      </div>
      {area === 'unstaged' && submodule.detached && <p className="submodule-detail">Detached HEAD</p>}
      {dirty && (
        <details className="submodule-detail">
          <summary>Changed child paths</summary>
          <ul>
            {submodule.dirtyPaths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="submodule-actions">
        <button
          type="button"
          className="button button-small"
          disabled={busy || !initialized}
          onClick={onOpen}
        >
          Open Submodule
        </button>
        {area === 'unstaged' &&
          (!initialized || submodule.workingChanged || submodule.state === 'missing-commit') && (
            <button
              type="button"
              className="button button-small"
              disabled={busy || dirty || submodule.state === 'conflicted'}
              onClick={onUpdate}
            >
              {initialized ? 'Update…' : 'Initialize…'}
            </button>
          )}
      </div>
    </div>
  );
}
