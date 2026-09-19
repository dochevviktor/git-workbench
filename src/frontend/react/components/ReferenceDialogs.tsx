import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  RepositoryBranch,
  RepositoryReferenceAction,
  RepositoryReferenceContext,
  RepositoryReferenceStartPoint,
  RepositoryTag,
} from '../../../common/ipc/contracts';
import { localBranchNameFor, referenceNameProblem } from '../lib/references';
import type { Platform } from '../lib/platform';
import { BranchIcon, CommitIcon, RemoteIcon, TagIcon, WarningIcon } from './Icons';

/** What a new branch or tag starts from, with the label the dialog shows for it. */
export interface ReferenceTarget {
  readonly startPoint: RepositoryReferenceStartPoint;
  readonly icon: 'commit' | 'branch' | 'remote' | 'tag';
  readonly label: string;
  readonly detail?: string | undefined;
  /** A remote-tracking branch the new branch can track. */
  readonly trackable?: string | undefined;
}

export type ReferenceDialogRequest =
  | { readonly kind: 'new-branch'; readonly target: ReferenceTarget }
  | { readonly kind: 'new-tag'; readonly target: ReferenceTarget }
  | { readonly kind: 'rename-branch'; readonly branch: RepositoryBranch }
  | { readonly kind: 'delete-branch'; readonly branch: RepositoryBranch }
  | { readonly kind: 'delete-tag'; readonly tag: RepositoryTag }
  | { readonly kind: 'set-upstream'; readonly branch: RepositoryBranch }
  | { readonly kind: 'checkout-remote-branch'; readonly target: ReferenceTarget }
  | { readonly kind: 'checkout-detached'; readonly target: ReferenceTarget };

interface ReferenceDialogProps {
  readonly request: ReferenceDialogRequest;
  readonly context: RepositoryReferenceContext | undefined;
  readonly platform: Platform;
  readonly busy: boolean;
  /** The last refusal from the backend for this dialog, shown instead of being thrown away. */
  readonly failure: { readonly message: string; readonly canForce: boolean } | undefined;
  readonly onSubmit: (action: RepositoryReferenceAction) => void;
  readonly onClose: () => void;
}

function targetIcon(icon: ReferenceTarget['icon']): ReactNode {
  switch (icon) {
    case 'commit':
      return <CommitIcon size={13} />;
    case 'branch':
      return <BranchIcon size={13} />;
    case 'remote':
      return <RemoteIcon size={13} />;
    case 'tag':
      return <TagIcon size={13} />;
  }
}

function TargetRow({ label, target }: { readonly label: string; readonly target: ReferenceTarget }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="reference-target">
        <span className="reference-target-icon" aria-hidden="true">
          {targetIcon(target.icon)}
        </span>
        <span className="reference-target-name">{target.label}</span>
        {target.detail && <span className="reference-target-detail muted">{target.detail}</span>}
      </dd>
    </>
  );
}

/** Fork's dialog chrome: a large mark, a title with one explanatory line, then labelled rows. */
function DialogShell({
  title,
  subtitle,
  icon,
  platform,
  warning,
  submitLabel,
  submitDisabled,
  danger,
  busy,
  onSubmit,
  onClose,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: ReactNode;
  readonly platform: Platform;
  readonly warning: string | null;
  readonly submitLabel: string;
  readonly submitDisabled: boolean;
  readonly danger?: boolean;
  readonly busy: boolean;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submitDisabled && !busy) onSubmit();
  };

  const confirm = (
    <button
      key="confirm"
      type="submit"
      className={danger ? 'button primary danger' : 'button primary'}
      disabled={submitDisabled || busy}
      data-testid="reference-dialog-submit"
    >
      {submitLabel}
    </button>
  );
  const cancel = (
    <button key="cancel" type="button" className="button" onClick={onClose}>
      Cancel
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      className="dialog reference-dialog"
      aria-labelledby={titleId}
      data-testid="reference-dialog"
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="dialog-content" onSubmit={submit}>
        <div className="reference-dialog-header">
          <span className="reference-dialog-mark" aria-hidden="true">
            {icon}
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        <dl className="reference-dialog-fields">{children}</dl>
        <div className="reference-dialog-actions">
          <p className="reference-dialog-warning" role="alert" data-testid="reference-dialog-warning">
            {warning && (
              <>
                <WarningIcon size={14} />
                <span>{warning}</span>
              </>
            )}
          </p>
          {/* Windows puts the affirmative button first; Linux and macOS put it last. */}
          <div className="dialog-actions">{platform === 'win32' ? [confirm, cancel] : [cancel, confirm]}</div>
        </div>
      </form>
    </dialog>
  );
}

export function ReferenceDialog(props: ReferenceDialogProps) {
  switch (props.request.kind) {
    case 'new-branch':
      return <NewBranchDialog {...props} target={props.request.target} />;
    case 'new-tag':
      return <NewTagDialog {...props} target={props.request.target} />;
    case 'checkout-remote-branch':
      return <CheckoutRemoteDialog {...props} target={props.request.target} />;
    case 'rename-branch':
      return <RenameBranchDialog {...props} branch={props.request.branch} />;
    case 'set-upstream':
      return <UpstreamDialog {...props} branch={props.request.branch} />;
    case 'delete-branch':
      return <DeleteBranchDialog {...props} branch={props.request.branch} />;
    case 'delete-tag':
      return <DeleteTagDialog {...props} tag={props.request.tag} />;
    case 'checkout-detached':
      return <CheckoutDetachedDialog {...props} target={props.request.target} />;
  }
}

type DialogPropsWithTarget = ReferenceDialogProps & { readonly target: ReferenceTarget };
type DialogPropsWithBranch = ReferenceDialogProps & { readonly branch: RepositoryBranch };

function NameField({
  label,
  value,
  placeholder,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}) {
  const fieldId = useId();
  return (
    <>
      <dt>
        <label htmlFor={fieldId}>{label}</label>
      </dt>
      <dd>
        <input
          id={fieldId}
          type="text"
          className="reference-input"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          data-testid="reference-name"
          onChange={(event) => onChange(event.target.value)}
        />
      </dd>
    </>
  );
}

function useNameWarning(
  name: string,
  kind: 'branch' | 'tag',
  taken: ReadonlySet<string>,
  failure: ReferenceDialogProps['failure'],
): string | null {
  return useMemo(() => {
    const trimmed = name.trim();
    const problem = referenceNameProblem(trimmed, kind);
    if (problem) return problem;
    if (taken.has(trimmed)) {
      return kind === 'branch' ? `Branch '${trimmed}' already exists` : `Tag '${trimmed}' already exists`;
    }
    return failure?.message ?? null;
  }, [failure, kind, name, taken]);
}

function branchNames(context: RepositoryReferenceContext | undefined): ReadonlySet<string> {
  return new Set((context?.branches ?? []).map((branch) => branch.name));
}

function tagNames(context: RepositoryReferenceContext | undefined): ReadonlySet<string> {
  return new Set((context?.tags ?? []).map((tag) => tag.name));
}

function NewBranchDialog({ target, context, failure, ...rest }: DialogPropsWithTarget) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [track, setTrack] = useState(true);
  const taken = useMemo(() => branchNames(context), [context]);
  const warning = useNameWarning(name, 'branch', taken, failure);
  const trimmed = name.trim();

  return (
    <DialogShell
      {...rest}
      title="Create Branch"
      subtitle={
        checkout ? 'Create a branch and check it out' : 'Create a branch without changing the working tree'
      }
      icon={<BranchIcon size={26} />}
      platform={rest.platform}
      warning={warning}
      submitLabel={checkout ? 'Create and Checkout' : 'Create Branch'}
      submitDisabled={
        trimmed.length === 0 || taken.has(trimmed) || referenceNameProblem(trimmed, 'branch') !== null
      }
      onClose={rest.onClose}
      onSubmit={() =>
        rest.onSubmit({
          kind: 'create-branch',
          name: trimmed,
          startPoint: target.startPoint,
          checkout,
          tracking: target.trackable ? (track ? 'track' : 'no-track') : 'auto',
        })
      }
    >
      <TargetRow label="Create at:" target={target} />
      <NameField label="Branch Name:" value={name} placeholder="Enter branch name" onChange={setName} />
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={checkout}
            data-testid="reference-checkout"
            onChange={(event) => setCheckout(event.target.checked)}
          />
          <span>Check out after creating</span>
        </label>
        {target.trackable && (
          <label className="reference-checkbox">
            <input
              type="checkbox"
              checked={track}
              data-testid="reference-track"
              onChange={(event) => setTrack(event.target.checked)}
            />
            <span>{`Track '${target.trackable}'`}</span>
          </label>
        )}
      </dd>
    </DialogShell>
  );
}

function NewTagDialog({ target, context, failure, ...rest }: DialogPropsWithTarget) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const taken = useMemo(() => tagNames(context), [context]);
  const warning = useNameWarning(name, 'tag', taken, failure);
  const trimmed = name.trim();
  const messageId = useId();

  return (
    <DialogShell
      {...rest}
      title="Create Tag"
      subtitle={
        message.trim()
          ? 'Create an annotated tag at the selected point'
          : 'Create a tag at the selected point'
      }
      icon={<TagIcon size={26} />}
      platform={rest.platform}
      warning={warning}
      submitLabel="Create Tag"
      submitDisabled={
        trimmed.length === 0 || taken.has(trimmed) || referenceNameProblem(trimmed, 'tag') !== null
      }
      onClose={rest.onClose}
      onSubmit={() =>
        rest.onSubmit({
          kind: 'create-tag',
          name: trimmed,
          startPoint: target.startPoint,
          message,
        })
      }
    >
      <TargetRow label="Create tag at:" target={target} />
      <NameField label="Tag Name:" value={name} placeholder="Enter tag name" onChange={setName} />
      <dt className="reference-label-top">
        <label htmlFor={messageId}>Message:</label>
      </dt>
      <dd>
        <textarea
          id={messageId}
          className="reference-input reference-message"
          value={message}
          placeholder="Enter tag message (optional)"
          spellCheck={false}
          rows={4}
          data-testid="reference-message"
          onChange={(event) => setMessage(event.target.value)}
        />
      </dd>
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox" title="Pushing a tag is not available yet (planned for P05).">
          <input type="checkbox" checked={false} disabled readOnly />
          <span className="muted">Push (not available yet)</span>
        </label>
      </dd>
    </DialogShell>
  );
}

function CheckoutRemoteDialog({ target, context, failure, ...rest }: DialogPropsWithTarget) {
  const remotes = context?.remotes ?? [];
  const [name, setName] = useState(() => localBranchNameFor(target.label, remotes));
  const taken = useMemo(() => branchNames(context), [context]);
  const warning = useNameWarning(name, 'branch', taken, failure);
  const trimmed = name.trim();

  return (
    <DialogShell
      {...rest}
      title="Checkout Remote Branch"
      subtitle={`Create a local branch that tracks '${target.label}'`}
      icon={<RemoteIcon size={26} />}
      platform={rest.platform}
      warning={warning}
      submitLabel="Checkout"
      submitDisabled={
        trimmed.length === 0 || taken.has(trimmed) || referenceNameProblem(trimmed, 'branch') !== null
      }
      onClose={rest.onClose}
      onSubmit={() =>
        rest.onSubmit({
          kind: 'checkout-remote-branch',
          fullName: target.startPoint.kind === 'reference' ? target.startPoint.fullName : '',
          name: trimmed,
        })
      }
    >
      <TargetRow label="Remote branch:" target={target} />
      <NameField label="Local Name:" value={name} placeholder="Enter branch name" onChange={setName} />
    </DialogShell>
  );
}

function RenameBranchDialog({ branch, context, failure, ...rest }: DialogPropsWithBranch) {
  const [name, setName] = useState(branch.name);
  const taken = useMemo(() => {
    const names = new Set(branchNames(context));
    names.delete(branch.name);
    return names;
  }, [branch.name, context]);
  const warning = useNameWarning(name, 'branch', taken, failure);
  const trimmed = name.trim();

  return (
    <DialogShell
      {...rest}
      title="Rename Branch"
      subtitle="Give the branch a different name"
      icon={<BranchIcon size={26} />}
      platform={rest.platform}
      warning={warning}
      submitLabel="Rename"
      submitDisabled={
        trimmed.length === 0 ||
        trimmed === branch.name ||
        taken.has(trimmed) ||
        referenceNameProblem(trimmed, 'branch') !== null
      }
      onClose={rest.onClose}
      onSubmit={() => rest.onSubmit({ kind: 'rename-branch', fullName: branch.fullName, name: trimmed })}
    >
      <TargetRow
        label="Branch:"
        target={{
          startPoint: { kind: 'commit', commitId: branch.target },
          icon: 'branch',
          label: branch.name,
        }}
      />
      <NameField label="New Name:" value={name} placeholder="Enter branch name" onChange={setName} />
    </DialogShell>
  );
}

function UpstreamDialog({ branch, context, failure, ...rest }: DialogPropsWithBranch) {
  const choices = context?.remoteBranches ?? [];
  const [upstream, setUpstream] = useState(branch.upstream ?? '');
  const fieldId = useId();

  return (
    <DialogShell
      {...rest}
      title="Branch Tracking"
      subtitle={`Choose the branch '${branch.name}' compares itself with`}
      icon={<RemoteIcon size={26} />}
      platform={rest.platform}
      warning={
        failure?.message ??
        (choices.length === 0 ? 'This repository has no remote-tracking branches yet.' : null)
      }
      submitLabel="Set Upstream"
      submitDisabled={upstream === (branch.upstream ?? '')}
      onClose={rest.onClose}
      onSubmit={() =>
        rest.onSubmit({
          kind: 'set-upstream',
          fullName: branch.fullName,
          upstream: upstream === '' ? null : upstream,
        })
      }
    >
      <TargetRow
        label="Branch:"
        target={{
          startPoint: { kind: 'commit', commitId: branch.target },
          icon: 'branch',
          label: branch.name,
        }}
      />
      <dt>
        <label htmlFor={fieldId}>Upstream:</label>
      </dt>
      <dd>
        <select
          id={fieldId}
          className="reference-input"
          value={upstream}
          data-testid="reference-upstream"
          onChange={(event) => setUpstream(event.target.value)}
        >
          <option value="">No upstream branch</option>
          {branch.upstream && !choices.includes(branch.upstream) && (
            <option value={branch.upstream}>{`${branch.upstream} (missing)`}</option>
          )}
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </dd>
    </DialogShell>
  );
}

function DeleteBranchDialog({ branch, failure, ...rest }: DialogPropsWithBranch) {
  const [force, setForce] = useState(false);
  const unmerged = !branch.merged;

  return (
    <DialogShell
      {...rest}
      title="Delete Branch"
      subtitle={`Remove the branch '${branch.name}' from this repository`}
      icon={<BranchIcon size={26} />}
      platform={rest.platform}
      warning={
        failure?.message ??
        (unmerged
          ? `'${branch.name}' is not fully merged. Deleting it drops the commits only it points to.`
          : null)
      }
      submitLabel="Delete Branch"
      submitDisabled={unmerged && !force}
      danger
      onClose={rest.onClose}
      onSubmit={() => rest.onSubmit({ kind: 'delete-branch', fullName: branch.fullName, force })}
    >
      <TargetRow
        label="Branch:"
        target={{
          startPoint: { kind: 'commit', commitId: branch.target },
          icon: 'branch',
          label: branch.name,
          detail: branch.target.slice(0, 7),
        }}
      />
      {branch.upstream && (
        <>
          <dt>Upstream:</dt>
          <dd className="muted">
            {branch.upstreamGone ? `${branch.upstream} (gone)` : branch.upstream}
            {' — the remote branch itself is not deleted.'}
          </dd>
        </>
      )}
      {(unmerged || failure?.canForce) && (
        <>
          <dt />
          <dd className="reference-dialog-options">
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={force}
                data-testid="reference-force"
                onChange={(event) => setForce(event.target.checked)}
              />
              <span>Delete even though it is not merged</span>
            </label>
          </dd>
        </>
      )}
    </DialogShell>
  );
}

function DeleteTagDialog({ tag, failure, ...rest }: ReferenceDialogProps & { readonly tag: RepositoryTag }) {
  return (
    <DialogShell
      {...rest}
      title="Delete Tag"
      subtitle={`Remove the tag '${tag.name}' from this repository`}
      icon={<TagIcon size={26} />}
      platform={rest.platform}
      warning={failure?.message ?? 'A tag already pushed to a remote is not removed there.'}
      submitLabel="Delete Tag"
      submitDisabled={false}
      danger
      onClose={rest.onClose}
      onSubmit={() => rest.onSubmit({ kind: 'delete-tag', fullName: tag.fullName })}
    >
      <TargetRow
        label="Tag:"
        target={{
          startPoint: { kind: 'commit', commitId: tag.target },
          icon: 'tag',
          label: tag.name,
          detail: tag.annotated ? 'annotated' : 'lightweight',
        }}
      />
    </DialogShell>
  );
}

function CheckoutDetachedDialog({ target, failure, ...rest }: DialogPropsWithTarget) {
  const commitId = target.startPoint.kind === 'commit' ? target.startPoint.commitId : '';

  return (
    <DialogShell
      {...rest}
      title="Checkout Revision"
      subtitle="Check out this revision without a branch"
      icon={<CommitIcon size={26} />}
      platform={rest.platform}
      warning={
        failure?.message ??
        'HEAD will be detached. Commits made here belong to no branch until you create one.'
      }
      submitLabel="Checkout"
      submitDisabled={commitId.length === 0}
      onClose={rest.onClose}
      onSubmit={() => rest.onSubmit({ kind: 'checkout-commit', commitId })}
    >
      <TargetRow label="Checkout:" target={target} />
    </DialogShell>
  );
}
