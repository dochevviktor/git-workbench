import { useEffect, useRef, useState } from 'react';
import type { Workspaces, WorkspaceEdit } from '../../../common/ipc/workspaces';
import { workspaceNameSchema } from '../../../common/ipc/workspaces';
import './settings.css';

export function WorkspacesDialog({
  value,
  edit,
  reload,
  onClose,
  open,
}: {
  value: Workspaces;
  edit(request: WorkspaceEdit): Promise<Workspaces | undefined>;
  reload(): Promise<void>;
  onClose(): void;
  open(id: string, newWindow: boolean): Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(value.activeId);
  const [name, setName] = useState(value.entries.find((entry) => entry.id === selected)?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const entry = value.entries.find((item) => item.id === selected);
  const activate = async (newWindow: boolean) => {
    if (!entry || busy) return;
    setBusy(true);
    setError('');
    try {
      await open(entry.id, newWindow);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cannot open workspace.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const act = async (request: WorkspaceEdit) => {
    setBusy(true);
    setError('');
    try {
      const next = await edit(request);
      if (request.kind === 'create') {
        const created = next?.entries.find((item) => item.name === request.name);
        if (created) setSelected(created.id);
      }
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cannot save workspace.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={ref}
      className="dialog settings-dialog"
      aria-label="Workspaces"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        <h2>Workspaces</h2>
        <p className="muted">
          Each workspace saves its repository tabs, order, colors and pane sizes. Open workspaces have their
          own windows.
        </p>
        <div className="workspace-settings-list" aria-label="Saved workspaces">
          {value.entries.map((item) => (
            <button
              className="button"
              key={item.id}
              aria-pressed={item.id === selected}
              disabled={busy}
              onClick={() => {
                setSelected(item.id);
                setName(item.name);
                setConfirm(false);
              }}
            >
              {item.name}
              {item.open ? ' · Open' : ''}
            </button>
          ))}
        </div>
        <section className="settings-page">
          <label>
            Workspace name
            <input
              autoFocus
              value={name}
              maxLength={60}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </section>
        <div className="settings-links">
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setSelected('');
              setName('');
              setConfirm(false);
            }}
          >
            New workspace
          </button>
          <button
            className="button primary"
            disabled={busy || !workspaceNameSchema.safeParse(name).success || name.trim() === entry?.name}
            onClick={() =>
              void act(
                entry
                  ? { kind: 'rename', id: entry.id, name: name.trim(), revision: value.revision }
                  : { kind: 'create', name: name.trim(), revision: value.revision },
              )
            }
          >
            {entry ? 'Rename' : 'Create'}
          </button>
          <button
            className="button"
            disabled={busy || !entry || entry.open || entry.id === 'default'}
            onClick={() => setConfirm(true)}
          >
            Remove
          </button>
        </div>
        {confirm && entry && (
          <div role="alert">
            <p>Remove “{entry.name}” from saved workspaces? Repositories and their files are kept.</p>
            <button
              className="button danger"
              onClick={() => void act({ kind: 'remove', id: entry.id, revision: value.revision })}
            >
              Remove workspace
            </button>
            <button className="button" onClick={() => setConfirm(false)}>
              Keep workspace
            </button>
          </div>
        )}
        {error && (
          <p role="alert">
            {error}{' '}
            <button className="button" onClick={() => void reload()}>
              Reload workspaces
            </button>
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="button"
            disabled={busy || !entry || entry.id === value.activeId}
            onClick={() => {
              void activate(true);
            }}
          >
            Open in New Window
          </button>
          <button
            className="button"
            disabled={busy || !entry || entry.id === value.activeId}
            onClick={() => {
              void activate(false);
            }}
          >
            Switch Workspace
          </button>
          <button className="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
