import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type {
  RepositoryBranch,
  RepositoryHistoryCommit,
  RepositoryHistoryReference,
  RepositoryLocation,
  RepositoryNetworkRequest,
  RepositoryReferenceAction,
  RepositoryRemoteAction,
  RepositoryLocalChangesPreview,
} from '../../../common/ipc/contracts';
import { AboutDialog } from '../components/AboutDialog';
import { ChangesView } from '../components/ChangesView';
import { HistoryView } from '../components/HistoryView';
import type { HistoryReferenceCommands } from '../components/HistoryView';
import { CheckIcon, WarningIcon } from '../components/Icons';
import { NetworkDialog } from '../components/NetworkDialogs';
import type { NetworkDialogRequest } from '../components/NetworkDialogs';
import { ReferenceDialog } from '../components/ReferenceDialogs';
import { RecoveryPanel } from '../components/RecoveryPanel';
import type { ReferenceDialogRequest, ReferenceTarget } from '../components/ReferenceDialogs';
import { RepositoryManagerView } from '../components/RepositoryManagerView';
import { RepositorySidebar } from '../components/RepositorySidebar';
import type { RepositoryView } from '../components/RepositorySidebar';
import { RepositoryTabs } from '../components/RepositoryTabs';
import type { WorkspaceTab } from '../components/RepositoryTabs';
import { Splitter } from '../components/Splitter';
import { TitleBar } from '../components/TitleBar';
import type { TitleBarMenu } from '../components/TitleBar';
import { Toolbar } from '../components/Toolbar';
import { ContextMenuHost } from '../components/menu/ContextMenuHost';
import { useContextMenu } from '../components/menu/context-menu';
import { compactMenu, contextMenuAnchor, menuSeparator, planned } from '../components/menu/menu-model';
import type { MenuEntry } from '../components/menu/menu-model';
import { useDesktop } from '../hooks/use-desktop';
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import { runningOperation, useOperations } from '../hooks/use-operations';
import { useReferences } from '../hooks/use-references';
import { useRepositories } from '../hooks/use-repositories';
import { useRepositoryHistory } from '../hooks/use-repository-history';
import { copyText } from '../lib/clipboard';
import { shortHash } from '../lib/format';
import { detectPlatform, matchesShortcut } from '../lib/platform';
import type { Platform } from '../lib/platform';

const appearances = ['system', 'light', 'dark'] as const;
type Appearance = (typeof appearances)[number];
const appearanceLabels: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const managerTabId = 'repository-manager';

type Desktop = ReturnType<typeof useDesktop>;

export default function App() {
  const desktop = useDesktop();
  const [detectedPlatform] = useState(detectPlatform);
  const platform = desktop.info?.platform ?? detectedPlatform;

  return (
    <ContextMenuHost platform={platform}>
      <Workbench desktop={desktop} platform={platform} />
    </ContextMenuHost>
  );
}

function Workbench({ desktop, platform }: { readonly desktop: Desktop; readonly platform: Platform }) {
  const { info, windowState, windowCommand } = desktop;
  const repositories = useRepositories();
  const {
    gitInfo,
    recent,
    open,
    manager,
    active,
    lastActive,
    managerActive,
    managerTabOpen,
    tabOrientation,
    recentlyClosed,
    loading: repositoriesLoading,
    busy,
    error: repositoryError,
    retry: retryRepositories,
    refreshOpen,
    openExisting,
    initialize,
    openRecent,
    closeRepository,
    closeRepositoryTabs,
    reopenClosed,
    removeRecent,
    addSourceDirectory,
    removeSourceDirectory,
    rescanSourceDirectory,
    openManagerTab,
    closeManagerTab,
    reportError,
    select,
    setTabOrientation,
  } = repositories;
  // History stays loaded for the last repository tab while the Repository Manager tab is in front.
  const history = useRepositoryHistory(lastActive?.id);
  const {
    refresh: refreshHistory,
    selectCommit,
    references,
    setFilter: setHistoryFilter,
    requestReveal,
  } = history;
  const showContextMenu = useContextMenu();
  const [appearance, setAppearance] = usePersistentState<Appearance>(
    'appearance',
    'system',
    isOneOf(appearances),
  );
  const [sidebarWidth, setSidebarWidth] = usePersistentState(
    'layout.sidebarWidth',
    248,
    isNumberBetween(180, 520),
  );
  const [views, setViews] = useState<Readonly<Record<string, RepositoryView>>>({});
  const [aboutOpen, setAboutOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const activeRepositoryId = useRef(active?.id);
  activeRepositoryId.current = active?.id;
  const repositoryRevision = `${lastActive?.head.name ?? ''}:${lastActive?.head.commit ?? ''}:${lastActive?.referenceVersion ?? ''}`;
  const lastRevision = useRef(repositoryRevision);
  useEffect(() => {
    if (lastRevision.current === repositoryRevision) return;
    lastRevision.current = repositoryRevision;
    refreshHistory();
    setRefreshSignal((value) => value + 1);
  }, [repositoryRevision, refreshHistory]);
  const {
    context: referenceContext,
    remotes,
    busy: referenceRequestBusy,
    apply: applyReference,
    applyRemote,
    reload: reloadReferences,
  } = useReferences(lastActive?.id, refreshSignal);
  const {
    operations,
    error: operationError,
    start: startOperation,
    cancel: cancelOperation,
  } = useOperations();
  const referenceBusy = referenceRequestBusy || runningOperation(operations, active?.id) !== undefined;
  const [localChangesPreview, setLocalChangesPreview] = useState<RepositoryLocalChangesPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const previewGeneration = useRef(0);
  const [dialogSnapshot, setDialogSnapshot] = useState<string>();
  const [referenceDialog, setReferenceDialog] = useState<ReferenceDialogRequest>();
  const [referenceFailure, setReferenceFailure] = useState<{
    readonly message: string;
    readonly canForce: boolean;
  }>();
  const [referenceStatus, setReferenceStatus] = useState<{
    readonly message: string;
    readonly blocked: boolean;
  }>();
  const development = info?.mode === 'development';
  const nativeMenu = platform === 'darwin';
  const repositoryBusy = busy !== undefined;
  const view: RepositoryView = active && !active.bare ? (views[active.id] ?? 'history') : 'history';

  useEffect(() => {
    // Menus are portaled to the document body, so theme tokens live on the root element.
    document.documentElement.dataset.theme = appearance;
    document.documentElement.dataset.platform = platform;
  }, [appearance, platform]);

  useEffect(() => {
    document.title = active ? `${active.name} — Git Workbench` : 'Git Workbench';
  }, [active]);

  const setView = useCallback(
    (next: RepositoryView) => {
      if (active) setViews((current) => ({ ...current, [active.id]: next }));
    },
    [active],
  );

  const openInFileManager = useCallback(
    (location: RepositoryLocation) => {
      void window.desktop?.repository.openInFileManager(location).then((result) => {
        if (!result.ok) reportError(result.error.message);
      });
    },
    [reportError],
  );

  const tabs = useMemo<WorkspaceTab[]>(
    () => [
      ...open.map((repository): WorkspaceTab => ({
        id: repository.id,
        kind: 'repository',
        title: repository.name,
        repository,
      })),
      ...(managerTabOpen
        ? [{ id: managerTabId, kind: 'manager', title: 'Repository Manager' } as const]
        : []),
    ],
    [managerTabOpen, open],
  );
  const activeTabId = managerActive ? managerTabId : active?.id;

  const selectTab = useCallback(
    (tab: WorkspaceTab) => {
      if (tab.kind === 'manager') openManagerTab();
      else select(tab.id);
    },
    [openManagerTab, select],
  );

  const closeTab = useCallback(
    (tab: WorkspaceTab) => {
      if (tab.kind === 'manager') {
        if (open.length > 0) closeManagerTab();
      } else if (!repositoryBusy) {
        void closeRepository(tab.id);
      }
    },
    [closeManagerTab, closeRepository, open.length, repositoryBusy],
  );

  const closeActiveTab = useCallback(() => {
    const tab = tabs.find((candidate) => candidate.id === activeTabId);
    if (tab) closeTab(tab);
  }, [activeTabId, closeTab, tabs]);

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      if (tabs.length < 2) return;
      const index = tabs.findIndex((tab) => tab.id === activeTabId);
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      if (next) selectTab(next);
    },
    [activeTabId, selectTab, tabs],
  );

  const refresh = useCallback(() => {
    refreshHistory();
    void refreshOpen();
    setRefreshSignal((value) => value + 1);
  }, [refreshHistory, refreshOpen]);

  const revealCommit = useCallback(
    (id: string) => {
      setView('history');
      selectCommit(id);
      window.requestAnimationFrame(() =>
        document.getElementById(`history-commit-${id}`)?.scrollIntoView({ block: 'center' }),
      );
    },
    [selectCommit, setView],
  );

  const revealSearchResult = useCallback(
    (commitId: string) => {
      setView('history');
      requestReveal(commitId);
    },
    [requestReveal, setView],
  );

  const referencesReady = referenceContext !== undefined && referenceContext.repositoryId === active?.id;
  const referenceLoading = 'The branches and tags of this repository are still loading.';

  const loadLocalChangesPreview = useCallback(() => {
    const generation = ++previewGeneration.current;
    setLocalChangesPreview(undefined);
    setPreviewError(undefined);
    const id = active?.id;
    if (!id || active.bare) return;
    void window.desktop?.repository.previewLocalChanges({ id }).then((result) => {
      if (activeRepositoryId.current !== id || previewGeneration.current !== generation) return;
      if (result.ok) setLocalChangesPreview(result.value);
      else setPreviewError(result.error.message);
    });
  }, [active]);

  const openReferenceDialog = useCallback(
    (request: ReferenceDialogRequest) => {
      previewGeneration.current += 1;
      setPreviewError(undefined);
      setReferenceFailure(undefined);
      setReferenceStatus(undefined);
      setDialogSnapshot(referenceContext?.snapshot);
      if (request.kind.startsWith('checkout') || request.kind === 'new-branch') loadLocalChangesPreview();
      setReferenceDialog(request);
    },
    [loadLocalChangesPreview, referenceContext?.snapshot],
  );

  const closeReferenceDialog = useCallback(() => {
    previewGeneration.current += 1;
    setReferenceDialog(undefined);
    setReferenceFailure(undefined);
  }, []);

  /**
   * Runs one branch or tag action. A refusal the backend foresaw is shown where the user is looking:
   * in the open dialog when there is one, and always in the status strip, so nothing fails silently.
   */
  const runReferenceAction = useCallback(
    (action: RepositoryReferenceAction) => {
      const owner = active?.id;
      void applyReference(action, referenceDialog ? dialogSnapshot : undefined)
        .then((result) => {
          if (activeRepositoryId.current !== owner) return;
          if (result.status === 'applied') {
            setReferenceDialog(undefined);
            setReferenceFailure(undefined);
            setReferenceStatus({ message: result.message, blocked: false });
            refresh();
            return;
          }
          const detail = result.paths.length > 0 ? ` (${result.paths.slice(0, 3).join(', ')})` : '';
          setReferenceFailure({ message: result.message, canForce: result.canForce });
          setReferenceStatus({ message: `${result.message}${detail}`, blocked: true });
        })
        .catch((reason: unknown) => {
          if (activeRepositoryId.current !== owner) return;
          reportError(reason instanceof Error ? reason.message : 'That branch or tag action failed.');
          reloadReferences();
        });
    },
    [active?.id, applyReference, dialogSnapshot, referenceDialog, refresh, reloadReferences, reportError],
  );

  const commitTarget = useCallback(
    (commit: RepositoryHistoryCommit): ReferenceTarget => ({
      startPoint: { kind: 'commit', commitId: commit.id },
      icon: 'commit',
      label: shortHash(commit.id),
      detail: commit.subject || '(no subject)',
    }),
    [],
  );

  const referenceTarget = useCallback(
    (reference: RepositoryHistoryReference): ReferenceTarget => ({
      startPoint: { kind: 'reference', fullName: reference.fullName },
      icon: reference.kind === 'remote' ? 'remote' : reference.kind === 'tag' ? 'tag' : 'branch',
      label: reference.name,
      detail: shortHash(reference.target),
      // Only a remote-tracking branch offers to become the new branch's upstream.
      trackable: reference.kind === 'remote' ? reference.name : undefined,
    }),
    [],
  );

  /** What "New Branch…" without a selected commit starts from: the current branch, or a detached HEAD. */
  const headTarget = useMemo((): ReferenceTarget | undefined => {
    if (!active || active.bare) return undefined;
    const current = referenceContext?.branches.find((branch) => branch.isHead);
    if (current) {
      return {
        startPoint: { kind: 'reference', fullName: current.fullName },
        icon: 'branch',
        label: current.name,
        detail: shortHash(current.target),
      };
    }
    if (active.head.commit) {
      return {
        startPoint: { kind: 'commit', commitId: active.head.commit },
        icon: 'commit',
        label: shortHash(active.head.commit),
        detail: 'Detached HEAD',
      };
    }
    return undefined;
  }, [active, referenceContext]);

  const headTargetReason = !referencesReady
    ? referenceLoading
    : headTarget
      ? undefined
      : 'This repository has no commit to start from yet.';

  const historyReferences = useMemo<HistoryReferenceCommands>(
    () => ({
      ready: referencesReady && !referenceBusy,
      newBranch: (commit) => openReferenceDialog({ kind: 'new-branch', target: commitTarget(commit) }),
      newTag: (commit) => openReferenceDialog({ kind: 'new-tag', target: commitTarget(commit) }),
      checkoutCommit: (commit) =>
        openReferenceDialog({ kind: 'checkout-detached', target: commitTarget(commit) }),
    }),
    [commitTarget, openReferenceDialog, referenceBusy, referencesReady],
  );

  const [networkDialog, setNetworkDialog] = useState<NetworkDialogRequest>();
  const [networkFailure, setNetworkFailure] = useState<string>();
  const [activityOpen, setActivityOpen] = useState(false);
  const activeOperation = runningOperation(operations, active?.id);

  const openNetworkDialog = useCallback(
    (request: NetworkDialogRequest) => {
      previewGeneration.current += 1;
      setPreviewError(undefined);
      setNetworkFailure(undefined);
      setDialogSnapshot(referenceContext?.snapshot);
      if (request.kind === 'pull') loadLocalChangesPreview();
      setNetworkDialog(request);
    },
    [loadLocalChangesPreview, referenceContext?.snapshot],
  );

  const closeNetworkDialog = useCallback(() => {
    previewGeneration.current += 1;
    setNetworkDialog(undefined);
    setNetworkFailure(undefined);
  }, []);

  /**
   * Starts one network operation. The request only has to be accepted: the outcome arrives as an
   * operation event, so a slow remote never blocks the window and no result is ever guessed.
   */
  const startNetwork = useCallback(
    (request: RepositoryNetworkRequest) => {
      if (!active) return;
      setNetworkFailure(undefined);
      void startOperation(active.id, request)
        .then(() => {
          if (activeRepositoryId.current !== active.id) return;
          setNetworkDialog(undefined);
          setActivityOpen(true);
        })
        .catch((reason: unknown) => {
          if (activeRepositoryId.current !== active.id) return;
          setNetworkFailure(
            reason instanceof Error ? reason.message : 'That operation could not be started.',
          );
        });
    },
    [active, startOperation],
  );

  const runRemoteAction = useCallback(
    (action: RepositoryRemoteAction) => {
      const owner = active?.id;
      setNetworkFailure(undefined);
      void applyRemote(action)
        .then((result) => {
          if (activeRepositoryId.current !== owner) return;
          if (result.status === 'blocked') {
            setNetworkFailure(result.message);
            return;
          }
          setReferenceStatus({ message: result.message, blocked: false });
          // The remotes dialog stays open so several changes can be made in one visit.
          setNetworkDialog({ kind: 'remotes' });
          refresh();
        })
        .catch((reason: unknown) => {
          if (activeRepositoryId.current !== owner) return;
          setNetworkFailure(reason instanceof Error ? reason.message : 'That remote change failed.');
        });
    },
    [active?.id, applyRemote, refresh],
  );

  // A finished operation refreshes the views whose refs or working tree it changed, once.
  const reportedOperation = useRef<string | undefined>(undefined);
  useEffect(() => {
    const completed = operations.find(
      (operation) => operation.status !== 'running' && operation.repositoryId === active?.id,
    );
    if (!completed || reportedOperation.current === completed.id) return;
    reportedOperation.current = completed.id;
    setReferenceStatus({
      message: `${completed.title}: ${completed.message}`,
      blocked: completed.status !== 'succeeded',
    });
    refresh();
  }, [active?.id, operations, refresh]);

  const networkBusyReason = activeOperation
    ? 'Another network operation is running for this repository.'
    : undefined;
  const networkDisabledReason = !referencesReady
    ? referenceLoading
    : remotes.length === 0
      ? 'This repository has no remotes yet. Add one from the Repository menu.'
      : undefined;
  const pullDisabledReason = active?.bare
    ? 'A bare repository has no working tree to pull into.'
    : active && active.head.state !== 'branch'
      ? 'Check out a branch before pulling.'
      : undefined;

  const pushBranch = useCallback(
    (branch: RepositoryBranch | undefined, force = false) => {
      openNetworkDialog({ kind: 'push', branch, force });
    },
    [openNetworkDialog],
  );

  const currentBranch = referenceContext?.branches.find((branch) => branch.isHead);

  const newReferenceItems = (
    target: ReferenceTarget | undefined,
    reason: string | undefined,
  ): MenuEntry[] => [
    {
      id: 'new-branch',
      label: 'New Branch…',
      shortcut: 'Mod+Shift+B',
      disabled: reason !== undefined || referenceBusy,
      disabledReason: reason,
      run: () => {
        if (target) openReferenceDialog({ kind: 'new-branch', target });
      },
    },
    {
      id: 'new-tag',
      label: 'New Tag…',
      disabled: reason !== undefined || referenceBusy,
      disabledReason: reason,
      run: () => {
        if (target) openReferenceDialog({ kind: 'new-tag', target });
      },
    },
  ];

  const checkoutItems: MenuEntry[] = (referenceContext?.branches ?? []).slice(0, 30).map((branch) => ({
    id: `checkout-${branch.fullName}`,
    label: branch.name,
    checkable: 'radio',
    checked: branch.isHead,
    disabled: branch.isHead || branch.worktreePath !== null || referenceBusy,
    disabledReason: branch.worktreePath
      ? `'${branch.name}' is checked out in the worktree at ${branch.worktreePath}.`
      : branch.isHead
        ? 'This branch is already checked out.'
        : undefined,
    run: () => openReferenceDialog({ kind: 'checkout-branch', branch }),
  }));

  const branchMenuItems: MenuEntry[] = compactMenu([
    ...newReferenceItems(headTarget, headTargetReason),
    menuSeparator,
    {
      id: 'checkout-branch',
      label: 'Checkout',
      disabled: checkoutItems.length === 0,
      disabledReason: referencesReady ? 'This repository has no branches yet.' : referenceLoading,
      submenu: checkoutItems,
    },
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A modal dialog owns the keyboard while it is open, including its own Escape handling.
      if (aboutOpen || referenceDialog || networkDialog) return;
      const is = (shortcut: string) => matchesShortcut(event, shortcut, platform);
      if (is('Mod+T')) openManagerTab();
      else if (is('Mod+O')) {
        if (!repositoryBusy) void openExisting();
      } else if (is('Mod+W')) closeActiveTab();
      else if (is('Mod+Shift+T')) {
        if (!repositoryBusy) void reopenClosed();
      } else if (is('Mod+Shift+B')) {
        if (headTarget && !referenceBusy) openReferenceDialog({ kind: 'new-branch', target: headTarget });
      } else if (is('Mod+Shift+F')) {
        if (active && remotes.length > 0 && !activeOperation) openNetworkDialog({ kind: 'fetch' });
      } else if (is('Ctrl+Tab')) cycleTab(1);
      else if (is('Ctrl+Shift+Tab')) cycleTab(-1);
      else if (is('F5')) refresh();
      else if (!nativeMenu && (is('Mod+=') || is('Mod+Plus'))) windowCommand('zoom-in');
      else if (!nativeMenu && is('Mod+-')) windowCommand('zoom-out');
      else if (!nativeMenu && is('Mod+0')) windowCommand('reset-zoom');
      else if (!nativeMenu && is('F11')) windowCommand('toggle-full-screen');
      else if (!nativeMenu && is('Mod+Q')) windowCommand('quit');
      else if (!nativeMenu && development && is('Mod+R')) windowCommand('reload');
      else if (!nativeMenu && development && (is('Mod+Shift+I') || is('F12'))) {
        windowCommand('toggle-developer-tools');
      } else {
        const tab =
          /^[1-9]$/u.test(event.key) && is(`Mod+${event.key}`) ? tabs[Number(event.key) - 1] : undefined;
        if (!tab) return;
        selectTab(tab);
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    aboutOpen,
    active,
    activeOperation,
    closeActiveTab,
    cycleTab,
    development,
    headTarget,
    nativeMenu,
    openExisting,
    openManagerTab,
    openNetworkDialog,
    openReferenceDialog,
    platform,
    networkDialog,
    referenceDialog,
    referenceBusy,
    remotes.length,
    refresh,
    reopenClosed,
    repositoryBusy,
    selectTab,
    tabs,
    windowCommand,
  ]);

  const appearanceItems: MenuEntry[] = appearances.map((value) => ({
    id: `appearance-${value}`,
    label: appearanceLabels[value],
    checkable: 'radio',
    checked: appearance === value,
    run: () => setAppearance(value),
  }));

  const openInItems: MenuEntry[] = [
    {
      id: 'open-in-file-manager',
      label: 'File Manager',
      disabled: !active,
      run: () => {
        if (active) openInFileManager({ kind: 'open', id: active.id });
      },
    },
    { id: 'open-in-terminal', label: 'Terminal', ...planned('Opening a terminal', 'P12') },
  ];

  const menus: TitleBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      mnemonic: 'f',
      items: compactMenu([
        { id: 'new-tab', label: 'New Tab', shortcut: 'Mod+T', run: openManagerTab },
        {
          id: 'open-repository',
          label: 'Open Repository…',
          shortcut: 'Mod+O',
          disabled: repositoryBusy,
          run: () => void openExisting(),
        },
        {
          id: 'initialize-repository',
          label: 'Initialize Repository…',
          disabled: repositoryBusy,
          run: () => void initialize(),
        },
        { id: 'clone', label: 'Clone…', ...planned('Remote cloning', 'P05') },
        menuSeparator,
        {
          id: 'open-recent',
          label: 'Open Recent',
          disabled: recent.length === 0,
          submenu: recent.slice(0, 15).map((repository) => ({
            id: `recent-${repository.id}`,
            label: repository.name,
            disabled: repositoryBusy || repository.status !== 'available',
            disabledReason:
              repository.status !== 'available' ? `${repository.path} is not available.` : undefined,
            run: () => void openRecent(repository.path),
          })),
        },
        {
          id: 'add-source-directory',
          label: 'Add Source Directory…',
          disabled: repositoryBusy,
          run: () => void addSourceDirectory(),
        },
        menuSeparator,
        {
          id: 'close-tab',
          label: 'Close Tab',
          shortcut: 'Mod+W',
          disabled: repositoryBusy || (managerActive && open.length === 0),
          run: closeActiveTab,
        },
        {
          id: 'reopen-closed-tab',
          label: 'Reopen Closed Tab',
          shortcut: 'Mod+Shift+T',
          disabled: repositoryBusy || recentlyClosed.length === 0,
          run: () => void reopenClosed(),
        },
        !nativeMenu && menuSeparator,
        !nativeMenu && {
          id: 'quit',
          label: platform === 'win32' ? 'Exit' : 'Quit',
          shortcut: 'Mod+Q',
          run: () => windowCommand('quit'),
        },
      ]),
    },
    {
      id: 'view',
      label: 'View',
      mnemonic: 'v',
      items: compactMenu([
        {
          id: 'view-changes',
          label: 'Local Changes',
          checkable: 'radio',
          checked: Boolean(active) && view === 'changes',
          disabled: !active || active.bare,
          run: () => setView('changes'),
        },
        {
          id: 'view-history',
          label: 'All Commits',
          checkable: 'radio',
          checked: Boolean(active) && view === 'history',
          disabled: !active,
          run: () => setView('history'),
        },
        menuSeparator,
        {
          id: 'tabs-horizontal',
          label: 'Horizontal Tabs',
          checkable: 'radio',
          checked: tabOrientation === 'horizontal',
          run: () => void setTabOrientation('horizontal'),
        },
        {
          id: 'tabs-vertical',
          label: 'Vertical Tabs',
          checkable: 'radio',
          checked: tabOrientation === 'vertical',
          run: () => void setTabOrientation('vertical'),
        },
        { id: 'appearance', label: 'Appearance', submenu: appearanceItems },
        !nativeMenu && menuSeparator,
        !nativeMenu && {
          id: 'zoom-in',
          label: 'Zoom In',
          shortcut: 'Mod+=',
          run: () => windowCommand('zoom-in'),
        },
        !nativeMenu && {
          id: 'zoom-out',
          label: 'Zoom Out',
          shortcut: 'Mod+-',
          run: () => windowCommand('zoom-out'),
        },
        !nativeMenu && {
          id: 'zoom-reset',
          label: 'Actual Size',
          shortcut: 'Mod+0',
          run: () => windowCommand('reset-zoom'),
        },
        !nativeMenu && menuSeparator,
        !nativeMenu && {
          id: 'full-screen',
          label: 'Toggle Full Screen',
          shortcut: 'F11',
          run: () => windowCommand('toggle-full-screen'),
        },
        !nativeMenu && development && menuSeparator,
        !nativeMenu &&
          development && {
            id: 'reload',
            label: 'Reload',
            shortcut: 'Mod+R',
            run: () => windowCommand('reload'),
          },
        !nativeMenu &&
          development && {
            id: 'developer-tools',
            label: 'Toggle Developer Tools',
            shortcut: 'Mod+Shift+I',
            run: () => windowCommand('toggle-developer-tools'),
          },
      ]),
    },
    ...(active
      ? [
          {
            id: 'repository',
            label: 'Repository',
            mnemonic: 'r',
            items: [
              { id: 'refresh', label: 'Refresh', shortcut: 'F5', run: refresh },
              menuSeparator,
              {
                id: 'fetch',
                label: 'Fetch…',
                shortcut: 'Mod+Shift+F',
                disabled: networkDisabledReason !== undefined || activeOperation !== undefined,
                disabledReason: networkDisabledReason ?? networkBusyReason,
                run: () => openNetworkDialog({ kind: 'fetch' }),
              },
              {
                id: 'pull',
                label: 'Pull',
                disabled:
                  networkDisabledReason !== undefined ||
                  pullDisabledReason !== undefined ||
                  activeOperation !== undefined,
                disabledReason: networkDisabledReason ?? pullDisabledReason ?? networkBusyReason,
                run: () => {
                  if (currentBranch) openNetworkDialog({ kind: 'pull', branch: currentBranch });
                },
              },
              {
                id: 'push',
                label: 'Push…',
                disabled: networkDisabledReason !== undefined || activeOperation !== undefined,
                disabledReason: networkDisabledReason ?? networkBusyReason,
                run: () => pushBranch(currentBranch),
              },
              {
                id: 'remotes',
                label: 'Remotes…',
                run: () => openNetworkDialog({ kind: 'remotes' }),
              },
              { id: 'save-stash', label: 'Save Stash…', ...planned('Stashing', 'P06') },
              menuSeparator,
              ...newReferenceItems(headTarget, headTargetReason),
              menuSeparator,
              {
                id: 'open-in-file-manager',
                label: 'Open in File Manager',
                run: () => openInFileManager({ kind: 'open', id: active.id }),
              },
              { id: 'copy-path', label: 'Copy Repository Path', run: () => copyText(active.path) },
            ],
          },
        ]
      : []),
    {
      id: 'window',
      label: 'Window',
      mnemonic: 'w',
      items: compactMenu([
        { id: 'minimize', label: 'Minimize', run: () => windowCommand('minimize') },
        {
          id: 'maximize',
          label: windowState?.maximized ? 'Restore' : 'Maximize',
          run: () => windowCommand('toggle-maximize'),
        },
        menuSeparator,
        {
          id: 'next-tab',
          label: 'Next Tab',
          shortcut: 'Ctrl+Tab',
          disabled: tabs.length < 2,
          run: () => cycleTab(1),
        },
        {
          id: 'previous-tab',
          label: 'Previous Tab',
          shortcut: 'Ctrl+Shift+Tab',
          disabled: tabs.length < 2,
          run: () => cycleTab(-1),
        },
        menuSeparator,
        ...tabs.map((tab, index): MenuEntry => ({
          id: `window-tab-${tab.id}`,
          label: tab.title,
          checkable: 'radio',
          checked: tab.id === activeTabId,
          shortcut: index < 9 ? `Mod+${index + 1}` : undefined,
          run: () => selectTab(tab),
        })),
      ]),
    },
    {
      id: 'help',
      label: 'Help',
      mnemonic: 'h',
      items: [{ id: 'about', label: 'About Git Workbench', run: () => setAboutOpen(true) }],
    },
  ];

  const openTabMenu = (tab: WorkspaceTab, event: ReactMouseEvent<HTMLElement>) => {
    const repository = tab.repository;
    showContextMenu({
      anchor: contextMenuAnchor(event, event.currentTarget),
      label: `${tab.title} tab`,
      items: compactMenu([
        {
          id: 'close-tab',
          label: 'Close Tab',
          shortcut: 'Mod+W',
          disabled: repositoryBusy || (tab.kind === 'manager' && open.length === 0),
          run: () => closeTab(tab),
        },
        repository && {
          id: 'close-all-but-this',
          label: 'Close All But This',
          disabled: repositoryBusy || open.length < 2,
          run: () => void closeRepositoryTabs(repository.id),
        },
        {
          id: 'close-all',
          label: 'Close All',
          disabled: repositoryBusy || open.length === 0,
          run: () => void closeRepositoryTabs(null),
        },
        {
          id: 'reopen-closed-tab',
          label: 'Reopen Closed Tab',
          shortcut: 'Mod+Shift+T',
          disabled: repositoryBusy || recentlyClosed.length === 0,
          run: () => void reopenClosed(),
        },
        { id: 'new-tab', label: 'New Tab', shortcut: 'Mod+T', run: openManagerTab },
        menuSeparator,
        repository && {
          id: 'open-in-file-manager',
          label: 'Open in File Manager',
          run: () => openInFileManager({ kind: 'open', id: repository.id }),
        },
        repository && {
          id: 'open-in-terminal',
          label: 'Open in Terminal',
          ...planned('Opening a terminal', 'P12'),
        },
        repository && { id: 'copy-path', label: 'Copy Path', run: () => copyText(repository.path) },
      ]),
    });
  };

  const openSectionMenu = (section: string, event: ReactMouseEvent<HTMLElement>) => {
    if (section === 'branches') {
      showContextMenu({
        anchor: contextMenuAnchor(event, event.currentTarget),
        label: 'Branches',
        items: newReferenceItems(headTarget, headTargetReason),
      });
      return;
    }
    if (section !== 'remotes') return;
    showContextMenu({
      anchor: contextMenuAnchor(event, event.currentTarget),
      label: 'Remotes',
      items: compactMenu([
        {
          id: 'fetch-all',
          label: 'Fetch All Remotes',
          disabled: networkDisabledReason !== undefined || activeOperation !== undefined,
          disabledReason: networkDisabledReason ?? networkBusyReason,
          run: () => startNetwork({ kind: 'fetch', remote: null, prune: true, tags: true }),
        },
        menuSeparator,
        { id: 'manage', label: 'Manage Remotes…', run: () => openNetworkDialog({ kind: 'remotes' }) },
      ]),
    });
  };

  const openRemoteMenu = (remoteName: string, event: ReactMouseEvent<HTMLElement>) => {
    const remote = remotes.find((candidate) => candidate.name === remoteName);
    showContextMenu({
      anchor: contextMenuAnchor(event, event.currentTarget),
      label: remoteName,
      items: compactMenu([
        {
          id: 'fetch',
          label: `Fetch '${remoteName}'`,
          shortcut: 'Mod+Shift+F',
          disabled: activeOperation !== undefined,
          disabledReason: networkBusyReason,
          run: () => startNetwork({ kind: 'fetch', remote: remoteName, prune: true, tags: true }),
        },
        {
          id: 'automatic-fetch',
          label: `Fetch '${remoteName}' Automatically`,
          checkable: 'checkbox',
          checked: remote?.fetchAutomatically ?? false,
          disabled: remote === undefined || referenceRequestBusy,
          disabledReason: remote ? undefined : 'The remote list is still loading.',
          run: () =>
            void runRemoteAction({
              kind: 'set-automatic-fetch',
              name: remoteName,
              enabled: !(remote?.fetchAutomatically ?? false),
            }),
        },
        menuSeparator,
        remote && {
          id: 'edit',
          label: `Edit '${remoteName}'…`,
          run: () => openNetworkDialog({ kind: 'edit-remote', remote }),
        },
        remote && {
          id: 'delete',
          label: `Delete '${remoteName}'…`,
          danger: true,
          run: () => openNetworkDialog({ kind: 'delete-remote', remote }),
        },
        menuSeparator,
        { id: 'copy-name', label: 'Copy Remote Name', run: () => copyText(remoteName) },
      ]),
    });
  };

  const openReferenceMenu = (reference: RepositoryHistoryReference, event: ReactMouseEvent<HTMLElement>) => {
    const current = references.find((candidate) => candidate.isHead && candidate.kind === 'branch');
    const loaded = history.commits.some((commit) => commit.id === reference.target);
    const branch = referenceContext?.branches.find((candidate) => candidate.fullName === reference.fullName);
    const tag = referenceContext?.tags.find((candidate) => candidate.fullName === reference.fullName);
    const target = referenceTarget(reference);
    const worktreeReason = branch?.worktreePath
      ? `'${reference.name}' is checked out in the worktree at ${branch.worktreePath}.`
      : undefined;
    const branchReason = branch ? worktreeReason : referencesReady ? undefined : referenceLoading;
    const filterHistory: MenuEntry = {
      id: 'filter-history',
      label: `Filter History to '${reference.name}'`,
      run: () => {
        setView('history');
        setHistoryFilter({ kind: 'reference', target: reference.target });
      },
    };
    const reveal: MenuEntry = {
      id: 'select-commit',
      label: 'Select Commit in List',
      disabled: !loaded,
      disabledReason: 'That commit is not loaded in the commit list yet.',
      run: () => revealCommit(reference.target),
    };
    let items: MenuEntry[];
    switch (reference.kind) {
      case 'branch':
        items = compactMenu([
          {
            id: 'checkout',
            label: `Checkout '${reference.name}'`,
            disabled: reference.isHead || branchReason !== undefined || referenceBusy,
            disabledReason: reference.isHead ? 'This branch is already checked out.' : branchReason,
            run: () => {
              if (branch) openReferenceDialog({ kind: 'checkout-branch', branch });
            },
          },
          menuSeparator,
          {
            id: 'fast-forward',
            label: `Fast-Forward to '${branch?.upstream ?? 'upstream'}'`,
            disabled:
              !branch?.upstreamRemote ||
              !branch.upstreamBranch ||
              Boolean(branch.worktreePath) ||
              referenceBusy,
            disabledReason: branch?.worktreePath
              ? 'This branch is checked out in another worktree.'
              : 'Choose an upstream branch first.',
            run: () => {
              if (referenceContext)
                startNetwork({
                  kind: 'fast-forward',
                  fullName: reference.fullName,
                  snapshot: referenceContext.snapshot,
                });
            },
          },
          {
            id: 'pull-branch',
            label: `Pull '${branch?.upstream ?? reference.name}'…`,
            disabled: !branch || Boolean(branch.worktreePath) || referenceBusy || remotes.length === 0,
            disabledReason: branch?.worktreePath
              ? 'This branch is checked out in another worktree.'
              : (networkDisabledReason ?? networkBusyReason),
            run: () => {
              if (branch) openNetworkDialog({ kind: 'pull', branch });
            },
          },
          {
            id: 'push-branch',
            label: `Push to '${branch?.upstreamRemote ?? remotes[0]?.name ?? 'remote'}'…`,
            disabled: !branch || remotes.length === 0 || referenceBusy,
            disabledReason: networkDisabledReason ?? networkBusyReason,
            run: () => pushBranch(branch),
          },
          {
            id: 'create-pull-request',
            label: `Create Pull Request on '${branch?.upstreamRemote ?? remotes[0]?.name ?? 'remote'}'…`,
            disabled: !branch || remotes.length === 0 || referenceBusy,
            disabledReason: networkDisabledReason ?? networkBusyReason,
            run: () => {
              const remote = remotes.some((item) => item.name === branch?.upstreamRemote)
                ? branch!.upstreamRemote!
                : remotes[0]?.name;
              if (active && branch && remote)
                void window.desktop?.repository
                  .openPullRequest({ id: active.id, fullName: branch.fullName, remote })
                  .then((result) => {
                    if (!result.ok) reportError(result.error.message);
                  });
            },
          },
          menuSeparator,
          current &&
            !reference.isHead && {
              id: 'merge',
              label: `Merge '${reference.name}' into '${current.name}'…`,
              ...planned('Merging', 'P06'),
            },
          current &&
            !reference.isHead && {
              id: 'rebase',
              label: `Rebase '${current.name}' on '${reference.name}'…`,
              ...planned('Rebasing', 'P07'),
            },
          menuSeparator,
          {
            id: 'new-branch',
            label: `New Branch from '${reference.name}'…`,
            shortcut: 'Mod+Shift+B',
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () => openReferenceDialog({ kind: 'new-branch', target }),
          },
          {
            id: 'new-tag',
            label: `New Tag at '${reference.name}'…`,
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () => openReferenceDialog({ kind: 'new-tag', target }),
          },
          menuSeparator,
          {
            id: 'tracking',
            label: 'Tracking',
            disabled: !branch || referenceBusy,
            disabledReason: branch ? undefined : referenceLoading,
            submenu: compactMenu([
              {
                id: 'set-upstream',
                label: 'Set Upstream…',
                run: () => {
                  if (branch) openReferenceDialog({ kind: 'set-upstream', branch });
                },
              },
              {
                id: 'unset-upstream',
                label: 'Stop Tracking',
                disabled: !branch?.upstream,
                disabledReason: 'This branch does not track another branch.',
                run: () =>
                  runReferenceAction({
                    kind: 'set-upstream',
                    fullName: reference.fullName,
                    upstream: null,
                  }),
              },
            ]),
          },
          {
            id: 'rename',
            label: `Rename '${reference.name}'…`,
            disabled: !branch || branchReason !== undefined || referenceBusy,
            disabledReason: branchReason ?? (branch ? undefined : referenceLoading),
            run: () => {
              if (branch) openReferenceDialog({ kind: 'rename-branch', branch });
            },
          },
          {
            id: 'delete',
            label: `Delete '${reference.name}'…`,
            danger: true,
            disabled: !branch || reference.isHead || branchReason !== undefined || referenceBusy,
            disabledReason: reference.isHead
              ? 'Check out another branch before deleting this one.'
              : (branchReason ?? (branch ? undefined : referenceLoading)),
            run: () => {
              if (branch) openReferenceDialog({ kind: 'delete-branch', branch });
            },
          },
          menuSeparator,
          filterHistory,
          menuSeparator,
          reveal,
          { id: 'copy-name', label: 'Copy Branch Name', run: () => copyText(reference.name) },
        ]);
        break;
      case 'remote':
        items = [
          {
            id: 'checkout',
            label: `Checkout '${reference.name}'…`,
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () => openReferenceDialog({ kind: 'checkout-remote-branch', target }),
          },
          menuSeparator,
          {
            id: 'new-branch',
            label: `New Branch from '${reference.name}'…`,
            shortcut: 'Mod+Shift+B',
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () => openReferenceDialog({ kind: 'new-branch', target }),
          },
          {
            id: 'new-tag',
            label: `New Tag at '${reference.name}'…`,
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () => openReferenceDialog({ kind: 'new-tag', target }),
          },
          {
            id: 'delete',
            label: `Delete '${reference.name}'…`,
            danger: true,
            disabled: activeOperation !== undefined,
            disabledReason: networkBusyReason,
            run: () => {
              const separator = reference.name.indexOf('/');
              if (separator <= 0) return;
              openNetworkDialog({
                kind: 'delete-remote-branch',
                remote: reference.name.slice(0, separator),
                remoteBranch: reference.name.slice(separator + 1),
              });
            },
          },
          menuSeparator,
          filterHistory,
          menuSeparator,
          reveal,
          { id: 'copy-name', label: 'Copy Branch Name', run: () => copyText(reference.name) },
        ];
        break;
      case 'tag':
        items = [
          {
            id: 'checkout',
            label: `Checkout '${reference.name}'…`,
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () =>
              openReferenceDialog({
                kind: 'checkout-detached',
                target: {
                  startPoint: { kind: 'commit', commitId: reference.target },
                  icon: 'tag',
                  label: reference.name,
                  detail: shortHash(reference.target),
                },
              }),
          },
          menuSeparator,
          {
            id: 'new-branch',
            label: `New Branch from '${reference.name}'…`,
            shortcut: 'Mod+Shift+B',
            disabled: !referencesReady || referenceBusy,
            disabledReason: referencesReady ? undefined : referenceLoading,
            run: () => openReferenceDialog({ kind: 'new-branch', target }),
          },
          {
            id: 'delete',
            label: `Delete '${reference.name}'…`,
            danger: true,
            disabled: !tag || referenceBusy,
            disabledReason: tag ? undefined : referenceLoading,
            run: () => {
              if (tag) openReferenceDialog({ kind: 'delete-tag', tag });
            },
          },
          menuSeparator,
          filterHistory,
          menuSeparator,
          reveal,
          { id: 'copy-name', label: 'Copy Tag Name', run: () => copyText(reference.name) },
        ];
        break;
      case 'stash':
        items = [
          { id: 'apply', label: 'Apply Stash…', ...planned('Applying stashes', 'P06') },
          { id: 'delete', label: 'Delete Stash…', danger: true, ...planned('Deleting stashes', 'P06') },
          menuSeparator,
          filterHistory,
          menuSeparator,
          reveal,
        ];
        break;
      default:
        items = [
          filterHistory,
          menuSeparator,
          reveal,
          { id: 'copy-name', label: 'Copy Reference Name', run: () => copyText(reference.fullName) },
        ];
    }
    showContextMenu({ anchor: contextMenuAnchor(event, event.currentTarget), label: reference.name, items });
  };

  const error = desktop.error ?? repositoryError ?? operationError;
  const desktopStatus = desktop.error ? 'unavailable' : desktop.loading ? 'connecting' : 'connected';
  const tabStrip = (orientation: 'horizontal' | 'vertical') => (
    <RepositoryTabs
      tabs={tabs}
      activeId={activeTabId}
      orientation={orientation}
      closeDisabled={repositoryBusy}
      onSelect={selectTab}
      onClose={closeTab}
      onNewTab={openManagerTab}
      onContextMenu={openTabMenu}
    />
  );

  return (
    <div
      className={`app tabs-${tabOrientation}`}
      data-theme={appearance}
      data-platform={platform}
      data-desktop-status={desktopStatus}
    >
      <TitleBar
        platform={platform}
        title={active ? `${active.name} — Git Workbench` : 'Git Workbench'}
        menus={menus}
        windowState={windowState}
        onWindowCommand={windowCommand}
      />
      <Toolbar
        repository={active}
        tracking={active ? history.tracking : undefined}
        branchItems={branchMenuItems}
        branchDisabledReason={active?.bare ? 'A bare repository has no working tree.' : undefined}
        openInItems={openInItems}
        appearanceItems={appearanceItems}
        operations={operations}
        runningOperation={activeOperation}
        networkDisabledReason={networkDisabledReason}
        pullDisabledReason={pullDisabledReason}
        activityOpen={activityOpen}
        onFetch={() => openNetworkDialog({ kind: 'fetch' })}
        onPull={() => {
          if (currentBranch) openNetworkDialog({ kind: 'pull', branch: currentBranch });
        }}
        onPush={() => pushBranch(currentBranch)}
        onToggleActivity={() => setActivityOpen((open) => !open)}
        onCancelOperation={cancelOperation}
      />
      {tabOrientation === 'horizontal' && tabStrip('horizontal')}
      <div className="workbench">
        {tabOrientation === 'vertical' && tabStrip('vertical')}
        {managerActive || !active ? (
          <RepositoryManagerView
            recent={recent}
            manager={manager}
            gitInfo={gitInfo}
            loading={repositoriesLoading}
            busy={repositoryBusy}
            onOpenPath={(path) => void openRecent(path)}
            onSwitchTo={select}
            onOpenExisting={() => void openExisting()}
            onInitialize={() => void initialize()}
            onAddSource={() => void addSourceDirectory()}
            onRescanSource={(id) => void rescanSourceDirectory(id)}
            onRemoveSource={(id) => void removeSourceDirectory(id)}
            onRemoveRecent={(id) => void removeRecent(id)}
            onOpenInFileManager={openInFileManager}
          />
        ) : (
          <div
            className="repository-workspace"
            style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
          >
            <RepositorySidebar
              key={active.id}
              repository={active}
              view={view}
              references={references}
              branches={referenceContext?.branches ?? []}
              referencesLoading={history.loading}
              onViewChange={setView}
              reveal={history.reveal}
              historyFiltered={history.filter.kind !== 'all'}
              onRevealCommit={revealSearchResult}
              onReferenceSelect={(reference) => {
                if (history.commits.some((commit) => commit.id === reference.target))
                  revealCommit(reference.target);
              }}
              onReferenceContextMenu={openReferenceMenu}
              onSectionContextMenu={openSectionMenu}
              onRemoteContextMenu={openRemoteMenu}
            />
            <Splitter
              orientation="vertical"
              label="Resize sidebar"
              value={sidebarWidth}
              minimum={180}
              maximum={520}
              onChange={setSidebarWidth}
            />
            <main className="repository-content">
              {view === 'changes' ? (
                <ChangesView
                  key={active.id}
                  repository={active}
                  refreshSignal={refreshSignal}
                  onCommitted={refresh}
                  operationBusy={Boolean(activeOperation)}
                />
              ) : (
                <HistoryView history={history} references={historyReferences} />
              )}
            </main>
          </div>
        )}
      </div>
      {referenceStatus && (
        <div
          className={referenceStatus.blocked ? 'reference-status blocked' : 'reference-status'}
          role="status"
          data-testid="reference-status"
        >
          <span className="reference-status-message">
            {referenceStatus.blocked ? <WarningIcon size={14} /> : <CheckIcon size={14} />}
            <span>{referenceStatus.message}</span>
          </span>
          <button type="button" className="link-button" onClick={() => setReferenceStatus(undefined)}>
            Dismiss
          </button>
        </div>
      )}
      {active && !active.bare && (
        <RecoveryPanel
          key={active.id}
          repositoryId={active.id}
          refreshSignal={refreshSignal}
          busy={Boolean(activeOperation)}
          onRecovered={refresh}
        />
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="button"
            onClick={() => {
              desktop.refresh();
              void retryRepositories();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {aboutOpen && <AboutDialog info={info} gitInfo={gitInfo} onClose={() => setAboutOpen(false)} />}
      {networkDialog && (
        <NetworkDialog
          request={networkDialog}
          remotes={remotes}
          branches={referenceContext?.branches ?? []}
          remoteBranches={referenceContext?.remoteBranches}
          referenceSnapshot={dialogSnapshot}
          preview={localChangesPreview}
          platform={platform}
          busy={referenceBusy}
          failure={networkFailure ?? previewError}
          onStart={startNetwork}
          onRemoteAction={runRemoteAction}
          onOpen={openNetworkDialog}
          onClose={closeNetworkDialog}
        />
      )}
      {referenceDialog && (
        <ReferenceDialog
          request={referenceDialog}
          context={referenceContext}
          preview={localChangesPreview}
          platform={platform}
          busy={referenceBusy}
          failure={
            referenceFailure ?? (previewError ? { message: previewError, canForce: false } : undefined)
          }
          onSubmit={runReferenceAction}
          onClose={closeReferenceDialog}
        />
      )}
    </div>
  );
}
