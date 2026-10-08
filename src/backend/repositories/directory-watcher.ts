import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

/** Bounded, symlink-safe native invalidation with a polling fallback for missed events/limits. */
export class DirectoryWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly identities = new Map<string, string>();
  private readonly pendingWork = new Set<Promise<void>>();
  private readonly stopping = new WeakSet<FSWatcher>();
  private filters = new Map<string, Set<string> | null>();
  private closed = false;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private maximum: ReturnType<typeof setTimeout> | undefined;
  private reconciling = false;
  private reconcileAgain = false;
  private degraded = false;
  private readonly fallback: ReturnType<typeof setInterval>;
  readonly ready: Promise<void>;

  constructor(
    private readonly roots: readonly { path: string; kind: 'worktree' | 'git' | 'source' }[],
    private readonly changed: (mode: 'active' | 'fallback') => void,
    private readonly limit = 1024,
  ) {
    this.ready = this.reconcile();
    this.fallback = setInterval(() => {
      this.changed('fallback');
      void this.reconcile();
    }, 30_000);
    this.fallback.unref();
  }

  private notify = (rename = false): void => {
    if (this.closed) return;
    if (rename) this.reconcileAgain = true;
    if (this.pending) clearTimeout(this.pending);
    const flush = () => {
      clearTimeout(this.pending);
      clearTimeout(this.maximum);
      this.pending = undefined;
      this.maximum = undefined;
      if (this.closed) return;
      this.changed(this.degraded ? 'fallback' : 'active');
      if (this.reconcileAgain) void this.reconcile();
    };
    this.pending = setTimeout(flush, 180);
    this.maximum ??= setTimeout(flush, 1000);
    this.pending.unref();
    this.maximum.unref();
  };

  private track(work: Promise<void>): Promise<void> {
    this.pendingWork.add(work);
    void work.then(
      () => this.pendingWork.delete(work),
      () => this.pendingWork.delete(work),
    );
    return work;
  }

  private closeWatcher(watcher: FSWatcher): void {
    if (this.stopping.has(watcher)) return;
    this.stopping.add(watcher);
    void this.track(
      new Promise<void>((resolve) => {
        const done = () => {
          watcher.removeListener('close', done);
          watcher.removeListener('error', done);
          resolve();
        };
        watcher.once('close', done);
        watcher.once('error', done);
        watcher.close();
      }),
    );
  }

  private reconcile(): Promise<void> {
    return this.track(this.reconcileDirectories());
  }

  private async reconcileDirectories(): Promise<void> {
    if (this.closed) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    this.reconcileAgain = false;
    this.degraded = false;
    const previousCount = this.watchers.size;
    const wanted = new Set<string>();
    const filters = new Map<string, Set<string> | null>();
    let entries = 0;
    const add = (path: string, child?: string) => {
      if (this.closed) return;
      if (!child) filters.set(path, null);
      else if (!filters.has(path)) filters.set(path, new Set([child]));
      else filters.get(path)?.add(child);
      this.filters.set(path, filters.get(path) ?? null);
      if (wanted.has(path)) return;
      if (wanted.size >= this.limit) {
        this.degraded = true;
        return;
      }
      wanted.add(path);
      if (this.watchers.has(path)) return;
      try {
        const watcher = watch(path, { persistent: false }, (event, filename) => {
          const names = this.filters.get(path);
          if (names && filename && !names.has(filename)) return;
          const gitDirectory = this.roots.some(
            (root) => root.kind === 'git' && (path === root.path || path.startsWith(`${root.path}${sep}`)),
          );
          if (gitDirectory && (filename?.endsWith('.lock') || filename === 'objects')) return;
          this.notify(event === 'rename');
        });
        watcher.on('error', () => {
          watcher.close();
          if (this.watchers.get(path) === watcher) this.watchers.delete(path);
          this.degraded = true;
          this.notify(true);
        });
        this.watchers.set(path, watcher);
      } catch {
        this.degraded = true;
      }
    };
    const visit = async (path: string, kind: 'worktree' | 'git' | 'source', depth: number): Promise<void> => {
      if (this.closed || wanted.size >= this.limit || entries >= 50_000 || depth > 24) {
        this.degraded = true;
        return;
      }
      try {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink() || this.closed) return;
        const identity = `${info.dev}:${info.ino}`;
        if (this.identities.has(path) && this.identities.get(path) !== identity) {
          const previous = this.watchers.get(path);
          if (previous) this.closeWatcher(previous);
          this.watchers.delete(path);
        }
        this.identities.set(path, identity);
        if (kind === 'source') {
          const marker = await lstat(join(path, '.git')).catch(() => undefined);
          const bare = await lstat(join(path, 'objects')).catch(() => undefined);
          if (marker || bare?.isDirectory()) {
            add(path, marker ? '.git' : 'HEAD');
            return;
          }
        }
        add(path);
        const directory = await opendir(path);
        for await (const entry of directory) {
          if (this.closed || ++entries >= 50_000 || wanted.size >= this.limit) {
            this.degraded = true;
            break;
          }
          if (
            !entry.isDirectory() ||
            entry.isSymbolicLink() ||
            entry.name === '.git' ||
            (kind === 'git' && entry.name === 'objects')
          )
            continue;
          await visit(join(path, entry.name), kind, depth + 1);
        }
      } catch {
        this.degraded = true;
      }
    };
    try {
      for (const root of this.roots) {
        add(dirname(root.path), basename(root.path));
        await visit(root.path, root.kind, 0);
      }
      this.filters = filters;
      for (const [path, watcher] of this.watchers)
        if (!wanted.has(path) || this.closed) {
          this.closeWatcher(watcher);
          this.watchers.delete(path);
          this.identities.delete(path);
        }
      // Cover changes during installation of watches on newly created subdirectories.
      if (previousCount > 0 && this.watchers.size !== previousCount) this.notify();
    } finally {
      this.reconciling = false;
      if (this.reconcileAgain && !this.closed) void this.reconcile();
    }
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.pending);
    clearTimeout(this.maximum);
    clearInterval(this.fallback);
    for (const watcher of this.watchers.values()) this.closeWatcher(watcher);
    this.watchers.clear();
    this.identities.clear();
  }

  /** After disposal, directory iterators can still be closing their native handles. */
  async settled(): Promise<void> {
    while (this.pendingWork.size) await Promise.allSettled([...this.pendingWork]);
  }
}
