import { useEffect, useMemo, useState } from 'react';
import { useAppearanceUpdates } from '../hooks/use-appearance-updates';
import type {
  RepositoryBlame,
  RepositoryBlameContext,
  RepositoryBlameLine,
  RepositoryFileHistory,
  RepositoryFileHistoryRevision,
  RepositoryHistoryCommit,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { ContextMenuHost } from '../components/menu/ContextMenuHost';
import { FileIcon } from '../components/Icons';
import { useDesktop } from '../hooks/use-desktop';
import { avatarColor, formatListDate, initials, shortHash } from '../lib/format';
import { detectPlatform } from '../lib/platform';

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

interface BlameGroup {
  readonly commitId: string;
  readonly lines: readonly RepositoryBlameLine[];
}

function groupLines(lines: readonly RepositoryBlameLine[]): BlameGroup[] {
  const groups: BlameGroup[] = [];
  for (const line of lines) {
    const previous = groups.at(-1);
    if (previous?.commitId === line.commitId) {
      groups[groups.length - 1] = { ...previous, lines: [...previous.lines, line] };
    } else {
      groups.push({ commitId: line.commitId, lines: [line] });
    }
  }
  return groups;
}

function revisionLabel(revision: RepositoryFileHistoryRevision): string {
  return `${revision.commit.subject || '(no subject)'} · ${shortHash(revision.commit.id)}`;
}

function selectedRevision(
  history: RepositoryFileHistory | undefined,
  index: number,
): RepositoryFileHistoryRevision | undefined {
  return history?.revisions[index];
}

export default function BlameInspector() {
  useAppearanceUpdates();
  const desktop = useDesktop();
  const [platform] = useState(detectPlatform);
  const [context, setContext] = useState<RepositoryBlameContext>();
  const [history, setHistory] = useState<RepositoryFileHistory>();
  const [blame, setBlame] = useState<RepositoryBlame>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigation, setNavigation] = useState<readonly number[]>([0]);
  const [navigationCursor, setNavigationCursor] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void window.desktop?.repository
      .getBlameContext()
      .then(unwrapResult)
      .then((value) => {
        if (!active) return;
        document.documentElement.dataset.theme = value.theme;
        setContext(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'Blame is unavailable.'));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!context || !window.desktop) return;
    let active = true;
    setHistory(undefined);
    setBlame(undefined);
    setError(undefined);
    void window.desktop.repository
      .getFileHistory({ id: context.repositoryId, commitId: context.commitId, path: context.path })
      .then(unwrapResult)
      .then((value) => {
        if (!active) return;
        const index = Math.max(
          0,
          value.revisions.findIndex(
            (revision) => revision.commit.id === context.commitId && revision.path === context.path,
          ),
        );
        setHistory(value);
        setSelectedIndex(index);
        setNavigation([index]);
        setNavigationCursor(0);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'The file revisions could not be loaded.'));
      });
    return () => {
      active = false;
    };
  }, [context]);

  const revision = selectedRevision(history, selectedIndex);
  useEffect(() => {
    if (!context || !revision || !window.desktop) return;
    let active = true;
    setBlame(undefined);
    setError(undefined);
    void window.desktop.repository
      .getBlame({ id: context.repositoryId, commitId: revision.commit.id, path: revision.path })
      .then(unwrapResult)
      .then((value) => {
        if (active) setBlame(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'The selected revision could not be blamed.'));
      });
    return () => {
      active = false;
    };
  }, [context, revision]);

  const commitsById = useMemo(
    () => new Map((blame?.commits ?? []).map((commit) => [commit.id, commit])),
    [blame?.commits],
  );
  const groups = useMemo(() => groupLines(blame?.lines ?? []), [blame?.lines]);

  const selectRevision = (index: number, recordNavigation: boolean) => {
    if (!history || index < 0 || index >= history.revisions.length || index === selectedIndex) return;
    setSelectedIndex(index);
    if (!recordNavigation) return;
    setNavigation((current) => [...current.slice(0, navigationCursor + 1), index]);
    setNavigationCursor((current) => current + 1);
  };

  const goBack = () => {
    if (navigationCursor === 0) return;
    const index = navigation[navigationCursor - 1];
    if (index === undefined) return;
    setNavigationCursor((current) => current - 1);
    setSelectedIndex(index);
  };

  const goForward = () => {
    if (navigationCursor >= navigation.length - 1) return;
    const index = navigation[navigationCursor + 1];
    if (index === undefined) return;
    setNavigationCursor((current) => current + 1);
    setSelectedIndex(index);
  };

  const openCommitDetails = (commit: RepositoryHistoryCommit, path: string) => {
    if (!context || !window.desktop) return;
    void window.desktop.repository
      .openCommitDetails({
        id: context.repositoryId,
        commitId: commit.id,
        tab: 'changes',
        path,
        theme: context.theme,
      })
      .then(unwrapResult)
      .catch((reason: unknown) => setError(errorMessage(reason, 'Commit details could not be opened.')));
  };

  useEffect(() => {
    document.title = context ? `${context.path} — Blame — Git Workbench` : 'Blame — Git Workbench';
  }, [context]);

  return (
    <ContextMenuHost platform={desktop.info?.platform ?? platform}>
      <main className="blame-inspector" aria-label="Blame" data-testid="blame-inspector">
        <header className="file-inspector-header">
          <div className="file-inspector-title">
            <strong>Blame</strong>
            <span className="file-inspector-path" title={revision?.path ?? context?.path}>
              <FileIcon size={14} />
              {revision?.path ?? context?.path ?? 'Reading blame…'}
            </span>
          </div>
          <div className="blame-navigation" aria-label="Blame revision navigation">
            <button
              type="button"
              className="pane-icon-button"
              aria-label="Back"
              title="Back"
              disabled={navigationCursor === 0}
              onClick={goBack}
            >
              ←
            </button>
            <button
              type="button"
              className="pane-icon-button"
              aria-label="Forward"
              title="Forward"
              disabled={navigationCursor >= navigation.length - 1}
              onClick={goForward}
            >
              →
            </button>
            <select
              aria-label="Blame revision"
              value={String(selectedIndex)}
              disabled={!history}
              onChange={(event) => selectRevision(Number(event.target.value), true)}
            >
              {history?.revisions.map((candidate, index) => (
                <option key={`${candidate.commit.id}:${candidate.path}`} value={index}>
                  {revisionLabel(candidate)}
                </option>
              ))}
            </select>
          </div>
        </header>
        {error && (
          <div className="inline-alert" role="alert">
            {error}
          </div>
        )}
        {!blame && !error ? (
          <p className="details-empty">Reading blame…</p>
        ) : blame?.state !== 'text' ? (
          <p className="details-empty">{blame?.message ?? 'This file has no inline blame.'}</p>
        ) : (
          <section className="blame-content" aria-label="Blamed lines">
            {groups.map((group) => {
              const commit = commitsById.get(group.commitId);
              if (!commit) return null;
              const first = group.lines[0];
              const last = group.lines.at(-1);
              return (
                <div
                  className="blame-group"
                  key={`${group.commitId}:${first?.line ?? 0}`}
                  data-testid="blame-group"
                >
                  <div className="blame-attribution">
                    <div className="blame-attribution-person">
                      <span
                        className={`avatar avatar-${avatarColor(commit.author.email || commit.author.name)}`}
                        aria-hidden="true"
                      >
                        {initials(commit.author.name, commit.author.email)}
                      </span>
                      <span>{commit.author.name || commit.author.email || 'Unknown author'}</span>
                    </div>
                    <time dateTime={commit.author.date}>{formatListDate(commit.author.date)}</time>
                    <button
                      type="button"
                      className="blame-commit-button"
                      title={commit.subject}
                      onClick={() => openCommitDetails(commit, revision?.path ?? context?.path ?? '')}
                    >
                      {shortHash(commit.id)} · {commit.subject || '(no subject)'}
                    </button>
                    <span className="blame-range">
                      Lines {first?.line ?? 0}–{last?.line ?? first?.line ?? 0}
                    </span>
                  </div>
                  <div className="blame-lines">
                    {group.lines.map((line) => (
                      <div
                        className="blame-line"
                        key={`${line.commitId}:${line.line}`}
                        data-testid="blame-line"
                      >
                        <span className="blame-line-number" aria-hidden="true">
                          {line.line}
                        </span>
                        <pre>{line.content}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {blame.truncated && <p className="sidebar-note">The blamed file is truncated.</p>}
          </section>
        )}
      </main>
    </ContextMenuHost>
  );
}
