import type { GitCommandResult, GitRunOptions } from './runner';
import type { GitRunnerLike } from '../repositories/repository-service';

/** Coalesces simultaneous identical reads, without retaining stale completed results or sharing writes. */
export class ReadCoordinator implements GitRunnerLike {
  private readonly pending = new Map<string, Promise<GitCommandResult>>();
  private active = 0;
  private epoch = 0;
  private readonly waiting: (() => void)[] = [];

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

  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult> {
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
      ].includes(command ?? '') ||
      (args[0] === 'symbolic-ref' &&
        args.at(-1) === 'HEAD' &&
        args.slice(1, -1).every((arg) => ['--quiet', '--short'].includes(arg))) ||
      (args[0] === 'remote' && (args.length === 1 || args[1] === 'get-url')) ||
      (args[0] === 'worktree' && args[1] === 'list') ||
      (args[0] === 'config' && args.some((arg) => ['--get', '--get-regexp', '--get-all'].includes(arg)));
    if (!read) {
      this.epoch += 1;
      return this.runner.run(args, options).finally(() => {
        this.epoch += 1;
      });
    }
    if (options.stdin !== undefined || options.signal || options.onStderr)
      return this.runner.run(args, options);
    const key = JSON.stringify([this.epoch, args, options]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const result = this.execute(args, options).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }

  private async execute(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult> {
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    try {
      return await this.runner.run(args, options);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
