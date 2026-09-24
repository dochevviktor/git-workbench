import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readlink, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
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
import { GitCancelledError, GitCommandError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { detectPendingOperation } from './commit-service';
import { conflictTextRegions, hasConflictMarkers } from '../../common/conflict-text';
import { finishStashApplication, readStashApplication } from './stash-application';

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
    const origins = groups.filter(
      (candidate) =>
        candidate.path !== group.path &&
        candidate.stages.has(1) &&
        [group.stages.get(2)?.objectId, group.stages.get(3)?.objectId].includes(
          candidate.stages.get(1)?.objectId,
        ),
    );
    if (!group.stages.has(1) && origins.length === 1)
      selected = { ...selected, shape: 'rename', previousPath: origins[0]!.path };
  }

  const selectedKind = selected?.kind;
  const files: RepositoryConflictFileSummary[] = groups.slice(0, conflictFileLimit).map((group) => ({
    path: group.path,
    previousPath: group.path === selectedPath ? (selected?.previousPath ?? null) : null,
    kind: group.path === selectedPath && selectedKind ? selectedKind : classifyStageKind(group),
    unresolvedRegions: group.path === selectedPath && selected ? selected.unresolvedRegions : null,
  }));
  const anchors = await Promise.all([
    optionalOutput(runner, context.cwd, ['rev-parse', '--verify', 'HEAD']),
    ...[
      'MERGE_HEAD',
      'REBASE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge/onto',
      'sequencer/head',
    ].map((name) => gitDirText(context.gitDir, name)),
  ]);
  const snapshot = conflictSnapshot(
    operation,
    groups,
    selectedPath,
    selected?.result ?? null,
    selectedPath
      ? `${await workingFingerprint(context.cwd, selectedPath)}:${selected?.workingCommitId ?? ''}:${JSON.stringify(anchors)}`
      : JSON.stringify(anchors),
  );
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
  signal?: AbortSignal,
): Promise<RepositoryConflictState> {
  const before = await readConflictState(runner, context, {
    id: request.id,
    path: request.path,
  });
  if (before.snapshot !== request.snapshot) throw new StaleConflictSnapshotError();
  if (signal?.aborted) throw new GitCancelledError();
  const selected = before.selected;
  if (!selected) throw new ConflictRequestError('That file is no longer conflicted. Refresh Local Changes.');
  if ('choice' in request) {
    await resolveChoice(runner, context, selected, request.choice, signal);
    return afterResolution(runner, context, request.id);
  }
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

  const target = await checkedWorktreePath(context.cwd, request.path);
  const original = await readSafeWorkingFile(target);
  if (!original) throw new ConflictRequestError('The conflicted worktree file is no longer available.');
  if (original.bytes.toString('utf8') !== selected.result.content) throw new StaleConflictSnapshotError();
  try {
    await replaceWorkingFile(target, bytes, original.mode);
    await runner.run(['add', '--', request.path], {
      cwd: context.cwd,
      timeoutMs: conflictWriteTimeoutMs,
      maxOutputBytes: 1024 * 1024,
      signal,
    });
  } catch (error) {
    // A stopped process may have committed the index already. Never put markers back into a
    // resolved file, or overwrite an external edit made while a filter was running.
    if (await stillUnmerged(runner, context.cwd, request.path)) {
      const current = await readSafeWorkingFile(target);
      if (current?.bytes.equals(bytes)) await replaceWorkingFile(target, original.bytes, original.mode);
    }
    if (error instanceof GitCommandError) {
      throw new ConflictRequestError(
        'Git could not stage the resolved conflict. Review the file and try again.',
      );
    }
    throw error;
  }
  return afterResolution(runner, context, request.id);
}

async function afterResolution(runner: ConflictRunner, context: ConflictContext, id: string) {
  const state = await readConflictState(runner, context, { id });
  if (state.conflictedCount === 0 && state.operation === 'stash')
    await finishStashApplication(context.gitDir);
  return state;
}

/** Whole-side choices are explicit, including binary/gitlink/deletion cases with no text markers. */
async function resolveChoice(
  runner: ConflictRunner,
  context: ConflictContext,
  file: RepositoryConflictFile,
  choice: 'ours' | 'theirs' | 'delete' | 'working',
  signal?: AbortSignal,
): Promise<void> {
  const target = await checkedWorktreePath(context.cwd, file.path);
  const options = {
    cwd: context.cwd,
    timeoutMs: conflictWriteTimeoutMs,
    maxOutputBytes: 1024 * 1024,
    signal,
  };
  const stage = choice === 'ours' || choice === 'theirs' ? file.stages[choice] : null;
  if (choice === 'working') {
    if (file.kind === 'submodule') {
      const root = (
        await runner.run(['rev-parse', '--show-toplevel'], { ...options, cwd: target })
      ).stdout.trim();
      if (resolve(root) !== target)
        throw new ConflictRequestError('Initialize this submodule before selecting its checked-out commit.');
      const id = (
        await runner.run(['rev-parse', '--verify', 'HEAD^{commit}'], { ...options, cwd: target })
      ).stdout.trim();
      if (!objectIdPattern.test(id))
        throw new ConflictRequestError('The submodule has no checked-out commit.');
      if (id !== file.workingCommitId) throw new StaleConflictSnapshotError();
      await stageObject(runner, context.cwd, file.path, '160000', id, signal);
    } else {
      if (file.result.state === 'text' && hasConflictMarkers(file.result.content))
        throw new ConflictRequestError('Resolve every conflict marker before staging this file.');
      if (file.result.state === 'too-large' || file.result.state === 'unavailable')
        throw new ConflictRequestError(
          'Choose a source version or deletion for this unavailable worktree result.',
        );
      await runner.run(['add', '--', file.path], options);
    }
    return;
  }
  if (stage?.mode === '160000' && stage.objectId) {
    // Selecting a gitlink never checks out or modifies the child repository.
    await stageObject(runner, context.cwd, file.path, stage.mode, stage.objectId, signal);
    return;
  }
  const details = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (details?.isDirectory()) {
    if (file.kind !== 'submodule' || stage?.objectId)
      throw new ConflictRequestError(
        'A directory occupies this path. Move its contents before resolving this entry.',
      );
    await runner.run(['update-index', '--force-remove', '--', file.path], options);
    return;
  }
  if (details && !details.isFile() && !details.isSymbolicLink())
    throw new ConflictRequestError('This worktree entry cannot be replaced safely.');
  if (details && details.size > conflictReadOutputLimit)
    throw new ConflictRequestError('Use an external tool for worktree conflict files larger than 8 MiB.');
  const original = details?.isFile() ? await readFile(target) : undefined;
  const originalLink = details?.isSymbolicLink() ? await readlink(target, { encoding: 'buffer' }) : undefined;
  let bytes: Buffer | undefined;
  if (stage?.objectId && stage.mode) {
    if (!['100644', '100755', '120000'].includes(stage.mode))
      throw new ConflictRequestError('This index mode cannot be selected as a file.');
    const size = Number((await runner.run(['cat-file', '-s', stage.objectId], options)).stdout.trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > conflictReadOutputLimit)
      throw new ConflictRequestError('Use an external tool for conflict sources larger than 8 MiB.');
    bytes = Buffer.from(
      (
        await runner.run(['cat-file', 'blob', stage.objectId], {
          ...options,
          maxOutputBytes: conflictReadOutputLimit,
          stdoutEncoding: 'base64',
        })
      ).stdout,
      'base64',
    );
  }
  if (signal?.aborted) throw new GitCancelledError();
  if (stage?.objectId) await checkedWorktreePath(context.cwd, file.path, true);
  try {
    if (!stage?.objectId || !stage.mode) {
      if (details) await unlink(target);
      await runner.run(['update-index', '--force-remove', '--', file.path], options);
    } else {
      if (stage.mode === '120000') {
        if (details) await unlink(target);
        await symlink(bytes!, target);
      } else await replaceWorkingFile(target, bytes!, stage.mode === '100755' ? 0o755 : 0o644);
      await stageObject(runner, context.cwd, file.path, stage.mode, stage.objectId, signal);
    }
  } catch (error) {
    if (!(await stillUnmerged(runner, context.cwd, file.path))) throw error;
    if (original) await replaceWorkingFile(target, original, details!.mode & 0o777);
    else if (originalLink !== undefined) {
      await unlink(target).catch(() => undefined);
      await symlink(originalLink, target);
    } else await unlink(target).catch(() => undefined);
    throw error;
  }
}

async function stageObject(
  runner: ConflictRunner,
  cwd: string,
  path: string,
  mode: string,
  id: string,
  signal?: AbortSignal,
) {
  await runner.run(['update-index', '-z', '--index-info'], {
    cwd,
    timeoutMs: conflictWriteTimeoutMs,
    maxOutputBytes: 1024 * 1024,
    stdin: `${mode} ${id}\t${path}\0`,
    signal,
  });
}

async function stillUnmerged(runner: ConflictRunner, cwd: string, path: string) {
  return (await readUnmergedGroups(runner, cwd)).some((group) => group.path === path);
}

async function replaceWorkingFile(path: string, bytes: Buffer, mode: number) {
  const temporary = join(dirname(path), `.git-workbench-resolve-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
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
    workingCommitId: kind === 'submodule' ? await workingSubmoduleCommit(runner, cwd, group.path) : null,
    shape: conflictShape(group),
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

async function workingSubmoduleCommit(
  runner: ConflictRunner,
  cwd: string,
  path: string,
): Promise<string | null> {
  try {
    const target = await checkedWorktreePath(cwd, path);
    if (!(await lstat(target)).isDirectory()) return null;
    const options = { cwd: target, timeoutMs: conflictReadTimeoutMs, maxOutputBytes: 32768 };
    if (resolve((await runner.run(['rev-parse', '--show-toplevel'], options)).stdout.trim()) !== target)
      return null;
    const id = (await runner.run(['rev-parse', '--verify', 'HEAD^{commit}'], options)).stdout.trim();
    return objectIdPattern.test(id) ? id : null;
  } catch {
    return null;
  }
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
  const present = [
    baseStageContent(group, 1, base),
    baseStageContent(group, 2, ours),
    baseStageContent(group, 3, theirs),
    result,
  ].filter((side) => side !== null);
  if (present.some((content) => content.state === 'binary')) return 'binary';
  if (present.some((content) => content.state !== 'text')) return 'unsupported';
  return 'text';
}

function classifyStageKind(group: ConflictGroup): RepositoryConflictKind {
  if ([...group.stages.values()].some((stage) => stage.mode === '160000')) return 'submodule';
  if ([...group.stages.values()].some((stage) => stage.mode === '120000')) return 'unsupported';
  return 'text';
}

function baseStageContent(group: ConflictGroup, stage: number, content: RepositoryConflictContent) {
  return group.stages.has(stage) ? content : null;
}

function conflictShape(group: ConflictGroup): RepositoryConflictFile['shape'] {
  if ([...group.stages.values()].some((stage) => stage.mode === '160000')) return 'submodule';
  if ([...group.stages.values()].some((stage) => stage.mode === '120000')) return 'symlink';
  if (!group.stages.has(2) && !group.stages.has(3)) return 'both-deleted';
  if (!group.stages.has(2) || !group.stages.has(3)) return 'delete-modify';
  if (!group.stages.has(1)) return 'add-add';
  return 'both-modified';
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
      stdoutEncoding: 'base64',
    });
    const bytes = Buffer.from(result.stdout, 'base64');
    const content = bytes.toString('utf8');
    if (isBinaryText(content, bytes)) return binary(byteLength);
    return { state: 'text', content, byteLength, message: null };
  } catch (error) {
    if (error instanceof GitCommandError) return unavailable('The staged conflict blob could not be read.');
    throw error;
  }
}

async function readWorktreeContent(cwd: string, path: string): Promise<RepositoryConflictContent> {
  let file: SafeWorkingFile | undefined;
  try {
    const target = await checkedWorktreePath(cwd, path);
    const details = await lstat(target).catch(() => undefined);
    if (details?.isFile() && details.size > conflictContentLimit) return tooLarge(details.size);
    file = await readSafeWorkingFile(target);
  } catch {
    return unavailable('The conflicted worktree file could not be read.');
  }
  if (!file) return unavailable('The conflicted worktree file is missing.');
  if (file.bytes.byteLength > conflictContentLimit) return tooLarge(file.bytes.byteLength);
  const content = file.bytes.toString('utf8');
  if (isBinaryText(content, file.bytes)) return binary(file.bytes.byteLength);
  return { state: 'text', content, byteLength: file.bytes.byteLength, message: null };
}

async function readSafeWorkingFile(path: string): Promise<SafeWorkingFile | undefined> {
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!details || !details.isFile() || details.size > conflictReadOutputLimit) return undefined;
  const bytes = await readFile(path);
  return { bytes, mode: details.mode & 0o777 };
}

function safeWorktreePath(cwd: string, path: string): string {
  if (!safeConflictPath.test(path) || path.split('/').some((part) => part.toLowerCase() === '.git'))
    throw new ConflictRequestError('The conflict path is not valid.');
  const root = resolve(cwd);
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new ConflictRequestError('The conflict path is outside the selected repository.');
  }
  return target;
}

async function checkedWorktreePath(cwd: string, path: string, createParents = false): Promise<string> {
  const target = safeWorktreePath(cwd, path);
  const parts = path.split('/');
  let parent = resolve(cwd);
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    if (createParents)
      await mkdir(parent).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    const details = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (details && (!details.isDirectory() || details.isSymbolicLink()))
      throw new ConflictRequestError('A parent of the conflict path is no longer a regular directory.');
  }
  return target;
}

async function workingFingerprint(cwd: string, path: string): Promise<string> {
  const target = await checkedWorktreePath(cwd, path);
  const details = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!details) return 'missing';
  const hash = createHash('sha256').update(
    `${details.mode}:${details.size}:${details.mtimeMs}:${details.ctimeMs}:`,
  );
  if (details.isSymbolicLink()) hash.update(await readlink(target, { encoding: 'buffer' }));
  else if (details.isFile() && details.size <= 256 * 1024 * 1024)
    for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function isBinaryText(content: string, bytes: Buffer): boolean {
  return content.includes('\0') || !Buffer.from(content, 'utf8').equals(bytes);
}

function parseByteLength(value: string): number {
  const byteLength = Number(value);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
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
  return conflictTextRegions(content)
    .slice(0, 1_000)
    .map(({ id, startLine, endLine, base, ours, theirs }) => ({
      id,
      startLine,
      endLine,
      base,
      ours,
      theirs,
    }));
}

export async function readOperationInfo(
  runner: ConflictRunner,
  context: ConflictContext,
): Promise<OperationInfo> {
  const pending = await detectPendingOperation(context.gitDir);
  const currentBranch = await optionalOutput(runner, context.cwd, ['branch', '--show-current']);
  const rebaseBranch =
    pending === 'rebase'
      ? ((await gitDirText(context.gitDir, 'rebase-merge/head-name')) ??
        (await gitDirText(context.gitDir, 'rebase-apply/head-name')))
      : null;
  const current = shortReference(currentBranch ?? rebaseBranch ?? 'current branch');
  if (pending === 'stash') {
    const application = await readStashApplication(context.gitDir);
    return {
      operation: 'stash',
      operationLabel: `Applying stash ${application?.source.slice(0, 7) ?? ''} to '${current}'`,
      oursLabel: `Current '${current}'`,
      theirsLabel: 'Stashed changes',
    };
  }
  if (pending === 'squash')
    return {
      operation: 'merge',
      operationLabel: `Squashing commits into '${current}'`,
      oursLabel: `Current '${current}'`,
      theirsLabel: 'Squashed changes',
    };
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
      operationLabel: `Merging branch '${shortReference(incomingLabel)}' into '${current}'`,
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
    const details = await lstat(join(gitDir, path));
    if (!details.isFile() || details.size > 65_536)
      throw new ConflictRequestError('Git operation metadata could not be read safely.');
    const file = await readFile(join(gitDir, path), 'utf8');
    return file.trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function shortReference(value: string): string {
  return value
    .replace(/^refs\/(heads|remotes|tags)\//u, '')
    .replace(/^undefined\s+/u, '')
    .slice(0, 200);
}

function conflictSnapshot(
  operation: OperationInfo,
  groups: readonly ConflictGroup[],
  selectedPath: string | undefined,
  result: RepositoryConflictContent | null,
  workingHash: string,
): string {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify([
      operation.operation,
      operation.oursLabel,
      operation.theirsLabel,
      selectedPath ?? null,
      workingHash,
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
