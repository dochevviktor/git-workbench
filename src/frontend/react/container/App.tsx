import { useState } from 'react';
import type { RepositoryManagerFolder, RepositoryManagerRepository } from '../../../common/ipc/contracts';
import { useDesktop } from '../hooks/use-desktop';
import { useRepositories } from '../hooks/use-repositories';

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
    loading: repositoriesLoading,
    busy,
    error: repositoryError,
    retry: retryRepositories,
    openExisting,
    initialize,
    openRecent,
    closeRepository,
    removeRecent,
    addSourceDirectory,
    removeSourceDirectory,
    rescanSourceDirectory,
    openManagerRepository,
    select,
  } = useRepositories();
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
        <span className="build-label">F02 repository manager</span>
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
          <div className="sidebar-title">WORKSPACE</div>
          {open.length === 0 ? (
            <div className="repository-empty">No repository open</div>
          ) : (
            <div className="open-repositories" aria-label="Open repositories">
              {open.map((repository) => (
                <button
                  key={repository.id}
                  className={active?.id === repository.id ? 'repository-tab active' : 'repository-tab'}
                  aria-current={active?.id === repository.id ? 'page' : undefined}
                  onClick={() => select(repository.id)}
                  title={repository.path}
                >
                  <span className="nav-dot" aria-hidden="true" />
                  <span className="repository-tab-copy">
                    <strong>{repository.name}</strong>
                    <small>
                      {repository.bare
                        ? 'Bare repository'
                        : headLabel(repository.head.state, repository.head.name)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
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
            <p>
              {active
                ? 'Branch, tag, remote, and stash browsing will be added after repository sessions.'
                : 'Open a repository to inspect its references.'}
            </p>
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
          <div className="panel-heading">
            <h1>{currentView.label}</h1>
            <span>{active?.path ?? 'No repository selected'}</span>
          </div>
          {active ? (
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
              </div>
              <p className="milestone-note">
                <span className="status-dot" aria-hidden="true" />
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
            ? `${active.name} · ${headLabel(active.head.state, active.head.name)}`
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
