import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryCommitDetailsContext } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { CommitDetails } from '../components/CommitDetails';
import { ContextMenuHost } from '../components/menu/ContextMenuHost';
import { useDesktop } from '../hooks/use-desktop';
import { detectPlatform } from '../lib/platform';

/** The privileged host supplies this window's repository/commit; no URL carries repository paths. */
export default function CommitInspector() {
  const desktop = useDesktop();
  const [platform] = useState(detectPlatform);
  const [context, setContext] = useState<RepositoryCommitDetailsContext>();
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    void window.desktop?.repository
      .getCommitDetailsContext()
      .then(unwrapResult)
      .then((value) => {
        if (!active) return;
        document.documentElement.dataset.theme = value.theme;
        setContext(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Commit details are unavailable.');
      });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    if (context)
      document.title = `${context.commit.id.slice(0, 7)} — ${context.commit.subject} — Git Workbench`;
  }, [context]);
  const selectCommit = useCallback(
    (commitId: string) => {
      if (!context || !window.desktop) return;
      const request = ++generation.current;
      setError(undefined);
      void window.desktop.repository
        .getHistory({
          id: context.repositoryId,
          offset: 0,
          limit: 1,
          filter: { kind: 'reference', target: commitId },
        })
        .then(unwrapResult)
        .then((page) => {
          if (request !== generation.current) return;
          const commit = page.commits.find((candidate) => candidate.id === commitId);
          if (!commit) throw new Error('That parent commit is no longer available.');
          setContext((current) =>
            current ? { ...current, commit, references: page.references, path: undefined } : current,
          );
        })
        .catch((reason: unknown) => {
          if (request === generation.current)
            setError(reason instanceof Error ? reason.message : 'The commit could not be loaded.');
        });
    },
    [context],
  );
  return (
    <ContextMenuHost platform={desktop.info?.platform ?? platform}>
      <main className="commit-inspector" aria-label="Commit details window" data-testid="commit-inspector">
        {(error || desktop.error) && (
          <div className="inline-alert" role="alert">
            {error ?? desktop.error}
          </div>
        )}
        {context ? (
          <CommitDetails
            repositoryId={context.repositoryId}
            commit={context.commit}
            lane={0}
            referencesByName={new Map(context.references.map((reference) => [reference.fullName, reference]))}
            loadedCommitIds={new Set([context.commit.id])}
            onSelectCommit={selectCommit}
            standalone
            initialTab={context.tab}
            initialPath={context.path}
          />
        ) : (
          <p className="details-empty">
            {error ? 'Close this window and reopen the commit.' : 'Reading commit details…'}
          </p>
        )}
      </main>
    </ContextMenuHost>
  );
}
