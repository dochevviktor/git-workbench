import { AsyncLocalStorage } from 'node:async_hooks';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GitRunnerLike } from '../repositories/repository-service';
import type { GitRunOptions } from './runner';
import { ExpectedBackendError } from '../errors';
import type { RepositoryTrustStore } from './trust-store';

export function gitCommandIndex(args: readonly string[]): number {
  let index = 0;
  while (args[index]?.startsWith('-')) index += args[index] === '-c' ? 2 : 1;
  return index;
}

/** Only object/topology/configuration reads are allowed before trust. Never inspect filtered worktree bytes. */
function restrictedArguments(args: readonly string[]): string[] {
  const index = gitCommandIndex(args);
  const command = args[index];
  const tail = args.slice(index + 1);
  const allowed =
    [
      'rev-parse',
      'for-each-ref',
      'show-ref',
      'ls-tree',
      'ls-files',
      'rev-list',
      'merge-base',
      'check-ref-format',
      'check-attr',
    ].includes(command ?? '') ||
    (command === 'symbolic-ref' &&
      tail.at(-1) === 'HEAD' &&
      tail.slice(0, -1).every((arg) => ['--quiet', '--short'].includes(arg))) ||
    (command === 'remote' && (tail.length === 0 || tail[0] === 'get-url')) ||
    (command === 'worktree' && tail[0] === 'list') ||
    (command === 'stash' && tail[0] === 'list') ||
    (command === 'config' &&
      tail.some((arg) => ['--get', '--get-all', '--get-regexp', '--list'].includes(arg))) ||
    (command === 'cat-file' && !tail.some((arg) => ['--filters', '--textconv'].includes(arg))) ||
    ['log', 'diff-tree', 'blame'].includes(command ?? '');
  if (!allowed)
    throw new ExpectedBackendError(
      'REPOSITORY_UNTRUSTED',
      'Trust this repository to inspect working changes, run Git operations or launch configured programs.',
    );
  const safe = [...args];
  if (command === 'log' || command === 'diff-tree')
    safe.splice(index + 1, 0, '--no-ext-diff', '--no-textconv');
  if (command === 'blame') safe.splice(index + 1, 0, '--no-textconv');
  return [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '-c',
    'log.showSignature=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
    ...safe,
  ];
}

/** The privilege decision stays in main; no trust flag or command argv is accepted from the renderer. */
export class RepositoryGitRunner implements GitRunnerLike {
  private readonly directories = new Map<string, string>();
  private readonly scope = new AsyncLocalStorage<boolean>();
  constructor(
    private readonly runner: GitRunnerLike,
    readonly trust: RepositoryTrustStore,
  ) {}
  get executable() {
    return this.runner.executable;
  }
  version() {
    return this.runner.version();
  }
  register(commonDir: string, paths: readonly string[]): void {
    for (const path of paths) this.directories.set(path, commonDir);
  }
  async run(args: readonly string[], options: GitRunOptions) {
    let common = this.directories.get(options.cwd);
    if (!common && !this.scope.getStore()) {
      try {
        const topology = await this.runner.run(['rev-parse', '--git-common-dir'], {
          cwd: options.cwd,
          signal: options.signal,
          timeoutMs: 5000,
          maxOutputBytes: 32768,
        });
        common = await realpath(resolve(options.cwd, topology.stdout.replace(/\r?\n$/u, '')));
      } catch {
        /* Non-repository/global reads still use the restricted command policy. */
      }
    }
    if (this.scope.getStore() || (common && (await this.trust.isTrusted(common))))
      return this.runner.run(args, options);
    return this.runner.run(restrictedArguments(args), {
      ...options,
      authentication: 'silent',
      env: {
        ...options.env,
        GIT_NO_LAZY_FETCH: '1',
        GIT_ALLOW_PROTOCOL: '',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
      },
    });
  }
  async authorized<T>(commonDir: string, work: () => Promise<T>): Promise<T> {
    if (!(await this.trust.isTrusted(commonDir)))
      throw new ExpectedBackendError(
        'REPOSITORY_UNTRUSTED',
        'Trust this repository before running operations or configured programs.',
      );
    return this.scope.run(true, work);
  }
  /** New destinations and global settings are explicit application actions, not repository-supplied execution. */
  applicationAction<T>(work: () => Promise<T>): Promise<T> {
    return this.scope.run(true, work);
  }
}
