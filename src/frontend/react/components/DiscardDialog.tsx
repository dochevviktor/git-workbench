import { useEffect, useState } from 'react';
import type {
  RepositoryDiscardPreview,
  RepositoryWorkingChangeSelection,
  RepositoryWorkingChangeTarget,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

export interface DiscardRequest {
  readonly targets: readonly RepositoryWorkingChangeTarget[];
  readonly selection: RepositoryWorkingChangeSelection;
}

/** The preview is read-only; mutation happens only after the user confirms this exact snapshot. */
export function DiscardDialog({
  repositoryId,
  request,
  busy,
  failure,
  onConfirm,
  onClose,
}: {
  readonly repositoryId: string;
  readonly request: DiscardRequest;
  readonly busy: boolean;
  readonly failure?: string | undefined;
  readonly onConfirm: (snapshot: string) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const [preview, setPreview] = useState<RepositoryDiscardPreview>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setError(undefined);
    if (!window.desktop) return;
    void window.desktop.repository
      .previewDiscard({ id: repositoryId, targets: [...request.targets], selection: request.selection })
      .then(unwrapResult)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not preview changes.');
      });
    return () => {
      active = false;
    };
  }, [repositoryId, request, revision]);
  return (
    <dialog
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      className="dialog discard-dialog"
      aria-label="Discard changes"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        <h2>Discard changes</h2>
        <p>
          Discard{' '}
          {request.selection.kind === 'file'
            ? `the unstaged changes in ${request.targets.length} selected file${request.targets.length === 1 ? '' : 's'}`
            : request.selection.kind === 'hunk'
              ? 'this hunk'
              : 'these selected lines'}
          ?
        </p>
        <p className="muted">
          A recovery copy of tracked changes will be saved. Staged changes and other files stay in place.
        </p>
        {(error ?? failure) && (
          <p role="alert">
            {error ?? failure}{' '}
            <button
              type="button"
              className="button button-small"
              disabled={busy}
              onClick={() => setRevision((current) => current + 1)}
            >
              Refresh preview
            </button>
          </p>
        )}
        {!preview && !error && <p role="status">Reading the exact changes…</p>}
        {preview && (
          <div className="discard-preview">
            {preview.files.map((file) => (
              <details key={file.target.path} open>
                <summary>{file.target.path}</summary>
                {file.state === 'binary' ? (
                  <p>Binary file. Its complete unstaged content will be restored from the index.</p>
                ) : (
                  <pre>{file.content || 'File metadata change; there are no textual hunks.'}</pre>
                )}
              </details>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary danger"
            disabled={!preview || busy}
            onClick={() => {
              if (preview)
                void onConfirm(preview.snapshot).then((success) => {
                  if (success) onClose();
                });
            }}
          >
            Discard
          </button>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
