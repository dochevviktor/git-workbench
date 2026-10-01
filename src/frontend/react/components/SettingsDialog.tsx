import { useEffect, useRef, useState } from 'react';
import type { GitInfo, RepositorySummary, RepositoryManagerSnapshot } from '../../../common/ipc/contracts';
import type { GitSettings } from '../../../common/ipc/settings';
import { saveGitSettingsSchema, gitOptionKeys } from '../../../common/ipc/settings';
import { unwrapResult } from '../../../common/ipc/result';
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import './settings.css';
import { GitInstanceControl } from './GitInstanceControl';
import { RepositoryTrustControl } from './RepositoryTrustControl';
import { HostingAccountsPanel } from './HostingAccountsPanel';
import type { HostingCloneTarget } from '../../../common/ipc/hosting';
import { ShortcutSettings } from './ShortcutSettings';
import { useProductivityPreferences } from '../hooks/use-productivity-preferences';
import { useExternalTools } from './external-tools-context';
import { CustomCommandsDialog } from './CustomCommandsDialog';
import type { CustomCommand } from '../../../common/ipc/custom-commands';

export function SettingsDialog({
  repository,
  canNavigate,
  gitInfo,
  onClose,
  onSaved,
  commandDefinitions,
  onCommandsChanged,
  initialPage,
  onClone,
  ai,
  remotes,
  gitFlow,
  sources,
  sourceDirectories,
  addSource,
  removeSource,
  sourceBusy,
  sourceError,
}: {
  repository: RepositorySummary | null;
  canNavigate: boolean;
  gitInfo: GitInfo | undefined;
  onClose(): void;
  onSaved(): void;
  commandDefinitions: CustomCommand[];
  onCommandsChanged(commands: CustomCommand[]): void;
  initialPage?: 'Accounts' | undefined;
  onClone(target: HostingCloneTarget): void;
  ai(): void;
  remotes(): void;
  gitFlow(): void;
  sources(): void;
  sourceDirectories: RepositoryManagerSnapshot['sourceDirectories'];
  addSource(): void;
  removeSource(id: string): void;
  sourceBusy: boolean;
  sourceError: string | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const externalTools = useExternalTools();
  const [page, setPage] = useState(repository ? 'Git' : (initialPage ?? 'General'));
  const [settings, setSettings] = useState<GitSettings>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [gitOptions, setGitOptions] = useState<Record<string, string>>({});
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
  const productivity = useProductivityPreferences();
  const [syntax, setSyntax] = usePersistentState(
    'diff.syntax',
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [showDirty, setShowDirty] = usePersistentState(
    'tabs.showDirty',
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [avatars, setAvatars] = usePersistentState('avatars', 'initials', isOneOf(['initials', 'hidden']));
  const [sortOrder, setSortOrder] = usePersistentState(
    'history.sortOrder',
    'topological',
    isOneOf(['topological', 'date']),
  );
  const [monospace, setMonospace] = usePersistentState(
    'commit.monospace',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [compactLabels, setCompactLabels] = usePersistentState(
    'history.compactLabels',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [branchSpaces, setBranchSpaces] = usePersistentState(
    'branch.spaces',
    'keep',
    isOneOf(['keep', '-', '_']),
  );
  const [subjectLimit, setSubjectLimit] = usePersistentState(
    'commit.subjectLimit',
    72,
    isNumberBetween(30, 200),
  );
  const [pageGuide, setPageGuide] = usePersistentState('commit.pageGuide', 72, isNumberBetween(0, 200));
  const [reviewPush, setReviewPush] = usePersistentState(
    'commit.reviewPush',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
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
        setGitOptions(
          Object.fromEntries((value.options ?? []).map((entry) => [entry.key, entry.value ?? ''])),
        );
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
    options: settings?.options
      ?.map((entry) => ({ key: entry.key, value: gitOptions[entry.key]?.trim() || null }))
      .filter((entry) => entry.value !== settings.options?.find((item) => item.key === entry.key)?.value),
    issueRule: repository && url.trim() ? { prefix, url: url.trim() } : null,
  };
  const valid = saveGitSettingsSchema.safeParse(request);
  const dirty =
    settings &&
    (request.name !== settings.name ||
      request.email !== settings.email ||
      JSON.stringify(request.issueRule) !== JSON.stringify(settings.issueRule) ||
      (request.options ?? []).some(
        (entry) => entry.value !== settings.options?.find((item) => item.key === entry.key)?.value,
      ));
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
      className={`dialog settings-dialog${page === 'Accounts' ? ' settings-accounts-dialog' : ''}${page === 'Integration' || page === 'Custom Commands' ? ' settings-tools-dialog' : ''}`}
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
            {['General', 'Commit', 'Git', 'Accounts', 'Integration', 'Custom Commands', 'Shortcuts'].map(
              (tab) => (
                <button
                  type="button"
                  key={tab}
                  aria-pressed={page === tab}
                  disabled={busy || (Boolean(dirty) && page !== tab)}
                  onClick={() => setPage(tab)}
                >
                  {tab}
                </button>
              ),
            )}
          </nav>
        )}
        {page === 'General' && (
          <section className="settings-page">
            <h3>Source Code Folders</h3>
            <div className="settings-sources" aria-label="Source code folders">
              {sourceDirectories.map((source) => (
                <div key={source.id}>
                  <span title={`${source.path} · ${source.status}`}>
                    {source.status !== 'available' ? '⚠ ' : ''}
                    {source.path}
                  </span>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Remove source folder ${source.path}`}
                    disabled={sourceBusy}
                    onClick={() => removeSource(source.id)}
                  >
                    −
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="button"
                  disabled={sourceBusy}
                  onClick={addSource}
                  aria-label="Add source folder"
                >
                  +
                </button>
                <button type="button" className="link-button" onClick={() => handoff(sources)}>
                  Repository Manager…
                </button>
              </div>
            </div>
            {sourceError && <p role="alert">{sourceError}</p>}
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
            <div
              className="settings-diff-preview"
              aria-label="Diff preview"
              style={{ fontSize: `${font}px` }}
            >
              <div className="muted">@@ −1,2 +1,2 @@</div>
              <div className="settings-diff-remove">{showMarks ? '− ' : '  '}const value = 1;</div>
              <div className="settings-diff-add">
                {showMarks ? '+ ' : '  '}
                <span className={syntax ? 'syntax-keyword' : ''}>const</span> value = 2;
              </div>
            </div>
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
            <label className="settings-check">
              <input
                type="checkbox"
                checked={!syntax}
                onChange={(event) => setSyntax(!event.target.checked)}
              />
              Disable syntax highlighting
            </label>
            <label>
              Sort commits
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                <option value="topological">Topologically</option>
                <option value="date">By date</option>
              </select>
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={compactLabels}
                onChange={(event) => setCompactLabels(event.target.checked)}
              />
              Compact branch labels
            </label>
            <label>
              Spaces in branch names
              <select value={branchSpaces} onChange={(event) => setBranchSpaces(event.target.value)}>
                <option value="keep">Validate as typed</option>
                <option value="-">Replace with −</option>
                <option value="_">Replace with _</option>
              </select>
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={showDirty}
                onChange={(event) => setShowDirty(event.target.checked)}
              />
              Tab indicator for uncommitted changes
            </label>
            <label>
              Author avatars
              <select value={avatars} onChange={(event) => setAvatars(event.target.value)}>
                <option value="initials">Local initials</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <p className="muted">
              Avatars are drawn locally; author email addresses are never sent to an avatar service.
            </p>
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
            <label className="settings-check">
              <input
                type="checkbox"
                checked={productivity.value?.fetchAllTags ?? true}
                disabled={!productivity.value || productivity.busy}
                onChange={(event) => void productivity.update({ fetchAllTags: event.target.checked })}
              />
              Always include tags into fetch
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={productivity.value?.updateSubmodulesOnCheckout ?? false}
                disabled={!productivity.value || productivity.busy}
                onChange={(event) =>
                  void productivity.update({ updateSubmodulesOnCheckout: event.target.checked })
                }
              />
              Update submodules automatically on checkout
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
            <label>
              Subject warning limit
              <input
                type="number"
                min={30}
                max={200}
                value={subjectLimit}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (next >= 30 && next <= 200) setSubjectLimit(next);
                }}
              />
            </label>
            <label>
              Page guide column
              <input
                type="number"
                min={0}
                max={200}
                value={pageGuide}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (next >= 0 && next <= 200) setPageGuide(next);
                }}
              />
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
            <label className="settings-check">
              <input
                type="checkbox"
                checked={monospace}
                onChange={(event) => setMonospace(event.target.checked)}
              />
              Use monospace commit font
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={reviewPush}
                onChange={(event) => setReviewPush(event.target.checked)}
              />
              Review Push after commit
            </label>
            <p className="muted">
              Opens the Push dialog after a successful commit. Review the destination before sending changes.
            </p>
            <p className="muted">
              Signing mode and repository signing key are available in the commit composer and tag dialog. Git
              commit templates continue to follow Git configuration.
            </p>
            <h3 className="settings-section-title">Generate Commit Message</h3>
            <button type="button" className="button" onClick={ai}>
              AI Integration…
            </button>
          </section>
        )}
        {page === 'Git' && (
          <section className="settings-page">
            {!repository && <GitInstanceControl gitInfo={gitInfo} />}
            {!repository && (
              <>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={productivity.value?.verboseGitOutput ?? false}
                    disabled={!productivity.value || productivity.busy}
                    onChange={(event) => void productivity.update({ verboseGitOutput: event.target.checked })}
                  />
                  Enable verbose Git output
                </label>
                <p className="muted">
                  Include executed operation commands in Activity output. Credentials are redacted.
                </p>
              </>
            )}
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
                    disabled={!settings || busy}
                    onChange={(event) => setPrefix(event.target.value)}
                  />
                </label>
                <label>
                  Issue URL
                  <input
                    value={url}
                    maxLength={2048}
                    placeholder="https://tracker.example/issues/{id}"
                    disabled={!settings || busy}
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
            {settings?.options && (
              <details className="settings-effective">
                <summary>Signing and commit template defaults</summary>
                <p className="muted">
                  Save writes to the configuration file above. Inherit or a blank path removes only this
                  file’s override. Key management and passphrases stay with Git’s signing agent.
                </p>
                {gitOptionKeys.map((key) => {
                  const item = settings.options?.find((entry) => entry.key === key);
                  const label = (
                    {
                      'user.signingkey': 'Signing key',
                      'commit.gpgsign': 'Sign commits',
                      'tag.gpgsign': 'Sign tags',
                      'commit.template': 'Commit template path',
                    } as const
                  )[key];
                  return (
                    <div key={key} className="settings-option">
                      <label>
                        {label}
                        {key.endsWith('gpgsign') ? (
                          <select
                            value={gitOptions[key] ?? ''}
                            disabled={busy}
                            onChange={(event) => setGitOptions({ ...gitOptions, [key]: event.target.value })}
                          >
                            <option value="">Inherit</option>
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                            {gitOptions[key] && !['true', 'false'].includes(gitOptions[key]!) && (
                              <option value={gitOptions[key]}>{gitOptions[key]} (current)</option>
                            )}
                          </select>
                        ) : (
                          <input
                            value={gitOptions[key] ?? ''}
                            maxLength={4096}
                            disabled={busy}
                            onChange={(event) => setGitOptions({ ...gitOptions, [key]: event.target.value })}
                          />
                        )}
                      </label>
                      <small>
                        {item?.effective.value ?? '(not configured)'} · {item?.effective.scope ?? 'No scope'}{' '}
                        · {item?.effective.origin ?? 'No source'}
                      </small>
                    </div>
                  );
                })}
              </details>
            )}
            {dirty && !valid.success && <p role="alert">{valid.error.issues[0]?.message}</p>}
          </section>
        )}
        {page === 'Integration' && (
          <section className="settings-page">
            {externalTools.settingsPanel}
            <button className="button" disabled={Boolean(dirty)} onClick={() => handoff(ai)}>
              AI Integration…
            </button>
          </section>
        )}
        {page === 'Accounts' && <HostingAccountsPanel onClone={onClone} />}
        {page === 'Shortcuts' && <ShortcutSettings />}
        {productivity.error && <p role="alert">{productivity.error}</p>}
        {page === 'Custom Commands' && (
          <CustomCommandsDialog
            embedded
            commands={commandDefinitions}
            onChanged={onCommandsChanged}
            onClose={() => setPage('General')}
          />
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
