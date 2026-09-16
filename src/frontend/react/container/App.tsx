import { useEffect, useState } from 'react';
import type {
  RepositoryHistoryReference,
  RepositoryManagerFolder,
  RepositoryManagerRepository,
  RepositorySummary,
  RepositoryTabOrientation,
} from '../../../common/ipc/contracts';
import { useDesktop } from '../hooks/use-desktop';
import { useRepositories } from '../hooks/use-repositories';
import { useRepositoryHistory } from '../hooks/use-repository-history';
import { HistoryView } from '../components/HistoryView';

const views = {
  history: {
    label: 'History',
    heading: 'Your repository, in perspective.',
    description: 'Explore branches, follow commits, and understand how your project changes.',
  },
  changes: {
    label: 'Working changes',
    heading: 'A clear view of your next commit.',
    description: 'Review your changes and build a commit, one file or one line at a time.',
  },
  activity: {
    label: 'Activity',
    heading: 'No activity yet.',
    description: 'Repository operations and their progress will appear here.',
  },
} as const;

function headLabel(state: 'branch' | 'detached' | 'unborn' | 'unknown', name: string | null): string {
  switch (state) {
    case 'branch':
      return `Branch ${name ?? 'unknown'}`;
    case 'detached':
      return 'Detached HEAD';
    case 'unborn':
      return `Unborn ${name ?? 'HEAD'}`;
    case 'unknown':
      return 'HEAD unavailable';
  }
}

function recentStatusLabel(status: 'available' | 'missing' | 'not-directory'): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'missing':
      return 'Missing';
    case 'not-directory':
      return 'Not a directory';
  }
}

function sourceStatusLabel(status: 'available' | 'missing' | 'not-directory' | 'unreadable'): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'missing':
      return 'Missing';
    case 'not-directory':
      return 'Not a directory';
    case 'unreadable':
      return 'Unreadable';
  }
}

function workingTreeLabel(repository: RepositorySummary): string {
  switch (repository.workingTree.state) {
    case 'clean':
      return 'Clean working tree';
    case 'dirty':
      return `${repository.workingTree.changedFileCount ?? 0} changed ${
        repository.workingTree.changedFileCount === 1 ? 'file' : 'files'
      }`;
    case 'unavailable':
      return 'No working tree';
    case 'unknown':
      return 'Status unavailable';
  }
}

function tabStatusLabel(repository: RepositorySummary): string {
  switch (repository.workingTree.state) {
    case 'clean':
      return 'Clean working tree';
    case 'dirty':
      return `Uncommitted changes${
        repository.workingTree.changedFileCount === null
          ? ''
          : ` · ${repository.workingTree.changedFileCount} ${
              repository.workingTree.changedFileCount === 1 ? 'file' : 'files'
            }`
      }`;
    case 'unavailable':
      return 'No working tree';
    case 'unknown':
      return 'Working-tree status unavailable';
  }
}

function tabIndicator(repository: RepositorySummary): string {
  switch (repository.workingTree.state) {
    case 'clean':
      return '○';
    case 'dirty':
      return '●';
    case 'unavailable':
      return '—';
    case 'unknown':
      return '?';
  }
}

function referenceKindLabel(kind: RepositoryHistoryReference['kind']): string {
  switch (kind) {
    case 'branch':
      return 'Branches';
    case 'remote':
      return 'Remotes';
    case 'tag':
      return 'Tags';
    case 'stash':
      return 'Stashes';
    case 'head':
      return 'HEAD';
    case 'other':
      return 'Other';
  }
}

function SidebarReferences({ references }: { readonly references: readonly RepositoryHistoryReference[] }) {
  const visibleReferences = references.slice(0, 100);
  return (
    <div className="sidebar-references">
      {visibleReferences.length === 0 ? (
        <p>No references found.</p>
      ) : (
        <ul className="reference-list">
          {visibleReferences.map((reference) => (
            <li key={reference.fullName}>
              <span className={`reference-kind ${reference.kind}`} aria-hidden="true">
                {reference.kind === 'branch' ? '●' : reference.kind === 'tag' ? '◆' : '○'}
              </span>
              <span className="reference-copy" title={reference.fullName}>
                <strong>
                  {reference.isHead && reference.kind === 'branch'
                    ? `HEAD → ${reference.name}`
                    : reference.name}
                </strong>
                <small>{referenceKindLabel(reference.kind)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {references.length > visibleReferences.length && (
        <p>
          Showing the first {visibleReferences.length} of {references.length} references.
        </p>
      )}
    </div>
  );
}

interface RepositoryTabsProps {
  readonly repositories: readonly RepositorySummary[];
  readonly activeId: string | undefined;
  readonly orientation: RepositoryTabOrientation;
  readonly closeDisabled: boolean;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
}

function RepositoryTabs({
  repositories,
  activeId,
  orientation,
  closeDisabled,
  onSelect,
  onClose,
}: RepositoryTabsProps) {
  if (repositories.length === 0) return <div className="repository-empty">No repository open</div>;

  return (
    <nav className={`repository-tabs ${orientation}`} aria-label="Open repository tabs" role="tablist">
      {repositories.map((repository) => {
        const selected = repository.id === activeId;
        const status = tabStatusLabel(repository);
        return (
          <div className={selected ? 'repository-tab-row active' : 'repository-tab-row'} key={repository.id}>
            <button
              className={selected ? 'repository-tab active' : 'repository-tab'}
              role="tab"
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              aria-label={`${repository.name}, ${status}`}
              onClick={() => onSelect(repository.id)}
              title={repository.path}
            >
              <span className={`repository-tab-indicator ${repository.workingTree.state}`} aria-hidden="true">
                {tabIndicator(repository)}
              </span>
              <span className="repository-tab-copy">
                <strong>{repository.name}</strong>
                <small>
                  {repository.bare
                    ? 'Bare repository'
                    : headLabel(repository.head.state, repository.head.name)}
                  {' · '}
                  {status}
                </small>
              </span>
            </button>
            <button
              className="repository-tab-close"
              aria-label={`Close ${repository.name}`}
              disabled={closeDisabled}
              onClick={() => onClose(repository.id)}
              title={`Close ${repository.name}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </nav>
  );
}

interface RepositoryManagerTreeProps {
  readonly parentId: string | null;
  readonly folders: readonly RepositoryManagerFolder[];
  readonly repositories: readonly RepositoryManagerRepository[];
  readonly disabled: boolean;
  readonly onOpen: (repository: RepositoryManagerRepository) => void;
}

function RepositoryManagerTree({
  parentId,
  folders,
  repositories,
  disabled,
  onOpen,
}: RepositoryManagerTreeProps) {
  const childFolders = folders.filter((folder) => folder.parentId === parentId);
  const childRepositories = repositories.filter((repository) => repository.folderId === parentId);
  if (childFolders.length === 0 && childRepositories.length === 0) return null;

  return (
    <ul className="manager-tree">
      {childFolders.map((folder) => (
        <li key={folder.id}>
          <div className="manager-folder">
            <span className="manager-folder-glyph" aria-hidden="true">
              ▸
            </span>
            <span title={folder.relativePath}>{folder.name}</span>
          </div>
          <RepositoryManagerTree
            parentId={folder.id}
            folders={folders}
            repositories={repositories}
            disabled={disabled}
            onOpen={onOpen}
          />
        </li>
      ))}
      {childRepositories.map((repository) => (
        <li key={repository.id}>
          <button
            className="manager-repository"
            data-testid="manager-repository"
            disabled={disabled}
            onClick={() => onOpen(repository)}
            title={repository.path}
          >
            <span className="manager-repository-glyph" aria-hidden="true">
              {repository.kind === 'bare' ? '◈' : '●'}
            </span>
            <span className="manager-repository-copy">
              <strong>{repository.name}</strong>
              <small>{repository.relativePath || 'Source root'}</small>
            </span>
            {repository.sessionId && (
              <span className="manager-open-label" title="Open in this window">
                open
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [view, setView] = useState<keyof typeof views>('history');
  const [theme, setTheme] = useState('system');
  const { info, windowState, error: desktopError, loading, refresh, toggleMaximize } = useDesktop();
  const {
    gitInfo,
    recent,
    open,
    manager,
    active,
    tabOrientation,
    recentlyClosed,
    loading: repositoriesLoading,
    busy,
    error: repositoryError,
    retry: retryRepositories,
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
    select,
    setTabOrientation,
  } = useRepositories();
  const history = useRepositoryHistory(active?.id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) {
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.altKey) return;

      if (event.key.toLowerCase() === 't' && event.shiftKey) {
        event.preventDefault();
        void reopenClosed();
        return;
      }
      if (event.key.toLowerCase() === 'w' && !event.shiftKey && active) {
        event.preventDefault();
        void closeRepository(active.id);
        return;
      }
      if (event.key === 'Tab' && open.length > 1) {
        event.preventDefault();
        const currentIndex = open.findIndex((repository) => repository.id === active?.id);
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + direction + open.length) % open.length;
        const next = open[nextIndex];
        if (next) select(next.id);
        return;
      }
      if (!event.shiftKey && /^[1-9]$/u.test(event.key)) {
        const next = open[Number(event.key) - 1];
        if (next) {
          event.preventDefault();
          select(next.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, closeRepository, open, reopenClosed, select]);

  const currentView = views[view];
  const error = desktopError ?? repositoryError;
  const repositoryBusy = busy !== undefined;

  return (
    <div className="app" data-theme={theme}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⑂
          </span>{' '}
          Git Workbench
        </div>
        <span className="build-label">F04 commit history</span>
        <div className="repository-actions" aria-label="Repository actions">
          <button disabled={repositoryBusy} onClick={() => void openExisting()}>
            {busy === 'opening' ? 'Opening…' : 'Open repository'}
          </button>
          <button disabled={repositoryBusy} onClick={() => void initialize()}>
            {busy === 'initializing' ? 'Initializing…' : 'Initialize repository'}
          </button>
          <button
            disabled
            title="Remote clone will be enabled with authenticated network operations in a later phase."
          >
            Clone repository
          </button>
          <button
            disabled={repositoryBusy || recentlyClosed.length === 0}
            aria-keyshortcuts="Control+Shift+T Meta+Shift+T"
            onClick={() => void reopenClosed()}
            title="Reopen the most recently closed tab (Ctrl/Cmd+Shift+T)"
          >
            {busy === 'reopening' ? 'Reopening…' : 'Reopen closed tab'}
          </button>
        </div>
        <div className="toolbar-actions">
          <label className="theme-picker">
            Appearance
            <select aria-label="Appearance" value={theme} onChange={(event) => setTheme(event.target.value)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <button disabled={!info} onClick={toggleMaximize}>
            {windowState?.maximized ? 'Restore window' : 'Maximize window'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading-row workspace-heading">
            <div className="sidebar-title">WORKSPACE</div>
            <button
              className="sidebar-action"
              aria-label={
                tabOrientation === 'vertical'
                  ? 'Use horizontal repository tabs'
                  : 'Use vertical repository tabs'
              }
              onClick={() =>
                void setTabOrientation(tabOrientation === 'vertical' ? 'horizontal' : 'vertical')
              }
              title={
                tabOrientation === 'vertical'
                  ? 'Move repository tabs above the workspace'
                  : 'Move repository tabs to the sidebar'
              }
            >
              {tabOrientation === 'vertical' ? '↔' : '↕'}
            </button>
          </div>
          {tabOrientation === 'vertical' ? (
            <RepositoryTabs
              repositories={open}
              activeId={active?.id}
              orientation="vertical"
              closeDisabled={repositoryBusy}
              onSelect={select}
              onClose={(id) => void closeRepository(id)}
            />
          ) : (
            <div className="repository-empty">Tabs are shown above the workspace.</div>
          )}
          <section className="manager-section" aria-labelledby="repository-manager-heading">
            <div className="sidebar-heading-row">
              <div className="sidebar-title" id="repository-manager-heading">
                REPOSITORY MANAGER
              </div>
              <button
                className="sidebar-action"
                aria-label="Add source directory"
                disabled={repositoryBusy}
                onClick={() => void addSourceDirectory()}
                title="Add source directory"
              >
                +
              </button>
            </div>
            {!manager && repositoriesLoading ? (
              <p>Scanning source directories…</p>
            ) : manager?.sourceDirectories.length === 0 ? (
              <p>Add a source directory to find repositories in its folders.</p>
            ) : (
              <div className="manager-sources">
                {manager?.sourceDirectories.map((source) => {
                  const sourceRepositories = manager.repositories.filter(
                    (repository) => repository.sourceDirectoryId === source.id,
                  );
                  const sourceFolders = manager.folders.filter(
                    (folder) => folder.sourceDirectoryId === source.id,
                  );
                  return (
                    <section
                      className="manager-source"
                      key={source.id}
                      aria-labelledby={`source-${source.id}`}
                    >
                      <div className="manager-source-heading">
                        <div className="manager-source-copy">
                          <strong id={`source-${source.id}`} title={source.path}>
                            {source.name}
                          </strong>
                          <small>
                            {source.repositoryCount}{' '}
                            {source.repositoryCount === 1 ? 'repository' : 'repositories'} ·{' '}
                            {sourceStatusLabel(source.status)}
                          </small>
                        </div>
                        <div className="manager-source-actions">
                          <button
                            className="sidebar-action"
                            aria-label={`Rescan ${source.name}`}
                            disabled={repositoryBusy}
                            onClick={() => void rescanSourceDirectory(source.id)}
                            title="Rescan source directory"
                          >
                            ↻
                          </button>
                          <button
                            className="sidebar-action"
                            aria-label={`Remove ${source.name}`}
                            disabled={repositoryBusy}
                            onClick={() => void removeSourceDirectory(source.id)}
                            title="Remove source directory"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <p className="manager-source-path" title={source.path}>
                        {source.path}
                      </p>
                      {source.status !== 'available' ? (
                        <p className="manager-source-note">This source directory needs attention.</p>
                      ) : (
                        <RepositoryManagerTree
                          parentId={null}
                          folders={sourceFolders}
                          repositories={sourceRepositories}
                          disabled={repositoryBusy}
                          onOpen={(repository) => void openManagerRepository(repository)}
                        />
                      )}
                      {source.truncated && (
                        <p className="manager-source-note">
                          Scan limits were reached; rescan after narrowing this folder.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
            {manager && manager.warnings.length > 0 && (
              <p className="manager-warning" role="status" title={manager.warnings[0]?.path}>
                {manager.warnings[0]?.message}
                {manager.warnings.length > 1 ? ` (+${manager.warnings.length - 1} more)` : ''}
              </p>
            )}
          </section>
          <nav aria-label="Repository views">
            {Object.entries(views).map(([key, item]) => (
              <button
                key={key}
                className={view === key ? 'nav-item active' : 'nav-item'}
                aria-current={view === key ? 'page' : undefined}
                onClick={() => setView(key as keyof typeof views)}
              >
                <span className="nav-dot" aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-section">
            <div className="sidebar-title">REFERENCES</div>
            {active ? (
              history.loading && history.references.length === 0 ? (
                <p>Loading references…</p>
              ) : (
                <SidebarReferences references={history.references} />
              )
            ) : (
              <p>Open a repository to inspect its references.</p>
            )}
          </div>
          <div className="sidebar-section recent-section">
            <div className="sidebar-title">RECENT REPOSITORIES</div>
            {repositoriesLoading && recent.length === 0 ? (
              <p>Loading recent repositories…</p>
            ) : recent.length === 0 ? (
              <p>No recent repositories yet.</p>
            ) : (
              <ul className="recent-list">
                {recent.map((repository) => (
                  <li key={repository.id}>
                    <button
                      className="recent-repository"
                      disabled={repositoryBusy || repository.status !== 'available'}
                      onClick={() => void openRecent(repository.path)}
                      title={repository.path}
                    >
                      <strong>{repository.name}</strong>
                      <small>{recentStatusLabel(repository.status)}</small>
                    </button>
                    <button
                      className="remove-recent"
                      aria-label={`Remove ${repository.name} from recent repositories`}
                      disabled={repositoryBusy}
                      onClick={() => void removeRecent(repository.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sidebar-bottom">A home for your repositories.</div>
        </aside>

        <main className="main-panel">
          {tabOrientation === 'horizontal' && (
            <RepositoryTabs
              repositories={open}
              activeId={active?.id}
              orientation="horizontal"
              closeDisabled={repositoryBusy}
              onSelect={select}
              onClose={(id) => void closeRepository(id)}
            />
          )}
          <div className="panel-heading">
            <h1>{currentView.label}</h1>
            <span>{active?.path ?? 'No repository selected'}</span>
          </div>
          {active && view === 'history' ? (
            <HistoryView history={history} repository={active} />
          ) : active ? (
            <section className="repository-open-state" aria-labelledby="repository-title">
              <p className="eyebrow">REPOSITORY OPEN</p>
              <h2 id="repository-title">{active.name}</h2>
              <p className="repository-path">{active.path}</p>
              <div className="repository-facts">
                <div>
                  <span>HEAD</span>
                  <strong>{headLabel(active.head.state, active.head.name)}</strong>
                </div>
                <div>
                  <span>WORKTREE</span>
                  <strong>{active.bare ? 'Bare repository' : 'Working tree'}</strong>
                </div>
                <div>
                  <span>GIT DIRECTORY</span>
                  <strong>{active.gitDir}</strong>
                </div>
                <div>
                  <span>WORKTREE STATUS</span>
                  <strong>{workingTreeLabel(active)}</strong>
                </div>
              </div>
              <p className="milestone-note">
                <span
                  className={
                    active.workingTree.state === 'dirty'
                      ? 'status-dot dirty'
                      : active.workingTree.state === 'unknown'
                        ? 'status-dot pending'
                        : 'status-dot'
                  }
                  aria-hidden="true"
                />
                {currentView.description}
              </p>
            </section>
          ) : (
            <section className="empty-state" aria-labelledby="welcome-title">
              <div className="empty-symbol" aria-hidden="true">
                ⑂
              </div>
              <p className="eyebrow">GIT WORKBENCH</p>
              <h2 id="welcome-title">{currentView.heading}</h2>
              <p>{currentView.description}</p>
              <div className="milestone-note">
                <span className="status-dot" aria-hidden="true" />
                Open an existing repository or initialize a directory to begin.
              </div>
            </section>
          )}
          {view !== 'history' && (
            <section className="detail-panel" aria-labelledby="details-heading">
              <div className="detail-heading">
                <h2 id="details-heading">{active ? 'Repository session' : 'Commit details'}</h2>
                {active && (
                  <button disabled={repositoryBusy} onClick={() => void closeRepository(active.id)}>
                    {busy === 'closing' ? 'Closing…' : 'Close repository'}
                  </button>
                )}
              </div>
              <p>
                {active
                  ? 'The repository is connected to this window. History and working changes are the next views.'
                  : 'Select a commit to inspect its message, changed files, and diff.'}
              </p>
            </section>
          )}
        </main>

        <aside className="inspector" aria-label="Workspace information">
          <h2>{active ? 'Repository information' : 'Getting started'}</h2>
          <p>
            {active
              ? 'Opening a repository is read-only. No files or Git references are changed by this view.'
              : 'Open an existing repository or initialize a local directory. Remote cloning is not enabled yet.'}
          </p>
          <div className="git-status" role="status">
            <span
              className={gitInfo?.status === 'available' ? 'status-dot' : 'status-dot error'}
              aria-hidden="true"
            />
            {gitInfo?.status === 'available'
              ? `Git ${gitInfo.version}`
              : gitInfo?.status === 'missing'
                ? 'Git is not installed or not on PATH'
                : gitInfo?.status === 'error'
                  ? 'Git could not be checked'
                  : 'Checking Git…'}
          </div>
          <details>
            <summary>About this build</summary>
            {info && (
              <dl>
                <dt>Version</dt>
                <dd>{info.version}</dd>
                <dt>Platform</dt>
                <dd>{info.platform}</dd>
                <dt>Electron</dt>
                <dd>{info.versions.electron}</dd>
                <dt>Chromium</dt>
                <dd>{info.versions.chrome}</dd>
                <dt>Node.js</dt>
                <dd>{info.versions.node}</dd>
              </dl>
            )}
            <button disabled={loading} onClick={refresh}>
              {loading ? 'Checking…' : 'Check connection'}
            </button>
          </details>
        </aside>
      </div>

      <footer className="statusbar">
        <span role="status" data-testid="backend-status">
          <span className={desktopError ? 'status-dot error' : 'status-dot'} aria-hidden="true" />
          {desktopError ? 'Desktop unavailable' : loading ? 'Connecting…' : 'Desktop connected'}
        </span>
        <span>
          {active
            ? `${active.name} · ${headLabel(active.head.state, active.head.name)} · ${workingTreeLabel(active)}`
            : 'No repository selected'}
        </span>
        <span className="statusbar-end">Git Workbench {info?.version ?? ''}</span>
      </footer>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              refresh();
              void retryRepositories();
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
