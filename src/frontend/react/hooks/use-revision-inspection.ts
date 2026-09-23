import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryCommitChanges,
  RepositoryRevisionBlob,
  RepositoryRevisionTree,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

function actionError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export type RevisionDirectory =
  | { readonly status: 'loading' }
  | {
      readonly status: 'loaded';
      readonly tree: RepositoryRevisionTree;
      readonly loadingMore?: boolean;
      readonly moreError?: string;
    }
  | { readonly status: 'error'; readonly message: string };

export type RevisionInspection = ReturnType<typeof useRevisionInspection>;

/** Loads committed revision data with guards for fast commit, directory, and file selection changes. */
export function useRevisionInspection(repositoryId: string | undefined, commitId: string | undefined) {
  const key = `${repositoryId}:${commitId}`;
  const [owner, setOwner] = useState(key);
  const [changes, setChanges] = useState<RepositoryCommitChanges>();
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string>();
  // Directories load one at a time as folders expand, keyed by their path ('' is the root).
  const [directories, setDirectories] = useState<ReadonlyMap<string, RevisionDirectory>>(() => new Map());
  const [blob, setBlob] = useState<RepositoryRevisionBlob>();
  const [blobPath, setBlobPath] = useState<string>();
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobError, setBlobError] = useState<string>();
  const revisionGeneration = useRef(0);
  const changesRequestGeneration = useRef(0);
  const blobRequestGeneration = useRef(0);
  const directoryRequests = useRef(new Set<string>());

  useEffect(() => {
    setOwner(key);
    revisionGeneration.current += 1;
    changesRequestGeneration.current += 1;
    blobRequestGeneration.current += 1;
    setChanges(undefined);
    setChangesLoading(false);
    setChangesError(undefined);
    setDirectories(new Map());
    directoryRequests.current = new Set();
    setBlob(undefined);
    setBlobPath(undefined);
    setBlobLoading(false);
    setBlobError(undefined);
    return () => {
      revisionGeneration.current += 1;
      changesRequestGeneration.current += 1;
      blobRequestGeneration.current += 1;
    };
  }, [key]);

  const loadChanges = useCallback(async () => {
    if (!repositoryId || !commitId) return;
    const revision = revisionGeneration.current;
    const request = changesRequestGeneration.current + 1;
    changesRequestGeneration.current = request;
    setChangesLoading(true);
    setChangesError(undefined);
    try {
      const api = window.desktop;
      if (!api) throw new Error('Open this application in Electron to inspect commit changes.');
      const value = unwrapResult(await api.repository.getCommitChanges({ id: repositoryId, commitId }));
      if (revision !== revisionGeneration.current || request !== changesRequestGeneration.current) return;
      setChanges(value);
    } catch (reason: unknown) {
      if (revision === revisionGeneration.current && request === changesRequestGeneration.current) {
        setChangesError(actionError(reason, 'The selected commit changes could not be loaded.'));
      }
    } finally {
      if (revision === revisionGeneration.current && request === changesRequestGeneration.current) {
        setChangesLoading(false);
      }
    }
  }, [commitId, repositoryId]);

  const loadDirectory = useCallback(
    async (path: string, append = false) => {
      if (!repositoryId || !commitId || directoryRequests.current.has(path)) return;
      const previous = append ? directories.get(path) : undefined;
      const offset = previous?.status === 'loaded' ? previous.tree.nextOffset : undefined;
      if (append && offset == null) return;
      directoryRequests.current.add(path);
      const revision = revisionGeneration.current;
      const update = (state: RevisionDirectory) =>
        setDirectories((current) => new Map(current).set(path, state));
      update(
        previous?.status === 'loaded'
          ? { status: 'loaded', tree: previous.tree, loadingMore: true }
          : { status: 'loading' },
      );
      try {
        const api = window.desktop;
        if (!api) throw new Error('Open this application in Electron to inspect the revision tree.');
        const tree = unwrapResult(
          await api.repository.getRevisionTree({
            id: repositoryId,
            commitId,
            path,
            ...(offset != null ? { offset } : {}),
          }),
        );
        if (revision === revisionGeneration.current)
          update({
            status: 'loaded',
            tree:
              previous?.status === 'loaded'
                ? { ...tree, entries: [...previous.tree.entries, ...tree.entries] }
                : tree,
          });
      } catch (reason: unknown) {
        if (revision === revisionGeneration.current) {
          const message = actionError(reason, 'The revision tree could not be loaded.');
          update(
            previous?.status === 'loaded'
              ? { status: 'loaded', tree: previous.tree, moreError: message }
              : { status: 'error', message },
          );
        }
      } finally {
        if (revision === revisionGeneration.current) directoryRequests.current.delete(path);
      }
    },
    [commitId, repositoryId, directories],
  );

  const loadBlob = useCallback(
    async (path: string) => {
      if (!repositoryId || !commitId) return;
      const revision = revisionGeneration.current;
      const request = blobRequestGeneration.current + 1;
      blobRequestGeneration.current = request;
      setBlobPath(path);
      setBlob(undefined);
      setBlobLoading(true);
      setBlobError(undefined);
      try {
        const api = window.desktop;
        if (!api) throw new Error('Open this application in Electron to inspect the revision file.');
        const value = unwrapResult(
          await api.repository.getRevisionBlob({ id: repositoryId, commitId, path }),
        );
        if (revision !== revisionGeneration.current || request !== blobRequestGeneration.current) return;
        setBlob(value);
      } catch (reason: unknown) {
        if (revision === revisionGeneration.current && request === blobRequestGeneration.current) {
          setBlobError(actionError(reason, 'The revision file could not be loaded.'));
        }
      } finally {
        if (revision === revisionGeneration.current && request === blobRequestGeneration.current) {
          setBlobLoading(false);
        }
      }
    },
    [commitId, repositoryId],
  );

  return {
    changes: owner === key ? changes : undefined,
    changesLoading,
    changesError,
    loadChanges,
    directories: owner === key ? directories : new Map<string, RevisionDirectory>(),
    loadDirectory,
    blob: owner === key ? blob : undefined,
    blobPath: owner === key ? blobPath : undefined,
    blobLoading,
    blobError,
    loadBlob,
  };
}
