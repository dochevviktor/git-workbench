import { useEffect, useMemo, useState } from 'react';
import { useAppearanceUpdates } from '../hooks/use-appearance-updates';
import type {
  RepositoryDiffTarget,
  RepositoryFileHistory,
  RepositoryFileHistoryContext,
  RepositoryFileHistoryRevision,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { DiffViewer } from '../components/DiffViewer';
import { ContextMenuHost } from '../components/menu/ContextMenuHost';
import { useDesktop } from '../hooks/use-desktop';
import { useRepositoryDiff } from '../hooks/use-repository-diff';
import { avatarColor, formatListDate, initials, shortHash } from '../lib/format';
import { detectPlatform } from '../lib/platform';
import { FileIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function revisionLabel(revision: RepositoryFileHistoryRevision): string {
  return `${revision.commit.subject || '(no subject)'} · ${shortHash(revision.commit.id)}`;
}

export default function FileHistoryInspector() {
  useAppearanceUpdates();
  const desktop = useDesktop();
  const [platform] = useState(detectPlatform);
  const [context, setContext] = useState<RepositoryFileHistoryContext>();
  const [history, setHistory] = useState<RepositoryFileHistory>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void window.desktop?.repository
      .getFileHistoryContext()
      .then(unwrapResult)
      .then((value) => {
        if (!active) return;
        document.documentElement.dataset.theme = value.theme;
        setContext(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'File history is unavailable.'));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!context || !window.desktop) return;
    let active = true;
    setHistory(undefined);
    setSelectedIndex(0);
    setError(undefined);
    void window.desktop.repository
      .getFileHistory({ id: context.repositoryId, commitId: context.commitId, path: context.path })
      .then(unwrapResult)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'The file history could not be loaded.'));
      });
    return () => {
      active = false;
    };
  }, [context]);

  useEffect(() => {
    if (history && selectedIndex >= history.revisions.length) setSelectedIndex(0);
  }, [history, selectedIndex]);

  const revision = history?.revisions[selectedIndex];
  const diffTarget = useMemo<RepositoryDiffTarget | undefined>(
    () =>
      revision
        ? {
            kind: 'commit',
            commitId: revision.commit.id,
            path: revision.path,
            previousPath: revision.previousPath,
          }
        : undefined,
    [revision],
  );
  const diff = useRepositoryDiff(context?.repositoryId, diffTarget, 'normal');

  const openBlame = () => {
    if (!context || !revision || !window.desktop) return;
    void window.desktop.repository
      .openBlame({
        id: context.repositoryId,
        commitId: revision.commit.id,
        path: revision.path,
        theme: context.theme,
      })
      .then(unwrapResult)
      .catch((reason: unknown) => setError(errorMessage(reason, 'Blame could not be opened.')));
  };

  const openCommitDetails = () => {
    if (!context || !revision || !window.desktop) return;
    void window.desktop.repository
      .openCommitDetails({
        id: context.repositoryId,
        commitId: revision.commit.id,
        tab: 'changes',
        path: revision.path,
        theme: context.theme,
      })
      .then(unwrapResult)
      .catch((reason: unknown) => setError(errorMessage(reason, 'Commit details could not be opened.')));
  };

  useEffect(() => {
    document.title = context ? `${context.path} — History — Git Workbench` : 'File History — Git Workbench';
  }, [context]);

  return (
    <ContextMenuHost platform={desktop.info?.platform ?? platform}>
      <main className="file-history-inspector" aria-label="File history" data-testid="file-history-inspector">
        <header className="file-inspector-header">
          <div className="file-inspector-title">
            <strong>History</strong>
            <span className="file-inspector-path" title={context?.path}>
              <FileIcon size={14} />
              {context?.path ?? 'Reading file history…'}
            </span>
          </div>
          <div className="file-inspector-actions">
            <button type="button" className="button button-small" disabled={!revision} onClick={openBlame}>
              Blame / Timeline
            </button>
            <button
              type="button"
              className="button button-small"
              disabled={!revision}
              onClick={openCommitDetails}
            >
              Open Commit Details
            </button>
          </div>
        </header>
        {error && (
          <div className="inline-alert" role="alert">
            {error}
          </div>
        )}
        {!history && !error ? (
          <p className="details-empty">Reading file history…</p>
        ) : history && history.revisions.length === 0 ? (
          <p className="details-empty">No committed revisions were found for this file.</p>
        ) : (
          <div className="file-history-body">
            <aside className="file-history-revisions" aria-label="File revisions">
              <div className="file-history-timeline" aria-hidden="true">
                <span>{history?.revisions.at(-1)?.commit.author.date.slice(0, 7) ?? ''}</span>
                <span>{history?.revisions[0]?.commit.author.date.slice(0, 7) ?? ''}</span>
              </div>
              {history?.revisions.map((candidate, index) => (
                <button
                  key={candidate.commit.id}
                  type="button"
                  className={index === selectedIndex ? 'file-history-card selected' : 'file-history-card'}
                  aria-pressed={index === selectedIndex}
                  data-testid="file-history-revision"
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="file-history-card-topline">
                    <span
                      className={`avatar avatar-${avatarColor(candidate.commit.author.email || candidate.commit.author.name)}`}
                      aria-hidden="true"
                    >
                      {initials(candidate.commit.author.name, candidate.commit.author.email)}
                    </span>
                    <span className="file-history-card-author">
                      {candidate.commit.author.name || candidate.commit.author.email || 'Unknown author'}
                    </span>
                    <time dateTime={candidate.commit.author.date}>
                      {formatListDate(candidate.commit.author.date)}
                    </time>
                  </span>
                  <span className="file-history-card-subject">{revisionLabel(candidate)}</span>
                  <span className="file-history-card-path">
                    <StatusBadge status={candidate.status} />
                    {candidate.previousPath
                      ? `${candidate.previousPath} → ${candidate.path}`
                      : candidate.path}
                  </span>
                </button>
              ))}
              {history?.truncated && <p className="sidebar-note">The file history is truncated.</p>}
            </aside>
            <section className="file-history-diff" aria-label="Historical file change">
              {revision ? (
                <>
                  <div className="file-history-diff-header">
                    <span className="file-history-diff-path">
                      <FileIcon size={14} />
                      {revision.path}
                    </span>
                    <span className="muted">{revision.commit.subject || '(no subject)'}</span>
                  </div>
                  <DiffViewer
                    value={diff.value}
                    loading={diff.loading}
                    error={diff.error}
                    onRetry={diff.refresh}
                    mode="unified"
                    onModeChange={() => undefined}
                    whitespace="normal"
                    onWhitespaceChange={() => undefined}
                    showWhitespace={false}
                    onShowWhitespaceChange={() => undefined}
                    label="Historical file diff"
                    controls={diff.controls}
                    positionKey={`file-history:${context?.repositoryId ?? ''}:${revision.commit.id}:${revision.path}`}
                  />
                </>
              ) : (
                <p className="preview-empty">Select a revision to inspect its change.</p>
              )}
            </section>
          </div>
        )}
      </main>
    </ContextMenuHost>
  );
}
