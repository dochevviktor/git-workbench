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

/** Loads committed revision data with guards for fast commit, directory, and file selection changes. */
export function useRevisionInspection(repositoryId: string | undefined, commitId: string | undefined) {
  const [changes, setChanges] = useState<RepositoryCommitChanges>();
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string>();
  const [tree, setTree] = useState<RepositoryRevisionTree>();
  const [treePath, setTreePath] = useState('');
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string>();
  const [blob, setBlob] = useState<RepositoryRevisionBlob>();
  const [blobPath, setBlobPath] = useState<string>();
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobError, setBlobError] = useState<string>();
  const revisionGeneration = useRef(0);
  const changesRequestGeneration = useRef(0);
  const treeRequestGeneration = useRef(0);
  const blobRequestGeneration = useRef(0);

  useEffect(() => {
    revisionGeneration.current += 1;
    changesRequestGeneration.current += 1;
    treeRequestGeneration.current += 1;
    blobRequestGeneration.current += 1;
    setChanges(undefined);
    setChangesLoading(false);
    setChangesError(undefined);
    setTree(undefined);
    setTreePath('');
    setTreeLoading(false);
    setTreeError(undefined);
    setBlob(undefined);
    setBlobPath(undefined);
    setBlobLoading(false);
    setBlobError(undefined);
  }, [commitId, repositoryId]);

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

  const loadTree = useCallback(
    async (path: string) => {
      if (!repositoryId || !commitId) return;
      const revision = revisionGeneration.current;
      const request = treeRequestGeneration.current + 1;
      treeRequestGeneration.current = request;
      setTreePath(path);
      setTree(undefined);
      setTreeLoading(true);
      setTreeError(undefined);
      setBlob(undefined);
      setBlobPath(undefined);
      setBlobError(undefined);
      try {
        const api = window.desktop;
        if (!api) throw new Error('Open this application in Electron to inspect the revision tree.');
        const value = unwrapResult(
          await api.repository.getRevisionTree({ id: repositoryId, commitId, path }),
        );
        if (revision !== revisionGeneration.current || request !== treeRequestGeneration.current) return;
        setTree(value);
      } catch (reason: unknown) {
        if (revision === revisionGeneration.current && request === treeRequestGeneration.current) {
          setTreeError(actionError(reason, 'The revision tree could not be loaded.'));
        }
      } finally {
        if (revision === revisionGeneration.current && request === treeRequestGeneration.current) {
          setTreeLoading(false);
        }
      }
    },
    [commitId, repositoryId],
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
    changes,
    changesLoading,
    changesError,
    loadChanges,
    tree,
    treePath,
    treeLoading,
    treeError,
    loadTree,
    blob,
    blobPath,
    blobLoading,
    blobError,
    loadBlob,
  };
}
