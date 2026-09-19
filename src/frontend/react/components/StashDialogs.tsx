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
      readonly paths: readonly string[];
      readonly snapshot?: string | undefined;
    }
  | {
      readonly kind: 'action';
      readonly action: 'apply' | 'pop' | 'drop';
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
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);

  const save = request.kind === 'save';
  const action = request.kind === 'action' ? request.action : undefined;
  const danger = action === 'drop';
  const title = save
    ? request.paths.length > 0
      ? 'Stash selected changes'
      : 'Save changes as stash'
    : action === 'apply'
      ? 'Apply Stash'
      : action === 'pop'
        ? 'Pop Stash'
        : 'Delete Stash';
  const submitLabel = save ? 'Stash' : action === 'apply' ? 'Apply' : action === 'pop' ? 'Pop' : 'Delete';
  const entry = request.kind !== 'save' ? request.entry : undefined;
  const subtitle = save
    ? request.paths.length > 0
      ? 'Only the selected files will be saved; other local changes stay in place.'
      : 'Save the supported local changes so the working tree can be changed safely.'
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

  return (
    <dialog
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      className="dialog stash-dialog"
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
          if (busy) return;
          if (save) {
            onSubmit({
              kind: 'save',
              message,
              includeUntracked,
              paths: [...request.paths],
              changesSnapshot: request.snapshot,
            });
          } else if (entry && action) {
            onSubmit({ kind: action, stashId: entry.commitId, changesSnapshot: request.snapshot });
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
        {save ? (
          <div className="stash-dialog-fields">
            <label>
              <span>Message</span>
              <input
                type="text"
                value={message}
                maxLength={512}
                autoFocus
                placeholder="Work in progress"
                spellCheck={false}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(event) => setIncludeUntracked(event.target.checked)}
              />
              <span>Include untracked files</span>
            </label>
            <div className="stash-path-preview">
              <strong>{request.paths.length > 0 ? 'Selected files' : 'Files to save'}</strong>
              {request.paths.length > 0 ? (
                <ul>
                  {request.paths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">All supported changed files, subject to the untracked-file option.</p>
              )}
            </div>
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
            {entry && (
              <dl className="stash-summary">
                <dt>Message</dt>
                <dd>{entry.message || '(no message)'}</dd>
                <dt>Created</dt>
                <dd>{formatListDate(entry.createdAt)}</dd>
                <dt>Untracked</dt>
                <dd>{entry.includesUntracked ? 'Included' : 'Not included'}</dd>
              </dl>
            )}
          </div>
        )}
        <div className="reference-dialog-actions">
          <p className="reference-dialog-warning" role="alert" />
          <div className="dialog-actions">
            {platform === 'darwin' ? (
              <>
                <button type="button" className="button" onClick={onClose}>
                  {busy ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className={danger ? 'button primary danger' : 'button primary'}
                  disabled={busy}
                >
                  {submitLabel}
                </button>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  className={danger ? 'button primary danger' : 'button primary'}
                  disabled={busy}
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
