import { describe, expect, it } from 'vitest';
import { OperationRegistry } from '../../src/backend/operations/operation-registry';
import type { OperationHandle, OperationOutcome } from '../../src/backend/operations/operation-registry';
import type { RepositoryOperation } from '../../src/common/ipc/contracts';

const repositoryId = `repo-${'a'.repeat(64)}`;

function descriptor(ownerId = 1) {
  return {
    ownerId,
    repositoryId,
    kind: 'fetch' as const,
    title: "Fetch 'origin'",
    command: 'git fetch --progress origin',
  };
}

/** Lets a test decide when the work finishes, so a running operation can be observed. */
function deferredWork() {
  let handle: OperationHandle | undefined;
  let settle: ((outcome: OperationOutcome) => void) | undefined;
  // The registry calls the work function synchronously, so the handle exists once start() returns.
  const work = (given: OperationHandle) =>
    new Promise<OperationOutcome>((resolve) => {
      handle = given;
      settle = resolve;
    });
  return {
    work,
    finish: (outcome: OperationOutcome) => settle?.(outcome),
    handleOf: () => {
      if (!handle) throw new Error('The work has not started yet.');
      return handle;
    },
  };
}

describe('operation registry', () => {
  it('accepts an operation as running and reports progress and completion to listeners', async () => {
    const registry = new OperationRegistry();
    const seen: RepositoryOperation[] = [];
    registry.subscribe((_ownerId, operation) => seen.push(operation));
    const deferred = deferredWork();

    const accepted = registry.start(descriptor(), deferred.work);
    expect(accepted).toMatchObject({ status: 'running', progress: null, command: descriptor().command });
    expect(registry.isBusy(1, repositoryId)).toBe(true);

    deferred.handleOf().setProgress({ phase: 'Receiving objects', percent: 42 });
    deferred.handleOf().appendOutput('remote: Enumerating objects: 5, done.\n');
    deferred.finish({ status: 'succeeded', message: 'Fetched new changes.', output: 'done' });
    await new Promise((resolve) => setImmediate(resolve));

    const final = registry.get(accepted.id);
    expect(final).toMatchObject({
      status: 'succeeded',
      message: 'Fetched new changes.',
      output: 'done',
      progress: null,
      failureReason: null,
    });
    expect(final?.finishedAt).not.toBeNull();
    expect(registry.isBusy(1, repositoryId)).toBe(false);
    expect(seen.map((operation) => operation.status)).toEqual(['running', 'running', 'running', 'succeeded']);
    expect(seen[1]?.progress).toEqual({ phase: 'Receiving objects', percent: 42 });
  });

  it('keeps the record queryable after every listener has gone', async () => {
    const registry = new OperationRegistry();
    const release = registry.subscribe(() => undefined);
    const deferred = deferredWork();
    const accepted = registry.start(descriptor(), deferred.work);

    release();
    deferred.finish({ status: 'succeeded', message: 'Fetched new changes.', output: '' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.get(accepted.id)).toMatchObject({ status: 'succeeded' });
    expect(registry.list(1)).toHaveLength(1);
  });

  it('aborts a cancelled operation and reports the outcome as cancelled', async () => {
    const registry = new OperationRegistry();
    const deferred = deferredWork();
    const accepted = registry.start(descriptor(), deferred.work);

    expect(registry.cancel(1, accepted.id)).toMatchObject({ status: 'running', message: 'Cancelling…' });
    expect(deferred.handleOf().signal.aborted).toBe(true);
    // The work still reports what it found; the registry records the user's intent instead.
    deferred.finish({ status: 'failed', message: 'Git stopped.', output: 'partial', failureReason: 'other' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.get(accepted.id)).toMatchObject({
      status: 'cancelled',
      failureReason: 'cancelled',
      output: 'partial',
    });
  });

  it("refuses to cancel or list another window's operation", async () => {
    const registry = new OperationRegistry();
    const deferred = deferredWork();
    const accepted = registry.start(descriptor(7), deferred.work);

    expect(registry.cancel(8, accepted.id)).toBeNull();
    expect(registry.list(8)).toEqual([]);
    expect(registry.list(7)).toHaveLength(1);
    expect(deferred.handleOf().signal.aborted).toBe(false);

    registry.disposeOwner(7);
    expect(deferred.handleOf().signal.aborted).toBe(true);
    expect(registry.list(7)).toEqual([]);
    deferred.finish({ status: 'failed', message: 'stopped', output: '' });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('records a thrown failure instead of leaving the operation running', async () => {
    const registry = new OperationRegistry();
    const accepted = registry.start(descriptor(), () => Promise.reject(new Error('spawn failed')));
    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.get(accepted.id)).toMatchObject({
      status: 'failed',
      message: 'spawn failed',
      failureReason: 'other',
    });
  });
});
