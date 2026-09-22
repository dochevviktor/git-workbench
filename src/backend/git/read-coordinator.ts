import { GitCancelledError } from './runner';
import type { GitCommandResult, GitRunOptions } from './runner';
import type { GitRunnerLike } from '../repositories/repository-service';

/** Coalesces simultaneous identical reads, without retaining stale completed results or sharing writes. */
export class ReadCoordinator implements GitRunnerLike {
  private readonly pending = new Map<string, Promise<GitCommandResult>>();
  private active = 0;
  private epoch = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly lifetime = new AbortController();
  private readonly tasks = new Set<Promise<GitCommandResult>>();

  constructor(
    private readonly runner: GitRunnerLike,
    private readonly concurrency = 6,
  ) {}

  get executable(): string {
    return this.runner.executable;
  }
  version() {
    return this.runner.version();
  }

  invalidate(): void {
    this.epoch += 1;
  }
  dispose(): void {
    this.lifetime.abort();
    this.pending.clear();
  }
  async settled(): Promise<void> {
    await Promise.allSettled([...this.tasks]);
  }

  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult> {
    const task = this.schedule(args, options);
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    );
    return task;
  }

  private schedule(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult> {
    if (this.lifetime.signal.aborted || options.signal?.aborted)
      return Promise.reject(new GitCancelledError());
    let index = 0;
    while (args[index]?.startsWith('-')) index += args[index] === '-c' ? 2 : 1;
    const command = args[index];
    const read =
      [
        'rev-parse',
        'for-each-ref',
        'status',
        'diff',
        'diff-tree',
        'diff-index',
        'ls-tree',
        'cat-file',
        'log',
        'show-ref',
        'blame',
        'rev-list',
        'ls-files',
        'check-attr',
        'merge-base',
        'check-ref-format',
      ].includes(command ?? '') ||
      (args[0] === 'symbolic-ref' &&
        args.at(-1) === 'HEAD' &&
        args.slice(1, -1).every((arg) => ['--quiet', '--short'].includes(arg))) ||
      (args[0] === 'remote' && (args.length === 1 || args[1] === 'get-url')) ||
      (args[0] === 'worktree' && args[1] === 'list') ||
      (args[0] === 'config' && args.some((arg) => ['--get', '--get-regexp', '--get-all'].includes(arg)));
    if (!read) {
      this.epoch += 1;
      return this.runner
        .run(args, {
          ...options,
          signal: AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]),
        })
        .finally(() => {
          this.epoch += 1;
        });
    }
    if (options.stdin !== undefined || options.signal || options.onStderr) return this.execute(args, options);
    const key = JSON.stringify([this.epoch, args, options]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const result = this.execute(args, options).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }

  private async execute(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult> {
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    if (this.active >= this.concurrency)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          const index = this.waiting.indexOf(ready);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new GitCancelledError());
        };
        this.waiting.push(ready);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    else this.active += 1;
    try {
      if (signal.aborted) throw new GitCancelledError();
      return await this.runner.run(args, { ...options, signal });
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
