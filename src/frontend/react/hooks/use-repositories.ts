import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GitInfo,
  RecentRepository,
  RepositoryManagerRepository,
  RepositoryManagerSnapshot,
  RepositorySummary,
  RepositoryTabOrientation,
  RepositoryTabPreferences,
} from '../../../common/ipc/contracts';
import type { DesktopApi } from '../../../common/ipc/api';
import { unwrapResult } from '../../../common/ipc/result';

type RepositoryBusyState =
  | 'opening'
  | 'initializing'
  | 'reopening'
  | 'closing'
  | 'removing'
  | 'adding-source'
  | 'scanning'
  | 'removing-source'
  | undefined;

const defaultTabPreferences: RepositoryTabPreferences = {
  tabOrientation: 'horizontal',
  activeRepositoryId: null,
};

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
  const [tabPreferences, setTabPreferences] = useState<RepositoryTabPreferences>(defaultTabPreferences);
  const [recentlyClosed, setRecentlyClosed] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<RepositoryBusyState>();
  const [error, setError] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  // The Repository Manager is a transient renderer tab, like a browser's new-tab page.
  const [managerTab, setManagerTab] = useState({ open: false, active: false });
  const generation = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef<RepositoryBusyState>(undefined);
  const openRef = useRef<RepositorySummary[]>([]);
  busyRef.current = busy;
  openRef.current = open;

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
      const [gitResult, recentResult, openResult, managerResult, preferencesResult] = await Promise.all([
        api.repository.getGitInfo(),
        api.repository.listRecent(),
        api.repository.listOpen(),
        api.repository.listManager(),
        api.repository.getTabPreferences(),
      ]);
      if (!mounted.current || generation.current !== requestGeneration) return;
      const nextGitInfo = unwrapResult(gitResult);
      const nextRecent = unwrapResult(recentResult);
      const nextOpen = unwrapResult(openResult);
      const nextManager = unwrapResult(managerResult);
      const nextPreferences = unwrapResult(preferencesResult);
      setGitInfo(nextGitInfo);
      setRecent(nextRecent);
      setOpen(nextOpen);
      setManager(nextManager);
      setTabPreferences(nextPreferences);
      setActiveId((current) => {
        if (current && nextOpen.some((repository) => repository.id === current)) return current;
        if (
          nextPreferences.activeRepositoryId &&
          nextOpen.some((repository) => repository.id === nextPreferences.activeRepositoryId)
        ) {
          return nextPreferences.activeRepositoryId;
        }
        return nextOpen[0]?.id;
      });
      setError(undefined);
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) setError(actionError(reason));
    } finally {
      if (mounted.current && generation.current === requestGeneration) setLoading(false);
    }
  }, []);

  const refreshOpen = useCallback(async () => {
    const api = desktopApi();
    if (!api || openRef.current.length === 0 || busyRef.current) return;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    try {
      const nextOpen = unwrapResult(await api.repository.listOpen());
      if (!mounted.current || generation.current !== requestGeneration) return;
      setOpen(nextOpen);
      setActiveId((current) =>
        current && nextOpen.some((repository) => repository.id === current) ? current : nextOpen[0]?.id,
      );
    } catch (reason: unknown) {
      if (mounted.current && generation.current === requestGeneration) setError(actionError(reason));
    }
  }, []);

  const leaveManagerTab = useCallback(() => {
    setManagerTab((current) => (current.active ? { open: false, active: false } : current));
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void refreshOpen(), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshOpen]);

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
      setRecentlyClosed((current) => current.filter((candidate) => candidate.id !== repository.id));
      setActiveId(repository.id);
      leaveManagerTab();
      await load();
    } catch (reason: unknown) {
      if (mounted.current) setError(actionError(reason));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }, [leaveManagerTab, load]);

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
      setRecentlyClosed((current) => current.filter((candidate) => candidate.id !== repository.id));
      setActiveId(repository.id);
      leaveManagerTab();
      await load();
    } catch (reason: unknown) {
      if (mounted.current) setError(actionError(reason));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }, [leaveManagerTab, load]);

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
        setRecentlyClosed((current) => current.filter((candidate) => candidate.id !== repository.id));
        setActiveId(repository.id);
        leaveManagerTab();
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [leaveManagerTab, load],
  );

  const closeRepository = useCallback(
    async (id: string) => {
      const api = desktopApi();
      if (!api) return;
      const closing = open.find((repository) => repository.id === id);
      setBusy('closing');
      setError(undefined);
      try {
        unwrapResult(await api.repository.close({ id }));
        if (closing) {
          setRecentlyClosed((current) =>
            [closing, ...current.filter((candidate) => candidate.id !== closing.id)].slice(0, 20),
          );
        }
        setActiveId((current) => {
          if (current !== id) return current;
          return open.find((repository) => repository.id !== id)?.id;
        });
        await load();
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) setBusy(undefined);
      }
    },
    [load, open],
  );

  /** Closes every repository tab, or every tab except `keepId`. */
  const closeRepositoryTabs = useCallback(
    async (keepId: string | null) => {
      const api = desktopApi();
      const closing = openRef.current.filter((repository) => repository.id !== keepId);
      if (!api || closing.length === 0) return;
      setBusy('closing');
      setError(undefined);
      const closed: RepositorySummary[] = [];
      try {
        for (const repository of closing) {
          unwrapResult(await api.repository.close({ id: repository.id }));
          closed.unshift(repository);
        }
        if (keepId) {
          setActiveId(keepId);
          setManagerTab((current) => ({ ...current, active: false }));
          unwrapResult(await api.repository.selectTab({ id: keepId }));
        } else {
          setActiveId(undefined);
        }
      } catch (reason: unknown) {
        if (mounted.current) setError(actionError(reason));
      } finally {
        if (mounted.current) {
          setRecentlyClosed((current) =>
            [
              ...closed,
              ...current.filter((candidate) => !closed.some((tab) => tab.id === candidate.id)),
            ].slice(0, 20),
          );
          await load();
          setBusy(undefined);
        }
      }
    },
    [load],
  );

  const reopenClosed = useCallback(async () => {
    const api = desktopApi();
    const candidate = recentlyClosed[0];
    if (!api || !candidate) return;
    setBusy('reopening');
    setError(undefined);
    try {
      const repository = unwrapResult(await api.repository.open({ path: candidate.path }));
      setRecentlyClosed((current) => current.filter((tab) => tab.id !== candidate.id));
      setActiveId(repository.id);
      leaveManagerTab();
      await load();
    } catch (reason: unknown) {
      if (mounted.current) setError(actionError(reason));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }, [leaveManagerTab, load, recentlyClosed]);

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

  const setTabOrientation = useCallback(
    async (orientation: RepositoryTabOrientation) => {
      const api = desktopApi();
      if (!api) {
        setError('Open this application in Electron to manage repositories.');
        return;
      }
      const previousOrientation = tabPreferences.tabOrientation;
      setError(undefined);
      try {
        setTabPreferences((current) => ({ ...current, tabOrientation: orientation }));
        const nextPreferences = unwrapResult(await api.repository.setTabOrientation(orientation));
        if (mounted.current) setTabPreferences(nextPreferences);
      } catch (reason: unknown) {
        if (mounted.current) {
          setTabPreferences((current) => ({ ...current, tabOrientation: previousOrientation }));
          setError(actionError(reason));
        }
      }
    },
    [tabPreferences.tabOrientation],
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

  const select = useCallback(
    (id: string) => {
      if (!open.some((repository) => repository.id === id)) return;
      setActiveId(id);
      setManagerTab((current) => ({ ...current, active: false }));
      const api = desktopApi();
      if (!api) return;
      void api.repository.selectTab({ id }).then((result) => {
        if (mounted.current && !result.ok) setError(result.error.message);
      });
    },
    [open],
  );

  const openManagerRepository = useCallback(
    async (repository: RepositoryManagerRepository) => {
      if (repository.sessionId) {
        select(repository.sessionId);
        return;
      }
      await openRecent(repository.path);
    },
    [openRecent, select],
  );

  const openManagerTab = useCallback(() => setManagerTab({ open: true, active: true }), []);
  const closeManagerTab = useCallback(() => setManagerTab({ open: false, active: false }), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const managerActive = open.length === 0 || managerTab.active;

  return {
    gitInfo,
    recent,
    open,
    manager,
    managerActive,
    managerTabOpen: open.length === 0 || managerTab.open,
    openManagerTab,
    closeManagerTab,
    closeRepositoryTabs,
    reportError,
    active: managerActive ? undefined : open.find((repository) => repository.id === activeId),
    lastActive: open.find((repository) => repository.id === activeId),
    tabOrientation: tabPreferences.tabOrientation,
    recentlyClosed,
    select,
    loading,
    busy,
    error,
    retry: load,
    refreshOpen,
    openExisting,
    initialize,
    openRecent,
    closeRepository,
    reopenClosed,
    removeRecent,
    addSourceDirectory,
    removeSourceDirectory,
    rescanSourceDirectory,
    openManagerRepository,
    setTabOrientation,
  };
}
