import type { DesktopApi } from '../../../common/ipc/api';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

export function mergeOperation(
  current: readonly RepositoryOperation[],
  next: RepositoryOperation,
): RepositoryOperation[] {
  const previous = current.find((operation) => operation.id === next.id);
  if (
    previous &&
    ((previous.revision ?? 0) > (next.revision ?? 0) ||
      (previous.status !== 'running' && next.status === 'running'))
  )
    return [...current];
  return [...current.filter((operation) => operation.id !== next.id), next]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .filter((operation, index) => operation.status === 'running' || index < 60);
}

/** A control deadline never decides a mutation's outcome. Reconcile missed events from queryable jobs. */
export function waitForOperation(
  api: DesktopApi,
  accepted: RepositoryOperation,
): Promise<RepositoryOperation> {
  if (accepted.status !== 'running') return Promise.resolve(accepted);
  return new Promise((resolve) => {
    let current = accepted;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const consume = (next: RepositoryOperation) => {
      if (finished || next.id !== accepted.id) return;
      current = mergeOperation([current], next)[0]!;
      if (current.status !== 'running') {
        finished = true;
        if (timer) clearTimeout(timer);
        release();
        resolve(current);
      }
    };
    const release = api.repository.onOperationChanged(consume);
    const poll = async () => {
      try {
        const current = unwrapResult(await api.repository.listOperations()).find(
          (item) => item.id === accepted.id,
        );
        if (current) consume(current);
      } catch {
        /* The job survives a transient control-request failure. */
      }
      if (!finished) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
  });
}
