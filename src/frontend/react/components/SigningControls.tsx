import { useEffect, useRef, useState } from 'react';
import type {
  RepositorySignature,
  RepositorySigningMode,
  RepositorySigningSettings,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

const signatureLabels: Record<RepositorySignature['status'], string> = {
  valid: 'Valid GPG signature · trusted key',
  untrusted: 'Valid GPG signature · key trust not established',
  invalid: 'Invalid GPG signature',
  'missing-key': 'Cannot verify · public key unavailable',
  expired: 'Expired signature or signing key',
  revoked: 'Signing key revoked',
  unsigned: 'Unsigned',
  unsupported: 'This signature format is not supported by GPG verification',
  unavailable: 'Signature could not be verified · check GPG installation and keyring',
};

export function SignatureCheck({
  repositoryId,
  objectId,
  kind,
}: {
  readonly repositoryId: string;
  readonly objectId: string;
  readonly kind: 'commit' | 'tag';
}) {
  const [result, setResult] = useState<RepositorySignature>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    return () => {
      generation.current = current + 1;
    };
  }, [repositoryId, objectId, kind]);
  return (
    <span className="signature-check" aria-live="polite">
      <button
        type="button"
        className="link-button"
        disabled={busy}
        onClick={() => {
          if (!window.desktop) return;
          const current = generation.current;
          setBusy(true);
          setError('');
          setResult(undefined);
          void window.desktop.repository
            .verifySignature({ id: repositoryId, objectId, kind })
            .then(unwrapResult)
            .then((value) => {
              if (current === generation.current) setResult(value);
            })
            .catch(() => {
              if (current === generation.current)
                setError('Signature verification failed. Check that the object and GPG are available.');
            })
            .finally(() => {
              if (current === generation.current) setBusy(false);
            });
        }}
      >
        {busy ? 'Verifying…' : result ? 'Verify again' : 'Verify GPG signature'}
      </button>
      {result && (
        <span title={result.fingerprint ?? undefined}>
          {' '}
          {signatureLabels[result.status]}
          {result.fingerprint && (
            <>
              {' '}
              · <code>{result.fingerprint}</code>
            </>
          )}
        </span>
      )}
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}

export function SigningControls({
  repositoryId,
  value,
  onChange,
  disabled = false,
}: {
  readonly repositoryId: string;
  readonly value: RepositorySigningMode;
  readonly onChange: (value: RepositorySigningMode) => void;
  readonly disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="signing-controls">
      <label>
        Signing:{' '}
        <select
          aria-label="Signing mode"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as RepositorySigningMode)}
        >
          <option value="inherit">Git default</option>
          <option value="gpg">Sign with GPG</option>
          <option value="unsigned">Unsigned</option>
        </select>
      </label>{' '}
      <button type="button" className="link-button" disabled={disabled} onClick={() => setOpen(true)}>
        Signing key…
      </button>
      {open && (
        <SigningKeyDialog key={repositoryId} repositoryId={repositoryId} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

function SigningKeyDialog({
  repositoryId,
  onClose,
}: {
  readonly repositoryId: string;
  readonly onClose: () => void;
}) {
  const [settings, setSettings] = useState<RepositorySigningSettings>();
  const [key, setKey] = useState('');
  const [inherit, setInherit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.desktop?.repository
      .getSigningSettings({ id: repositoryId })
      .then(unwrapResult)
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setKey(value.localKey ?? value.key ?? '');
        setInherit(value.localKey === null);
      })
      .catch(() => {
        if (active) setError('Signing settings could not be read.');
      });
    return () => {
      active = false;
    };
  }, [repositoryId]);
  const valid = inherit || /^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})!?$/u.test(key.trim());
  return (
    <dialog
      className="dialog reference-dialog"
      aria-label="Repository signing key"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onCancel={(event) => {
        event.stopPropagation();
        if (busy) event.preventDefault();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClose={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="dialog-content">
        <h2>Repository signing key</h2>
        <p>
          Saved in this repository’s Git configuration, shared by its linked worktrees. GPG handles
          passphrases in its native agent.
        </p>
        {settings ? (
          <>
            <p>
              Effective key: <code>{settings.key ?? 'Git committer identity'}</code>
              <br />
              Repository override: <code>{settings.localKey ?? 'None'}</code>
              <br />
              Git defaults: {settings.format}; commits {settings.commits ? 'signed' : 'unsigned'}; tags{' '}
              {settings.tags ? 'signed' : 'unsigned'}.
            </p>
            <label>
              <input
                type="checkbox"
                checked={inherit}
                disabled={busy}
                onChange={(event) => setInherit(event.target.checked)}
              />
              Inherit key (remove repository override)
            </label>
            <label>
              GPG key fingerprint
              <input
                className="reference-input"
                aria-label="GPG key fingerprint"
                value={key}
                disabled={busy || inherit}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <p>
              Use a full fingerprint or a 16-digit key ID. Worktree-specific or environment settings can
              override this repository value. Sign with GPG selects OpenPGP for that operation.
            </p>
          </>
        ) : (
          <p>Reading settings…</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!settings || !valid || busy}
            onClick={() => {
              if (!settings || !window.desktop) return;
              setBusy(true);
              setError('');
              void window.desktop.repository
                .setSigningKey({
                  id: repositoryId,
                  snapshot: settings.snapshot,
                  key: inherit ? null : key.trim(),
                })
                .then(unwrapResult)
                .then(onClose)
                .catch(() => {
                  setError(
                    'Could not save. Settings may have changed or be read-only. Reopen this dialog before retrying.',
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            Save
          </button>
        </div>
      </div>
    </dialog>
  );
}
