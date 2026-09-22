import { useEffect, useRef, useState } from 'react';
import type {
  RepositoryOperation,
  RepositoryPatchPreview,
  RepositoryPatchTarget,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import type { Platform } from '../lib/platform';
import { DialogShell } from './DialogShell';
import { CheckIcon } from './Icons';

export function PatchImportDialog({
  repositoryId,
  source,
  platform,
  onClose,
  onApplied,
}: {
  readonly repositoryId: string;
  readonly source: 'file' | 'clipboard';
  readonly platform: Platform;
  readonly onClose: () => void;
  readonly onApplied: () => void;
}) {
  const [preview, setPreview] = useState<RepositoryPatchPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState<string>();
  const [selection, setSelection] = useState({ source, revision: 0 });
  const generation = useRef(0);
  useEffect(() => {
    const api = window.desktop?.repository;
    if (!api) return;
    const current = ++generation.current;
    let token: string | undefined;
    let disposed = false;
    void api.previewPatch({ id: repositoryId, source: selection.source }).then((result) => {
      if (result.ok && result.value) token = result.value.token;
      if (disposed) {
        if (token) void api.releasePatch({ id: repositoryId, token });
        return;
      }
      if (!result.ok) setError(result.error.message);
      else if (result.value) setPreview(result.value);
      else setError('Patch selection cancelled. Choose a file or use the clipboard.');
    });
    return () => {
      disposed = true;
      generation.current = current + 1;
      if (token) void api.releasePatch({ id: repositoryId, token });
    };
  }, [repositoryId, selection]);

  useEffect(() => {
    const api = window.desktop?.repository;
    if (!api || !operationId) return;
    let done = false;
    const receive = (operation: RepositoryOperation) => {
      if (done || operation.id !== operationId || operation.status === 'running') return;
      done = true;
      setBusy(false);
      onApplied();
      if (operation.status === 'succeeded') onClose();
      else {
        setPreview(undefined);
        setError(operation.message + (operation.output ? '\n' + operation.output : ''));
      }
    };
    const release = api.onOperationChanged(receive);
    void api.listOperations().then((result) => {
      if (!done && result.ok) result.value.forEach(receive);
    });
    return () => {
      done = true;
      release();
    };
  }, [operationId, onApplied, onClose]);

  const choose = (next: 'file' | 'clipboard') => {
    setPreview(undefined);
    setError(undefined);
    setSelection((old) => ({ source: next, revision: old.revision + 1 }));
  };
  const apply = async () => {
    if (!preview || !window.desktop) return;
    const current = generation.current;
    setBusy(true);
    const result = await window.desktop.repository.applyPatch({ id: repositoryId, token: preview.token });
    if (current !== generation.current) return;
    if (result.ok) setOperationId(result.value.id);
    else {
      setBusy(false);
      setPreview(undefined);
      setError(result.error.message);
    }
  };
  return (
    <DialogShell
      className="patch-dialog"
      title="Apply Patch"
      subtitle="Apply changes to the index and working tree without committing."
      icon={<CheckIcon size={32} />}
      platform={platform}
      warning={error ?? (preview?.state !== 'clean' ? (preview?.message ?? null) : null)}
      submitLabel={busy ? 'Applying…' : 'Apply'}
      submitDisabled={!preview || preview.state === 'invalid'}
      busy={busy}
      onSubmit={() => void apply()}
      onClose={onClose}
    >
      <dt>Location:</dt>
      <dd className="patch-location">
        <input aria-label="Patch location" readOnly value={preview?.location ?? ''} />
        <button type="button" className="button" disabled={busy} onClick={() => choose('file')}>
          Browse…
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => choose('clipboard')}>
          Use Clipboard
        </button>
      </dd>
      <dt>Status:</dt>
      <dd role="status">
        {preview?.state === 'clean' ? (
          <span className="patch-clean">✓ {preview.message}</span>
        ) : preview ? (
          'Review the warning below.'
        ) : error ? (
          'No patch selected.'
        ) : (
          'Checking patch…'
        )}
      </dd>
    </DialogShell>
  );
}

export function PatchExportDialog({
  repositoryId,
  target,
  platform,
  onClose,
  onSaved,
}: {
  readonly repositoryId: string;
  readonly target: RepositoryPatchTarget;
  readonly platform: Platform;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
}) {
  const [destination, setDestination] = useState<'file' | 'clipboard'>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async () => {
    const api = window.desktop?.repository;
    if (!api) return;
    setBusy(true);
    try {
      if (destination === 'clipboard') {
        unwrapResult(await api.copyPatch({ id: repositoryId, target }));
        if (mounted.current) {
          onSaved('Patch copied to clipboard.');
          onClose();
        }
      } else {
        const result = unwrapResult(await api.savePatch({ id: repositoryId, target }));
        if (mounted.current && result.status === 'saved') {
          onSaved(result.message);
          onClose();
        }
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Patch export failed.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <DialogShell
      title="Create Patch"
      subtitle="Export the selected changes as a Git patch."
      icon={<CheckIcon size={32} />}
      platform={platform}
      warning={error ?? null}
      submitLabel={destination === 'clipboard' ? 'Copy' : 'Save…'}
      submitDisabled={false}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <dt>Source:</dt>
      <dd>
        {target.kind === 'commit'
          ? target.commitId
          : target.kind === 'stash'
            ? target.stashId
            : `${target.paths.length} selected paths`}
      </dd>
      <dt>Destination:</dt>
      <dd>
        <select
          aria-label="Patch destination"
          value={destination}
          disabled={busy}
          onChange={(event) => setDestination(event.target.value as 'file' | 'clipboard')}
        >
          <option value="file">File</option>
          <option value="clipboard">Clipboard</option>
        </select>
      </dd>
    </DialogShell>
  );
}
