import { useState } from 'react';
import { useDesktop } from '../hooks/use-desktop';

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

export default function App() {
  const [view, setView] = useState<keyof typeof views>('history');
  const [theme, setTheme] = useState('system');
  const { info, windowState, error, loading, refresh, toggleMaximize } = useDesktop();
  const currentView = views[view];

  return (
    <div className="app" data-theme={theme}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⑂
          </span>{' '}
          Git Workbench
        </div>
        <span className="build-label">Early development</span>
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
          <div className="repository-empty">No repository open</div>
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
            <p>Branches, tags, remotes, and stashes will appear when a repository is open.</p>
          </div>
          <div className="sidebar-bottom">A home for your repositories.</div>
        </aside>

        <main className="main-panel">
          <div className="panel-heading">
            <h1>{currentView.label}</h1>
            <span>No repository selected</span>
          </div>
          <section className="empty-state" aria-labelledby="welcome-title">
            <div className="empty-symbol" aria-hidden="true">
              ⑂
            </div>
            <p className="eyebrow">GIT WORKBENCH</p>
            <h2 id="welcome-title">{currentView.heading}</h2>
            <p>{currentView.description}</p>
            <div className="milestone-note">
              <span className="status-dot" aria-hidden="true" />
              This build prepares the workspace. Repository tools are coming next.
            </div>
          </section>
          <section className="detail-panel" aria-labelledby="details-heading">
            <h2 id="details-heading">Commit details</h2>
            <p>Select a commit to inspect its message, changed files, and diff.</p>
          </section>
        </main>

        <aside className="inspector" aria-label="Workspace information">
          <h2>Getting started</h2>
          <p>Repository opening, cloning, and history browsing are planned for upcoming builds.</p>
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
          <span className={error ? 'status-dot error' : 'status-dot'} aria-hidden="true" />
          {error ? 'Desktop unavailable' : loading ? 'Connecting…' : 'Desktop connected'}
        </span>
        <span>No repository selected</span>
        <span className="statusbar-end">Git Workbench {info?.version ?? ''}</span>
      </footer>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={refresh}>Retry</button>
        </div>
      )}
    </div>
  );
}
