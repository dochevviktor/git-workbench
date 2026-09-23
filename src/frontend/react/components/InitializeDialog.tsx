import { useRef, useState } from 'react';
import { unwrapResult } from '../../../common/ipc/result';
import type { RepositorySummary } from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { RepositoryIcon } from './Icons';
import { DialogShell } from './DialogShell';

export function InitializeDialog({
  platform,
  onClose,
  onCreated,
}: {
  readonly platform: Platform;
  readonly onClose: () => void;
  readonly onCreated: (repository: RepositorySummary) => void;
}) {
  const [path, setPath] = useState('');
  const [bare, setBare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const closed = useRef(false);
  const close = () => {
    closed.current = true;
    onClose();
  };
  const browse = async () => {
    if (!window.desktop) return;
    try {
      const selected = unwrapResult(await window.desktop.repository.pickDirectory());
      if (selected && !closed.current) setPath(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'A folder could not be selected.');
    }
  };
  const submit = async () => {
    if (!window.desktop) return;
    setBusy(true);
    setError(undefined);
    try {
      const repository = unwrapResult(await window.desktop.repository.initialize({ path, bare }));
      if (!closed.current) onCreated(repository);
    } catch (reason) {
      if (!closed.current)
        setError(reason instanceof Error ? reason.message : 'The repository could not be initialized.');
    } finally {
      if (!closed.current) setBusy(false);
    }
  };
  return (
    <DialogShell
      title="Initialize Repository"
      subtitle="Create a Git repository in an existing folder"
      icon={<RepositoryIcon size={26} />}
      platform={platform}
      busy={busy}
      warning={error ?? null}
      submitLabel="Initialize"
      submitDisabled={!path.trim()}
      onSubmit={() => void submit()}
      onClose={close}
    >
      <dt>
        <label htmlFor="initialize-path">Folder:</label>
      </dt>
      <dd className="reference-input-with-button">
        <input
          id="initialize-path"
          className="reference-input"
          autoFocus
          value={path}
          disabled={busy}
          onChange={(event) => setPath(event.target.value)}
        />
        <button type="button" className="button" disabled={busy} onClick={() => void browse()}>
          Browse…
        </button>
      </dd>
      <dt />
      <dd>
        <label>
          <input
            type="checkbox"
            checked={bare}
            disabled={busy}
            onChange={(event) => setBare(event.target.checked)}
          />{' '}
          Bare repository (no working files)
        </label>
      </dd>
    </DialogShell>
  );
}
