import { useState } from 'react';
import type { WorkspaceRecovery as Recovery } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { relocateRepositoryPreferences } from '../hooks/use-persistent-state';
import { copyText } from '../lib/clipboard';

export function WorkspaceRecovery({
  recovery,
  onChanged,
}: {
  readonly recovery: Recovery;
  readonly onChanged: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const presentation = Object.keys(window.localStorage).filter((key) =>
    key.startsWith('git-workbench.recovery.'),
  );
  const recover = async (tab: Recovery['tabs'][number], action: 'retry' | 'locate' | 'remove') => {
    const api = window.desktop?.repository;
    if (!api) return;
    setBusy(true);
    setError(undefined);
    try {
      const path =
        action === 'locate' ? unwrapResult(await api.pickDirectory()) : action === 'retry' ? tab.path : null;
      if (action === 'locate' && !path) return;
      const repository = unwrapResult(await api.recoverTab({ id: tab.id, path }));
      if (repository && repository.id !== tab.id) relocateRepositoryPreferences(tab.id, repository.id);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The saved tab could not be recovered.');
    } finally {
      setBusy(false);
    }
  };
  if (!recovery.tabs.length && !recovery.settings.length && !presentation.length) return null;
  return (
    <section className="workspace-recovery" aria-label="Workspace recovery">
      {recovery.tabs.length > 0 && <h2>Unavailable repositories</h2>}
      {recovery.tabs.map((tab) => (
        <div className="workspace-recovery-row" key={tab.id}>
          <div>
            <strong>{tab.name}</strong>
            <p>{tab.path}</p>
            <p className="muted">{tab.reason}</p>
          </div>
          <div className="manager-detail-actions">
            <button className="button" disabled={busy} onClick={() => void recover(tab, 'retry')}>
              Retry
            </button>
            <button className="button" disabled={busy} onClick={() => void recover(tab, 'locate')}>
              Locate…
            </button>
            <button className="button" disabled={busy} onClick={() => void recover(tab, 'remove')}>
              Remove Saved Tab
            </button>
          </div>
        </div>
      ))}
      {recovery.settings.length > 0 && (
        <>
          <h2>Recovered settings</h2>
          <p>
            Invalid settings were replaced with defaults. Original files are preserved in the settings folder.
          </p>
          <ul>
            {recovery.settings.map((entry) => (
              <li key={entry.path} title={entry.path}>
                {entry.name}
              </li>
            ))}
          </ul>
          <button
            className="button"
            onClick={() => {
              void window.desktop?.repository
                .revealWorkspaceStorage()
                .then(unwrapResult)
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error ? reason.message : 'The settings folder could not be opened.',
                  ),
                );
            }}
          >
            Open Settings Folder
          </button>
        </>
      )}
      {presentation.length > 0 && (
        <>
          <h2>Recovered presentation settings</h2>
          <p>Invalid preferences or drafts use their defaults. Their saved values are preserved here.</p>
          <ul>
            {presentation.map((key) => (
              <li key={key}>
                {key.slice('git-workbench.recovery.'.length)}{' '}
                <button
                  className="link-button"
                  onClick={() => copyText(window.localStorage.getItem(key) ?? '')}
                >
                  Copy Saved Value
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
