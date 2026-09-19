import type { RepositoryOperation } from '../../common/ipc/contracts';

export interface BackgroundFetchTarget {
  readonly ownerId: number;
  readonly repositoryId: string;
  readonly remote: string;
}

export interface BackgroundFetchSchedulerOptions {
  readonly intervalMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly start: (target: BackgroundFetchTarget) => Promise<RepositoryOperation>;
  /** Used when a repository is closed while asynchronous planning is still in progress. */
  readonly cancel?: ((target: BackgroundFetchTarget, operationId: string) => void) | undefined;
}

interface FetchEntry {
  readonly key: string;
  readonly ownerId: number;
  readonly repositoryId: string;
  remotes: string[];
  cursor: number;
  nextAt: number;
  inFlightId: string | undefined;
  inFlightRemote: string | undefined;
  finishedBeforeAcceptance: string | undefined;
  starting: boolean;
  stopped: boolean;
}

const defaultIntervalMs = 20 * 60 * 1_000;
const maximumRemoteCount = 100;

/**
 * Schedules enabled fetches without owning Git semantics. One repository has one slot, so several
 * automatic remotes are visited in turn and can never launch overlapping fetches. The scheduler is
 * deliberately timer-driven rather than renderer-driven; closing a tab or a window removes its
 * target and prevents a late asynchronous start from being left behind.
 */
export class BackgroundFetchScheduler {
  private readonly entries = new Map<string, FetchEntry>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly start: BackgroundFetchSchedulerOptions['start'];
  private readonly cancel: BackgroundFetchSchedulerOptions['cancel'];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(options: BackgroundFetchSchedulerOptions) {
    this.intervalMs = Math.max(1, options.intervalMs ?? defaultIntervalMs);
    this.now = options.now ?? Date.now;
    this.start = options.start;
    this.cancel = options.cancel;
  }

  /** Replaces the enabled remotes for one open repository. */
  configure(ownerId: number, repositoryId: string, remotes: readonly string[]): string[] {
    if (this.disposed) return [];
    const key = this.key(ownerId, repositoryId);
    const nextRemotes = [...new Set(remotes)]
      .filter((remote) => remote.length > 0)
      .slice(0, maximumRemoteCount);
    if (nextRemotes.length === 0) return this.remove(ownerId, repositoryId);

    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, {
        key,
        ownerId,
        repositoryId,
        remotes: nextRemotes,
        cursor: 0,
        nextAt: this.now() + this.intervalMs,
        inFlightId: undefined,
        inFlightRemote: undefined,
        finishedBeforeAcceptance: undefined,
        starting: false,
        stopped: false,
      });
      this.schedule();
      return [];
    }

    const cancelled: string[] = [];
    if (entry.inFlightId && entry.inFlightRemote && !nextRemotes.includes(entry.inFlightRemote)) {
      cancelled.push(entry.inFlightId);
      entry.inFlightId = undefined;
      entry.inFlightRemote = undefined;
      entry.nextAt = this.now() + this.intervalMs;
    }
    entry.remotes = nextRemotes;
    entry.cursor %= nextRemotes.length;
    this.schedule();
    return cancelled;
  }

  /** Stops scheduling and returns operation IDs that the owner should cancel. */
  remove(ownerId: number, repositoryId: string): string[] {
    const key = this.key(ownerId, repositoryId);
    const entry = this.entries.get(key);
    if (!entry) return [];
    entry.stopped = true;
    this.entries.delete(key);
    this.schedule();
    return entry.inFlightId ? [entry.inFlightId] : [];
  }

  removeOwner(ownerId: number): string[] {
    const cancelled: string[] = [];
    for (const entry of [...this.entries.values()]) {
      if (entry.ownerId !== ownerId) continue;
      cancelled.push(...this.remove(entry.ownerId, entry.repositoryId));
    }
    return cancelled;
  }

  /** Testable/manual equivalent of a timer tick for one repository. */
  async runNow(ownerId: number, repositoryId: string): Promise<string | undefined> {
    const entry = this.entries.get(this.key(ownerId, repositoryId));
    if (!entry) return undefined;
    return this.runEntry(entry);
  }

  /** Lets the scheduler release its per-repository slot when an operation really finishes. */
  operationChanged(ownerId: number, operation: RepositoryOperation): void {
    if (operation.source !== 'background' || operation.status === 'running') return;
    const entry = this.entries.get(this.key(ownerId, operation.repositoryId));
    if (!entry) return;
    if (entry.inFlightId !== operation.id) {
      // A very fast local fetch can finish between OperationRegistry.start() publishing its running
      // event and the scheduler receiving the accepted record. Remember that terminal event so the
      // acceptance continuation cannot re-open the slot indefinitely.
      if (!entry.starting || !entry.inFlightRemote) return;
      entry.finishedBeforeAcceptance = operation.id;
      entry.inFlightRemote = undefined;
    } else {
      entry.inFlightId = undefined;
      entry.inFlightRemote = undefined;
    }
    entry.nextAt = this.now() + this.intervalMs;
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const entry of this.entries.values()) entry.stopped = true;
    this.entries.clear();
  }

  private async runEntry(entry: FetchEntry): Promise<string | undefined> {
    if (
      this.disposed ||
      entry.stopped ||
      this.entries.get(entry.key) !== entry ||
      entry.starting ||
      entry.inFlightId ||
      entry.remotes.length === 0
    )
      return undefined;

    const remote = entry.remotes[entry.cursor % entry.remotes.length];
    if (!remote) return undefined;
    entry.cursor = (entry.cursor + 1) % entry.remotes.length;
    entry.starting = true;
    entry.inFlightRemote = remote;
    // Move the due time before awaiting planning; otherwise the timer would repeatedly schedule
    // zero-delay ticks while `start` is still resolving.
    entry.nextAt = this.now() + this.intervalMs;
    const target: BackgroundFetchTarget = {
      ownerId: entry.ownerId,
      repositoryId: entry.repositoryId,
      remote,
    };
    try {
      const operation = await this.start(target);
      const stillScheduled = !this.disposed && !entry.stopped && this.entries.get(entry.key) === entry;
      if (!stillScheduled) {
        if (operation.status === 'running') this.cancel?.(target, operation.id);
        return operation.id;
      }
      if (operation.status === 'running' && entry.finishedBeforeAcceptance !== operation.id)
        entry.inFlightId = operation.id;
      else {
        entry.finishedBeforeAcceptance = undefined;
        entry.inFlightId = undefined;
        entry.inFlightRemote = undefined;
        entry.nextAt = this.now() + this.intervalMs;
      }
      return operation.id;
    } catch {
      // A busy repository or a disappeared session is retried at the next interval. Automatic work
      // never creates a second request merely because planning failed.
      if (this.entries.get(entry.key) === entry) {
        entry.inFlightRemote = undefined;
        entry.nextAt = this.now() + this.intervalMs;
      }
      return undefined;
    } finally {
      entry.starting = false;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.entries.size === 0) return;
    const now = this.now();
    const dueAt = Math.min(...[...this.entries.values()].map((entry) => entry.nextAt));
    const delay = Math.max(0, dueAt - now);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const current = this.now();
      for (const entry of this.entries.values()) {
        if (entry.nextAt <= current) void this.runEntry(entry);
      }
      this.schedule();
    }, delay);
    this.timer.unref?.();
  }

  private key(ownerId: number, repositoryId: string): string {
    return `${ownerId}\0${repositoryId}`;
  }
}
