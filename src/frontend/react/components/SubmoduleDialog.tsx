import { useState } from 'react';
import type { RepositorySubmodule, RepositorySubmoduleAction } from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { SubmoduleIcon } from './Icons';
import { DialogShell } from './DialogShell';

interface SubmoduleDialogProps {
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: Extract<RepositorySubmoduleAction, { kind: 'add' }>) => void;
  readonly onClose: () => void;
}

/** Adds one submodule with explicit path, URL, and recursive-clone choices. */
export function SubmoduleDialog({ platform, busy, failure, onSubmit, onClose }: SubmoduleDialogProps) {
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [branch, setBranch] = useState('');
  const [recursive, setRecursive] = useState(false);
  const validPath =
    path.trim().length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').includes('..');
  return (
    <DialogShell
      className="p05-dialog p09-dialog"
      title="Add Submodule"
      subtitle="Register and initialize a child repository"
      icon={<SubmoduleIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel="Add"
      submitDisabled={!url.trim() || !validPath}
      busy={busy}
      onSubmit={() =>
        onSubmit({
          kind: 'add',
          url: url.trim(),
          path: path.trim(),
          ...(branch.trim() ? { branch: branch.trim() } : {}),
          recursive,
        })
      }
      onClose={onClose}
    >
      <dt>
        <label htmlFor="submodule-url">Repository URL:</label>
      </dt>
      <dd>
        <input
          id="submodule-url"
          className="reference-input"
          autoFocus
          value={url}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setUrl(event.target.value)}
        />
      </dd>
      <dt>
        <label htmlFor="submodule-path">Path:</label>
      </dt>
      <dd>
        <input
          id="submodule-path"
          className="reference-input"
          value={path}
          placeholder="modules/example"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPath(event.target.value)}
        />
        {!validPath && path.length > 0 && (
          <p className="dialog-inline-note">Use a normalized relative path.</p>
        )}
      </dd>
      <dt>
        <label htmlFor="submodule-branch">Branch:</label>
      </dt>
      <dd>
        <input
          id="submodule-branch"
          className="reference-input"
          value={branch}
          placeholder="Optional"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setBranch(event.target.value)}
        />
      </dd>
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(event) => setRecursive(event.target.checked)}
          />
          <span>Initialize nested submodules recursively</span>
        </label>
      </dd>
    </DialogShell>
  );
}

export interface SubmoduleActionDialogRequest {
  readonly kind: 'init' | 'update' | 'sync' | 'remove';
  readonly submodule: RepositorySubmodule;
  readonly snapshot: string;
}

/** Preview the exact child path and recursion/network scope before mutation. */
export function SubmoduleActionDialog({
  request,
  repositoryPath,
  descendants,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  readonly request: SubmoduleActionDialogRequest;
  readonly repositoryPath: string;
  readonly descendants: readonly RepositorySubmodule[];
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: RepositorySubmoduleAction) => void;
  readonly onClose: () => void;
}) {
  const [recursive, setRecursive] = useState(false);
  const [force, setForce] = useState(false);
  const { kind, submodule } = request;
  const remove = kind === 'remove';
  const dirty = descendants.some(
    (item) =>
      (item.dirtyFileCount ?? 0) > 0 ||
      item.state === 'conflicted' ||
      item.ignoredPaths.length > 0 ||
      item.workingChanged ||
      item.indexChanged,
  );
  const label = remove
    ? 'Remove'
    : kind === 'sync'
      ? 'Synchronize URL'
      : kind === 'init'
        ? 'Initialize'
        : 'Update';
  return (
    <DialogShell
      className="p05-dialog p09-dialog"
      title={`${label} Submodule`}
      subtitle={remove ? `Remove '${submodule.path}' and stage its removal` : `${label} '${submodule.path}'`}
      icon={<SubmoduleIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel={force ? 'Force Remove' : label}
      submitDisabled={remove && dirty && !force}
      busy={busy}
      danger={remove}
      onSubmit={() =>
        onSubmit(
          remove
            ? { kind: 'remove', submoduleId: submodule.id, force }
            : { kind, submoduleId: submodule.id, recursive },
        )
      }
      onClose={onClose}
    >
      <dt>Location:</dt>
      <dd className="p09-path">
        {platform === 'win32'
          ? `${repositoryPath}\\${submodule.path.replaceAll('/', '\\')}`
          : `${repositoryPath}/${submodule.path}`}
      </dd>
      <dt>Repository:</dt>
      <dd className="p09-path">{submodule.url || 'URL unavailable'}</dd>
      {submodule.nested && (
        <>
          <dt>Owning repository:</dt>
          <dd>{submodule.ownerPath}</dd>
        </>
      )}
      {remove ? (
        <>
          <dt>Scope:</dt>
          <dd>
            The selected child directory and its nested submodules. The owning repository's .gitmodules and
            index will change. Stored Git objects are retained.
          </dd>
          {descendants.length > 1 && (
            <>
              <dt>Nested children:</dt>
              <dd>
                <ul className="p09-path-list">
                  {descendants
                    .filter((item) => item.id !== submodule.id)
                    .map((item) => (
                      <li key={item.id}>{item.path}</li>
                    ))}
                </ul>
              </dd>
            </>
          )}
          {dirty && (
            <>
              <dt>Local changes:</dt>
              <dd>
                <ul className="p09-path-list">
                  {descendants.flatMap((item) =>
                    [...item.dirtyPaths, ...item.ignoredPaths].slice(0, 100).map((path) => (
                      <li key={`${item.id}:${path}`}>
                        {item.path}/{path}
                      </li>
                    )),
                  )}
                </ul>
              </dd>
            </>
          )}
          <dt />
          <dd>
            <label className="reference-checkbox">
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
              <span>Force removal and discard local child changes</span>
            </label>
          </dd>
        </>
      ) : (
        <>
          <dt>Scope:</dt>
          <dd>
            {kind === 'sync'
              ? 'Copy the configured URL to local Git configuration.'
              : 'Fetch missing commits if needed, then check out the revision recorded in the owning index. The child will use a detached HEAD.'}
          </dd>
          <dt />
          <dd>
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(event) => setRecursive(event.target.checked)}
              />
              <span>Include nested submodules recursively</span>
            </label>
          </dd>
          {kind !== 'sync' && (
            <>
              <dt />
              <dd className="dialog-inline-note">
                Activity shows progress and Cancel. After an interruption, review the child state and run
                Update to resume.
              </dd>
            </>
          )}
        </>
      )}
    </DialogShell>
  );
}
