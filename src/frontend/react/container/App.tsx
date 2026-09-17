import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { RepositoryHistoryReference, RepositoryLocation } from '../../../common/ipc/contracts';
import { AboutDialog } from '../components/AboutDialog';
import { ChangesView } from '../components/ChangesView';
import { HistoryView } from '../components/HistoryView';
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
import { useRepositories } from '../hooks/use-repositories';
import { useRepositoryHistory } from '../hooks/use-repository-history';
import { copyText } from '../lib/clipboard';
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
  const { refresh: refreshHistory, selectCommit, references, setFilter: setHistoryFilter } = history;
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

  const focusCommitSearch = useCallback(() => {
    setView('history');
    window.requestAnimationFrame(() => document.getElementById('history-commit-search')?.focus());
  }, [setView]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const is = (shortcut: string) => matchesShortcut(event, shortcut, platform);
      if (is('Mod+T')) openManagerTab();
      else if (is('Mod+O')) {
        if (!repositoryBusy) void openExisting();
      } else if (is('Mod+W')) closeActiveTab();
      else if (is('Mod+Shift+T')) {
        if (!repositoryBusy) void reopenClosed();
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
    closeActiveTab,
    cycleTab,
    development,
    nativeMenu,
    openExisting,
    openManagerTab,
    platform,
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
              { id: 'fetch', label: 'Fetch…', ...planned('Fetching', 'P05') },
              { id: 'pull', label: 'Pull…', ...planned('Pulling', 'P05') },
              { id: 'push', label: 'Push…', ...planned('Pushing', 'P05') },
              { id: 'save-stash', label: 'Save Stash…', ...planned('Stashing', 'P06') },
              menuSeparator,
              { id: 'create-branch', label: 'Create New Branch…', ...planned('Creating branches', 'P05') },
              { id: 'create-tag', label: 'Create New Tag…', ...planned('Creating tags', 'P05') },
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

  const openReferenceMenu = (reference: RepositoryHistoryReference, event: ReactMouseEvent<HTMLElement>) => {
    const current = references.find((candidate) => candidate.isHead && candidate.kind === 'branch');
    const loaded = history.commits.some((commit) => commit.id === reference.target);
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
            ...(reference.isHead
              ? { disabled: true, disabledReason: 'This branch is already checked out.' }
              : planned('Checking out branches', 'P05')),
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
            ...planned('Creating branches', 'P05'),
          },
          { id: 'rename', label: `Rename '${reference.name}'…`, ...planned('Renaming branches', 'P05') },
          {
            id: 'delete',
            label: `Delete '${reference.name}'…`,
            danger: true,
            ...planned('Deleting branches', 'P05'),
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
            ...planned('Checking out branches', 'P05'),
          },
          {
            id: 'delete',
            label: `Delete '${reference.name}'…`,
            danger: true,
            ...planned('Deleting remote branches', 'P05'),
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
          { id: 'checkout', label: `Checkout '${reference.name}'…`, ...planned('Checking out tags', 'P05') },
          {
            id: 'delete',
            label: `Delete '${reference.name}'…`,
            danger: true,
            ...planned('Deleting tags', 'P05'),
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

  const error = desktop.error ?? repositoryError;
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
        platform={platform}
        repository={active}
        tracking={active ? history.tracking : undefined}
        openInItems={openInItems}
        appearanceItems={appearanceItems}
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
              referencesLoading={history.loading}
              onViewChange={setView}
              onCommitSearch={focusCommitSearch}
              onReferenceSelect={(reference) => {
                if (history.commits.some((commit) => commit.id === reference.target))
                  revealCommit(reference.target);
              }}
              onReferenceContextMenu={openReferenceMenu}
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
              {view === 'changes' ? <ChangesView repository={active} /> : <HistoryView history={history} />}
            </main>
          </div>
        )}
      </div>
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
    </div>
  );
}
