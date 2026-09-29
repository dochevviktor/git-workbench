import { useCallback, useEffect, useRef, useState } from 'react';
import type { LfsAction, LfsContext, LfsLocks } from '../../../common/ipc/lfs';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import './lfs.css';

export function LfsDialog({
  repositoryId,
  name,
  initialPath,
  onClose,
}: {
  readonly repositoryId: string;
  readonly name: string;
  readonly initialPath?: string;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<'Transfers' | 'Tracking' | 'Locks'>(initialPath ? 'Locks' : 'Transfers');
  const [context, setContext] = useState<LfsContext>();
  const [remote, setRemote] = useState('');
  const [refetch, setRefetch] = useState(false);
  const [pattern, setPattern] = useState('');
  const [lockable, setLockable] = useState(false);
  const [path, setPath] = useState(initialPath ?? '');
  const [locks, setLocks] = useState<LfsLocks>();
  const [operation, setOperation] = useState<RepositoryOperation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  const events = useRef(new Map<string, RepositoryOperation>());
  const handled = useRef('');
  const refresh = useCallback(async () => {
    const api = window.desktop;
    if (!api) return;
    const value = unwrapResult(await api.repository.getLfsContext({ id: repositoryId }));
    if (!active.current) return;
    setContext(value);
    setRemote((current) =>
      value.remotes.some((entry) => entry.name === current) ? current : (value.defaultRemote ?? ''),
    );
  }, [repositoryId]);
  useEffect(() => {
    active.current = true;
    void refresh().catch((reason: unknown) => {
      if (active.current)
        setError(reason instanceof Error ? reason.message : 'Git LFS settings could not be read.');
    });
    const unsubscribe = window.desktop?.repository.onOperationChanged((value) => {
      if (value.repositoryId !== repositoryId || value.kind !== 'lfs') return;
      const previous = events.current.get(value.id);
      if ((previous?.revision ?? -1) > (value.revision ?? 0)) return;
      events.current.set(value.id, value);
      if (events.current.size > 50) events.current.delete(events.current.keys().next().value!);
      setOperation((current) => (current?.id === value.id ? value : current));
    });
    return () => {
      active.current = false;
      unsubscribe?.();
    };
  }, [refresh, repositoryId]);
  useEffect(() => {
    if (!operation || operation.status === 'running' || handled.current === operation.id) return;
    handled.current = operation.id;
    if (operation.result?.kind === 'lfs-locks') setLocks(operation.result.value);
    void refresh()
      .catch((reason: unknown) => {
        if (active.current) setError(reason instanceof Error ? reason.message : 'Refresh failed.');
      })
      .finally(() => {
        pending.current = false;
        if (active.current) setBusy(false);
      });
  }, [operation, refresh]);
  const run = async (action: LfsAction) => {
    if (!context || pending.current || !window.desktop) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const accepted = unwrapResult(
        await window.desktop.repository.startLfsOperation({
          id: repositoryId,
          snapshot: context.snapshot,
          action,
        }),
      );
      if (active.current) setOperation(events.current.get(accepted.id) ?? accepted);
    } catch (reason) {
      pending.current = false;
      if (active.current) {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : 'The LFS operation could not start.');
      }
    }
  };
  const enabled = !!context?.available && !busy;
  const selectedRemote = context?.remotes.find((item) => item.name === remote);
  return (
    <dialog
      className="dialog lfs-dialog"
      aria-label="Git LFS"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onCancel={(event) => event.stopPropagation()}
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="dialog-content">
        <h2>
          Git LFS <span className="lfs-repository-name">{name}</span>
        </h2>
        <div className="lfs-tabs" role="tablist" aria-label="Git LFS pages">
          {(['Transfers', 'Tracking', 'Locks'] as const).map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === item}
              key={item}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {!context ? (
          <p>Reading Git LFS settings…</p>
        ) : !context.available ? (
          <p role="status">Git LFS is not installed. Install git-lfs, then refresh.</p>
        ) : (
          <>
            {tab !== 'Tracking' && (
              <label className="lfs-field">
                Remote
                <select
                  aria-label="LFS remote"
                  value={remote}
                  disabled={busy}
                  onChange={(event) => {
                    setRemote(event.target.value);
                    setLocks(undefined);
                  }}
                >
                  <option value="" disabled>
                    Select a remote
                  </option>
                  {context.remotes.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === 'Transfers' && (
              <section role="tabpanel" aria-label="Transfers">
                <p className="lfs-destination">
                  {selectedRemote?.url ?? 'Add a remote in Repository → Remotes.'}
                </p>
                {selectedRemote && (
                  <dl className="lfs-endpoints">
                    <dt>LFS download</dt>
                    <dd>{selectedRemote.endpoint ?? 'Resolved by Git LFS'}</dd>
                    <dt>Push URL</dt>
                    <dd>{selectedRemote.pushUrl}</dd>
                  </dl>
                )}
                <p>
                  Revision: <code>{context.head?.slice(0, 12) ?? 'No commits'}</code>
                </p>
                <p>
                  Download the LFS objects at this revision, or upload objects needed by its history.
                  Transfers leave Git references and the working copy unchanged.
                </p>
                <div className="lfs-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={!enabled || !remote || !context.head}
                    onClick={() => void run({ kind: 'fetch', remote, refetch })}
                  >
                    Download objects
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!enabled || !remote || !context.head}
                    onClick={() => void run({ kind: 'push', remote })}
                  >
                    Push LFS objects
                  </button>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={refetch}
                    disabled={busy}
                    onChange={(event) => setRefetch(event.target.checked)}
                  />{' '}
                  Download again, replacing cached LFS objects
                </label>
              </section>
            )}
            {tab === 'Tracking' && (
              <section role="tabpanel" aria-label="Tracking">
                <p>
                  Rules are saved in .gitattributes. Review and commit that file in Local Changes. Existing
                  history is not converted.
                </p>
                <div className="lfs-table-scroll">
                  <table className="lfs-table">
                    <thead>
                      <tr>
                        <th>Pattern</th>
                        <th>Attributes file</th>
                        <th>Lockable</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {context.patterns.map((item, index) => (
                        <tr key={`${item.source}:${item.pattern}:${index}`}>
                          <td>
                            <code>{item.pattern}</code>
                          </td>
                          <td>{item.source}</td>
                          <td>{item.lockable ? 'Yes' : 'No'}</td>
                          <td>
                            <button
                              type="button"
                              className="link-button"
                              disabled={!enabled || item.source !== '.gitattributes'}
                              title={
                                item.source === '.gitattributes'
                                  ? 'Remove this LFS tracking rule'
                                  : 'Edit this attributes file at its source'
                              }
                              onClick={() => void run({ kind: 'untrack', pattern: item.pattern })}
                            >
                              Stop tracking
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {context.patterns.length === 0 && <p className="preview-note">No LFS tracking rules.</p>}
                </div>
                <label className="lfs-field">
                  Pattern
                  <input
                    aria-label="LFS tracking pattern"
                    placeholder="*.psd"
                    value={pattern}
                    disabled={busy}
                    onChange={(event) => setPattern(event.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lockable}
                    disabled={busy}
                    onChange={(event) => setLockable(event.target.checked)}
                  />{' '}
                  Lockable files (read-only until locked)
                </label>
                <div className="lfs-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={!enabled || !pattern.trim()}
                    onClick={() => void run({ kind: 'track', pattern: pattern.trim(), lockable })}
                  >
                    Track pattern
                  </button>
                </div>
              </section>
            )}
            {tab === 'Locks' && (
              <section role="tabpanel" aria-label="Locks">
                <div className="lfs-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={!enabled || !remote}
                    onClick={() => void run({ kind: 'locks', remote })}
                  >
                    Refresh locks
                  </button>
                  <span>Ownership is verified with the server.</span>
                </div>
                <div className="lfs-table-scroll">
                  {locks?.remote === remote ? (
                    <>
                      <table className="lfs-table">
                        <thead>
                          <tr>
                            <th>File</th>
                            <th>Owner</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {locks.locks.map((lock) => (
                            <tr key={lock.id}>
                              <td title={lock.lockedAt}>{lock.path}</td>
                              <td>
                                {lock.owner}
                                {lock.ours ? ' (you)' : ''}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="link-button"
                                  disabled={!enabled || !lock.ours}
                                  title={
                                    lock.ours ? 'Release your lock' : 'This lock belongs to another user'
                                  }
                                  onClick={() =>
                                    void run({ kind: 'unlock', remote, lockId: lock.id, path: lock.path })
                                  }
                                >
                                  Unlock
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {locks.locks.length === 0 && <p className="preview-note">No locked files.</p>}
                      {locks.truncated && <p>Only the first 1,000 locks are shown.</p>}
                    </>
                  ) : (
                    <p className="preview-note">Refresh to load locks from the selected remote.</p>
                  )}
                </div>
                <label className="lfs-field">
                  File
                  <input
                    aria-label="LFS file to lock"
                    value={path}
                    disabled={busy}
                    onChange={(event) => setPath(event.target.value)}
                  />
                </label>
                <div className="lfs-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={!enabled || !remote || !path}
                    onClick={() => void run({ kind: 'lock', remote, path })}
                  >
                    Lock file
                  </button>
                </div>
              </section>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {operation && (
          <div className="lfs-operation" role="status">
            <span>
              {operation.status === 'running'
                ? operation.cancelRequested
                  ? 'Cancelling…'
                  : (operation.progress?.phase ?? 'Starting…')
                : operation.message}
            </span>
            {operation.status === 'running' && (
              <>
                <progress max="100" value={operation.progress?.percent ?? undefined} />
                <button
                  type="button"
                  className="link-button"
                  disabled={operation.cancelRequested}
                  onClick={() => {
                    void window.desktop?.repository
                      .cancelOperation({ operationId: operation.id })
                      .then(unwrapResult)
                      .catch(() => setError('The operation could not be cancelled. Check Activity.'));
                  }}
                >
                  Cancel transfer
                </button>
              </>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setError('');
              void refresh().catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : 'Refresh failed.'),
              );
            }}
          >
            Refresh
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
