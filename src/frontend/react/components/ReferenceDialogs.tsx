import { useId, useMemo, useState } from 'react';
import { SignatureCheck, SigningControls } from './SigningControls';
import type { RepositorySigningMode } from '../../../common/ipc/contracts';
import type { ReactNode } from 'react';
import type {
  RepositoryBranch,
  RepositoryReferenceAction,
  RepositoryReferenceContext,
  RepositoryReferenceStartPoint,
  RepositoryTag,
  RepositoryLocalChangesPolicy,
  RepositoryLocalChangesPreview,
} from '../../../common/ipc/contracts';
import { localBranchNameFor, referenceNameProblem } from '../lib/references';
import type { Platform } from '../lib/platform';
import { BranchIcon, CommitIcon, RemoteIcon, TagIcon } from './Icons';
import { DialogShell } from './DialogShell';
import { LocalChangesOptions } from './LocalChangesOptions';

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
  | { readonly kind: 'delete-references'; readonly referenceType: 'branch' | 'tag'; readonly stale?: boolean }
  | { readonly kind: 'checkout-branch'; readonly branch: RepositoryBranch }
  | { readonly kind: 'new-branch'; readonly target: ReferenceTarget }
  | { readonly kind: 'new-tag'; readonly target: ReferenceTarget }
  | { readonly kind: 'rename-branch'; readonly branch: RepositoryBranch }
  | { readonly kind: 'delete-branch'; readonly branch: RepositoryBranch }
  | { readonly kind: 'delete-tag'; readonly tag: RepositoryTag }
  | { readonly kind: 'tag-details'; readonly tag: RepositoryTag }
  | { readonly kind: 'push-tag'; readonly tag: RepositoryTag }
  | { readonly kind: 'set-upstream'; readonly branch: RepositoryBranch }
  | { readonly kind: 'checkout-remote-branch'; readonly target: ReferenceTarget }
  | { readonly kind: 'checkout-detached'; readonly target: ReferenceTarget };

interface ReferenceDialogProps {
  readonly preview?: RepositoryLocalChangesPreview | undefined;
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

export function ReferenceDialog(props: ReferenceDialogProps) {
  switch (props.request.kind) {
    case 'delete-references':
      return (
        <DeleteReferencesDialog
          {...props}
          referenceType={props.request.referenceType}
          stale={props.request.stale ?? false}
        />
      );
    case 'checkout-branch':
      return <CheckoutBranchDialog {...props} branch={props.request.branch} />;
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
    case 'tag-details':
      return (
        <TagDetailsDialog
          tag={props.request.tag}
          repositoryId={props.context?.repositoryId}
          onClose={props.onClose}
        />
      );
    case 'push-tag':
      return <PushTagDialog {...props} tag={props.request.tag} />;
    case 'checkout-detached':
      return <CheckoutDetachedDialog {...props} target={props.request.target} />;
  }
}

type DialogPropsWithTarget = ReferenceDialogProps & { readonly target: ReferenceTarget };
type DialogPropsWithBranch = ReferenceDialogProps & { readonly branch: RepositoryBranch };

function CheckoutBranchDialog({ branch, preview, failure, onSubmit, ...rest }: DialogPropsWithBranch) {
  const [policy, setPolicy] = useState<RepositoryLocalChangesPolicy>('keep');
  return (
    <DialogShell
      {...rest}
      title="Checkout Branch"
      className="p05-dialog p05-checkout"
      subtitle="Switch to another branch"
      icon={<BranchIcon size={26} />}
      warning={failure?.message ?? null}
      submitLabel="Checkout"
      submitDisabled={!preview && policy !== 'keep'}
      danger={policy === 'discard'}
      onSubmit={() =>
        onSubmit({
          kind: 'checkout-branch',
          fullName: branch.fullName,
          localChanges: policy,
          changesSnapshot: preview?.snapshot,
        })
      }
    >
      <dt>Switch to:</dt>
      <dd className="reference-target">
        <BranchIcon size={13} />
        {branch.name}
      </dd>
      <LocalChangesOptions value={policy} preview={preview} onChange={setPolicy} />
    </DialogShell>
  );
}

function NameField({
  label,
  value,
  placeholder,
  onChange,
  selectOnFocus = false,
  suggestions = [],
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly selectOnFocus?: boolean;
  readonly suggestions?: readonly string[];
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
          data-dialog-autofocus
          data-select-on-open={selectOnFocus}
          onFocus={selectOnFocus ? (event) => event.target.select() : undefined}
          data-testid="reference-name"
          list={suggestions.length ? `${fieldId}-folders` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {suggestions.length > 0 && (
          <datalist id={`${fieldId}-folders`}>
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
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

function NewBranchDialog({ target, context, failure, preview, ...rest }: DialogPropsWithTarget) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [policy, setPolicy] = useState<RepositoryLocalChangesPolicy>('keep');
  const [track, setTrack] = useState(true);
  const taken = useMemo(() => branchNames(context), [context]);
  const warning = useNameWarning(name, 'branch', taken, failure);
  const trimmed = name.trim();

  return (
    <DialogShell
      {...rest}
      title="Create Branch"
      className="p05-dialog p05-create-branch"
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
          localChanges: checkout ? policy : 'keep',
          changesSnapshot: preview?.snapshot,
          tracking: target.trackable ? (track ? 'track' : 'no-track') : 'auto',
        })
      }
    >
      <TargetRow label="Create at:" target={target} />
      {checkout && <LocalChangesOptions value={policy} preview={preview} onChange={setPolicy} />}
      <NameField
        label="Branch Name:"
        value={name}
        placeholder="Enter branch name"
        onChange={setName}
        suggestions={[
          ...new Set(
            context?.branches.flatMap((branch) =>
              branch.name
                .split('/')
                .slice(0, -1)
                .map(
                  (_part, index) =>
                    branch.name
                      .split('/')
                      .slice(0, index + 1)
                      .join('/') + '/',
                ),
            ) ?? [],
          ),
        ]}
      />
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
  const [signing, setSigning] = useState<RepositorySigningMode>('inherit');
  const [push, setPush] = useState(false);
  const [remote, setRemote] = useState(context?.remotes[0] ?? '');
  const taken = useMemo(() => tagNames(context), [context]);
  const warning = useNameWarning(name, 'tag', taken, failure);
  const trimmed = name.trim();
  const messageId = useId();

  return (
    <DialogShell
      {...rest}
      title="Create Tag"
      className="p05-dialog p05-create-tag"
      subtitle="Create annotated tag at the selected point"
      icon={<TagIcon size={26} />}
      platform={rest.platform}
      warning={warning}
      submitLabel={push ? 'Create and Push' : 'Create'}
      submitDisabled={
        trimmed.length === 0 ||
        taken.has(trimmed) ||
        referenceNameProblem(trimmed, 'tag') !== null ||
        (push && !remote)
      }
      onClose={rest.onClose}
      onSubmit={() =>
        rest.onSubmit({
          kind: 'create-tag',
          signing,
          name: trimmed,
          startPoint: target.startPoint,
          message,
          ...(push ? { pushRemote: remote } : {}),
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
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={push}
            disabled={!context?.remotes.length}
            onChange={(event) => setPush(event.target.checked)}
          />
          <span>Push</span>
        </label>
        {push && (
          <select
            aria-label="Push tag to remote"
            className="reference-input"
            value={remote}
            onChange={(event) => setRemote(event.target.value)}
          >
            {context?.remotes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {context && (
          <details className="p05-options">
            <summary>Signing</summary>
            <SigningControls
              repositoryId={context.repositoryId}
              value={signing}
              onChange={setSigning}
              disabled={rest.busy}
            />
          </details>
        )}
      </dd>
    </DialogShell>
  );
}

function CheckoutRemoteDialog({ target, context, failure, preview, ...rest }: DialogPropsWithTarget) {
  const [policy, setPolicy] = useState<RepositoryLocalChangesPolicy>('keep');
  const remotes = context?.remotes ?? [];
  const [name, setName] = useState(() => localBranchNameFor(target.label, remotes));
  const taken = useMemo(() => branchNames(context), [context]);
  const warning = useNameWarning(name, 'branch', taken, failure);
  const trimmed = name.trim();

  return (
    <DialogShell
      {...rest}
      title="Checkout Remote Branch"
      className="p05-dialog p05-checkout"
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
          localChanges: policy,
          changesSnapshot: preview?.snapshot,
          fullName: target.startPoint.kind === 'reference' ? target.startPoint.fullName : '',
          name: trimmed,
        })
      }
    >
      <TargetRow label="Remote branch:" target={target} />
      <LocalChangesOptions value={policy} preview={preview} onChange={setPolicy} />
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
      title="Rename Local Branch"
      className="p05-dialog p05-rename-branch"
      subtitle="Rename local branch"
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
      <NameField
        label="New Name:"
        value={name}
        placeholder="Enter branch name"
        onChange={setName}
        selectOnFocus
      />
    </DialogShell>
  );
}

function UpstreamDialog({ branch, context, failure, ...rest }: DialogPropsWithBranch) {
  const choices = [
    ...(context?.remoteBranches ?? []).map((name) => ({ value: `refs/remotes/${name}`, label: name })),
    ...(context?.branches ?? [])
      .filter((candidate) => candidate.fullName !== branch.fullName)
      .map((candidate) => ({ value: candidate.fullName, label: `${candidate.name} (local)` })),
  ];
  const initial = branch.upstreamFullName ?? branch.upstream ?? '';
  const [upstream, setUpstream] = useState(initial);
  const fieldId = useId();

  return (
    <DialogShell
      {...rest}
      title="Branch Tracking"
      className="p05-dialog p05-tracking"
      subtitle={`Choose the branch '${branch.name}' compares itself with`}
      icon={<RemoteIcon size={26} />}
      platform={rest.platform}
      warning={
        failure?.message ??
        (choices.length === 0 ? 'This repository has no other branches to track yet.' : null)
      }
      submitLabel="Set Upstream"
      submitDisabled={upstream === initial}
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
          {initial && !choices.some((choice) => choice.value === initial) && (
            <option value={initial}>{`${branch.upstream} (missing)`}</option>
          )}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </dd>
    </DialogShell>
  );
}

function DeleteBranchDialog({ branch, failure, context, ...rest }: DialogPropsWithBranch) {
  const [force, setForce] = useState(false);
  const [deleteUpstream, setDeleteUpstream] = useState(false);
  const canDeleteUpstream = Boolean(
    branch.upstreamRemote &&
    branch.upstreamBranch &&
    !branch.upstreamGone &&
    context?.remotes.includes(branch.upstreamRemote),
  );
  const unmerged = !branch.merged;

  return (
    <DialogShell
      {...rest}
      title="Delete Branch"
      className="p05-dialog p05-delete-branch"
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
      onSubmit={() =>
        rest.onSubmit({ kind: 'delete-branch', fullName: branch.fullName, force, deleteUpstream })
      }
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
      <dt />
      <dd>
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={deleteUpstream}
            disabled={!canDeleteUpstream}
            onChange={(event) => setDeleteUpstream(event.target.checked)}
          />
          Also delete corresponding remote branch
        </label>
        {deleteUpstream && (
          <p className="dialog-inline-note">
            Delete {branch.upstreamRemote}/{branch.upstreamBranch} for everyone using that remote.
          </p>
        )}
      </dd>
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

function DeleteReferencesDialog({
  context,
  referenceType,
  stale,
  failure,
  onSubmit,
  ...rest
}: ReferenceDialogProps & { readonly referenceType: 'branch' | 'tag'; readonly stale: boolean }) {
  const candidates = referenceType === 'branch' ? (context?.branches ?? []) : (context?.tags ?? []);
  const unavailable = (candidate: RepositoryBranch | RepositoryTag) =>
    'isHead' in candidate && (candidate.isHead || Boolean(candidate.worktreePath));
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        stale
          ? candidates
              .filter(
                (candidate) =>
                  'upstreamGone' in candidate && candidate.upstreamGone && !unavailable(candidate),
              )
              .slice(0, 100)
              .map((candidate) => candidate.fullName)
          : [],
      ),
  );
  const [force, setForce] = useState(false);
  const unmerged = candidates.some(
    (candidate) => selected.has(candidate.fullName) && 'merged' in candidate && !candidate.merged,
  );
  return (
    <DialogShell
      {...rest}
      title={referenceType === 'branch' ? 'Delete Branches' : 'Delete Tags'}
      className="p05-dialog p05-expanded"
      subtitle="Select local references to remove"
      icon={referenceType === 'branch' ? <BranchIcon size={26} /> : <TagIcon size={26} />}
      warning={
        failure?.message ??
        (unmerged ? 'Selected branches contain commits not merged into the current branch.' : null)
      }
      danger
      submitLabel={`Delete ${selected.size || ''} ${referenceType === 'branch' ? 'Branches' : 'Tags'}`.replace(
        '  ',
        ' ',
      )}
      submitDisabled={!selected.size || (unmerged && !force)}
      onSubmit={() => onSubmit({ kind: 'delete-references', fullNames: [...selected], force })}
    >
      <dt>Delete:</dt>
      <dd>
        <div className="reference-batch-list" role="group" aria-label="References to delete">
          {candidates.map((candidate) => (
            <label className="reference-checkbox" key={candidate.fullName}>
              <input
                type="checkbox"
                checked={selected.has(candidate.fullName)}
                disabled={
                  unavailable(candidate) || (!selected.has(candidate.fullName) && selected.size >= 100)
                }
                onChange={(event) =>
                  setSelected((values) => {
                    const next = new Set(values);
                    if (event.target.checked) next.add(candidate.fullName);
                    else next.delete(candidate.fullName);
                    return next;
                  })
                }
              />
              {candidate.name}
              <span className="muted">
                {'isHead' in candidate
                  ? candidate.isHead
                    ? 'current'
                    : candidate.worktreePath
                      ? 'in worktree'
                      : candidate.upstreamGone
                        ? 'upstream gone'
                        : ''
                  : ''}
              </span>
            </label>
          ))}
        </div>
      </dd>
      <dt />
      <dd className="reference-dialog-options">
        <span className="muted">Remote references are retained. Up to 100 references per operation.</span>
        {unmerged && (
          <label className="reference-checkbox">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Delete unmerged branches
          </label>
        )}
      </dd>
    </DialogShell>
  );
}

function DeleteTagDialog({
  tag,
  failure,
  context,
  ...rest
}: ReferenceDialogProps & { readonly tag: RepositoryTag }) {
  const [deleteRemotes, setDeleteRemotes] = useState(false);
  const [remoteNames, setRemoteNames] = useState<string[]>(context?.remotes ?? []);
  return (
    <DialogShell
      {...rest}
      title="Delete Tag"
      className="p05-dialog p05-delete-tag"
      subtitle={`Remove the tag '${tag.name}' from this repository`}
      icon={<TagIcon size={26} />}
      platform={rest.platform}
      warning={failure?.message ?? null}
      submitLabel="Delete Tag"
      submitDisabled={deleteRemotes && remoteNames.length === 0}
      danger
      onClose={rest.onClose}
      onSubmit={() =>
        rest.onSubmit({
          kind: 'delete-tag',
          fullName: tag.fullName,
          remoteNames: deleteRemotes ? remoteNames : [],
        })
      }
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
      <dt />
      <dd>
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={deleteRemotes}
            disabled={!context?.remotes.length}
            onChange={(event) => setDeleteRemotes(event.target.checked)}
          />
          Delete tag from remote repositories
        </label>
        {deleteRemotes &&
          context?.remotes.map((name) => (
            <label className="reference-checkbox" key={name}>
              <input
                type="checkbox"
                checked={remoteNames.includes(name)}
                onChange={(event) =>
                  setRemoteNames((current) =>
                    event.target.checked ? [...current, name] : current.filter((item) => item !== name),
                  )
                }
              />
              {name}
            </label>
          ))}
      </dd>
    </DialogShell>
  );
}

function TagDetailsDialog({
  tag,
  repositoryId,
  onClose,
}: {
  readonly tag: RepositoryTag;
  readonly repositoryId: string | undefined;
  readonly onClose: () => void;
}) {
  return (
    <dialog
      className="dialog reference-dialog p05-dialog p05-tag-details"
      aria-label="Tag Details"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onClose={onClose}
    >
      <div className="dialog-content">
        <div className="reference-dialog-header">
          <span className="reference-dialog-mark">
            <TagIcon size={26} />
          </span>
          <h2>Tag Details</h2>
        </div>
        <dl className="reference-dialog-fields">
          <dt>Tag:</dt>
          <dd className="reference-target">
            <TagIcon size={13} />
            {tag.name} <span className="muted">{tag.annotated ? 'Annotated tag' : 'Lightweight tag'}</span>
          </dd>
          <dt className="reference-label-top">Message:</dt>
          <dd>
            <textarea
              aria-label="Tag message"
              className="reference-input reference-message"
              readOnly
              rows={7}
              value={
                tag.annotated
                  ? [tag.tagger, tag.taggedAt, '', tag.message]
                      .filter((line) => line !== null && line !== undefined)
                      .join('\n')
                  : 'This lightweight tag has no tagger or annotation.'
              }
            />
            {repositoryId && tag.annotated && tag.objectId ? (
              <SignatureCheck
                key={tag.objectId}
                repositoryId={repositoryId}
                objectId={tag.objectId}
                kind="tag"
              />
            ) : !tag.annotated ? (
              <p>Unsigned lightweight tag</p>
            ) : null}
          </dd>
        </dl>
        <div className="dialog-actions">
          <button type="button" className="button primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

function PushTagDialog({
  tag,
  context,
  failure,
  ...rest
}: ReferenceDialogProps & { readonly tag: RepositoryTag }) {
  const [remote, setRemote] = useState(context?.remotes[0] ?? '');
  return (
    <DialogShell
      {...rest}
      title="Push Tag"
      className="p05-dialog p05-push-tag"
      subtitle={`Push '${tag.name}' to a remote repository`}
      icon={<TagIcon size={26} />}
      warning={failure?.message ?? null}
      submitLabel="Push"
      submitDisabled={!remote}
      onSubmit={() => rest.onSubmit({ kind: 'push-tag', fullName: tag.fullName, remote })}
    >
      <dt>Remote:</dt>
      <dd>
        <select
          aria-label="Push tag to remote"
          className="reference-input"
          value={remote}
          onChange={(event) => setRemote(event.target.value)}
        >
          {context?.remotes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </dd>
    </DialogShell>
  );
}

function CheckoutDetachedDialog({ target, failure, preview, ...rest }: DialogPropsWithTarget) {
  const [policy, setPolicy] = useState<RepositoryLocalChangesPolicy>('keep');
  const commitId = target.startPoint.kind === 'commit' ? target.startPoint.commitId : '';

  return (
    <DialogShell
      {...rest}
      title="Checkout Revision"
      className="p05-dialog p05-checkout-commit"
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
      onSubmit={() =>
        rest.onSubmit({
          kind: 'checkout-commit',
          commitId,
          localChanges: policy,
          changesSnapshot: preview?.snapshot,
        })
      }
    >
      <TargetRow label="Checkout:" target={target} />
      <LocalChangesOptions value={policy} preview={preview} onChange={setPolicy} />
    </DialogShell>
  );
}
