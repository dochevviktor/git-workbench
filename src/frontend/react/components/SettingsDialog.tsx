import { useEffect, useRef, useState } from 'react';
import type { GitInfo, RepositorySummary } from '../../../common/ipc/contracts';
import type { GitSettings } from '../../../common/ipc/settings';
import { saveGitSettingsSchema } from '../../../common/ipc/settings';
import { unwrapResult } from '../../../common/ipc/result';
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import './settings.css';
import { GitInstanceControl } from './GitInstanceControl';
import { RepositoryTrustControl } from './RepositoryTrustControl';
import { HostingAccountsPanel } from './HostingAccountsPanel';
import type { HostingCloneTarget } from '../../../common/ipc/hosting';

export function SettingsDialog({
  repository,
  canNavigate,
  gitInfo,
  onClose,
  onSaved,
  tools,
  commands,
  initialPage,
  onClone,
  ai,
  remotes,
  gitFlow,
}: {
  repository: RepositorySummary | null;
  canNavigate: boolean;
  gitInfo: GitInfo | undefined;
  onClose(): void;
  onSaved(): void;
  tools(): void;
  commands(): void;
  initialPage?: 'Accounts' | undefined;
  onClone(target: HostingCloneTarget): void;
  ai(): void;
  remotes(): void;
  gitFlow(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(repository ? 'Git' : (initialPage ?? 'General'));
  const [settings, setSettings] = useState<GitSettings>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [prefix, setPrefix] = useState('#');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [appearance, setAppearance] = usePersistentState(
    'appearance',
    'system',
    isOneOf(['system', 'light', 'dark']),
  );
  const [font, setFont] = usePersistentState('diff.fontSize', 12, isNumberBetween(10, 20));
  const [subjectGuide, setSubjectGuide] = usePersistentState(
    'commit.subjectGuide',
    50,
    isNumberBetween(30, 120),
  );
  const [spellCheck, setSpellCheck] = usePersistentState(
    'commit.spellCheck',
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [showMarks, setShowMarks] = usePersistentState(
    'diff.showMarks',
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [fetch, setFetch] = useState<boolean>();
  const EffectiveValues = repository ? 'div' : 'details';
  const id = repository?.id ?? null;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    let current = true;
    void window.desktop?.settings
      .getGit({ id })
      .then(unwrapResult)
      .then((value) => {
        if (!current) return;
        setSettings(value);
        setName(value.name ?? '');
        setEmail(value.email ?? '');
        setPrefix(value.issueRule?.prefix ?? '#');
        setUrl(value.issueRule?.url ?? '');
        setError('');
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Cannot read settings.');
      });
    void window.desktop?.repository.getAutomaticFetch().then((result) => {
      if (current && result.ok) setFetch(result.value.enabled);
    });
    return () => {
      current = false;
    };
  }, [id, reload]);
  const request = {
    id,
    snapshot: settings?.snapshot ?? '',
    name: name.trim() || null,
    email: email.trim() || null,
    issueRule: repository && url.trim() ? { prefix, url: url.trim() } : null,
  };
  const valid = saveGitSettingsSchema.safeParse(request);
  const dirty =
    settings &&
    (request.name !== settings.name ||
      request.email !== settings.email ||
      JSON.stringify(request.issueRule) !== JSON.stringify(settings.issueRule));
  const handoff = (action: () => void) => {
    onClose();
    action();
  };
  const save = async () => {
    if (!window.desktop || !valid.success || busy) return;
    setBusy(true);
    setError('');
    try {
      await window.desktop.settings.saveGit(valid.data).then(unwrapResult);
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cannot save settings.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={ref}
      className={`dialog settings-dialog${page === 'Accounts' ? ' settings-accounts-dialog' : ''}`}
      aria-label={repository ? 'Repository Settings' : 'Preferences'}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        <h2>{repository ? 'Repository Settings' : 'Preferences'}</h2>
        {repository && (
          <p className="settings-target">
            <strong>{repository.name}</strong>
            <br />
            {repository.path}
          </p>
        )}
        {!repository && (
          <nav className="settings-tabs" aria-label="Settings pages">
            {['General', 'Commit', 'Git', 'Accounts', 'Integration', 'Custom Commands'].map((tab) => (
              <button
                type="button"
                key={tab}
                aria-pressed={page === tab}
                disabled={busy || (Boolean(dirty) && page !== tab)}
                onClick={() => setPage(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
        )}
        {page === 'General' && (
          <section className="settings-page">
            <h3>Appearance</h3>
            <label>
              Appearance
              <select value={appearance} onChange={(event) => setAppearance(event.target.value)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <h3 className="settings-section-title">Diff View</h3>
            <label>
              Diff font size
              <select value={font} onChange={(event) => setFont(Number(event.target.value))}>
                {Array.from({ length: 11 }, (_, i) => i + 10).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={showMarks}
                onChange={(event) => setShowMarks(event.target.checked)}
              />
              Show −/+ marks
            </label>
            <h3 className="settings-section-title">Network</h3>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={fetch ?? false}
                disabled={fetch === undefined || busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setBusy(true);
                  void window.desktop?.repository
                    .setAutomaticFetch({ enabled })
                    .then(unwrapResult)
                    .then((value) => {
                      setFetch(value.enabled);
                      onSaved();
                    })
                    .catch((reason: unknown) =>
                      setError(reason instanceof Error ? reason.message : 'Cannot save automatic fetch.'),
                    )
                    .finally(() => setBusy(false));
                }}
              />
              Fetch remotes automatically
            </label>
            <p className="muted">
              Changes apply immediately. Per-remote fetch exclusions are available in Remotes.
            </p>
          </section>
        )}
        {page === 'Commit' && (
          <section className="settings-page">
            <p className="muted">Application profile · presentation controls apply immediately.</p>
            <label>
              Subject length guide
              <select value={subjectGuide} onChange={(event) => setSubjectGuide(Number(event.target.value))}>
                {[50, 72, 100].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <p className="muted">
              The composer counts down from this guide. Longer subjects are still allowed.
            </p>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={spellCheck}
                onChange={(event) => setSpellCheck(event.target.checked)}
              />
              Check commit message spelling
            </label>
            <p className="muted">
              Signing mode and repository signing key are available in the commit composer and tag dialog. Git
              commit templates continue to follow Git configuration.
            </p>
          </section>
        )}
        {page === 'Git' && (
          <section className="settings-page">
            {!repository && <GitInstanceControl gitInfo={gitInfo} />}
            {repository && (
              <RepositoryTrustControl key={repository.id} repository={repository} onChanged={onSaved} />
            )}
            <h3 className={repository ? undefined : 'settings-section-title'}>
              {repository ? 'Repository User Information' : 'Global User Information'}
            </h3>
            <p className="muted">
              {repository
                ? 'Repository-wide, shared by linked worktrees. Blank fields remove overrides from this file; inherited and worktree values remain.'
                : 'Applies unless a repository overrides it. Clear a field to remove its global value.'}
              {repository && ' Save applies all fields below; Cancel discards edits.'}
            </p>
            {settings && <p className="settings-target">Write to: {settings.path}</p>}
            <label>
              User name
              <input
                autoComplete="off"
                maxLength={256}
                value={name}
                disabled={!settings || busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Email
              <input
                autoComplete="off"
                maxLength={256}
                value={email}
                disabled={!settings || busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {settings && (
              <EffectiveValues className="settings-effective">
                {!repository && <summary>Effective values and sources</summary>}
                {[
                  ['Name', settings.effectiveName],
                  ['Email', settings.effectiveEmail],
                ].map(
                  ([label, field]) =>
                    typeof field === 'object' && (
                      <p key={String(label)}>
                        {String(label)} in Git configuration: {field.value ?? '(not configured)'}
                        <br />
                        <span className="muted">
                          {field.scope ?? 'No scope'} · {field.origin ?? 'No source'}
                        </span>
                      </p>
                    ),
                )}
                <p className="muted">Commit author environment variables can override Git configuration.</p>
              </EffectiveValues>
            )}
            {repository && (
              <>
                <button
                  className="button"
                  type="button"
                  disabled={!settings || busy}
                  onClick={() => {
                    setName('');
                    setEmail('');
                  }}
                >
                  Remove identity overrides
                </button>
                <h3>Issue links</h3>
                <p className="muted">
                  Match a prefix followed by up to 12 digits in commit messages. Blank URL disables links.
                </p>
                <label>
                  Issue prefix
                  <input
                    value={prefix}
                    maxLength={32}
                    disabled={busy}
                    onChange={(event) => setPrefix(event.target.value)}
                  />
                </label>
                <label>
                  Issue URL
                  <input
                    value={url}
                    maxLength={2048}
                    placeholder="https://tracker.example/issues/{id}"
                    disabled={busy}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </label>
                <div className="settings-links">
                  <button
                    className="button"
                    disabled={!canNavigate || Boolean(dirty) || busy}
                    onClick={() => handoff(remotes)}
                  >
                    Remotes…
                  </button>
                  <button
                    className="button"
                    disabled={!canNavigate || Boolean(dirty) || busy || repository.bare}
                    onClick={() => handoff(gitFlow)}
                  >
                    Git-flow…
                  </button>
                </div>
              </>
            )}
            {dirty && !valid.success && <p role="alert">{valid.error.issues[0]?.message}</p>}
          </section>
        )}
        {page === 'Integration' && (
          <section className="settings-page">
            <p>Configure installed editors, diff/merge tools, terminals and AI integration.</p>
            <button className="button" disabled={Boolean(dirty)} onClick={() => handoff(tools)}>
              External Tools…
            </button>
            <button className="button" disabled={Boolean(dirty)} onClick={() => handoff(ai)}>
              AI Integration…
            </button>
          </section>
        )}
        {page === 'Accounts' && <HostingAccountsPanel onClone={onClone} />}
        {page === 'Custom Commands' && (
          <section className="settings-page">
            <p>Manage contextual commands, input forms and shared definitions.</p>
            <button className="button" disabled={Boolean(dirty)} onClick={() => handoff(commands)}>
              Custom Commands…
            </button>
          </section>
        )}
        {error && (
          <div role="alert">
            {error}
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setSettings(undefined);
                setReload(reload + 1);
              }}
            >
              Reload settings (discard edits)
            </button>
          </div>
        )}
        <div className="dialog-actions">
          {(repository || dirty) && (
            <button
              className="button primary"
              disabled={!dirty || !valid.success || busy}
              onClick={() => void save()}
            >
              Save
            </button>
          )}
          <button className="button" disabled={busy} onClick={onClose}>
            {dirty ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
