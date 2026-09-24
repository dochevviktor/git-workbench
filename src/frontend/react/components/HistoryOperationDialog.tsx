import { useEffect, useId, useState } from 'react';
import type {
  RepositoryHistoryCommit,
  RepositoryHistoryOperationAction,
  RepositoryHistoryOperationPreview,
  RepositoryHistoryResetMode,
} from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { CommitIcon } from './Icons';
import { DialogShell } from './DialogShell';
import { IntegrationStatus } from './IntegrationStatus';

export type HistoryOperationDialogRequest = {
  readonly kind: 'cherry-pick' | 'revert' | 'reset';
  readonly commit: RepositoryHistoryCommit;
};

export function HistoryOperationDialog({
  repositoryId,
  request,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  readonly repositoryId: string;
  readonly request: HistoryOperationDialogRequest;
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: RepositoryHistoryOperationAction) => void;
  readonly onClose: () => void;
}) {
  const [preview, setPreview] = useState<RepositoryHistoryOperationPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const [mode, setMode] = useState<RepositoryHistoryResetMode>('mixed');
  const [commitChanges, setCommitChanges] = useState(true);
  const [appendOrigin, setAppendOrigin] = useState(false);
  const [mainlineParent, setMainlineParent] = useState(1);
  const [autostash, setAutostash] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const modeId = useId();

  useEffect(() => {
    setPreview(undefined);
    setPreviewError(undefined);
    setCommitChanges(true);
    setAppendOrigin(false);
    setMainlineParent(1);
    setAutostash(false);
    setConfirmDiscard(false);
  }, [request.commit.id, request.kind]);

  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setPreviewError(undefined);
    const input =
      request.kind === 'reset'
        ? { kind: 'reset' as const, id: repositoryId, targetCommitId: request.commit.id, mode }
        : {
            kind: request.kind,
            id: repositoryId,
            commitId: request.commit.id,
            ...(request.commit.parents.length > 1 ? { mainlineParent } : {}),
          };
    void window.desktop?.repository
      .getHistoryOperationPreview(input)
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreview(result.value);
        else setPreviewError(result.error.message);
      })
      .catch((reason: unknown) => {
        if (active) setPreviewError(reason instanceof Error ? reason.message : 'The preview failed.');
      });
    return () => {
      active = false;
    };
  }, [mode, mainlineParent, repositoryId, request]);

  const target = preview?.targetCommitId ?? request.commit.id;
  const targetSubject = preview?.targetSubject ?? request.commit.subject;
  const parents = preview?.targetParents ?? request.commit.parents;
  const hasChanges = Boolean(
    preview && preview.workingChanges.paths.length + preview.workingChanges.untrackedPaths.length > 0,
  );
  const hasTrackedChanges = Boolean(preview && preview.workingChanges.paths.length > 0);
  const mergeTarget = parents.length > 1;
  const loading = !preview && !previewError;
  const needsAutostash = request.kind !== 'reset' && hasChanges;
  const needsHardConfirmation = request.kind === 'reset' && mode === 'hard' && hasTrackedChanges;
  const warning = failure ?? previewError ?? (preview && !preview.canStart ? preview.message : null);
  const submitDisabled =
    loading ||
    !preview ||
    !preview.canStart ||
    (needsAutostash && !autostash) ||
    (needsHardConfirmation && !confirmDiscard) ||
    (mergeTarget && !mainlineParent);

  const submit = () => {
    if (!preview || submitDisabled) return;
    if (request.kind === 'reset') {
      onSubmit({
        kind: 'reset',
        targetCommitId: target,
        mode,
        snapshot: preview.snapshot,
        changesSnapshot: preview.workingChanges.snapshot,
        confirmDiscard,
      });
      return;
    }
    const common = {
      commitId: target,
      snapshot: preview.snapshot,
      commitChanges,
      autostash,
      changesSnapshot: autostash ? preview.workingChanges.snapshot : undefined,
      ...(mergeTarget ? { mainlineParent } : {}),
    };
    if (request.kind === 'cherry-pick') onSubmit({ kind: 'cherry-pick', appendOrigin, ...common });
    else onSubmit({ kind: 'revert', ...common });
  };

  const title =
    request.kind === 'cherry-pick'
      ? 'Cherry-pick Commit'
      : request.kind === 'revert'
        ? 'Revert Commit'
        : 'Reset Branch';
  const submitLabel =
    request.kind === 'cherry-pick' ? 'Cherry-pick' : request.kind === 'revert' ? 'Revert' : 'Reset';
  const subtitle =
    request.kind === 'reset'
      ? 'Move the current branch to the selected revision'
      : 'Apply the selected commit to the current branch';

  return (
    <DialogShell
      className="p05-dialog p06-dialog"
      title={title}
      subtitle={subtitle}
      icon={<CommitIcon size={26} />}
      platform={platform}
      warning={warning}
      status={request.kind !== 'reset' ? <IntegrationStatus value={preview?.integration} /> : undefined}
      submitLabel={submitLabel}
      submitDisabled={submitDisabled}
      danger={request.kind === 'reset' && mode === 'hard'}
      busy={busy}
      onSubmit={submit}
      onClose={onClose}
    >
      <dt>Commit:</dt>
      <dd className="reference-target">
        <CommitIcon size={13} />
        <strong>{targetSubject || '(no subject)'}</strong>
        <span className="reference-target-detail muted">{target.slice(0, 7)}</span>
      </dd>
      <dt>Current branch:</dt>
      <dd className="reference-target">{preview?.currentBranch ?? 'Checking…'}</dd>
      {request.kind === 'reset' ? (
        <>
          <dt>
            <label htmlFor={modeId}>Reset mode:</label>
          </dt>
          <dd>
            <select
              id={modeId}
              className="reference-input"
              value={mode}
              onChange={(event) => setMode(event.target.value as RepositoryHistoryResetMode)}
            >
              <option value="soft">Soft — keep index and worktree changes</option>
              <option value="mixed">Mixed — unstage differences, keep worktree</option>
              <option value="hard">Hard — discard tracked local changes</option>
            </select>
          </dd>
          {needsHardConfirmation && (
            <>
              <dt />
              <dd className="reference-dialog-options">
                <label className="reference-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmDiscard}
                    disabled={!needsHardConfirmation}
                    onChange={(event) => setConfirmDiscard(event.target.checked)}
                  />
                  Confirm saving a Recovery copy before discarding tracked changes
                </label>
                <p className="dialog-inline-note">
                  {mode === 'hard'
                    ? 'Untracked files are left in place; tracked changes are retained in Recovery before reset.'
                    : mode === 'soft'
                      ? 'HEAD moves while the index and worktree stay unchanged.'
                      : 'HEAD and the index move while worktree files stay unchanged.'}
                </p>
              </dd>
            </>
          )}
        </>
      ) : (
        <>
          <dt>Commit result:</dt>
          <dd className="reference-dialog-options">
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={commitChanges}
                onChange={(event) => setCommitChanges(event.target.checked)}
              />
              Commit the changes
            </label>
            {request.kind === 'cherry-pick' && (
              <label className="reference-checkbox">
                <input
                  type="checkbox"
                  checked={appendOrigin}
                  onChange={(event) => setAppendOrigin(event.target.checked)}
                />
                Append origin to the commit message
              </label>
            )}
          </dd>
          {mergeTarget && (
            <>
              <dt>
                <label htmlFor={`${modeId}-parent`}>Mainline parent:</label>
              </dt>
              <dd>
                <select
                  id={`${modeId}-parent`}
                  className="reference-input"
                  value={mainlineParent}
                  onChange={(event) => setMainlineParent(Number(event.target.value))}
                >
                  {parents.map((_parent, index) => (
                    <option key={index + 1} value={index + 1}>
                      Parent {index + 1} ({_parent.slice(0, 7)})
                    </option>
                  ))}
                </select>
              </dd>
            </>
          )}
          {hasChanges && (
            <>
              <dt>Local changes:</dt>
              <dd className="reference-dialog-options">
                <label className="reference-checkbox">
                  <input
                    type="checkbox"
                    checked={autostash}
                    disabled={!hasChanges}
                    onChange={(event) => setAutostash(event.target.checked)}
                  />
                  Stash and reapply local changes
                </label>
                <p className="dialog-inline-note">
                  {loading
                    ? 'Checking the working tree…'
                    : hasChanges
                      ? `${preview?.workingChanges.paths.length ?? 0} tracked and ${preview?.workingChanges.untrackedPaths.length ?? 0} untracked path${(preview?.workingChanges.paths.length ?? 0) + (preview?.workingChanges.untrackedPaths.length ?? 0) === 1 ? '' : 's'} will be preserved.`
                      : 'No local changes detected.'}
                </p>
              </dd>
            </>
          )}
        </>
      )}
    </DialogShell>
  );
}
