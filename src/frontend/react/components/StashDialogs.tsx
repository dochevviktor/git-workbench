import { useEffect, useState } from 'react';
import type {
  RepositoryStashAction,
  RepositoryStashDetails,
  RepositoryStashEntry,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import type { Platform } from '../lib/platform';
import { formatListDate } from '../lib/format';
import { StashIcon, StashItemIcon, WarningIcon } from './Icons';

export type StashDialogRequest =
  | {
      readonly kind: 'save';
      readonly previewError?: string;
      readonly paths: readonly string[];
      readonly snapshot?: string | undefined;
      readonly selection?: Omit<
        Extract<RepositoryStashAction, { kind: 'save-selection' }>,
        'kind' | 'message'
      >;
    }
  | {
      readonly kind: 'action';
      readonly previewError?: string;
      readonly action: 'apply' | 'pop' | 'drop' | 'rename';
      readonly entry: RepositoryStashEntry;
      readonly snapshot?: string | undefined;
    }
  | { readonly kind: 'inspect'; readonly entry: RepositoryStashEntry };

interface StashDialogsProps {
  readonly repositoryId: string;
  readonly request: StashDialogRequest;
  readonly platform: Platform;
  readonly busy: boolean;
  readonly onSubmit: (action: RepositoryStashAction) => void;
  readonly onClose: () => void;
}

function StashDialog({ repositoryId, request, platform, busy, onSubmit, onClose }: StashDialogsProps) {
  const [message, setMessage] = useState(
    request.kind === 'action' && request.action === 'rename' ? request.entry.message : '',
  );
  const [stageNewFiles, setStageNewFiles] = useState(false);
  const [deleteAfterApply, setDeleteAfterApply] = useState(
    request.kind === 'action' && request.action === 'pop',
  );

  const save = request.kind === 'save';
  const action = request.kind === 'action' ? request.action : undefined;
  const danger = action === 'drop';
  const title = save
    ? request.paths.length > 0
      ? 'Stash selected changes'
      : 'Save stash'
    : action === 'apply'
      ? 'Apply Stash'
      : action === 'pop'
        ? 'Apply Stash'
        : action === 'rename'
          ? 'Rename Stash'
          : 'Delete Stash';
  const submitLabel = save
    ? 'Save Stash'
    : action === 'apply' || action === 'pop'
      ? 'Apply'
      : action === 'rename'
        ? 'Rename'
        : 'Delete';
  const entry = request.kind !== 'save' ? request.entry : undefined;
  const subtitle = save
    ? request.paths.length > 0
      ? 'Only the selected files will be saved; other local changes stay in place.'
      : 'Save your local changes to a new stash'
    : entry
      ? `${entry.selector}${entry.branch ? ` on ${entry.branch}` : ''}`
      : '';

  if (request.kind === 'inspect') {
    return (
      <StashInspectDialog
        repositoryId={repositoryId}
        entry={request.entry}
        platform={platform}
        onClose={onClose}
      />
    );
  }
  const waitingForPreview =
    request.kind === 'save'
      ? !request.selection && !request.snapshot
      : (request.action === 'apply' || request.action === 'pop') && !request.snapshot;

  return (
    <dialog
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      className="dialog stash-dialog p06-stash-dialog"
      aria-label={title}
      aria-busy={busy}
      data-testid="stash-dialog"
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="dialog-content"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || waitingForPreview) return;
          if (save) {
            if (request.selection) onSubmit({ kind: 'save-selection', message, ...request.selection });
            else
              onSubmit({
                kind: 'save',
                message,
                includeUntracked: false,
                stageNewFiles,
                paths: [...request.paths],
                changesSnapshot: request.snapshot,
              });
          } else if (entry && action === 'rename') {
            if (message.trim())
              onSubmit({ kind: 'rename', stashId: entry.commitId, message: message.trim() });
          } else if (entry && action === 'drop') {
            onSubmit({ kind: 'drop', stashId: entry.commitId });
          } else if (entry && action) {
            onSubmit({
              kind: deleteAfterApply ? 'pop' : 'apply',
              stashId: entry.commitId,
              changesSnapshot: request.snapshot,
            });
          }
        }}
      >
        <div className="reference-dialog-header">
          <span className="reference-dialog-mark" aria-hidden="true">
            {save ? <StashIcon size={24} /> : <StashItemIcon size={24} />}
          </span>
          <div>
            <h2>{title}</h2>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        {save || action === 'rename' ? (
          <div className="stash-dialog-fields">
            <label>
              <span>Message</span>
              <input
                type="text"
                value={message}
                maxLength={512}
                autoFocus
                placeholder="Stash message (optional)"
                spellCheck={false}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            {save && !request.selection && (
              <>
                <label className="reference-checkbox">
                  <input
                    type="checkbox"
                    checked={stageNewFiles}
                    onChange={(event) => setStageNewFiles(event.target.checked)}
                  />
                  <span>Stage new files</span>
                </label>
                <p className="muted">By default stash ignores new files until you stage them.</p>
                {request.paths.length > 0 && (
                  <div className="stash-path-preview">
                    <strong>{request.paths.length > 0 ? 'Selected files' : 'Files to save'}</strong>
                    {request.paths.length > 0 ? (
                      <ul>
                        {request.paths.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">
                        Tracked changes{stageNewFiles ? ' and newly staged files' : ''}; ignored files stay
                        outside the stash.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {save && request.selection && (
              <p className="muted">
                {request.selection.selection.kind === 'hunk' ? 'Selected hunk' : 'Selected lines'} in{' '}
                {request.selection.target.path}. Other changes stay in place.
              </p>
            )}
            {action === 'rename' && (
              <p className="muted">
                The renamed stash moves to the top of the list. Its saved contents are unchanged.
              </p>
            )}
          </div>
        ) : (
          <div className="stash-action-copy">
            <p>
              {action === 'drop'
                ? 'The stash will be removed from Git and cannot be restored by Git Workbench.'
                : action === 'pop'
                  ? 'The stash will be applied with its staged/unstaged distinction, then deleted only if the apply succeeds.'
                  : 'The stash will be applied with its staged/unstaged distinction and retained in the stash list.'}
            </p>
            {(action === 'apply' || action === 'pop') && (
              <>
                <label className="reference-checkbox">
                  <input
                    type="checkbox"
                    checked={deleteAfterApply}
                    onChange={(event) => setDeleteAfterApply(event.target.checked)}
                  />
                  Delete stash after applying
                </label>
                {deleteAfterApply && (
                  <p className="muted">The stash will not be deleted if a conflict occurs.</p>
                )}
              </>
            )}
            {entry && (
              <dl className="stash-summary">
                <dt>Message</dt>
                <dd>{entry.message || '(no message)'}</dd>
                <dt>Created</dt>
                <dd>{formatListDate(entry.createdAt)}</dd>
              </dl>
            )}
          </div>
        )}
        <div className="reference-dialog-actions">
          <p className="reference-dialog-warning" role="alert">
            {request.previewError ?? (waitingForPreview ? 'Checking local changes…' : '')}
          </p>
          <div className="dialog-actions">
            {platform === 'darwin' ? (
              <>
                <button type="button" className="button" onClick={onClose}>
                  {busy ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className={danger ? 'button primary danger' : 'button primary'}
                  disabled={busy || waitingForPreview || (action === 'rename' && !message.trim())}
                >
                  {submitLabel}
                </button>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  className={danger ? 'button primary danger' : 'button primary'}
                  disabled={busy || waitingForPreview || (action === 'rename' && !message.trim())}
                >
                  {submitLabel}
                </button>
                <button type="button" className="button" onClick={onClose}>
                  {busy ? 'Close' : 'Cancel'}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </dialog>
  );
}

function StashInspectDialog({
  repositoryId,
  entry,
  platform,
  onClose,
}: {
  readonly repositoryId: string;
  readonly entry: RepositoryStashEntry;
  readonly platform: Platform;
  readonly onClose: () => void;
}) {
  const [details, setDetails] = useState<RepositoryStashDetails>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void window.desktop?.repository
      .getStashDetails({ id: repositoryId, stashId: entry.commitId })
      .then((result) => {
        if (!active) return;
        try {
          setDetails(unwrapResult(result));
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'The stash could not be inspected.');
        }
      });
    return () => {
      active = false;
    };
  }, [entry.commitId, repositoryId]);
  return (
    <dialog
      className="dialog stash-dialog stash-inspect-dialog"
      aria-label="Inspect Stash"
      data-testid="stash-inspect-dialog"
      open
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-content">
        <div className="reference-dialog-header">
          <span className="reference-dialog-mark" aria-hidden="true">
            <StashItemIcon size={24} />
          </span>
          <div>
            <h2>Inspect Stash</h2>
            <p className="muted">
              {entry.selector}: {entry.message || '(no message)'}
            </p>
          </div>
        </div>
        {error ? (
          <p className="inline-alert" role="alert">
            <WarningIcon size={14} /> {error}
          </p>
        ) : details?.state === 'too-large' ? (
          <p className="muted">This stash is too large to display inline.</p>
        ) : details ? (
          <pre className="stash-patch-preview">{details.content || 'No displayable changes.'}</pre>
        ) : (
          <p className="muted">Reading stash changes…</p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button primary" onClick={onClose}>
            {platform === 'darwin' ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function StashDialogs(props: StashDialogsProps) {
  return <StashDialog {...props} />;
}
