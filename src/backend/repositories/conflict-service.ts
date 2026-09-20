import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type {
  RepositoryConflictContent,
  RepositoryConflictFile,
  RepositoryConflictFileSummary,
  RepositoryConflictKind,
  RepositoryConflictOperation,
  RepositoryConflictRegion,
  RepositoryConflictRequest,
  RepositoryConflictStage,
  RepositoryConflictState,
  RepositoryResolveConflictRequest,
} from '../../common/ipc/contracts';
import { repositoryConflictStateSchema } from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { detectPendingOperation } from './commit-service';

const conflictReadTimeoutMs = 15_000;
const conflictWriteTimeoutMs = 120_000;
const conflictReadOutputLimit = 8 * 1024 * 1024;
const conflictContentLimit = 2 * 1024 * 1024;
const conflictFileLimit = 1_000;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const modePattern = /^\d{6}$/u;
const safeConflictPath = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/).+$/u;

export interface ConflictRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ConflictContext {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
}

export class ConflictRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictRequestError';
  }
}

export class StaleConflictSnapshotError extends Error {
  constructor() {
    super('The conflict changed after it was read. Refresh the resolver and try again.');
    this.name = 'StaleConflictSnapshotError';
  }
}

interface RawStage {
  readonly mode: string;
  readonly objectId: string;
  readonly stage: 1 | 2 | 3;
}

interface ConflictGroup {
  readonly path: string;
  readonly stages: ReadonlyMap<number, RawStage>;
}

interface OperationInfo {
  readonly operation: RepositoryConflictOperation;
  readonly operationLabel: string;
  readonly oursLabel: string;
  readonly theirsLabel: string;
}

interface SafeWorkingFile {
  readonly bytes: Buffer;
  readonly mode: number;
}

/** Reads Git's unmerged index stages and the selected worktree result without exposing commands. */
export async function readConflictState(
  runner: ConflictRunner,
  context: ConflictContext,
  request: RepositoryConflictRequest,
): Promise<RepositoryConflictState> {
  const groups = await readUnmergedGroups(runner, context.cwd);
  const operation = await readOperationInfo(runner, context);
  const selectedPath = request.path ?? groups[0]?.path;
  if (request.path && !groups.some((group) => group.path === request.path)) {
    throw new ConflictRequestError('That file is no longer conflicted. Refresh Local Changes.');
  }

  let selected: RepositoryConflictFile | null = null;
  if (selectedPath) {
    const group = groups.find((candidate) => candidate.path === selectedPath);
    if (!group) throw new ConflictRequestError('There are no conflicted files to inspect.');
    selected = await readConflictFile(runner, context.cwd, group);
  }

  const selectedKind = selected?.kind;
  const files: RepositoryConflictFileSummary[] = groups.slice(0, conflictFileLimit).map((group) => ({
    path: group.path,
    previousPath: null,
    kind: group.path === selectedPath && selectedKind ? selectedKind : classifyStageKind(group),
    unresolvedRegions: group.path === selectedPath && selected ? selected.unresolvedRegions : null,
  }));
  const snapshot = conflictSnapshot(operation, groups, selectedPath, selected?.result ?? null);
  return repositoryConflictStateSchema.parse({
    repositoryId: context.repositoryId,
    operation: operation.operation,
    operationLabel: operation.operationLabel,
    oursLabel: operation.oursLabel,
    theirsLabel: operation.theirsLabel,
    files,
    selected,
    conflictedCount: groups.length,
    snapshot,
  } satisfies RepositoryConflictState);
}

/** Writes one manually edited text result and stages it, guarded by the state the resolver showed. */
export async function resolveConflict(
  runner: ConflictRunner,
  context: ConflictContext,
  request: RepositoryResolveConflictRequest,
): Promise<RepositoryConflictState> {
  const before = await readConflictState(runner, context, {
    id: request.id,
    path: request.path,
  });
  if (before.snapshot !== request.snapshot) throw new StaleConflictSnapshotError();
  const selected = before.selected;
  if (!selected) throw new ConflictRequestError('That file is no longer conflicted. Refresh Local Changes.');
  if (selected.kind !== 'text' || selected.result.state !== 'text') {
    throw new ConflictRequestError(
      'This conflict is not a bounded text file. Resolve it with an external tool, then stage it in Local Changes.',
    );
  }
  if (hasConflictMarkers(request.content)) {
    throw new ConflictRequestError('Resolve every conflict marker before staging this file.');
  }
  const bytes = Buffer.from(request.content, 'utf8');
  if (bytes.byteLength > conflictContentLimit) {
    throw new ConflictRequestError('The resolved file is too large for the built-in conflict helper.');
  }

  const target = safeWorktreePath(context.cwd, request.path);
  const original = await readSafeWorkingFile(target);
  if (!original) throw new ConflictRequestError('The conflicted worktree file is no longer available.');
  if (original.bytes.toString('utf8') !== selected.result.content) throw new StaleConflictSnapshotError();
  try {
    await writeFile(target, bytes, { mode: original.mode });
    await runner.run(['add', '--', request.path], {
      cwd: context.cwd,
      timeoutMs: conflictWriteTimeoutMs,
      maxOutputBytes: 1024 * 1024,
    });
  } catch (error) {
    // A failed stage must not leave the user with a half-applied editor result.
    await writeFile(target, original.bytes, { mode: original.mode }).catch(() => undefined);
    if (error instanceof GitCommandError) {
      throw new ConflictRequestError(
        'Git could not stage the resolved conflict. Review the file and try again.',
      );
    }
    throw error;
  }
  return readConflictState(runner, context, { id: request.id });
}

async function readUnmergedGroups(runner: ConflictRunner, cwd: string): Promise<ConflictGroup[]> {
  const result = await runner.run(['ls-files', '--unmerged', '-z', '--'], {
    cwd,
    timeoutMs: conflictReadTimeoutMs,
    maxOutputBytes: conflictReadOutputLimit,
  });
  const groups = new Map<string, Map<number, RawStage>>();
  for (const record of result.stdout.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('Git returned an invalid unmerged-file record.');
    const fields = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    const mode = fields[0];
    const objectId = fields[1];
    const stageText = fields[2];
    if (
      !mode ||
      !modePattern.test(mode) ||
      !objectId ||
      !objectIdPattern.test(objectId) ||
      !stageText ||
      !/^[123]$/u.test(stageText) ||
      !safeConflictPath.test(path)
    ) {
      throw new Error('Git returned invalid unmerged-file metadata.');
    }
    const stage = Number(stageText) as 1 | 2 | 3;
    const entries = groups.get(path) ?? new Map<number, RawStage>();
    if (entries.has(stage)) throw new Error('Git returned duplicate unmerged-file stages.');
    entries.set(stage, { mode, objectId, stage });
    groups.set(path, entries);
    if (groups.size > conflictFileLimit)
      throw new ConflictRequestError('Too many conflicted files to inspect safely.');
  }
  return [...groups.entries()]
    .map(([path, stages]) => ({ path, stages }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function readConflictFile(
  runner: ConflictRunner,
  cwd: string,
  group: ConflictGroup,
): Promise<RepositoryConflictFile> {
  const baseStage = group.stages.get(1);
  const oursStage = group.stages.get(2);
  const theirsStage = group.stages.get(3);
  const [base, ours, theirs, result] = await Promise.all([
    readStageContent(runner, cwd, baseStage),
    readStageContent(runner, cwd, oursStage),
    readStageContent(runner, cwd, theirsStage),
    readWorktreeContent(cwd, group.path),
  ]);
  const kind = conflictKind(group, base, ours, theirs, result);
  const regions = kind === 'text' && result.state === 'text' ? parseConflictRegions(result.content) : [];
  return {
    path: group.path,
    previousPath: null,
    kind,
    unresolvedRegions: regions.length,
    stages: {
      base: stageDto(baseStage),
      ours: stageDto(oursStage),
      theirs: stageDto(theirsStage),
    },
    base,
    ours,
    theirs,
    result,
    regions,
  } satisfies RepositoryConflictFile;
}

function conflictKind(
  group: ConflictGroup,
  base: RepositoryConflictContent,
  ours: RepositoryConflictContent,
  theirs: RepositoryConflictContent,
  result: RepositoryConflictContent,
): RepositoryConflictKind {
  if ([...group.stages.values()].some((stage) => stage.mode === '160000')) return 'submodule';
  if ([...group.stages.values()].some((stage) => stage.mode === '120000')) return 'unsupported';
  if ([1, 2, 3].some((stage) => !group.stages.has(stage))) return 'unsupported';
  if ([base, ours, theirs, result].some((content) => content.state === 'binary')) return 'binary';
  if ([base, ours, theirs, result].some((content) => content.state !== 'text')) return 'unsupported';
  return 'text';
}

function classifyStageKind(group: ConflictGroup): RepositoryConflictKind {
  if ([...group.stages.values()].some((stage) => stage.mode === '160000')) return 'submodule';
  if ([...group.stages.values()].some((stage) => stage.mode === '120000')) return 'unsupported';
  if ([1, 2, 3].some((stage) => !group.stages.has(stage))) return 'unsupported';
  return 'text';
}

function stageDto(stage: RawStage | undefined): RepositoryConflictStage {
  return { mode: stage?.mode ?? null, objectId: stage?.objectId ?? null };
}

async function readStageContent(
  runner: ConflictRunner,
  cwd: string,
  stage: RawStage | undefined,
): Promise<RepositoryConflictContent> {
  if (!stage) return unavailable('This conflict has no version for this side.');
  if (stage.mode === '160000') return unavailable('This side is a submodule entry, not text.');
  if (stage.mode === '120000')
    return unavailable('Symbolic-link conflicts are resolved outside the built-in editor.');
  try {
    const size = await runner.run(['cat-file', '-s', stage.objectId], {
      cwd,
      timeoutMs: conflictReadTimeoutMs,
      maxOutputBytes: 128,
    });
    const byteLength = parseByteLength(size.stdout.trim());
    if (byteLength > conflictContentLimit) return tooLarge(byteLength);
    const result = await runner.run(['cat-file', 'blob', stage.objectId], {
      cwd,
      timeoutMs: conflictReadTimeoutMs,
      maxOutputBytes: conflictContentLimit,
    });
    const content = result.stdout;
    if (isBinaryText(content, byteLength)) return binary(byteLength);
    return { state: 'text', content, byteLength, message: null };
  } catch (error) {
    if (error instanceof GitCommandError) return unavailable('The staged conflict blob could not be read.');
    throw error;
  }
}

async function readWorktreeContent(cwd: string, path: string): Promise<RepositoryConflictContent> {
  let file: SafeWorkingFile | undefined;
  try {
    file = await readSafeWorkingFile(safeWorktreePath(cwd, path));
  } catch {
    return unavailable('The conflicted worktree file could not be read.');
  }
  if (!file) return unavailable('The conflicted worktree file is missing.');
  if (file.bytes.byteLength > conflictContentLimit) return tooLarge(file.bytes.byteLength);
  const content = file.bytes.toString('utf8');
  if (isBinaryText(content, file.bytes.byteLength)) return binary(file.bytes.byteLength);
  return { state: 'text', content, byteLength: file.bytes.byteLength, message: null };
}

async function readSafeWorkingFile(path: string): Promise<SafeWorkingFile | undefined> {
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!details || !details.isFile()) return undefined;
  const bytes = await readFile(path);
  return { bytes, mode: details.mode & 0o777 };
}

function safeWorktreePath(cwd: string, path: string): string {
  if (!safeConflictPath.test(path)) throw new ConflictRequestError('The conflict path is not valid.');
  const root = resolve(cwd);
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new ConflictRequestError('The conflict path is outside the selected repository.');
  }
  return target;
}

function isBinaryText(content: string, byteLength: number): boolean {
  return content.includes('\0') || Buffer.byteLength(content, 'utf8') !== byteLength;
}

function parseByteLength(value: string): number {
  const byteLength = Number(value);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 8 * 1024 * 1024) {
    throw new Error('Git returned an invalid conflict blob size.');
  }
  return byteLength;
}

function unavailable(message: string): RepositoryConflictContent {
  return { state: 'unavailable', content: '', byteLength: null, message };
}

function binary(byteLength: number): RepositoryConflictContent {
  return {
    state: 'binary',
    content: '',
    byteLength,
    message: 'Binary content is not editable in the built-in conflict helper.',
  };
}

function tooLarge(byteLength: number): RepositoryConflictContent {
  return {
    state: 'too-large',
    content: '',
    byteLength,
    message: 'This conflict side is too large for the built-in conflict helper.',
  };
}

/** Parses Git's standard and diff3 conflict markers into ranges the renderer can replace safely. */
export function parseConflictRegions(content: string): RepositoryConflictRegion[] {
  const lines = content.split('\n');
  const regions: RepositoryConflictRegion[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (!isStartMarker(lines[cursor] ?? '')) {
      cursor += 1;
      continue;
    }
    const startLine = cursor;
    cursor += 1;
    const oursStart = cursor;
    while (cursor < lines.length && !isBaseMarker(lines[cursor] ?? '') && !isSeparator(lines[cursor] ?? '')) {
      cursor += 1;
    }
    const ours = lines.slice(oursStart, cursor).join('\n');
    let base: string | null = null;
    if (isBaseMarker(lines[cursor] ?? '')) {
      cursor += 1;
      const baseStart = cursor;
      while (cursor < lines.length && !isSeparator(lines[cursor] ?? '')) cursor += 1;
      base = lines.slice(baseStart, cursor).join('\n');
    }
    if (!isSeparator(lines[cursor] ?? '')) break;
    cursor += 1;
    const theirsStart = cursor;
    while (cursor < lines.length && !isEndMarker(lines[cursor] ?? '')) cursor += 1;
    if (!isEndMarker(lines[cursor] ?? '')) break;
    const theirs = lines.slice(theirsStart, cursor).join('\n');
    const endLine = cursor + 1;
    regions.push({ id: regions.length, startLine, endLine, base, ours, theirs });
    cursor = endLine;
  }
  return regions;
}

function hasConflictMarkers(content: string): boolean {
  return parseConflictRegions(content).length > 0 || /^(?:<{7}|={7}|>{7})/mu.test(content);
}

function isStartMarker(line: string): boolean {
  return /^<{7}(?: .*)?$/u.test(line);
}

function isBaseMarker(line: string): boolean {
  return /^\|{7}(?: .*)?$/u.test(line);
}

function isSeparator(line: string): boolean {
  return /^={7}$/u.test(line);
}

function isEndMarker(line: string): boolean {
  return /^>{7}(?: .*)?$/u.test(line);
}

async function readOperationInfo(runner: ConflictRunner, context: ConflictContext): Promise<OperationInfo> {
  const pending = await detectPendingOperation(context.gitDir);
  const currentBranch = await optionalOutput(runner, context.cwd, ['branch', '--show-current']);
  const rebaseBranch =
    pending === 'rebase'
      ? ((await gitDirText(context.gitDir, 'rebase-merge/head-name')) ??
        (await gitDirText(context.gitDir, 'rebase-apply/head-name')))
      : null;
  const current = shortReference(currentBranch ?? rebaseBranch ?? 'current branch');
  if (pending === 'merge') {
    const incoming = await gitDirText(context.gitDir, 'MERGE_HEAD');
    const incomingLabel = incoming
      ? (await optionalOutput(runner, context.cwd, [
          'name-rev',
          '--name-only',
          '--no-undefined',
          incoming,
        ])) || 'incoming branch'
      : 'incoming branch';
    return {
      operation: 'merge',
      operationLabel: `Merge conflict on '${current}'`,
      oursLabel: `Current '${current}'`,
      theirsLabel: `Merged '${shortReference(incomingLabel)}'`,
    };
  }
  if (pending === 'rebase') {
    const onto =
      (await gitDirText(context.gitDir, 'rebase-merge/onto')) ??
      (await gitDirText(context.gitDir, 'rebase-apply/onto'));
    const ontoLabel = onto
      ? (await optionalOutput(runner, context.cwd, ['name-rev', '--name-only', '--no-undefined', onto])) ||
        onto
      : 'upstream';
    return {
      operation: 'rebase',
      operationLabel: `Rebase conflict while replaying '${current}'`,
      oursLabel: `Rebase base '${shortReference(ontoLabel)}'`,
      theirsLabel: 'Commit being replayed',
    };
  }
  if (pending === 'cherry-pick') {
    const picked = await gitDirText(context.gitDir, 'CHERRY_PICK_HEAD');
    const pickedLabel = picked
      ? (await optionalOutput(runner, context.cwd, ['name-rev', '--name-only', '--no-undefined', picked])) ||
        picked.slice(0, 7)
      : 'selected commit';
    return {
      operation: 'cherry-pick',
      operationLabel: `Cherry-pick conflict on '${current}'`,
      oursLabel: `Current '${current}'`,
      theirsLabel: `Cherry-picked '${shortReference(pickedLabel)}'`,
    };
  }
  if (pending === 'revert') {
    const reverted = await gitDirText(context.gitDir, 'REVERT_HEAD');
    const revertedLabel = reverted
      ? (await optionalOutput(runner, context.cwd, [
          'name-rev',
          '--name-only',
          '--no-undefined',
          reverted,
        ])) || reverted.slice(0, 7)
      : 'selected commit';
    return {
      operation: 'revert',
      operationLabel: `Revert conflict on '${current}'`,
      oursLabel: `Current '${current}'`,
      theirsLabel: `Reverted '${shortReference(revertedLabel)}'`,
    };
  }
  return {
    operation: 'unknown',
    operationLabel: 'Unfinished conflict',
    oursLabel: 'Current worktree',
    theirsLabel: 'Incoming change',
  };
}

async function optionalOutput(
  runner: ConflictRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    return (
      (
        await runner.run(args, { cwd, timeoutMs: conflictReadTimeoutMs, maxOutputBytes: 8 * 1024 })
      ).stdout.trim() || null
    );
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

async function gitDirText(gitDir: string, path: string): Promise<string | null> {
  try {
    const file = await readFile(join(gitDir, path), 'utf8');
    return file.trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function shortReference(value: string): string {
  return value.replace(/^refs\/(heads|remotes|tags)\//u, '').replace(/^undefined\s+/u, '');
}

function conflictSnapshot(
  operation: OperationInfo,
  groups: readonly ConflictGroup[],
  selectedPath: string | undefined,
  result: RepositoryConflictContent | null,
): string {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify([
      operation.operation,
      operation.oursLabel,
      operation.theirsLabel,
      selectedPath ?? null,
      groups.map((group) => [
        group.path,
        [...group.stages.values()].map((stage) => [stage.stage, stage.mode, stage.objectId]),
      ]),
    ]),
  );
  if (result) {
    hash.update(result.state);
    hash.update(String(result.byteLength ?? ''));
    hash.update(result.content);
  }
  return hash.digest('hex');
}
