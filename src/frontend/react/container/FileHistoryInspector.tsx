import { useEffect, useMemo, useState } from 'react';
import { useAppearanceUpdates } from '../hooks/use-appearance-updates';
import type {
  RepositoryDiffTarget,
  RepositoryFileHistory,
  RepositoryFileHistoryContext,
  RepositoryFileHistoryRevision,
  RepositoryDiffWhitespace,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { DiffViewer } from '../components/DiffViewer';
import { ContextMenuHost } from '../components/menu/ContextMenuHost';
import { useDesktop } from '../hooks/use-desktop';
import { useRepositoryDiff } from '../hooks/use-repository-diff';
import { avatarColor, initials, shortHash } from '../lib/format';
import { detectPlatform } from '../lib/platform';
import { FileIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { HistoryTimeline } from '../components/HistoryTimeline';
import type { DiffDisplayMode } from '../components/DiffViewer';

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
  const [selectedFile, setSelectedFile] = useState(0);
  const [mode, setMode] = useState<DiffDisplayMode>('unified');
  const [whitespace, setWhitespace] = useState<RepositoryDiffWhitespace>('normal');
  const [showWhitespace, setShowWhitespace] = useState(false);
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
    const readId = crypto.randomUUID();
    setHistory(undefined);
    setSelectedIndex(0);
    setError(undefined);
    void window.desktop.repository
      .getFileHistory({
        id: context.repositoryId,
        commitId: context.commitId,
        path: context.path,
        scope: context.scope,
        readId,
      })
      .then(unwrapResult)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'The file history could not be loaded.'));
      });
    return () => {
      active = false;
      void window.desktop?.repository.cancelInvestigation({ id: context.repositoryId, readId });
    };
  }, [context]);

  useEffect(() => {
    if (history && selectedIndex >= history.revisions.length) setSelectedIndex(0);
  }, [history, selectedIndex]);

  const revision = history?.revisions[selectedIndex];
  const change = revision?.changes?.[selectedFile] ?? revision;
  const diffTarget = useMemo<RepositoryDiffTarget | undefined>(
    () =>
      revision && change
        ? {
            kind: 'commit',
            commitId: revision.commit.id,
            path: change.path,
            previousPath: change.previousPath,
          }
        : undefined,
    [revision, change],
  );
  const diff = useRepositoryDiff(context?.repositoryId, diffTarget, whitespace);
  const selectRevision = (index: number) => {
    setSelectedIndex(index);
    setSelectedFile(0);
  };

  const openBlame = () => {
    if (!context || !revision || !change || !window.desktop) return;
    void window.desktop.repository
      .openBlame({
        id: context.repositoryId,
        commitId: revision.commit.id,
        path: change.path,
        theme: context.theme,
      })
      .then(unwrapResult)
      .catch((reason: unknown) => setError(errorMessage(reason, 'Blame could not be opened.')));
  };

  const openCommitDetails = () => {
    if (!context || !revision || !change || !window.desktop) return;
    void window.desktop.repository
      .openCommitDetails({
        id: context.repositoryId,
        commitId: revision.commit.id,
        tab: 'changes',
        path: change.path,
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
              {context?.scope?.kind === 'lines' ? ` · Lines ${context.scope.start}–${context.scope.end}` : ''}
            </span>
          </div>
          <div className="file-inspector-actions">
            <button
              type="button"
              className="button button-small"
              disabled={!revision || change?.status === 'deleted'}
              onClick={openBlame}
            >
              Blame / Timeline
            </button>
            <button
              type="button"
              className="button button-small"
              disabled={!revision || change?.status === 'deleted'}
              onClick={() => {
                if (!context || !revision || !change) return;
                void window.desktop?.repository
                  .saveRevisionFile({
                    id: context.repositoryId,
                    commitId: revision.commit.id,
                    path: change.path,
                  })
                  .then(unwrapResult)
                  .catch((reason: unknown) => setError(errorMessage(reason, 'The file could not be saved.')));
              }}
            >
              Save As…
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
        {history && (
          <HistoryTimeline revisions={history.revisions} selected={selectedIndex} onSelect={selectRevision} />
        )}
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
              {history?.revisions.map((candidate, index) => (
                <button
                  key={candidate.commit.id}
                  type="button"
                  className={index === selectedIndex ? 'file-history-card selected' : 'file-history-card'}
                  aria-pressed={index === selectedIndex}
                  data-testid="file-history-revision"
                  aria-label={revisionLabel(candidate)}
                  onClick={() => selectRevision(index)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'ArrowDown'
                        ? index + 1
                        : event.key === 'ArrowUp'
                          ? index - 1
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? history.revisions.length - 1
                              : undefined;
                    if (next === undefined) return;
                    event.preventDefault();
                    const clamped = Math.max(0, Math.min(history.revisions.length - 1, next));
                    selectRevision(clamped);
                    (
                      event.currentTarget.parentElement?.children[clamped] as HTMLElement | undefined
                    )?.focus();
                  }}
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
                      {new Date(candidate.commit.author.date).toLocaleDateString()}
                    </time>
                    <span>{shortHash(candidate.commit.id)}</span>
                  </span>
                  <span className="file-history-card-subject">
                    {candidate.commit.subject || '(no subject)'}
                  </span>
                  <span className="file-history-card-path">
                    <StatusBadge status={candidate.status} />
                    <span
                      title={
                        candidate.previousPath
                          ? `${candidate.previousPath} → ${candidate.path}`
                          : candidate.path
                      }
                    >
                      {candidate.path}
                      {candidate.changes && candidate.changes.length > 1
                        ? ` (+${candidate.changes.length - 1})`
                        : ''}
                    </span>
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
                      {change?.path}
                    </span>
                    {revision.changes && (
                      <select
                        aria-label="Historical changed file"
                        value={selectedFile}
                        onChange={(event) => setSelectedFile(Number(event.target.value))}
                      >
                        {revision.changes.map((file, index) => (
                          <option key={file.path} value={index}>
                            {file.path}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <DiffViewer
                    value={diff.value}
                    loading={diff.loading}
                    error={diff.error}
                    onRetry={diff.refresh}
                    mode={mode}
                    onModeChange={setMode}
                    whitespace={whitespace}
                    onWhitespaceChange={setWhitespace}
                    showWhitespace={showWhitespace}
                    onShowWhitespaceChange={setShowWhitespace}
                    label="Historical file diff"
                    controls={diff.controls}
                    positionKey={`file-history:${context?.repositoryId ?? ''}:${revision.commit.id}:${change?.path ?? revision.path}`}
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
