import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GitInfo,
  RecentRepository,
  RepositoryManagerRepository,
  RepositoryManagerSnapshot,
  RepositorySummary,
} from '../../../common/ipc/contracts';
import type { DesktopApi } from '../../../common/ipc/api';
import { unwrapResult } from '../../../common/ipc/result';

type RepositoryBusyState =
  | 'opening'
  | 'initializing'
  | 'closing'
  | 'removing'
  | 'adding-source'
  | 'scanning'
  | 'removing-source'
  | undefined;

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The repository action could not be completed.';
}

function desktopApi(): DesktopApi | undefined {
  return window.desktop;
}

export function useRepositories() {
  const [gitInfo, setGitInfo] = useState<GitInfo>();
  const [recent, setRecent] = useState<RecentRepository[]>([]);
  const [open, setOpen] = useState<RepositorySummary[]>([]);
  const [manager, setManager] = useState<RepositoryManagerSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<RepositoryBusyState>();
  const [error, setError] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const api = desktopApi();
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    if (!api) {
      setError('Open this application in Electron to manage repositories.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [gitResult, recentResult, openResult, managerResult] = await Promise.all([
        api.repository.getGitInfo(),
        api.repository.listRecent(),
        api.repository.listOpen(),
        api.repository.listManager(),
      ]);
      if (!mounted.current || generation.current !== requestGeneration) return;
      const nextGitInfo = unwrapResult(gitResult);
      const nextRecent = unwrapResult(recentResult);
      const nextOpen = unwrapResult(openResult);
      const nextManager = unwrapResult(managerResult);
      setGitInfo(nextGitInfo);
      setRecent(nextRecent);
      setOpen(nextOpen);
      setManager(nextManager);
      setActiveId((current) =>
        current && nextOpen.some((repository) => repository.id === current) ? current : nextOpen[0]?.id,
      );
      setError(undefined);
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) setError(actionError(reason));
    } finally {
      if (mounted.current && generation.current === requestGeneration) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const openExisting = useCallback(async () => {
    const api = desktopApi();
    if (!api) {
      setError('Open this application in Electron to manage repositories.');
      return;
    }
    setBusy('opening');
    setError(undefined);
    try {
      const pickedPath = unwrapResult(await api.repository.pickDirectory());
      if (pickedPath === null) return;
      const repository = unwrapResult(await api.repository.open({ path: pickedPath }));
      setActiveId(repository.id);
      await load();
    } catch (reason: unknown) {
      if (mounted.current) setError(actionError(reason));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }, [load]);

  const initialize = useCallback(async () => {
    const api = desktopApi();
    if (!api) {
      setError('Open this application in Electron to manage repositories.');
      return;
    }
    setBusy('initializing');
    setError(undefined);
    try {
      const pickedPath = unwrapResult(await api.repository.pickDirectory());
      if (pickedPath === null) return;
      const repository = unwrapResult(await api.repository.initialize({ path: pickedPath, bare: false }));
      setActiveId(repository.id);
      await load();
    } catch (reason: unknown) {
      if (mounted.current) setError(actionError(reason));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }, [load]);

  const openRecent = useCallback(
    async (path: string) => {
      const api = desktopApi();
      if (!api) {
        setError('Open this application in Electron to manage repositories.');
        return;
      }
      setBusy('opening');
      setError(undefined);
      try {
        const repository = unwrapResult(await api.repository.open({ path }));
        setActiveId(repository.id);
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [load],
  );

  const closeRepository = useCallback(
    async (id: string) => {
      const api = desktopApi();
      if (!api) return;
      setBusy('closing');
      setError(undefined);
      try {
        unwrapResult(await api.repository.close({ id }));
        setActiveId((current) => (current === id ? undefined : current));
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [load],
  );

  const removeRecent = useCallback(
    async (id: string) => {
      const api = desktopApi();
      if (!api) return;
      setBusy('removing');
      setError(undefined);
      try {
        unwrapResult(await api.repository.removeRecent({ id }));
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [load],
  );

  const addSourceDirectory = useCallback(async () => {
    const api = desktopApi();
    if (!api) {
      setError('Open this application in Electron to manage repositories.');
      return;
    }
    setBusy('adding-source');
    setError(undefined);
    try {
      const pickedPath = unwrapResult(await api.repository.pickDirectory());
      if (pickedPath === null) return;
      unwrapResult(await api.repository.addSourceDirectory({ path: pickedPath }));
      await load();
    } catch (reason: unknown) {
      if (mounted.current) setError(actionError(reason));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }, [load]);

  const removeSourceDirectory = useCallback(
    async (id: string) => {
      const api = desktopApi();
      if (!api) return;
      setBusy('removing-source');
      setError(undefined);
      try {
        unwrapResult(await api.repository.removeSourceDirectory({ id }));
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [load],
  );

  const rescanSourceDirectory = useCallback(
    async (id: string) => {
      const api = desktopApi();
      if (!api) return;
      setBusy('scanning');
      setError(undefined);
      try {
        unwrapResult(await api.repository.rescanSourceDirectory({ id }));
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [load],
  );

  const openManagerRepository = useCallback(
    async (repository: RepositoryManagerRepository) => {
      if (repository.sessionId) {
        setActiveId(repository.sessionId);
        return;
      }
      await openRecent(repository.path);
    },
    [openRecent],
  );

  const select = useCallback((id: string) => setActiveId(id), []);

  return {
    gitInfo,
    recent,
    open,
    manager,
    active: open.find((repository) => repository.id === activeId),
    select,
    loading,
    busy,
    error,
    retry: load,
    openExisting,
    initialize,
    openRecent,
    closeRepository,
    removeRecent,
    addSourceDirectory,
    removeSourceDirectory,
    rescanSourceDirectory,
    openManagerRepository,
  };
}
