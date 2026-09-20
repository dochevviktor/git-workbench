import { useEffect, useRef, useState } from 'react';
import type { RepositoryConnectionRequest, RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

/** A connection check is read-only Git work with the same bounded job/cancellation lifetime as a fetch. */
export function TestConnection({
  request,
  operations,
  disabled = false,
}: {
  readonly request: RepositoryConnectionRequest;
  readonly operations: readonly RepositoryOperation[];
  readonly disabled?: boolean;
}) {
  const [accepted, setAccepted] = useState<RepositoryOperation>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const pendingOperationId = useRef<string | undefined>(undefined);
  const known = operations.find((operation) => operation.id === accepted?.id);
  const operation = known && (known.revision ?? 0) >= (accepted?.revision ?? 0) ? known : accepted;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingOperationId.current)
        void window.desktop?.repository.cancelOperation({ operationId: pendingOperationId.current });
    };
  }, []);
  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      if (!window.desktop) throw new Error('The desktop connection is unavailable.');
      const operation = unwrapResult(await window.desktop.repository.testConnection(request));
      if (!mounted.current) {
        void window.desktop.repository.cancelOperation({ operationId: operation.id });
        return;
      }
      pendingOperationId.current = operation.id;
      setAccepted(operation);
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : 'Connection test could not start.');
    } finally {
      if (mounted.current) setStarting(false);
    }
  };
  return (
    <div className="connection-test">
      <button
        type="button"
        className="link-button"
        disabled={disabled || starting || operation?.status === 'running'}
        onClick={() => void start()}
      >
        Test Connection
      </button>
      {(error || operation) && (
        <span role="status" className="muted">
          {' '}
          {error ?? operation?.message}
        </span>
      )}
    </div>
  );
}
