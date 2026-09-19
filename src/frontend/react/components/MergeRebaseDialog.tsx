import { useState } from 'react';
import type {
  RepositoryBranch,
  RepositoryLocalChangesPreview,
  RepositoryMergeRebaseAction,
} from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { BranchIcon } from './Icons';
import { DialogShell } from './DialogShell';

export type MergeRebaseDialogRequest =
  | {
      readonly kind: 'merge';
      readonly source: RepositoryBranch;
      readonly current: RepositoryBranch;
    }
  | {
      readonly kind: 'rebase';
      readonly source: RepositoryBranch;
      readonly current: RepositoryBranch;
    };

export function MergeRebaseDialog({
  request,
  referenceSnapshot,
  preview,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
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
  const title = request.kind === 'merge' ? 'Merge Branch' : 'Rebase Branch';
  const submitLabel = request.kind === 'merge' ? 'Merge' : 'Rebase';
  const subtitle =
    request.kind === 'merge'
      ? `Merge '${request.source.name}' into '${request.current.name}'`
      : `Replay '${request.current.name}' on '${request.source.name}'`;

  return (
    <DialogShell
      title={title}
      subtitle={subtitle}
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel={submitLabel}
      submitDisabled={!referenceSnapshot || (autostash && !preview)}
      busy={busy}
      onSubmit={() => {
        if (!referenceSnapshot) return;
        onSubmit({
          kind: request.kind,
          sourceFullName: request.source.fullName,
          snapshot: referenceSnapshot,
          autostash,
          changesSnapshot: autostash ? preview?.snapshot : undefined,
        });
      }}
      onClose={onClose}
    >
      <dt>Source:</dt>
      <dd className="reference-target">
        <BranchIcon size={13} />
        <strong>{request.source.name}</strong>
      </dd>
      <dt>Into:</dt>
      <dd className="reference-target">
        <BranchIcon size={13} />
        <strong>{request.current.name}</strong>
      </dd>
      <dt>Local changes:</dt>
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
            {preview.paths.length + preview.untrackedPaths.length === 1 ? '' : 's'} will be saved in Recovery
            before the operation.
          </p>
        )}
        {preview && hasChanges === false && <p className="dialog-inline-note">No local changes detected.</p>}
        {!preview && <p className="dialog-inline-note">Checking the working tree…</p>}
      </dd>
    </DialogShell>
  );
}
