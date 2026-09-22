import { useEffect, useRef, useState } from 'react';
import type { RepositorySummary } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

export function RepositoryTrustControl({
  repository,
  onChanged,
}: {
  readonly repository: RepositorySummary;
  readonly onChanged: () => void;
}) {
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trusted, setTrusted] = useState(repository.trusted === true);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (review) dialog.current?.showModal();
  }, [review]);
  const close = () => {
    if (!busy) {
      setReview(false);
      opener.current?.focus();
    }
  };
  const save = async (value: boolean) => {
    if (!window.desktop) return;
    setBusy(true);
    setError('');
    try {
      unwrapResult(await window.desktop.repository.setTrust({ id: repository.id, trusted: value }));
      setTrusted(value);
      setReview(false);
      onChanged();
      opener.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Trust could not be changed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="repository-trust" data-testid="repository-trust">
        <span>
          {trusted
            ? 'Repository trusted'
            : 'History browsing · trust this repository to use working changes and Git operations.'}
        </span>
        <button
          ref={opener}
          type="button"
          className="button"
          disabled={busy}
          onClick={() => (trusted ? void save(false) : setReview(true))}
        >
          {trusted ? 'Revoke Trust' : 'Trust Repository…'}
        </button>
        {error && !review && <span role="alert">{error}</span>}
      </div>
      {review && (
        <dialog
          ref={dialog}
          className="dialog"
          aria-labelledby="trust-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={close}
        >
          <div className="dialog-content">
            <h2 id="trust-title">Trust Repository</h2>
            <p>
              <strong>{repository.name}</strong>
              <br />
              {repository.path}
            </p>
            <p>
              Git hooks, filters, credential helpers and other configured programs can run with your
              permissions. Only trust repositories whose contents and configuration you trust.
            </p>
            <p className="muted">Git operations can also run programs in this repository's submodules.</p>
            <p className="muted">
              This choice is remembered for this repository and its linked worktrees. You can revoke it in
              Repository Settings. Git ownership checks still apply.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                Trust Repository
              </button>
              <button type="button" className="button" disabled={busy} onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
