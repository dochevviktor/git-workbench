import { useMemo, useState } from 'react';
import type {
  RepositoryReferenceContext,
  RepositoryWorktree,
  RepositoryWorktreeAction,
} from '../../../common/ipc/contracts';
import { localBranchNameFor, referenceNameProblem } from '../lib/references';
import type { Platform } from '../lib/platform';
import { BranchIcon, FolderIcon } from './Icons';
import { DialogShell } from './DialogShell';

export type WorktreeDialogRequest =
  | { readonly kind: 'create'; readonly sourceFullName?: string | undefined; readonly commitId?: string }
  | { readonly kind: 'lock'; readonly worktree: RepositoryWorktree }
  | { readonly kind: 'remove'; readonly worktree: RepositoryWorktree };

interface WorktreeDialogProps {
  readonly request: WorktreeDialogRequest;
  readonly context: RepositoryReferenceContext | undefined;
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: RepositoryWorktreeAction) => void;
  readonly onClose: () => void;
}

export function WorktreeDialog(props: WorktreeDialogProps) {
  if (props.request.kind === 'create') return <CreateWorktreeDialog {...props} request={props.request} />;
  if (props.request.kind === 'lock')
    return <LockWorktreeDialog {...props} worktree={props.request.worktree} />;
  return <RemoveWorktreeDialog {...props} worktree={props.request.worktree} />;
}

function CreateWorktreeDialog({
  context,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
  request,
}: WorktreeDialogProps & { readonly request: Extract<WorktreeDialogRequest, { kind: 'create' }> }) {
  const sources = useMemo(() => {
    const localBranches = context?.branches ?? [];
    const remoteBranches = context?.remoteBranches ?? [];
    return [
      ...localBranches.map((branch) => ({
        fullName: branch.fullName,
        label: branch.name,
        remote: false,
        disabled: branch.isHead || branch.worktreePath !== null,
      })),
      ...remoteBranches.map((name) => ({
        fullName: `refs/remotes/${name}`,
        label: name,
        remote: true,
        disabled: false,
      })),
    ];
  }, [context?.branches, context?.remoteBranches]);
  const firstAvailable = sources.find((source) => !source.disabled) ?? sources[0];
  const [sourceFullName, setSourceFullName] = useState(
    request.sourceFullName ?? firstAvailable?.fullName ?? '',
  );
  const selected = sources.find((source) => source.fullName === sourceFullName) ?? firstAvailable;
  const [path, setPath] = useState('');
  const defaultBranchName = selected?.remote
    ? localBranchNameFor(selected.label, context?.remotes ?? [])
    : '';
  const [branchName, setBranchName] = useState(defaultBranchName);
  const remote = selected?.remote ?? false;
  const branchProblem = remote ? referenceNameProblem(branchName.trim(), 'branch') : null;
  const detached = request.commitId !== undefined;
  const occupied = !detached && (selected?.disabled ?? true);

  return (
    <DialogShell
      className="p05-dialog p09-dialog"
      title={detached ? 'Checkout Commit as Worktree' : 'Checkout Branch as Worktree'}
      subtitle="Checkout in a separate worktree"
      icon={<FolderIcon size={26} />}
      platform={platform}
      warning={failure ?? (occupied ? 'That branch is already checked out.' : null)}
      submitLabel="Create"
      submitDisabled={
        (!detached && !selected) ||
        occupied ||
        path.trim().length === 0 ||
        (!detached && remote && (branchName.trim().length === 0 || branchProblem !== null))
      }
      busy={busy}
      onSubmit={() =>
        onSubmit(
          detached
            ? { kind: 'create-detached', path: path.trim(), commitId: request.commitId! }
            : {
                kind: 'create',
                path: path.trim(),
                sourceFullName,
                ...(remote ? { branchName: branchName.trim() } : {}),
              },
        )
      }
      onClose={onClose}
    >
      <dt>{detached ? 'Commit:' : 'Local Branch:'}</dt>
      <dd>
        {detached ? (
          <code>{request.commitId?.slice(0, 12)} · Detached HEAD</code>
        ) : (
          <select
            className="reference-input"
            aria-label="Branch:"
            value={sourceFullName}
            onChange={(event) => {
              setSourceFullName(event.target.value);
              const next = sources.find((source) => source.fullName === event.target.value);
              if (next?.remote) setBranchName(localBranchNameFor(next.label, context?.remotes ?? []));
            }}
          >
            {sources.map((source) => (
              <option key={source.fullName} value={source.fullName} disabled={source.disabled}>
                {source.remote ? `Remote: ${source.label}` : source.label}
                {source.disabled ? ' (already checked out)' : ''}
              </option>
            ))}
          </select>
        )}
      </dd>
      {remote && !detached && (
        <>
          <dt>
            <label htmlFor="worktree-branch-name">Local branch:</label>
          </dt>
          <dd>
            <input
              id="worktree-branch-name"
              className="reference-input"
              value={branchName}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setBranchName(event.target.value)}
            />
          </dd>
        </>
      )}
      <dt>
        <label htmlFor="worktree-location">Location:</label>
      </dt>
      <dd>
        <div className="p09-location">
          <input
            id="worktree-location"
            className="reference-input"
            value={path}
            placeholder="/path/to/linked-worktree"
            spellCheck={false}
            autoComplete="off"
            data-dialog-autofocus
            onChange={(event) => setPath(event.target.value)}
          />
          <button
            type="button"
            className="button button-small"
            aria-label="Choose parent folder"
            onClick={() => {
              void window.desktop?.repository.pickDirectory().then((result) => {
                if (result.ok && result.value)
                  setPath(
                    `${result.value.replace(/[\\/]$/u, '')}/${detached ? 'detached-worktree' : (selected?.label ?? 'worktree').replaceAll('/', '-')}`,
                  );
              });
            }}
          >
            <FolderIcon size={14} />
          </button>
        </div>
        <p className="dialog-inline-note">The destination must not already exist.</p>
      </dd>
    </DialogShell>
  );
}

function RemoveWorktreeDialog({
  worktree,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: WorktreeDialogProps & { readonly worktree: RepositoryWorktree }) {
  const destructive = worktree.workingTree.state === 'dirty' || worktree.locked;
  const [force, setForce] = useState(false);
  const status = [
    worktree.workingTree.state === 'dirty' ? 'uncommitted changes' : null,
    worktree.locked ? 'locked' : null,
  ].filter((value): value is string => value !== null);

  return (
    <DialogShell
      className="p05-dialog p09-dialog"
      title="Remove Worktree"
      subtitle={`Delete '${worktree.path.split(/[\\/]/u).at(-1)}'?`}
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel={force ? 'Force Remove' : 'Remove'}
      submitDisabled={destructive && !force}
      danger={force}
      busy={busy}
      onSubmit={() => onSubmit({ kind: 'remove', worktreeId: worktree.id, force })}
      onClose={onClose}
    >
      <dt>Location:</dt>
      <dd className="p09-path">{worktree.path}</dd>
      <dt>Branch:</dt>
      <dd>{worktree.branchName ?? 'Detached HEAD'}</dd>
      {status.length > 0 && (
        <>
          <dt>Status:</dt>
          <dd>
            {status.join(', ')}
            {worktree.lockReason ? `: ${worktree.lockReason}` : ''}
            {worktree.workingTree.changedFileCount
              ? ` · ${worktree.workingTree.changedFileCount} changed paths (including ignored files)`
              : ''}
          </dd>
          <dt />
          <dd className="reference-dialog-options">
            <label className="reference-checkbox">
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
              <span>Force removal and discard this worktree state</span>
            </label>
          </dd>
        </>
      )}
      {!destructive && <p className="dialog-inline-note">The linked branch and its commits are retained.</p>}
    </DialogShell>
  );
}

function LockWorktreeDialog({
  worktree,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: WorktreeDialogProps & { readonly worktree: RepositoryWorktree }) {
  const [reason, setReason] = useState('');
  return (
    <DialogShell
      className="p05-dialog p09-dialog"
      title="Lock Worktree"
      subtitle="Protect its registration from pruning and accidental removal"
      icon={<FolderIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel="Lock"
      submitDisabled={false}
      busy={busy}
      onClose={onClose}
      onSubmit={() => onSubmit({ kind: 'lock', worktreeId: worktree.id, reason })}
    >
      <dt>Location:</dt>
      <dd className="p09-path">{worktree.path}</dd>
      <dt>
        <label htmlFor="worktree-lock-reason">Reason:</label>
      </dt>
      <dd>
        <input
          id="worktree-lock-reason"
          className="reference-input"
          value={reason}
          maxLength={512}
          data-dialog-autofocus
          onChange={(event) => setReason(event.target.value)}
          placeholder="Optional"
        />
      </dd>
    </DialogShell>
  );
}
