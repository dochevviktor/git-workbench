import { randomBytes } from 'node:crypto';
import type {
  RepositoryOperation,
  RepositoryOperationFailureReason,
  RepositoryOperationKind,
  RepositoryOperationProgress,
} from '../../common/ipc/contracts';
import { repositoryOperationSchema } from '../../common/ipc/contracts';

/** Operations kept per window after they finish, so a reopened activity list still shows them. */
const historyLimit = 50;
const outputLimit = 64 * 1024;

export interface OperationDescriptor {
  readonly ownerId: number;
  readonly repositoryId: string;
  readonly kind: RepositoryOperationKind;
  readonly title: string;
  /** The Git command as it will be run, already redacted for display. */
  readonly command: string;
}

export interface OperationOutcome {
  readonly status: 'succeeded' | 'failed';
  readonly message: string;
  readonly output: string;
  readonly failureReason?: RepositoryOperationFailureReason | undefined;
  readonly canForceWithLease?: boolean | undefined;
}

/** What a running operation may report back while it works. */
export interface OperationHandle {
  readonly signal: AbortSignal;
  setProgress(progress: RepositoryOperationProgress | null): void;
  appendOutput(text: string): void;
}

export type OperationListener = (ownerId: number, operation: RepositoryOperation) => void;

interface OperationEntry {
  readonly ownerId: number;
  readonly controller: AbortController;
  operation: RepositoryOperation;
  /** Set when a cancel arrives, so the outcome is reported as cancelled rather than failed. */
  cancelled: boolean;
}

/**
 * Owns long-running Git work. A caller receives an accepted record immediately and the operation
 * continues in the background: progress and completion arrive as events, and the state stays
 * queryable after every listener has gone. Nothing here retries on its own, because a network write
 * whose outcome is unknown must not be repeated.
 */
export class OperationRegistry {
  private readonly entries = new Map<string, OperationEntry>();
  private readonly listeners = new Set<OperationListener>();
  private readonly clock: () => Date;

  constructor(options: { readonly clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  subscribe(listener: OperationListener): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  list(ownerId: number): RepositoryOperation[] {
    return [...this.entries.values()]
      .filter((entry) => entry.ownerId === ownerId)
      .map((entry) => entry.operation)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  get(operationId: string): RepositoryOperation | null {
    return this.entries.get(operationId)?.operation ?? null;
  }

  /** True while this window has an unfinished operation for the repository. */
  isBusy(ownerId: number, repositoryId: string): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        entry.ownerId === ownerId &&
        entry.operation.repositoryId === repositoryId &&
        entry.operation.status === 'running',
    );
  }

  /**
   * Accepts the operation, publishes it as running, and starts `work` without awaiting it. The
   * returned record is the accepted state; everything after it reaches listeners as an event.
   */
  start(
    descriptor: OperationDescriptor,
    work: (handle: OperationHandle) => Promise<OperationOutcome>,
  ): RepositoryOperation {
    const id = `op-${randomBytes(16).toString('hex')}`;
    const controller = new AbortController();
    const entry: OperationEntry = {
      ownerId: descriptor.ownerId,
      controller,
      cancelled: false,
      operation: repositoryOperationSchema.parse({
        id,
        repositoryId: descriptor.repositoryId,
        kind: descriptor.kind,
        title: descriptor.title,
        status: 'running',
        startedAt: this.clock().toISOString(),
        finishedAt: null,
        progress: null,
        command: descriptor.command,
        output: '',
        message: 'Running…',
        failureReason: null,
        canForceWithLease: false,
      } satisfies RepositoryOperation),
    };
    this.entries.set(id, entry);
    this.forget(descriptor.ownerId);

    const handle: OperationHandle = {
      signal: controller.signal,
      setProgress: (progress) => {
        if (entry.operation.status !== 'running') return;
        this.update(entry, { progress });
      },
      appendOutput: (text) => {
        if (!text) return;
        this.update(entry, { output: boundedOutput(entry.operation.output + text) });
      },
    };

    void work(handle)
      .then((outcome) => {
        this.finish(entry, entry.cancelled ? cancelledOutcome(outcome) : outcome);
      })
      .catch((error: unknown) => {
        this.finish(entry, {
          status: 'failed',
          message: error instanceof Error ? error.message : 'The operation failed.',
          output: entry.operation.output,
          failureReason: 'other',
        });
      });

    this.publish(entry);
    return entry.operation;
  }

  /**
   * Asks the operation to stop. The record stays until its process actually exits, because a
   * cancelled network write may still have completed on the other side.
   */
  cancel(ownerId: number, operationId: string): RepositoryOperation | null {
    const entry = this.entries.get(operationId);
    if (!entry || entry.ownerId !== ownerId) return null;
    if (entry.operation.status !== 'running') return entry.operation;
    entry.cancelled = true;
    entry.controller.abort();
    this.update(entry, { message: 'Cancelling…' });
    return entry.operation;
  }

  /** Cancels this window's work and drops its records; a closed window has no one to report to. */
  disposeOwner(ownerId: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.ownerId !== ownerId) continue;
      if (entry.operation.status === 'running') {
        entry.cancelled = true;
        entry.controller.abort();
      }
      this.entries.delete(id);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.operation.status === 'running') entry.controller.abort();
    }
    this.entries.clear();
    this.listeners.clear();
  }

  private finish(entry: OperationEntry, outcome: OperationOutcome): void {
    if (entry.operation.status !== 'running') return;
    this.update(entry, {
      status: entry.cancelled ? 'cancelled' : outcome.status,
      finishedAt: this.clock().toISOString(),
      progress: null,
      message: outcome.message,
      output: boundedOutput(outcome.output),
      failureReason: entry.cancelled ? 'cancelled' : (outcome.failureReason ?? null),
      canForceWithLease: !entry.cancelled && (outcome.canForceWithLease ?? false),
    });
  }

  private update(entry: OperationEntry, patch: Partial<RepositoryOperation>): void {
    entry.operation = repositoryOperationSchema.parse({ ...entry.operation, ...patch });
    this.publish(entry);
  }

  private publish(entry: OperationEntry): void {
    for (const listener of this.listeners) listener(entry.ownerId, entry.operation);
  }

  /** Keeps the newest finished records for a window and drops the rest. */
  private forget(ownerId: number): void {
    const finished = [...this.entries.entries()]
      .filter(([, entry]) => entry.ownerId === ownerId && entry.operation.status !== 'running')
      .sort(([, left], [, right]) => right.operation.startedAt.localeCompare(left.operation.startedAt));
    for (const [id] of finished.slice(historyLimit)) this.entries.delete(id);
  }
}

function cancelledOutcome(outcome: OperationOutcome): OperationOutcome {
  return {
    status: 'failed',
    message: 'The operation was cancelled. Refresh the repository to see what it had already done.',
    output: outcome.output,
    failureReason: 'cancelled',
  };
}

function boundedOutput(text: string): string {
  return text.length > outputLimit ? `…\n${text.slice(text.length - outputLimit + 2)}` : text;
}
