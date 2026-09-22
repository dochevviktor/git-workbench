import { useEffect, useRef, useState } from 'react';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { RepositoryIcon } from './Icons';
import { DialogShell } from './DialogShell';
import type { Platform } from '../lib/platform';
import type { HostingCloneTarget } from '../../../common/ipc/hosting';

export function CloneDialog({
  platform,
  operations,
  onClose,
  initialTarget,
  onBrowseHosted,
}: {
  readonly platform: Platform;
  readonly operations: readonly RepositoryOperation[];
  readonly onClose: () => void;
  readonly initialTarget?: HostingCloneTarget | undefined;
  readonly onBrowseHosted: () => void;
}) {
  const [url, setUrl] = useState(initialTarget?.url ?? '');
  const [parentPath, setParentPath] = useState('');
  const [name, setName] = useState(initialTarget?.name ?? '');
  const nameEdited = useRef(false);
  const [accepted, setAccepted] = useState<RepositoryOperation>();
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const closed = useRef(false);
  const [failure, setFailure] = useState<string>();
  const known = accepted ? operations.find((operation) => operation.id === accepted.id) : undefined;
  const operation = known && (known.revision ?? 0) >= (accepted?.revision ?? 0) ? known : accepted;
  const running = operation?.status === 'running';
  const cloning = running && operation.kind === 'clone';
  const interactionBusy = Boolean(running) || checking || starting;
  const currentOperation = useRef(operation);
  currentOperation.current = operation;
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      const pending = currentOperation.current;
      if (pending?.kind === 'connection' && pending.status === 'running')
        void window.desktop?.repository.cancelOperation({ operationId: pending.id });
    };
  }, []);
  const validName =
    name.trim().length > 0 &&
    !/[\\/]/u.test(name) &&
    !['.', '..'].includes(name.trim()) &&
    !name.trim().startsWith('-');

  const api = () => {
    if (!window.desktop) throw new Error('Open this application in Electron to clone a repository.');
    return window.desktop.repository;
  };
  const fail = (reason: unknown) => {
    if (!closed.current)
      setFailure(reason instanceof Error ? reason.message : 'The operation could not be started.');
  };
  const cancel = () => {
    if (operation?.status === 'running')
      void api().cancelOperation({ operationId: operation.id }).then(unwrapResult).catch(fail);
  };
  const submit = async () => {
    setStarting(true);
    setFailure(undefined);
    try {
      const next = unwrapResult(await api().clone({ url: url.trim(), parentPath, name: name.trim() }));
      if (!closed.current) setAccepted(next);
    } catch (reason) {
      fail(reason);
    } finally {
      setStarting(false);
    }
  };
  const testConnection = async () => {
    setChecking(true);
    setFailure(undefined);
    try {
      const next = unwrapResult(await api().testConnection({ kind: 'url', url: url.trim() }));
      if (closed.current) await api().cancelOperation({ operationId: next.id });
      else setAccepted(next);
    } catch (reason) {
      fail(reason);
    } finally {
      setChecking(false);
    }
  };
  const close = () => {
    closed.current = true;
    if (operation?.kind === 'connection') cancel();
    onClose();
  };
  return (
    <DialogShell
      title="Clone"
      subtitle="Clone a repository into a new local folder"
      icon={<RepositoryIcon size={26} />}
      platform={platform}
      busy={starting || Boolean(cloning)}
      warning={failure ?? (operation?.status === 'failed' ? operation.message : null)}
      submitLabel="Clone"
      submitDisabled={!url.trim() || !parentPath || !validName || Boolean(running) || checking}
      onSubmit={() => void submit()}
      onClose={close}
    >
      <dt />
      <dd>
        <button type="button" className="link-button" disabled={interactionBusy} onClick={onBrowseHosted}>
          Browse hosted repositories…
        </button>
      </dd>
      <dt>
        <label htmlFor="clone-url">Repository URL:</label>
      </dt>
      <dd>
        <input
          id="clone-url"
          autoFocus
          className="reference-input"
          value={url}
          disabled={interactionBusy}
          onChange={(event) => {
            setUrl(event.target.value);
            setAccepted(undefined);
            if (!nameEdited.current)
              setName(
                event.target.value
                  .trim()
                  .replace(/[\\/]+$/u, '')
                  .split(/[\\/]/u)
                  .at(-1)
                  ?.replace(/\.git$/u, '') ?? '',
              );
          }}
        />
      </dd>
      <dt />
      <dd>
        <button
          type="button"
          className="link-button"
          disabled={!url.trim() || interactionBusy}
          onClick={() => void testConnection()}
        >
          Test Connection
        </button>
        {operation?.kind === 'connection' && (
          <span role="status" className="muted">
            {' '}
            {operation.message}
          </span>
        )}
      </dd>
      <dt>
        <label htmlFor="clone-parent">Parent Folder:</label>
      </dt>
      <dd className="clone-parent-field">
        <input
          id="clone-parent"
          className="reference-input"
          value={parentPath}
          disabled={interactionBusy}
          onChange={(event) => setParentPath(event.target.value)}
        />
        <button
          type="button"
          className="button"
          disabled={interactionBusy}
          aria-label="Choose clone parent folder"
          onClick={() => {
            void api()
              .pickDirectory()
              .then((result) => {
                const path = unwrapResult(result);
                if (path && !closed.current) setParentPath(path);
              })
              .catch(fail);
          }}
        >
          Browse…
        </button>
      </dd>
      <dt>
        <label htmlFor="clone-name">Name:</label>
      </dt>
      <dd>
        <input
          id="clone-name"
          className="reference-input"
          value={name}
          disabled={interactionBusy}
          onChange={(event) => {
            nameEdited.current = true;
            setName(event.target.value);
          }}
        />
      </dd>
      {operation?.kind === 'clone' && (
        <>
          <dt>Status:</dt>
          <dd role="status">
            {operation.progress
              ? `${operation.progress.phase} ${operation.progress.percent ?? ''}%`
              : operation.message}
          </dd>
        </>
      )}
      {running && (
        <>
          <dt />
          <dd>
            <button type="button" className="button" disabled={operation.cancelRequested} onClick={cancel}>
              {operation.cancelRequested ? 'Cancelling…' : 'Cancel Operation'}
            </button>
          </dd>
        </>
      )}
    </DialogShell>
  );
}
