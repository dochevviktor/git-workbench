import { useEffect, useState } from 'react';
import type {
  RepositoryBranch,
  RepositoryLocalChangesPreview,
  RepositoryMergeRebaseAction,
  RepositoryMergeRebasePreview,
} from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { BranchIcon } from './Icons';
import { DialogShell } from './DialogShell';
import { IntegrationStatus } from './IntegrationStatus';

type MergeMode = 'default' | 'no-ff' | 'squash' | 'no-commit';
let lastMergeMode: MergeMode = 'default';

export type MergeRebaseDialogRequest =
  | {
      readonly kind: 'merge';
      readonly source: Pick<RepositoryBranch, 'name' | 'fullName'>;
      readonly current: RepositoryBranch;
    }
  | {
      readonly kind: 'rebase';
      readonly source: Pick<RepositoryBranch, 'name' | 'fullName'>;
      readonly current: RepositoryBranch;
    };

export function MergeRebaseDialog({
  repositoryId,
  request,
  referenceSnapshot,
  preview,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  readonly repositoryId: string;
  readonly request: MergeRebaseDialogRequest;
  readonly referenceSnapshot: string | undefined;
  readonly preview: RepositoryLocalChangesPreview | undefined;
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: RepositoryMergeRebaseAction) => void;
  readonly onClose: () => void;
}) {
  const hasChanges = preview ? preview.paths.length + preview.untrackedPaths.length > 0 : undefined;
  const [autostash, setAutostash] = useState(false);
  const [mode, setMode] = useState<MergeMode>(lastMergeMode);
  const [prediction, setPrediction] = useState<RepositoryMergeRebasePreview>();
  const [predictionError, setPredictionError] = useState<string>();
  useEffect(() => {
    let active = true;
    setPrediction(undefined);
    setPredictionError(undefined);
    void window.desktop?.repository
      .getMergeRebasePreview({
        id: repositoryId,
        kind: request.kind,
        sourceFullName: request.source.fullName,
      })
      .then((result) => {
        if (!active) return;
        if (result.ok) setPrediction(result.value);
        else setPredictionError(result.error.message);
      })
      .catch((reason: unknown) => {
        if (active)
          setPredictionError(reason instanceof Error ? reason.message : 'Could not check the operation.');
      });
    return () => {
      active = false;
    };
  }, [repositoryId, request.kind, request.source.fullName]);
  const title = request.kind === 'merge' ? 'Merge Branch' : 'Rebase Branch';
  const submitLabel = request.kind === 'merge' ? 'Merge' : 'Rebase';
  const subtitle =
    request.kind === 'merge'
      ? `Merge '${request.source.name}' into '${request.current.name}'`
      : `Replay '${request.current.name}' on '${request.source.name}'`;

  return (
    <DialogShell
      className="p05-dialog p06-dialog"
      title={title}
      subtitle={subtitle}
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={
        failure ??
        predictionError ??
        (prediction && referenceSnapshot && prediction.snapshot !== referenceSnapshot
          ? 'The branch changed. Close this dialog and review the operation again.'
          : null)
      }
      status={<IntegrationStatus value={prediction} />}
      submitLabel={submitLabel}
      submitDisabled={
        !referenceSnapshot ||
        !preview ||
        !prediction ||
        prediction.snapshot !== referenceSnapshot ||
        Boolean(preview.pendingOperation) ||
        (hasChanges === true && !autostash)
      }
      busy={busy}
      onSubmit={() => {
        if (!referenceSnapshot) return;
        const common = {
          sourceFullName: request.source.fullName,
          sourceCommitId: prediction?.sourceCommitId,
          snapshot: referenceSnapshot,
          autostash,
          changesSnapshot: autostash ? preview?.snapshot : undefined,
        };
        if (request.kind === 'merge') {
          lastMergeMode = mode;
          onSubmit({ kind: 'merge', mode, ...common });
        } else onSubmit({ kind: 'rebase', ...common });
      }}
      onClose={onClose}
    >
      <dt>{request.kind === 'merge' ? 'Merge:' : 'Rebase:'}</dt>
      <dd className="reference-target">
        <BranchIcon size={13} />
        <strong>{request.kind === 'merge' ? request.source.name : request.current.name}</strong>
      </dd>
      <dt>{request.kind === 'merge' ? 'Into:' : 'Onto:'}</dt>
      <dd className="reference-target">
        <BranchIcon size={13} />
        <strong>{request.kind === 'merge' ? request.current.name : request.source.name}</strong>
      </dd>
      {request.kind === 'merge' && (
        <>
          <dt>
            <label htmlFor="merge-mode">Merge Option:</label>
          </dt>
          <dd>
            <select
              id="merge-mode"
              className="reference-input"
              value={mode}
              onChange={(event) => setMode(event.target.value as MergeMode)}
            >
              <option value="default">Default — Fast-forward if possible</option>
              <option value="no-ff">No Fast-Forward — Always create a merge commit</option>
              <option value="squash">Squash — Stage a single-parent result</option>
              <option value="no-commit">Don't Commit — Merge without commit</option>
            </select>
            {mode === 'no-commit' && (
              <p className="dialog-inline-note">
                A fast-forward updates the branch immediately; a merge commit pauses for review.
              </p>
            )}
          </dd>
        </>
      )}
      {(request.kind === 'rebase' || hasChanges !== false) && (
        <>
          <dt />
          <dd>
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={autostash}
                disabled={!preview}
                data-testid="merge-rebase-autostash"
                onChange={(event) => setAutostash(event.target.checked)}
              />
              Stash and reapply local changes
            </label>
            {preview && hasChanges === true && (
              <p className="dialog-inline-note">
                {preview.paths.length + preview.untrackedPaths.length} changed path
                {preview.paths.length + preview.untrackedPaths.length === 1 ? '' : 's'} will be saved in
                Recovery before the operation.
              </p>
            )}
            {preview && hasChanges === false && (
              <p className="dialog-inline-note">No local changes detected.</p>
            )}
            {!preview && <p className="dialog-inline-note">Checking the working tree…</p>}
          </dd>
        </>
      )}
    </DialogShell>
  );
}
