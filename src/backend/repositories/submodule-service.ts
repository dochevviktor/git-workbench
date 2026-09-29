import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type {
  RepositorySubmodule,
  RepositorySubmoduleAction,
  RepositorySubmoduleActionResult,
  RepositorySubmoduleContext,
  RepositorySubmoduleComparison,
  RepositoryOperationProgress,
  RepositorySubmoduleParentStatus,
} from '../../common/ipc/contracts';
import { repositorySubmoduleContextSchema, repositorySubmoduleSchema } from '../../common/ipc/contracts';
import {
  GitCancelledError,
  GitCommandError,
  GitTimeoutError,
  redactUrlCredentials,
  sanitizeGitOutput,
} from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { ProgressCollector } from './network-service';
import { parseWorkingTreeStatus } from './working-tree-service';
import { hasUnrelatedRepository, topologyPathFingerprint } from './topology-paths';

const submoduleReadTimeoutMs = 15_000;
const submoduleMutationTimeoutMs = 10 * 60_000;
const submoduleReadOutputLimit = 4 * 1024 * 1024;
const submoduleOutputLimit = 64 * 1024;
const submoduleLimit = 1_000;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const safeSubmodulePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]+$/u;

export interface SubmoduleRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReadSubmoduleContextInput {
  readonly repositoryId: string;
  readonly cwd: string;
}

export interface ApplySubmoduleActionInput extends ReadSubmoduleContextInput {
  readonly action: RepositorySubmoduleAction;
  readonly snapshot: string;
  readonly signal?: AbortSignal | undefined;
  readonly onCommand?: ((args: readonly string[]) => void) | undefined;
  readonly onProgress?: ((progress: RepositoryOperationProgress) => void) | undefined;
  readonly onOutput?: ((line: string) => void) | undefined;
}

export class StaleSubmoduleSnapshotError extends Error {
  constructor() {
    super('The submodule layout changed after it was read. Refresh and try again.');
    this.name = 'StaleSubmoduleSnapshotError';
  }
}

export class SubmoduleActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmoduleActionError';
  }
}

interface SubmoduleDefinition {
  readonly name: string;
  readonly url: string;
  readonly branch: string | null;
}

interface SubmoduleStatus {
  readonly code: ' ' | '+' | '-' | 'U';
  readonly revision: string | null;
}

interface ParentStatus {
  readonly index: string;
  readonly worktree: string;
}

interface ChildState {
  readonly exists: boolean;
  readonly head: string | null;
  readonly branch: string | null;
  readonly dirtyPaths: readonly string[];
  readonly dirtyFileCount: number | null;
  readonly missingExpectedRevision: boolean;
  readonly ignoredPaths: readonly string[];
  readonly fingerprint: string;
}

/**
 * Reads gitlinks and child repositories separately. A submodule is not a text file: the parent
 * stores a commit object while the child can point elsewhere and have its own dirty worktree.
 */
export async function readSubmoduleContext(
  runner: SubmoduleRunner,
  input: ReadSubmoduleContextInput,
): Promise<RepositorySubmoduleContext> {
  const submodules: RepositorySubmodule[] = [];
  const fingerprints: string[] = [];
  let truncated = false;
  // Read each gitlink in its owning index. Recursive status text is neither NUL-delimited nor
  // sufficient to distinguish a nested parent's HEAD/index from the root repository's pointers.
  const visit = async (ownerPath: string, depth: number): Promise<void> => {
    const cwd = resolve(input.cwd, ownerPath);
    const [definitions, parentStatuses, headPointers, indexPointers] = await Promise.all([
      readDefinitions(runner, cwd),
      readParentStatuses(runner, cwd),
      readTreePointers(runner, cwd, 'HEAD'),
      readIndexPointers(runner, cwd),
    ]);
    fingerprints.push(
      createHash('sha256')
        .update(JSON.stringify([...definitions]))
        .digest('hex'),
    );
    const paths = [...new Set([...definitions.keys(), ...indexPointers.keys()])]
      .filter(isSafeSubmodulePath)
      .sort((left, right) => left.localeCompare(right));
    for (const relativePath of paths) {
      if (submodules.length >= submoduleLimit || depth > 16) {
        truncated = true;
        return;
      }
      const path = ownerPath ? `${ownerPath}/${relativePath}` : relativePath;
      const definition = definitions.get(relativePath);
      const parentStatus = parentStatuses?.get(relativePath) ?? {
        index: parentStatuses ? '.' : 'X',
        worktree: parentStatuses ? '.' : 'X',
      };
      const revisions = {
        head: headPointers.get(relativePath) ?? null,
        index: indexPointers.get(relativePath) ?? null,
        working: null as string | null,
      };
      const child = await readChildState(runner, input.cwd, path, revisions.index);
      fingerprints.push(child.fingerprint);
      revisions.working = child.head;
      const parentState = toParentStatus(parentStatus);
      const indexChanged = !sameRevision(revisions.head, revisions.index);
      const workingChanged = !sameRevision(revisions.index, revisions.working);
      const statusCode = parentState === 'unmerged' ? 'U' : !child.head ? '-' : workingChanged ? '+' : ' ';
      const detached = child.head !== null && child.branch === null;
      const state = submoduleState({
        statusCode,
        parentStatus: parentState,
        child,
        detached,
        indexChanged,
        workingChanged,
      });
      submodules.push(
        repositorySubmoduleSchema.parse({
          id: submoduleId(input.repositoryId, path),
          path,
          name: basename(path) || path,
          url: redactUrlCredentials(definition?.url ?? ''),
          branch: definition?.branch ?? null,
          nested: ownerPath !== '',
          ownerPath,
          relativePath,
          initialized: child.head !== null,
          detached,
          state,
          parentStatus: parentState,
          statusCode,
          dirtyFileCount: child.dirtyFileCount,
          revisions,
          indexChanged,
          workingChanged,
          dirtyPaths: child.dirtyPaths.slice(0, 10_000),
          ignoredPaths: child.ignoredPaths.slice(0, 10_000),
        }),
      );
      if (child.head) await visit(path, depth + 1);
    }
  };
  await visit('', 0);

  const snapshot = createHash('sha256')
    .update(createSubmoduleSnapshot(submodules))
    .update(JSON.stringify(fingerprints))
    .digest('hex');
  return repositorySubmoduleContextSchema.parse({
    repositoryId: input.repositoryId,
    submodules,
    snapshot,
    truncated,
  });
}

/** Applies one explicit submodule action and returns a fresh read for the renderer. */
export async function applySubmoduleAction(
  runner: SubmoduleRunner,
  input: ApplySubmoduleActionInput,
): Promise<RepositorySubmoduleActionResult> {
  const before = await readSubmoduleContext(runner, input);
  if (before.snapshot !== input.snapshot) throw new StaleSubmoduleSnapshotError();
  const action = input.action;
  if (before.truncated)
    return blocked(
      input.repositoryId,
      action.kind,
      'other',
      'The submodule list is incomplete. Open the owning child repository to work on a smaller scope.',
      before,
      [],
    );
  const selected =
    action.kind === 'add' ? undefined : before.submodules.find((item) => item.id === action.submoduleId);
  let cwd = input.cwd;

  if (action.kind === 'add') {
    if (!isSafeSubmodulePath(action.path) || !(await safeDirectoryPath(input.cwd, action.path)))
      return blocked(
        input.repositoryId,
        action.kind,
        'invalid-path',
        'Choose a normalized relative submodule path.',
        before,
        [action.path],
      );
    if (
      before.submodules.some(
        (submodule) => action.path === submodule.path || action.path.startsWith(`${submodule.path}/`),
      )
    )
      return blocked(
        input.repositoryId,
        action.kind,
        'exists',
        'A submodule is already registered at that path.',
        before,
        [action.path],
      );
  } else {
    const submodule = selected;
    if (!submodule)
      return blocked(
        input.repositoryId,
        action.kind,
        'not-found',
        'That submodule is no longer registered. Refresh the repository.',
        before,
        [],
      );
    if (!(await safeDirectoryPath(input.cwd, submodule.path)))
      return blocked(
        input.repositoryId,
        action.kind,
        'invalid-path',
        'The submodule path contains a symbolic link or is not a directory.',
        before,
        [submodule.path],
      );
    cwd = resolve(input.cwd, submodule.ownerPath);
    const scope = before.submodules.filter(
      (item) =>
        item.id === submodule.id ||
        ((action.kind === 'remove' || action.recursive) && item.path.startsWith(`${submodule.path}/`)),
    );
    if (scope.some((item) => item.state === 'unknown' || (item.initialized && item.dirtyFileCount === null)))
      return blocked(
        input.repositoryId,
        action.kind,
        'other',
        'The selected worktree could not be fully inspected. Refresh before continuing.',
        before,
        [submodule.path],
      );
    if (
      action.kind === 'remove' &&
      (await hasUnrelatedRepository(
        resolve(input.cwd, submodule.path),
        scope.map((item) => resolve(input.cwd, item.path)),
      ))
    )
      return blocked(
        input.repositoryId,
        action.kind,
        'invalid-path',
        'The child contains an unrelated repository or too many paths to review. Remove that repository separately.',
        before,
        [submodule.path],
      );
    if (action.kind !== 'sync' && !(action.kind === 'remove' && action.force)) {
      const unsafe = scope.find(
        (item) =>
          item.state === 'conflicted' ||
          (item.dirtyFileCount ?? 0) > 0 ||
          (action.kind === 'remove' &&
            (item.ignoredPaths.length > 0 || item.workingChanged || item.indexChanged)) ||
          (item.initialized && item.dirtyFileCount === null),
      );
      if (unsafe)
        return blocked(
          input.repositoryId,
          action.kind,
          unsafe.state === 'conflicted' ? 'conflict' : 'dirty',
          `Save or resolve changes in '${unsafe.path}' before ${action.kind === 'remove' ? 'removing' : 'updating'} it.`,
          before,
          unsafe.dirtyPaths.length || unsafe.ignoredPaths.length
            ? [...unsafe.dirtyPaths, ...unsafe.ignoredPaths].map((path) => `${unsafe.path}/${path}`)
            : [unsafe.path],
        );
    }
    if (action.kind === 'remove' && !action.force) {
      if (submodule.state === 'conflicted')
        return blocked(
          input.repositoryId,
          action.kind,
          'conflict',
          'Resolve the submodule conflict before removing it, or choose force removal.',
          before,
          [submodule.path],
        );
      if (submodule.dirtyFileCount !== null && submodule.dirtyFileCount > 0)
        return blocked(
          input.repositoryId,
          action.kind,
          'dirty',
          'The submodule has uncommitted changes. Review its child worktree before removing it.',
          before,
          submodule.dirtyPaths.length > 0
            ? submodule.dirtyPaths.map((path) => `${submodule.path}/${path}`)
            : [submodule.path],
        );
    }
  }

  try {
    const run = async (args: string[]) => {
      input.onCommand?.(args.map(redactUrlCredentials));
      const collector = new ProgressCollector(
        (progress) => input.onProgress?.(progress),
        (line) => input.onOutput?.(`${line}\n`),
      );
      try {
        return await runner.run(args, {
          cwd,
          timeoutMs: submoduleMutationTimeoutMs,
          maxOutputBytes: 8 * 1024 * 1024,
          ...(input.signal ? { signal: input.signal } : {}),
          authentication: 'prompt',
          onStderr: (chunk) => collector.push(chunk),
        });
      } finally {
        collector.flush();
      }
    };
    const result = await run(actionArguments(action, before));
    // `submodule add` has no --recursive option. Finish registering the child, then explicitly
    // initialize its descendants. An interruption leaves native Git state available for Update.
    if (action.kind === 'add' && action.recursive)
      await run([
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'update',
        '--init',
        '--checkout',
        '--progress',
        '--recursive',
        '--',
        action.path,
      ]);
    const context = await readSubmoduleContext(runner, input);
    return {
      status: 'applied',
      repositoryId: input.repositoryId,
      kind: action.kind,
      message: actionMessage(action),
      output: outputText(result.stdout, result.stderr),
      context,
    };
  } catch (error) {
    if (error instanceof GitCancelledError || error instanceof GitTimeoutError) throw error;
    const output = error instanceof GitCommandError ? outputText(error.stdout, error.stderr) : '';
    const context = await readSubmoduleContext(runner, input).catch(() => before);
    return blocked(
      input.repositoryId,
      action.kind,
      failureReason(error, output),
      failureMessage(action, output),
      context,
      action.kind === 'add' ? [action.path] : [],
      output,
    );
  }
}

async function readDefinitions(
  runner: SubmoduleRunner,
  cwd: string,
): Promise<ReadonlyMap<string, SubmoduleDefinition>> {
  try {
    if ((await lstat(join(cwd, '.gitmodules'))).isSymbolicLink()) return new Map();
    const result = await runner.run(
      ['config', '--null', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url|branch)$'],
      readOptions(cwd, submoduleReadOutputLimit),
    );
    const bySection = new Map<string, { name: string; url: string; branch: string | null }>();
    const pathsBySection = new Map<string, string>();
    for (const record of result.stdout.split('\0')) {
      if (!record) continue;
      const separator = record.indexOf('\n');
      if (separator < 0) continue;
      const key = record.slice(0, separator);
      const value = record.slice(separator + 1);
      const match = /^submodule\.(.+)\.(path|url|branch)$/u.exec(key);
      if (!match?.[1] || !match[2]) continue;
      const current = bySection.get(match[1]) ?? { name: match[1], url: '', branch: null };
      bySection.set(match[1], current);
      if (match[2] === 'path' && isSafeSubmodulePath(value)) pathsBySection.set(match[1], value);
      else if (match[2] === 'url') current.url = value;
      else if (match[2] === 'branch') current.branch = value;
    }
    const byPath = new Map<string, SubmoduleDefinition>();
    for (const [section, path] of pathsBySection) {
      const value = bySection.get(section);
      if (value) byPath.set(path, { ...value });
    }
    return byPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    if (error instanceof GitCommandError && error.exitCode === 1) return new Map();
    throw error;
  }
}

async function readParentStatuses(
  runner: SubmoduleRunner,
  cwd: string,
): Promise<ReadonlyMap<string, ParentStatus> | null> {
  const result = await runner
    .run(
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '--no-optional-locks',
        'status',
        '--porcelain=v2',
        '--ignore-submodules=none',
        '--untracked-files=all',
        '-z',
        '--',
      ],
      readOptions(cwd, submoduleReadOutputLimit),
    )
    .catch((error: unknown) => {
      if (error instanceof GitCommandError) return null;
      throw error;
    });
  if (!result) return null;
  const statuses = new Map<string, ParentStatus>();
  for (const record of result.stdout.split('\0')) {
    if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const fields = record.split(' ');
      const pair = fields[1];
      const path = pathAfterFields(record, record.startsWith('1 ') ? 8 : record.startsWith('2 ') ? 9 : 10);
      if (pair?.length === 2 && path && isSafeSubmodulePath(path))
        statuses.set(
          path,
          record.startsWith('u ')
            ? { index: 'U', worktree: 'U' }
            : { index: normalizeStatus(pair[0]), worktree: normalizeStatus(pair[1]) },
        );
    } else if (record.startsWith('? ')) {
      const path = record.slice(2);
      if (isSafeSubmodulePath(path)) statuses.set(path, { index: '?', worktree: '?' });
    }
  }
  return statuses;
}

async function readTreePointers(
  runner: SubmoduleRunner,
  cwd: string,
  revision: string,
): Promise<ReadonlyMap<string, string>> {
  try {
    const result = await runner.run(
      ['ls-tree', '-rz', revision, '--'],
      readOptions(cwd, submoduleReadOutputLimit),
    );
    const pointers = new Map<string, string>();
    for (const record of result.stdout.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab < 0) continue;
      const fields = record.slice(0, tab).split(/\s+/u);
      const path = record.slice(tab + 1);
      if (fields[0] === '160000' && fields[2] && objectIdPattern.test(fields[2]) && isSafeSubmodulePath(path))
        pointers.set(path, fields[2]);
    }
    return pointers;
  } catch (error) {
    if (error instanceof GitCommandError) return new Map();
    throw error;
  }
}

async function readIndexPointers(
  runner: SubmoduleRunner,
  cwd: string,
): Promise<ReadonlyMap<string, string | null>> {
  const result = await runner.run(
    ['ls-files', '--stage', '-z', '--'],
    readOptions(cwd, submoduleReadOutputLimit),
  );
  const pointers = new Map<string, string | null>();
  for (const record of result.stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const fields = record.slice(0, tab).split(/\s+/u);
    const path = record.slice(tab + 1);
    if (fields[0] === '160000' && fields[1] && objectIdPattern.test(fields[1]) && isSafeSubmodulePath(path))
      pointers.set(path, fields[2] === '0' ? fields[1] : null);
  }
  return pointers;
}

async function readChildState(
  runner: SubmoduleRunner,
  parentCwd: string,
  path: string,
  expectedRevision: string | null,
): Promise<ChildState> {
  const childCwd = resolve(parentCwd, path);
  if (!(await safeDirectoryPath(parentCwd, path))) return missingChild();
  try {
    const details = await lstat(childCwd);
    if (!details.isDirectory()) return missingChild();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missingChild();
    throw error;
  }

  let head: string | null = null;
  try {
    // An existing empty submodule directory otherwise discovers the parent repository's HEAD.
    const marker = await lstat(join(childCwd, '.git'));
    if (marker.isSymbolicLink()) return { ...missingChild(), exists: true };
    const top = (
      await runner.run(['rev-parse', '--show-toplevel'], readOptions(childCwd, 32_768))
    ).stdout.trimEnd();
    if ((await realpath(top)) !== (await realpath(childCwd))) return { ...missingChild(), exists: true };
    head = cleanObjectId(
      (await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], readOptions(childCwd, 1_024))).stdout,
    );
  } catch (error) {
    if (!(error instanceof GitCommandError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error;
  }
  if (!head)
    return {
      ...missingChild(),
      exists: true,
    };

  const branch = await optionalOutput(runner, childCwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  let dirtyPaths: string[] = [];
  let ignoredPaths: string[] = [];
  let fingerprint = '';
  let dirtyFileCount: number | null;
  try {
    const status = await runner.run(
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '--no-optional-locks',
        'status',
        '--porcelain=v2',
        '--ignore-submodules=none',
        '--untracked-files=all',
        '--ignored=matching',
        '-z',
        '--',
      ],
      readOptions(childCwd, submoduleReadOutputLimit),
    );
    const records = parseWorkingTreeStatus(status.stdout);
    dirtyPaths = records
      .filter((record) => record.kind !== 'ignored')
      .map((record) => record.path.replace(/\/$/u, ''))
      .slice(0, 10_000);
    ignoredPaths = records
      .filter((record) => record.kind === 'ignored')
      .map((record) => record.path.replace(/\/$/u, ''))
      .slice(0, 10_000);
    fingerprint = createHash('sha256')
      .update(status.stdout)
      .update(await topologyPathFingerprint(childCwd, [...dirtyPaths, ...ignoredPaths]))
      .digest('hex');
    dirtyFileCount = Math.min(dirtyPaths.length, 100_000);
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    dirtyFileCount = null;
  }

  let missingExpectedRevision = false;
  if (expectedRevision) {
    try {
      await runner.run(['cat-file', '-e', `${expectedRevision}^{commit}`], readOptions(childCwd, 1_024));
    } catch (error) {
      if (error instanceof GitCommandError) missingExpectedRevision = true;
      else throw error;
    }
  }
  return {
    exists: true,
    head,
    branch,
    dirtyPaths,
    dirtyFileCount,
    missingExpectedRevision,
    ignoredPaths,
    fingerprint,
  };
}

async function optionalOutput(
  runner: SubmoduleRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await runner.run(args, readOptions(cwd, 1_024));
    const value = result.stdout.trim();
    return value || null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

function pathAfterFields(record: string, separatorCount: number): string {
  let cursor = 0;
  for (let index = 0; index < separatorCount; index += 1) {
    const separator = record.indexOf(' ', cursor);
    if (separator < 0) return '';
    cursor = separator + 1;
  }
  return record[cursor] === '\t' ? record.slice(cursor + 1) : record.slice(cursor);
}

function missingChild(): ChildState {
  return {
    exists: false,
    head: null,
    branch: null,
    dirtyPaths: [],
    dirtyFileCount: null,
    missingExpectedRevision: false,
    ignoredPaths: [],
    fingerprint: '',
  };
}

function submoduleState(input: {
  readonly statusCode: SubmoduleStatus['code'] | '?';
  readonly parentStatus: RepositorySubmoduleParentStatus;
  readonly child: ChildState;
  readonly detached: boolean;
  readonly indexChanged: boolean;
  readonly workingChanged: boolean;
}): RepositorySubmodule['state'] {
  if (input.parentStatus === 'unmerged' || input.statusCode === 'U') return 'conflicted';
  if (!input.child.exists) return 'missing';
  if (!input.child.head) return 'uninitialized';
  if (input.child.missingExpectedRevision) return 'missing-commit';
  if ((input.child.dirtyFileCount ?? 0) > 0) return 'dirty';
  if (input.detached && !input.indexChanged && !input.workingChanged) return 'detached';
  if (input.indexChanged || input.workingChanged || input.statusCode === '+') return 'changed';
  if (input.parentStatus === 'unknown') return 'unknown';
  return 'clean';
}

function toParentStatus(status: ParentStatus): RepositorySubmoduleParentStatus {
  if (status.index === 'X' || status.worktree === 'X') return 'unknown';
  if (status.index === '?' || status.worktree === '?') return 'untracked';
  if (status.index === 'U' || status.worktree === 'U') return 'unmerged';
  if (status.index === 'M' && status.worktree !== '.') return 'staged-and-modified';
  if (status.index !== '.') return 'staged';
  if (status.worktree !== '.') return 'modified';
  return 'clean';
}

function normalizeStatus(value: string | undefined): string {
  return value && /^[.ACDMRTUX?!]$/u.test(value) ? value : 'X';
}

function sameRevision(left: string | null, right: string | null): boolean {
  return left === right;
}

function cleanObjectId(value: string): string | null {
  const candidate = value.trim();
  return objectIdPattern.test(candidate) ? candidate : null;
}

function isSafeSubmodulePath(value: string): boolean {
  return (
    safeSubmodulePathPattern.test(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split('/').every((part) => part !== '' && part !== '.' && part.toLowerCase() !== '.git')
  );
}

/** Every existing ancestor must be a real directory, including the selected leaf. */
async function safeDirectoryPath(cwd: string, path: string): Promise<boolean> {
  if (!isSafeSubmodulePath(path)) return false;
  let current = cwd;
  for (const part of path.split('/')) {
    current = join(current, part);
    try {
      if (!(await lstat(current)).isDirectory()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
  }
  return true;
}

function actionArguments(action: RepositorySubmoduleAction, context: RepositorySubmoduleContext): string[] {
  switch (action.kind) {
    case 'add':
      return [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '--progress',
        ...(action.branch ? ['--branch', action.branch] : []),
        '--',
        action.url,
        action.path,
      ];
    case 'init':
      return [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'update',
        '--init',
        '--checkout',
        '--progress',
        ...(action.recursive ? ['--recursive'] : []),
        '--',
        submodulePath(context, action.submoduleId),
      ];
    case 'update':
      return [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'update',
        '--init',
        '--checkout',
        '--progress',
        ...(action.recursive ? ['--recursive'] : []),
        '--',
        submodulePath(context, action.submoduleId),
      ];
    case 'sync':
      return [
        'submodule',
        'sync',
        ...(action.recursive ? ['--recursive'] : []),
        '--',
        submodulePath(context, action.submoduleId),
      ];
    case 'remove':
      return ['rm', ...(action.force ? ['--force'] : []), '--', submodulePath(context, action.submoduleId)];
  }
}

function submodulePath(context: RepositorySubmoduleContext, id: string): string {
  const submodule = context.submodules.find((candidate) => candidate.id === id);
  if (!submodule)
    throw new SubmoduleActionError('That submodule is no longer registered. Refresh the repository.');
  return submodule.relativePath;
}

function actionMessage(action: RepositorySubmoduleAction): string {
  switch (action.kind) {
    case 'add':
      return `Added submodule '${action.path}'.`;
    case 'init':
      return 'Initialized the selected submodule.';
    case 'update':
      return 'Updated the selected submodule.';
    case 'sync':
      return 'Synchronized the selected submodule URL.';
    case 'remove':
      return 'Removed the selected submodule.';
  }
}

function failureReason(
  error: unknown,
  output: string,
): Extract<RepositorySubmoduleActionResult, { status: 'blocked' }>['reason'] {
  if (/local changes|modified content|would be overwritten|dirty/iu.test(output)) return 'dirty';
  if (/conflict|unmerged/iu.test(output)) return 'conflict';
  if (/already exists|already registered/iu.test(output)) return 'exists';
  if (error instanceof SubmoduleActionError) return 'invalid-path';
  return 'other';
}

function failureMessage(action: RepositorySubmoduleAction, output: string): string {
  const prefix =
    action.kind === 'remove' ? 'The submodule could not be removed.' : 'The submodule action failed.';
  return output ? `${prefix} ${output.slice(0, 400)}` : prefix;
}

function blocked(
  repositoryId: string,
  kind: RepositorySubmoduleAction['kind'],
  reason: Extract<RepositorySubmoduleActionResult, { status: 'blocked' }>['reason'],
  message: string,
  context: RepositorySubmoduleContext,
  paths: readonly string[],
  output = '',
): RepositorySubmoduleActionResult {
  return {
    status: 'blocked',
    repositoryId,
    kind,
    reason,
    message: message.slice(0, 512),
    output: output.slice(0, submoduleOutputLimit),
    paths: paths.slice(0, 200),
    context,
  };
}

function submoduleId(repositoryId: string, path: string): string {
  return `submodule-${createHash('sha256').update(`${repositoryId}\0${path}`, 'utf8').digest('hex')}`;
}

function createSubmoduleSnapshot(submodules: readonly RepositorySubmodule[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        submodules.map((submodule) => [
          submodule.id,
          submodule.path,
          submodule.ownerPath,
          submodule.url,
          submodule.parentStatus,
          submodule.state,
          submodule.revisions,
          submodule.dirtyPaths,
        ]),
      ),
      'utf8',
    )
    .digest('hex');
}

function readOptions(cwd: string, maxOutputBytes: number): GitRunOptions {
  return { cwd, timeoutMs: submoduleReadTimeoutMs, maxOutputBytes };
}

function outputText(stdout: string, stderr: string): string {
  return sanitizeGitOutput(`${stdout}${stdout && stderr ? '\n' : ''}${stderr}`).slice(
    0,
    submoduleOutputLimit,
  );
}

/** Bounded, local object reads for the selected staged/unstaged gitlink comparison. */
export async function readSubmoduleComparison(
  runner: SubmoduleRunner,
  cwd: string,
  submodule: RepositorySubmodule,
  area: 'staged' | 'unstaged',
): Promise<RepositorySubmoduleComparison> {
  const before = area === 'staged' ? submodule.revisions.head : submodule.revisions.index;
  const after = area === 'staged' ? submodule.revisions.index : submodule.revisions.working;
  const comparison: RepositorySubmoduleComparison = {
    before,
    after,
    commits: [],
    ahead: null,
    behind: null,
    truncated: false,
  };
  if (!submodule.initialized || !(await safeDirectoryPath(cwd, submodule.path))) return comparison;
  const childCwd = resolve(cwd, submodule.path);
  const available: string[] = [];
  for (const id of new Set([before, after])) {
    if (!id) continue;
    try {
      await runner.run(['cat-file', '-e', `${id}^{commit}`], readOptions(childCwd, 1024));
      available.push(id);
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
    }
  }
  if (!available.length) return comparison;
  const format = '%H%x00%P%x00%an%x00%aI%x00%s%x00';
  const parse = (value: string) => {
    const fields = value.split('\0');
    for (let i = 0; i + 4 < fields.length; i += 5) {
      const id = fields[i]!.trim();
      if (!objectIdPattern.test(id) || comparison.commits.some((commit) => commit.id === id)) continue;
      comparison.commits.push({
        id,
        parents: fields[i + 1]!.split(' ')
          .filter((id) => objectIdPattern.test(id))
          .slice(0, 64),
        author: fields[i + 2]!.slice(0, 4096),
        date: fields[i + 3]!.slice(0, 128),
        subject: fields[i + 4]!.slice(0, 4096),
      });
    }
  };
  const log = await runner.run(
    [
      'log',
      '--no-show-signature',
      '--no-decorate',
      '--no-ext-diff',
      '--no-textconv',
      '--topo-order',
      before === after ? '--max-count=1' : '--max-count=101',
      `--format=${format}`,
      ...(before && after && before !== after && available.length === 2
        ? [`${before}...${after}`]
        : available),
      '--',
    ],
    readOptions(childCwd, submoduleReadOutputLimit),
  );
  parse(log.stdout);
  comparison.truncated = comparison.commits.length > 100;
  comparison.commits = comparison.commits.slice(0, 100);
  for (const id of available) {
    if (!comparison.commits.some((commit) => commit.id === id))
      parse(
        (
          await runner.run(
            ['log', '--no-show-signature', '--no-decorate', '-1', `--format=${format}`, id, '--'],
            readOptions(childCwd, submoduleReadOutputLimit),
          )
        ).stdout,
      );
  }
  if (before && after && available.includes(before) && available.includes(after)) {
    const counts = (
      await runner.run(
        ['rev-list', '--left-right', '--count', `${before}...${after}`, '--'],
        readOptions(childCwd, 1024),
      )
    ).stdout
      .trim()
      .split(/\s+/u)
      .map(Number);
    comparison.behind = counts[0] ?? 0;
    comparison.ahead = counts[1] ?? 0;
  }
  return comparison;
}
