import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  RepositoryBranch,
  RepositoryNetworkRequest,
  RepositoryRemote,
  RepositoryRemoteAction,
  RepositoryLocalChangesPreview,
  RepositoryOperation,
  RepositoryPushPreview,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { referenceNameProblem } from '../lib/references';
import type { Platform } from '../lib/platform';
import { DialogShell } from './DialogShell';
import { TestConnection } from './TestConnection';
import { BranchIcon, FetchIcon, PullIcon, PushIcon, RemoteIcon } from './Icons';

export type NetworkDialogRequest =
  | { readonly kind: 'pull'; readonly branch: RepositoryBranch }
  | { readonly kind: 'fetch' }
  | { readonly kind: 'push'; readonly branch: RepositoryBranch | undefined; readonly force?: boolean }
  | { readonly kind: 'remotes' }
  | { readonly kind: 'edit-remote'; readonly remote: RepositoryRemote }
  | { readonly kind: 'delete-remote'; readonly remote: RepositoryRemote }
  | {
      readonly kind: 'delete-remote-branch';
      readonly remote: string;
      readonly remoteBranch: string;
    };

interface NetworkDialogProps {
  readonly repositoryId?: string | undefined;
  readonly operations?: readonly RepositoryOperation[] | undefined;
  readonly referenceSnapshot?: string | undefined;
  readonly preview?: RepositoryLocalChangesPreview | undefined;
  readonly remoteBranches?: readonly string[] | undefined;
  readonly request: NetworkDialogRequest;
  readonly remotes: readonly RepositoryRemote[];
  readonly branches: readonly RepositoryBranch[];
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onStart: (request: RepositoryNetworkRequest) => void;
  readonly onRemoteAction: (action: RepositoryRemoteAction) => void;
  readonly onOpen: (request: NetworkDialogRequest) => void;
  readonly onClose: () => void;
}

export function NetworkDialog(props: NetworkDialogProps) {
  switch (props.request.kind) {
    case 'pull':
      return <PullDialog {...props} branch={props.request.branch} />;
    case 'fetch':
      return <FetchDialog {...props} />;
    case 'push':
      return <PushDialog {...props} branch={props.request.branch} force={props.request.force ?? false} />;
    case 'remotes':
      return <RemotesDialog {...props} />;
    case 'edit-remote':
      return <EditRemoteDialog {...props} remote={props.request.remote} />;
    case 'delete-remote':
      return <DeleteRemoteDialog {...props} remote={props.request.remote} />;
    case 'delete-remote-branch':
      return (
        <DeleteRemoteBranchDialog
          {...props}
          remote={props.request.remote}
          remoteBranch={props.request.remoteBranch}
        />
      );
  }
}

function PullDialog({
  branch,
  remotes,
  remoteBranches = [],
  preview,
  referenceSnapshot,
  failure,
  onStart,
  ...rest
}: NetworkDialogProps & { readonly branch: RepositoryBranch }) {
  const [remote, setRemote] = useState(
    branch.upstreamRemote && remotes.some((item) => item.name === branch.upstreamRemote)
      ? branch.upstreamRemote
      : (remotes[0]?.name ?? ''),
  );
  const [source, setSource] = useState(branch.upstreamBranch ?? branch.name);
  const [rebase, setRebase] = useState(false);
  const [ffOnly, setFfOnly] = useState(false);
  const [autostash, setAutostash] = useState(false);
  const listId = useId();
  return (
    <DialogShell
      {...rest}
      title="Pull"
      className="p05-dialog p05-pull"
      subtitle={
        branch.isHead
          ? 'Pull remote changes into your local branch'
          : `Check out '${branch.name}', then pull remote changes into it`
      }
      icon={<PullIcon size={26} />}
      warning={failure ?? null}
      submitLabel="Pull"
      submitDisabled={!remote || !source.trim() || (autostash && !preview)}
      onSubmit={() =>
        onStart({
          kind: 'pull',
          remote,
          branch: source.trim(),
          into: branch.fullName,
          expectedHead: branch.target,
          snapshot: referenceSnapshot,
          ...(ffOnly ? {} : { rebase }),
          autostash,
          changesSnapshot: preview?.snapshot,
          prune: true,
        })
      }
    >
      <RemoteSelect remotes={remotes} value={remote} onChange={setRemote} />
      <dt>
        <label htmlFor={`${listId}-branch`}>Branch:</label>
      </dt>
      <dd>
        <input
          id={`${listId}-branch`}
          className="reference-input"
          value={source}
          list={listId}
          onChange={(event) => setSource(event.target.value)}
          data-testid="pull-branch"
        />
        <datalist id={listId}>
          {remoteBranches
            .filter((name) => name.startsWith(`${remote}/`))
            .map((name) => (
              <option key={name} value={name.slice(remote.length + 1)} />
            ))}
        </datalist>
      </dd>
      <dt>Into:</dt>
      <dd className="reference-target" data-testid="pull-into">
        <BranchIcon size={13} />
        {branch.name}
      </dd>
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={rebase}
            disabled={ffOnly}
            onChange={(event) => setRebase(event.target.checked)}
          />
          Rebase instead of merge
        </label>
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={autostash}
            disabled={!preview}
            onChange={(event) => setAutostash(event.target.checked)}
          />
          Stash and reapply local changes
        </label>
        <details className="p05-options">
          <summary>Options</summary>
          <label className="reference-checkbox">
            <input type="checkbox" checked={ffOnly} onChange={(event) => setFfOnly(event.target.checked)} />
            Fast-forward only
          </label>
        </details>
      </dd>
    </DialogShell>
  );
}

function RemoteSelect({
  remotes,
  value,
  disabled,
  onChange,
}: {
  readonly remotes: readonly RepositoryRemote[];
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const fieldId = useId();
  return (
    <>
      <dt>
        <label htmlFor={fieldId}>Remote:</label>
      </dt>
      <dd>
        <select
          id={fieldId}
          className="reference-input"
          value={value}
          disabled={disabled}
          data-testid="network-remote"
          onChange={(event) => onChange(event.target.value)}
        >
          {remotes.map((remote) => (
            <option key={remote.name} value={remote.name}>
              {remote.name}
            </option>
          ))}
        </select>
      </dd>
    </>
  );
}

function FetchDialog({ remotes, failure, onStart, ...rest }: NetworkDialogProps) {
  const [remote, setRemote] = useState(remotes[0]?.name ?? '');
  const [all, setAll] = useState(false);
  const [prune, setPrune] = useState(true);
  const [tags, setTags] = useState(true);

  return (
    <DialogShell
      {...rest}
      title="Fetch"
      className="p05-dialog p05-fetch"
      subtitle="Fetch the latest changes from a remote repository"
      icon={<FetchIcon size={26} />}
      warning={failure ?? (remotes.length === 0 ? 'This repository has no remotes yet.' : null)}
      submitLabel="Fetch"
      submitDisabled={remotes.length === 0 || (!all && remote.length === 0)}
      onSubmit={() => onStart({ kind: 'fetch', remote: all ? null : remote, prune, tags })}
    >
      <RemoteSelect remotes={remotes} value={remote} disabled={all} onChange={setRemote} />
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={all}
            data-testid="fetch-all"
            onChange={(event) => setAll(event.target.checked)}
          />
          <span>Fetch all remotes</span>
        </label>
        <details className="p05-options">
          <summary>Options</summary>
          <label className="reference-checkbox">
            <input type="checkbox" checked={prune} onChange={(event) => setPrune(event.target.checked)} />
            <span>Remove remote branches that no longer exist</span>
          </label>
          <label className="reference-checkbox">
            <input type="checkbox" checked={tags} onChange={(event) => setTags(event.target.checked)} />
            <span>Fetch tags</span>
          </label>
        </details>
      </dd>
    </DialogShell>
  );
}

function PushDialog({
  remotes,
  branches,
  branch,
  force,
  failure,
  onStart,
  repositoryId,
  remoteBranches = [],
  ...rest
}: NetworkDialogProps & { readonly branch: RepositoryBranch | undefined; readonly force: boolean }) {
  const current = branch ?? branches.find((candidate) => candidate.isHead);
  const defaultRemote = useMemo(() => {
    const matching = remotes.find((remote) => remote.name === current?.upstreamRemote);
    return matching?.name ?? remotes[0]?.name ?? '';
  }, [current?.upstreamRemote, remotes]);
  const [remote, setRemote] = useState(defaultRemote);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(current ? [current.fullName] : []),
  );
  const [withLease, setWithLease] = useState(force);
  const [tags, setTags] = useState(false);
  const [track, setTrack] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [review, setReview] = useState<{ key: string; value: RepositoryPushPreview }>();
  const [reviewError, setReviewError] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [destinations, setDestinations] = useState<Readonly<Record<string, string>>>({});
  const destination = (candidate: RepositoryBranch) =>
    destinations[`${remote}:${candidate.fullName}`] ??
    (candidate.upstreamRemote === remote ? (candidate.upstreamBranch ?? candidate.name) : candidate.name);
  const chosen = branches.filter((candidate) => selected.has(candidate.fullName));
  const missingUpstream = chosen.some((candidate) => candidate.upstream === null);
  const targets = chosen.map((candidate) => ({
    fullName: candidate.fullName,
    remoteBranch: destination(candidate).trim(),
    setUpstream: track && candidate.upstream === null,
  }));
  const reviewKey = JSON.stringify([repositoryId, remote, targets, tags]);
  const reviewed = review?.key === reviewKey ? review.value : undefined;
  const nameProblem = targets
    .map((target) => referenceNameProblem(target.remoteBranch, 'branch'))
    .find(Boolean);
  const duplicate = new Set(targets.map((target) => target.remoteBranch)).size !== targets.length;
  const submit = async () => {
    if (withLease && !reviewed) {
      if (!repositoryId || !window.desktop) return;
      setReviewing(true);
      setReviewError(undefined);
      try {
        const value = unwrapResult(
          await window.desktop.repository.previewPush({ id: repositoryId, remote, targets, tags }),
        );
        if (mounted.current) setReview({ key: reviewKey, value });
      } catch (error) {
        if (mounted.current)
          setReviewError(error instanceof Error ? error.message : 'The push could not be reviewed.');
      } finally {
        if (mounted.current) setReviewing(false);
      }
      return;
    }
    onStart({
      kind: 'push',
      remote,
      targets,
      setUpstream: false,
      force: withLease ? 'with-lease' : 'none',
      tags,
      ...(withLease && reviewed ? { previewToken: reviewed.token } : {}),
    });
    setReview(undefined);
  };

  const toggle = (fullName: string) => {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  };

  return (
    <DialogShell
      {...rest}
      className={`p05-dialog p05-push${multiple || reviewed ? ' p05-expanded' : ''}`}
      busy={rest.busy || reviewing}
      title={chosen.length > 1 ? `Push ${chosen.length} Branches` : 'Push'}
      subtitle={
        withLease
          ? 'Review the exact remote commits before replacing them'
          : 'Push your local changes to a remote repository'
      }
      icon={<PushIcon size={26} />}
      warning={
        failure ??
        reviewError ??
        nameProblem ??
        (duplicate ? 'Choose each destination branch once.' : null) ??
        (withLease
          ? 'A lease-checked push overwrites commits on the remote that are not in this branch.'
          : null)
      }
      submitLabel={withLease ? (reviewed ? 'Force Push with Lease' : 'Review Force Push') : 'Push'}
      submitDisabled={
        chosen.length === 0 ||
        remote.length === 0 ||
        chosen.some((candidate) => !destination(candidate).trim()) ||
        Boolean(nameProblem) ||
        duplicate
      }
      danger={withLease}
      onSubmit={() => void submit()}
    >
      {(remotes.length > 1 || multiple) && (
        <RemoteSelect remotes={remotes} value={remote} onChange={setRemote} />
      )}
      <dt>{multiple ? 'Branches:' : 'Branch:'}</dt>
      <dd>
        {!multiple && (
          <select
            className="reference-input"
            aria-label="Branch to push"
            value={chosen[0]?.fullName ?? ''}
            data-testid="push-branches"
            onChange={(event) => setSelected(new Set([event.target.value]))}
          >
            {!chosen.length && <option value="">Choose a branch</option>}
            {branches.map((candidate) => (
              <option key={candidate.fullName} value={candidate.fullName}>
                {candidate.name}
              </option>
            ))}
          </select>
        )}
        {multiple && (
          <div
            className="push-branches"
            role="group"
            aria-label="Branches to push"
            data-testid="push-branches"
          >
            {branches.map((candidate) => (
              <div key={candidate.fullName} className="reference-checkbox push-branch">
                <input
                  type="checkbox"
                  checked={selected.has(candidate.fullName)}
                  aria-label={`Push ${candidate.name}`}
                  onChange={() => toggle(candidate.fullName)}
                />
                <BranchIcon size={13} />
                <span className="push-branch-name">{candidate.name}</span>
                {selected.has(candidate.fullName) && (
                  <input
                    className="reference-input push-destination"
                    aria-label={`Destination branch for ${candidate.name}`}
                    value={destination(candidate)}
                    onChange={(event) =>
                      setDestinations((current) => ({
                        ...current,
                        [`${remote}:${candidate.fullName}`]: event.target.value,
                      }))
                    }
                  />
                )}
                <span className="push-branch-meta muted">
                  {candidate.upstream === null
                    ? 'new branch'
                    : candidate.upstreamGone
                      ? 'upstream gone'
                      : trackingSummary(candidate)}
                </span>
              </div>
            ))}
          </div>
        )}
      </dd>
      {!multiple && chosen[0] && (
        <>
          <dt>To:</dt>
          <dd>
            <div className="p05-push-destination">
              <span>{remote}/</span>
              <input
                className="reference-input"
                aria-label={`Destination branch for ${chosen[0].name}`}
                list="push-destinations"
                value={destination(chosen[0])}
                onChange={(event) => {
                  const fullName = chosen[0]!.fullName;
                  setDestinations((value) => ({ ...value, [`${remote}:${fullName}`]: event.target.value }));
                }}
              />
            </div>
            <datalist id="push-destinations">
              {remoteBranches
                .filter((name) => name.startsWith(`${remote}/`))
                .map((name) => (
                  <option key={name} value={name.slice(remote.length + 1)} />
                ))}
            </datalist>
          </dd>
        </>
      )}
      <dt />
      <dd className="reference-dialog-options">
        {missingUpstream && (
          <label className="reference-checkbox">
            <input type="checkbox" checked={track} onChange={(event) => setTrack(event.target.checked)} />
            Create tracking reference
          </label>
        )}
        <label className="reference-checkbox">
          <input type="checkbox" checked={tags} onChange={(event) => setTags(event.target.checked)} />
          <span>Push all tags</span>
        </label>
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={withLease}
            data-testid="push-force"
            onChange={(event) => {
              setWithLease(event.target.checked);
              setReview(undefined);
            }}
          />
          <span>Force push (with lease)</span>
        </label>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMultiple(!multiple);
            if (multiple) setSelected(new Set(chosen[0] ? [chosen[0].fullName] : []));
          }}
        >
          {multiple ? 'Push one branch' : 'Choose multiple branches…'}
        </button>
      </dd>
      {withLease && reviewed && (
        <>
          <dt>Review:</dt>
          <dd className="push-review" data-testid="push-review">
            {reviewed.targets.map((target) => (
              <p key={target.remoteBranch}>
                <strong>
                  {reviewed.remote}/{target.remoteBranch}
                </strong>
                <br />
                <code title={target.remoteId ?? ''}>{target.remoteId?.slice(0, 12) ?? 'Must not exist'}</code>
                {' → '}
                <code title={target.localId}>{target.localId.slice(0, 12)}</code>
                <br />
                {target.replacedCommits} remote commits will be replaced.
              </p>
            ))}
            {reviewed.tagCount > 0 && (
              <p>Also push {reviewed.tagCount} tags without overwriting existing tags.</p>
            )}
            <p className="muted">
              Based on the last fetch. If the remote has changed, the push will be refused.
            </p>
          </dd>
        </>
      )}
    </DialogShell>
  );
}

function trackingSummary(branch: RepositoryBranch): string {
  if (branch.ahead === null || branch.behind === null) return branch.upstream ?? '';
  if (branch.ahead === 0 && branch.behind === 0) return 'up to date';
  const parts = [];
  if (branch.ahead > 0) parts.push(`${branch.ahead} ahead`);
  if (branch.behind > 0) parts.push(`${branch.behind} behind`);
  return parts.join(', ');
}

function RemotesDialog({
  remotes,
  failure,
  onRemoteAction,
  onOpen,
  operations = [],
  ...rest
}: NetworkDialogProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const nameId = useId();
  const urlId = useId();
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const taken = remotes.some((remote) => remote.name === trimmedName);

  return (
    <DialogShell
      {...rest}
      title="Remotes"
      className="p05-dialog p05-remotes"
      subtitle="The repositories this one exchanges commits with"
      icon={<RemoteIcon size={26} />}
      warning={failure ?? (taken ? `A remote named '${trimmedName}' already exists` : null)}
      submitLabel="Add Remote"
      submitDisabled={trimmedName.length === 0 || trimmedUrl.length === 0 || taken}
      onSubmit={() => onRemoteAction({ kind: 'add', name: trimmedName, url: trimmedUrl })}
    >
      <dt>Configured:</dt>
      <dd>
        <div className="remote-list" data-testid="remote-list">
          {remotes.length === 0 && <p className="muted">No remotes are configured yet.</p>}
          {remotes.map((remote) => (
            <div key={remote.name} className="remote-row">
              <div className="remote-row-copy">
                <strong>{remote.name}</strong>
                <span className="muted" title={remote.fetchUrl}>
                  {remote.pushUrl ? `${remote.fetchUrl} (push: ${remote.pushUrl})` : remote.fetchUrl}
                </span>
              </div>
              <button
                type="button"
                className="button button-small"
                onClick={() => onOpen({ kind: 'edit-remote', remote })}
              >
                Edit…
              </button>
              <button
                type="button"
                className="button button-small"
                onClick={() => onOpen({ kind: 'delete-remote', remote })}
              >
                Remove…
              </button>
            </div>
          ))}
        </div>
      </dd>
      <dt>
        <label htmlFor={nameId}>New Name:</label>
      </dt>
      <dd>
        <input
          id={nameId}
          type="text"
          className="reference-input"
          value={name}
          placeholder="origin"
          spellCheck={false}
          autoComplete="off"
          data-testid="remote-name"
          onChange={(event) => setName(event.target.value)}
        />
      </dd>
      <dt>
        <label htmlFor={urlId}>URL:</label>
      </dt>
      <dd>
        <input
          id={urlId}
          type="text"
          className="reference-input"
          value={url}
          placeholder="https://example.com/team/repository.git"
          spellCheck={false}
          autoComplete="off"
          data-testid="remote-url"
          onChange={(event) => setUrl(event.target.value)}
        />
        <TestConnection
          key={trimmedUrl}
          request={{ kind: 'url', url: trimmedUrl }}
          operations={operations}
          disabled={!trimmedUrl}
        />
      </dd>
    </DialogShell>
  );
}

function EditRemoteDialog({
  remote,
  failure,
  onRemoteAction,
  repositoryId,
  operations = [],
  ...rest
}: NetworkDialogProps & { readonly remote: RepositoryRemote }) {
  const [name, setName] = useState(remote.name);
  const [url, setUrl] = useState(remote.fetchUrl);
  const [pushUrl, setPushUrl] = useState(remote.pushUrl ?? '');
  const [separatePush, setSeparatePush] = useState(remote.pushUrl !== null);
  const nameId = useId();
  const urlId = useId();
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const renamed = trimmedName !== remote.name;
  const retargeted = trimmedUrl !== remote.fetchUrl;
  const nextPushUrl = separatePush ? pushUrl.trim() : null;
  const pushChanged = nextPushUrl !== remote.pushUrl;

  return (
    <DialogShell
      {...rest}
      title="Edit Remote"
      className="p05-dialog p05-edit-remote"
      subtitle="Edit URL of the remote repository"
      icon={<RemoteIcon size={26} />}
      warning={failure ?? null}
      submitLabel="Edit"
      submitDisabled={
        !remote.snapshot ||
        trimmedName.length === 0 ||
        trimmedUrl.length === 0 ||
        (separatePush && !nextPushUrl) ||
        (!renamed && !retargeted && !pushChanged)
      }
      onSubmit={() =>
        onRemoteAction({
          kind: 'edit',
          name: remote.name,
          newName: trimmedName,
          url: trimmedUrl,
          pushUrl: nextPushUrl,
          snapshot: remote.snapshot!,
        })
      }
    >
      <dt>
        <label htmlFor={nameId}>Remote:</label>
      </dt>
      <dd>
        <input
          id={nameId}
          type="text"
          className="reference-input"
          value={name}
          autoFocus
          data-dialog-autofocus
          data-select-on-open="true"
          onFocus={(event) => event.target.select()}
          spellCheck={false}
          autoComplete="off"
          data-testid="remote-name"
          onChange={(event) => setName(event.target.value)}
        />
      </dd>
      <dt>
        <label htmlFor={urlId}>Repository URL:</label>
      </dt>
      <dd>
        <input
          id={urlId}
          type="text"
          className="reference-input"
          value={url}
          spellCheck={false}
          autoComplete="off"
          data-testid="remote-url"
          onChange={(event) => setUrl(event.target.value)}
        />
        <TestConnection
          key={trimmedUrl}
          request={
            !retargeted && repositoryId
              ? { kind: 'remote', id: repositoryId, name: remote.name }
              : { kind: 'url', url: trimmedUrl }
          }
          operations={operations}
          disabled={!trimmedUrl}
        />
      </dd>
      <dt />
      <dd>
        <details className="p05-options" open={remote.pushUrl !== null || undefined}>
          <summary>Push URL</summary>
          <label className="reference-checkbox">
            <input
              type="checkbox"
              checked={separatePush}
              onChange={(event) => setSeparatePush(event.target.checked)}
            />
            Use a separate URL for push
          </label>
          {separatePush && (
            <input
              className="reference-input"
              aria-label="Push URL"
              value={pushUrl}
              onChange={(event) => setPushUrl(event.target.value)}
            />
          )}
        </details>
      </dd>
    </DialogShell>
  );
}

function DeleteRemoteDialog({
  remote,
  failure,
  onRemoteAction,
  ...rest
}: NetworkDialogProps & { readonly remote: RepositoryRemote }) {
  return (
    <DialogShell
      {...rest}
      title="Remove Remote"
      className="p05-dialog p05-delete-remote"
      subtitle={`Stop tracking the repository at '${remote.name}'`}
      icon={<RemoteIcon size={26} />}
      warning={
        failure ??
        `This removes '${remote.name}' and its ${remote.branchCount} remote-tracking branches from this repository only.`
      }
      submitLabel="Remove Remote"
      submitDisabled={false}
      danger
      onSubmit={() => onRemoteAction({ kind: 'remove', name: remote.name })}
    >
      <dt>Remote:</dt>
      <dd className="reference-target">
        <span className="reference-target-icon" aria-hidden="true">
          <RemoteIcon size={13} />
        </span>
        <span className="reference-target-name">{remote.name}</span>
        <span className="reference-target-detail muted">{remote.fetchUrl}</span>
      </dd>
    </DialogShell>
  );
}

function DeleteRemoteBranchDialog({
  remote,
  remoteBranch,
  failure,
  onStart,
  ...rest
}: NetworkDialogProps & { readonly remote: string; readonly remoteBranch: string }) {
  return (
    <DialogShell
      {...rest}
      title="Delete Branch on Remote"
      className="p05-dialog p05-delete-branch"
      subtitle={`Delete '${remoteBranch}' on '${remote}'`}
      icon={<RemoteIcon size={26} />}
      warning={
        failure ?? 'This deletes the branch for everyone using this remote. It cannot be undone from here.'
      }
      submitLabel="Delete on Remote"
      submitDisabled={false}
      danger
      onSubmit={() => onStart({ kind: 'delete-remote-branch', remote, remoteBranch })}
    >
      <dt>Branch:</dt>
      <dd className="reference-target">
        <span className="reference-target-icon" aria-hidden="true">
          <RemoteIcon size={13} />
        </span>
        <span className="reference-target-name">{`${remote}/${remoteBranch}`}</span>
      </dd>
    </DialogShell>
  );
}
