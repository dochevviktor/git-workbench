import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type {
  RepositorySubmodule,
  RepositorySubmoduleAction,
  RepositorySubmoduleActionResult,
  RepositorySubmoduleContext,
  RepositorySubmoduleParentStatus,
} from '../../common/ipc/contracts';
import { repositorySubmoduleContextSchema, repositorySubmoduleSchema } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

const submoduleReadTimeoutMs = 15_000;
const submoduleMutationTimeoutMs = 120_000;
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
}

/**
 * Reads gitlinks and child repositories separately. A submodule is not a text file: the parent
 * stores a commit object while the child can point elsewhere and have its own dirty worktree.
 */
export async function readSubmoduleContext(
  runner: SubmoduleRunner,
  input: ReadSubmoduleContextInput,
): Promise<RepositorySubmoduleContext> {
  const definitions = await readDefinitions(runner, input.cwd);
  const statuses = await readSubmoduleStatus(runner, input.cwd);
  const parentStatuses = await readParentStatuses(runner, input.cwd);
  const headPointers = await readTreePointers(runner, input.cwd, 'HEAD');
  const indexPointers = await readIndexPointers(runner, input.cwd);

  const paths = [...new Set([...definitions.keys(), ...statuses.keys(), ...indexPointers.keys()])]
    .filter(isSafeSubmodulePath)
    .sort((left, right) => left.localeCompare(right));
  const selected = paths.slice(0, submoduleLimit);
  const submodules: RepositorySubmodule[] = [];

  for (const path of selected) {
    const definition = definitions.get(path);
    const status = statuses.get(path);
    const parentStatus = parentStatuses.get(path) ?? { index: '.', worktree: '.' };
    const revisions = {
      head: headPointers.get(path) ?? null,
      index: indexPointers.get(path) ?? status?.revision ?? null,
      working: null as string | null,
    };
    const child = await readChildState(runner, input.cwd, path, revisions.index);
    revisions.working = child.head;
    const parentState = toParentStatus(parentStatus);
    const indexChanged = !sameRevision(revisions.head, revisions.index);
    const workingChanged = !sameRevision(revisions.index, revisions.working);
    const statusCode = status?.code ?? (definition ? ' ' : '?');
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
        url: definition?.url ?? '',
        branch: definition?.branch ?? null,
        nested: definition === undefined,
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
      }),
    );
  }

  const snapshot = createSubmoduleSnapshot(submodules);
  return repositorySubmoduleContextSchema.parse({
    repositoryId: input.repositoryId,
    submodules,
    snapshot,
    truncated: paths.length > submoduleLimit,
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

  if (action.kind === 'add') {
    if (!isSafeSubmodulePath(action.path))
      return blocked(
        input.repositoryId,
        action.kind,
        'invalid-path',
        'Choose a normalized relative submodule path.',
        before,
        [action.path],
      );
    if (before.submodules.some((submodule) => submodule.path === action.path))
      return blocked(
        input.repositoryId,
        action.kind,
        'exists',
        'A submodule is already registered at that path.',
        before,
        [action.path],
      );
  } else {
    const submodule = before.submodules.find((candidate) => candidate.id === action.submoduleId);
    if (!submodule)
      return blocked(
        input.repositoryId,
        action.kind,
        'not-found',
        'That submodule is no longer registered. Refresh the repository.',
        before,
        [],
      );
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

  const args = actionArguments(action, before);
  input.onCommand?.(args);
  try {
    const result = await runner.run(args, {
      cwd: input.cwd,
      timeoutMs: submoduleMutationTimeoutMs,
      maxOutputBytes: submoduleOutputLimit,
      ...(input.signal ? { signal: input.signal } : {}),
    });
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
    if (error instanceof GitCancelledError) throw error;
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
      const match = /^submodule\\.(.+)\\.(path|url|branch)$/u.exec(key);
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
    if (error instanceof GitCommandError && error.exitCode === 1) return new Map();
    throw error;
  }
}

async function readSubmoduleStatus(
  runner: SubmoduleRunner,
  cwd: string,
): Promise<ReadonlyMap<string, SubmoduleStatus>> {
  try {
    const result = await runner.run(
      ['submodule', 'status', '--recursive', '--'],
      readOptions(cwd, submoduleReadOutputLimit),
    );
    const records = new Map<string, SubmoduleStatus>();
    for (const line of result.stdout.split(/\r?\n/u)) {
      const match = /^([ +\-U])([0-9a-f]{40}|[0-9a-f]{64})\s+(.+)$/u.exec(line);
      if (!match?.[1] || !match[2] || !match[3]) continue;
      const path = statusPath(match[3]);
      if (!path || !isSafeSubmodulePath(path)) continue;
      records.set(path, { code: match[1] as SubmoduleStatus['code'], revision: match[2] });
    }
    return records;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return new Map();
    throw error;
  }
}

function statusPath(value: string): string | null {
  const withoutNote = value.replace(/\s+\([^\n]*\)$/u, '');
  return withoutNote.trim() || null;
}

async function readParentStatuses(
  runner: SubmoduleRunner,
  cwd: string,
): Promise<ReadonlyMap<string, ParentStatus>> {
  const result = await runner.run(
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
  );
  const statuses = new Map<string, ParentStatus>();
  for (const record of result.stdout.split('\0')) {
    if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const fields = record.split(' ');
      const pair = fields[1];
      const path = pathAfterFields(record, record.startsWith('1 ') ? 8 : record.startsWith('2 ') ? 9 : 10);
      if (pair?.length === 2 && path && isSafeSubmodulePath(path))
        statuses.set(path, { index: normalizeStatus(pair[0]), worktree: normalizeStatus(pair[1]) });
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

async function readIndexPointers(runner: SubmoduleRunner, cwd: string): Promise<ReadonlyMap<string, string>> {
  const result = await runner.run(
    ['ls-files', '--stage', '-z', '--'],
    readOptions(cwd, submoduleReadOutputLimit),
  );
  const pointers = new Map<string, string>();
  for (const record of result.stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const fields = record.slice(0, tab).split(/\s+/u);
    const path = record.slice(tab + 1);
    if (fields[0] === '160000' && fields[1] && objectIdPattern.test(fields[1]) && isSafeSubmodulePath(path))
      pointers.set(path, fields[1]);
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
  try {
    const details = await stat(childCwd);
    if (!details.isDirectory()) return missingChild();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missingChild();
    throw error;
  }

  let head: string | null = null;
  try {
    head = cleanObjectId(
      (await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], readOptions(childCwd, 1_024))).stdout,
    );
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
  }
  if (!head)
    return {
      exists: true,
      head: null,
      branch: null,
      dirtyPaths: [],
      dirtyFileCount: null,
      missingExpectedRevision: false,
    };

  const branch = await optionalOutput(runner, childCwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  let dirtyPaths: string[] = [];
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
        '-z',
        '--',
      ],
      readOptions(childCwd, submoduleReadOutputLimit),
    );
    dirtyPaths = statusPaths(status.stdout).slice(0, 10_000);
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
  return { exists: true, head, branch, dirtyPaths, dirtyFileCount, missingExpectedRevision };
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

function statusPaths(output: string): string[] {
  const paths: string[] = [];
  for (let index = 0; index < output.length;) {
    const end = output.indexOf('\0', index);
    const record = output.slice(index, end < 0 ? output.length : end);
    if (record && !record.startsWith('#')) {
      if (record.startsWith('2 ')) {
        const oldPathEnd = output.indexOf('\0', (end < 0 ? output.length : end) + 1);
        const path = pathAfterFields(record, 9);
        if (path) paths.push(path);
        index = oldPathEnd < 0 ? output.length : oldPathEnd + 1;
        continue;
      }
      const path = record.startsWith('1 ')
        ? pathAfterFields(record, 8)
        : record.startsWith('2 ')
          ? pathAfterFields(record, 9)
          : record.startsWith('u ')
            ? pathAfterFields(record, 10)
            : record.slice(2);
      if (path) paths.push(path);
    }
    index = end < 0 ? output.length : end + 1;
  }
  return paths.filter((path) => isSafeSubmodulePath(path));
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
    safeSubmodulePathPattern.test(value) && value.split('/').every((part) => part !== '' && part !== '.')
  );
}

function actionArguments(action: RepositorySubmoduleAction, context: RepositorySubmoduleContext): string[] {
  switch (action.kind) {
    case 'add':
      return [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        ...(action.recursive ? ['--recursive'] : []),
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
  return submodule.path;
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
    message,
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
  return `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`.slice(0, submoduleOutputLimit);
}
