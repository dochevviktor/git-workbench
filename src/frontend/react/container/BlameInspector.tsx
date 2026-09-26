import { useEffect, useMemo, useState } from 'react';
import { useAppearanceUpdates } from '../hooks/use-appearance-updates';
import type {
  RepositoryBlame,
  RepositoryBlameContext,
  RepositoryFileHistory,
  RepositoryFileHistoryRevision,
  RepositoryHistoryCommit,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { ContextMenuHost } from '../components/menu/ContextMenuHost';
import { FileIcon } from '../components/Icons';
import { HistoryTimeline } from '../components/HistoryTimeline';
import { useDesktop } from '../hooks/use-desktop';
import { avatarColor, formatListDate, initials, shortHash } from '../lib/format';
import { detectPlatform } from '../lib/platform';
import { useRepositoryDiff } from '../hooks/use-repository-diff';
import { blameDisplayLines } from '../lib/blame-lines';
import type { BlameDisplayLine } from '../lib/blame-lines';

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

interface BlameGroup {
  readonly commitId: string;
  readonly lines: BlameDisplayLine[];
}

function groupLines(lines: readonly BlameDisplayLine[]): BlameGroup[] {
  const groups: BlameGroup[] = [];
  for (const line of lines) {
    const previous = groups.at(-1);
    if (
      previous?.commitId === line.commitId &&
      previous.lines[0]?.originalPath === line.originalPath &&
      previous.lines[0]?.change === line.change
    ) {
      previous.lines.push(line);
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
    const readId = crypto.randomUUID();
    setHistory(undefined);
    setBlame(undefined);
    setError(undefined);
    void window.desktop.repository
      .getFileHistory({ id: context.repositoryId, commitId: context.commitId, path: context.path, readId })
      .then(unwrapResult)
      .then((value) => {
        if (!active) return;
        value = { ...value, revisions: value.revisions.filter((revision) => revision.status !== 'deleted') };
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
      void window.desktop?.repository.cancelInvestigation({ id: context.repositoryId, readId });
    };
  }, [context]);

  const revision = selectedRevision(history, selectedIndex);
  const target = useMemo(
    () =>
      revision
        ? {
            kind: 'commit' as const,
            commitId: revision.commit.id,
            path: revision.path,
            previousPath: revision.previousPath,
          }
        : undefined,
    [revision],
  );
  const diff = useRepositoryDiff(context?.repositoryId, target, 'normal');
  useEffect(() => {
    if (!context || !revision || !window.desktop) return;
    let active = true;
    const readId = crypto.randomUUID();
    setBlame(undefined);
    setError(undefined);
    void window.desktop.repository
      .getBlame({ id: context.repositoryId, commitId: revision.commit.id, path: revision.path, readId })
      .then(unwrapResult)
      .then((value) => {
        if (active) setBlame(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'The selected revision could not be blamed.'));
      });
    return () => {
      active = false;
      void window.desktop?.repository.cancelInvestigation({ id: context.repositoryId, readId });
    };
  }, [context, revision]);

  const commitsById = useMemo(
    () =>
      new Map(
        [...(blame?.commits ?? []), ...(revision ? [revision.commit] : [])].map((commit) => [
          commit.id,
          commit,
        ]),
      ),
    [blame?.commits, revision],
  );
  const groups = useMemo(
    () =>
      groupLines(
        blameDisplayLines(
          blame?.lines ?? [],
          diff.value?.target.kind === 'commit' && diff.value.target.commitId === blame?.commitId
            ? diff.value.content
            : '',
          revision?.commit.id ?? '',
          revision?.path ?? '',
        ),
      ),
    [blame, diff.value, revision],
  );

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
        {history && (
          <HistoryTimeline
            revisions={history.revisions}
            selected={selectedIndex}
            onSelect={(index) => selectRevision(index, true)}
          />
        )}
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
              return (
                <div
                  className="blame-group"
                  key={`${group.commitId}:${first?.line ?? 0}:${first?.change}`}
                  data-testid="blame-group"
                >
                  <div className="blame-attribution">
                    <span
                      className={`avatar avatar-${avatarColor(commit.author.email || commit.author.name)}`}
                      aria-hidden="true"
                    >
                      {initials(commit.author.name, commit.author.email)}
                    </span>
                    <button
                      type="button"
                      className="blame-commit-button"
                      title={`${commit.subject}\n${commit.author.name} · ${formatListDate(commit.author.date)}\n${first?.originalPath ?? ''}:${first?.originalLine ?? 1}`}
                      aria-label={`${shortHash(commit.id)} · ${commit.subject || '(no subject)'}`}
                      onClick={() => openCommitDetails(commit, first?.originalPath ?? revision?.path ?? '')}
                    >
                      {commit.subject || '(no subject)'}
                    </button>
                    <time dateTime={commit.author.date}>
                      {new Date(commit.author.date).toLocaleDateString()}
                    </time>
                    <span className="blame-range">{shortHash(commit.id)}</span>
                  </div>
                  <div className="blame-lines">
                    {group.lines.map((line) => (
                      <div
                        className={`blame-line ${line.change}`}
                        key={`${line.commitId}:${line.line}:${line.change}`}
                        data-testid={line.change === 'remove' ? 'blame-deleted-line' : 'blame-line'}
                        title={`Original line ${line.originalLine} in ${line.originalPath}`}
                      >
                        <span className="blame-line-number" aria-hidden="true">
                          {line.change === 'remove' ? `−${line.line}` : line.line}
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
