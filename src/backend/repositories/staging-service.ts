import { createHash } from 'node:crypto';
import type {
  RepositoryDiscardPreview,
  RepositoryWorkingChangeAction,
  RepositoryWorkingChangeSelection,
  RepositoryWorkingChangeTarget,
} from '../../common/ipc/contracts';
import { readRepositoryDiff } from './diff-service';
import type { DiffRunner } from './diff-service';
import { readWorkingChanges } from './working-tree-service';
import { GitCommandError } from '../git/runner';
import type { GitRunOptions } from '../git/runner';
import { saveDiscardRecovery } from './recovery-service';

const stagingTimeoutMs = 20_000;
const stagingOutputLimit = 512 * 1024;
const maximumPatchBytes = 8 * 1024 * 1024;
const patchContextLines = 3;
/** Keeps one Git invocation's argument list well inside platform limits. */
const pathBatchSize = 100;

export interface StagingRunner extends DiffRunner {
  run(
    args: readonly string[],
    options: GitRunOptions,
  ): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly signal: NodeJS.Signals | null;
  }>;
}

export interface ApplyWorkingChangeInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly action: RepositoryWorkingChangeAction;
  /** Whole-file actions may name several files; a hunk or line selection names exactly one. */
  readonly targets: readonly RepositoryWorkingChangeTarget[];
  readonly snapshot: string | null;
  readonly selection: RepositoryWorkingChangeSelection;
}

export class StaleWorkingSnapshotError extends Error {
  constructor() {
    super('The file changed after its diff was read. Refresh the changes and try again.');
    this.name = 'StaleWorkingSnapshotError';
  }
}

export class WorkingChangeActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkingChangeActionError';
  }
}

interface PatchHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly suffix: string;
  readonly lines: PatchLine[];
}

interface PatchLine {
  readonly kind: 'context' | 'add' | 'remove' | 'note';
  readonly raw: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly oldBefore: number;
  readonly newBefore: number;
}

interface ParsedPatch {
  readonly preamble: readonly string[];
  readonly hunks: readonly PatchHunk[];
}

/**
 * Applies one validated working-tree selection. A hunk or line selection re-reads that file's diff
 * immediately before the mutation, so the renderer's snapshot is a compare-and-swap guard rather than
 * an instruction to trust stale patch text. Whole-file actions revalidate every named file against a
 * fresh status read and then run as one Git invocation per batch.
 */
export async function applyWorkingChange(
  runner: StagingRunner,
  input: ApplyWorkingChangeInput,
): Promise<void> {
  for (const target of input.targets) validateAction(input.action, target, input.selection);

  if (input.selection.kind === 'file') {
    await applyFileTargets(runner, input);
    return;
  }

  const target = input.targets[0];
  if (!target || input.targets.length !== 1 || !input.snapshot) {
    throw new WorkingChangeActionError('A hunk or line action applies to exactly one file.');
  }
  const current = await readRepositoryDiff(runner, {
    repositoryId: input.repositoryId,
    cwd: input.cwd,
    target: { kind: 'working' as const, ...target },
    whitespace: 'normal',
    options: {
      contextLines: input.selection.contextLines,
      entireFile: input.selection.entireFile,
      loadLarge: true,
    },
  });
  if (!current.snapshot || current.snapshot !== input.snapshot) throw new StaleWorkingSnapshotError();
  if (current.state !== 'text') {
    throw new WorkingChangeActionError(
      current.message ?? 'Only textual changes can be selected by hunk or line.',
    );
  }
  const patch = selectPatch(current.content, input.selection);
  if (!patch) throw new WorkingChangeActionError('Select at least one changed line.');
  if (Buffer.byteLength(patch, 'utf8') > maximumPatchBytes) {
    throw new WorkingChangeActionError('The selected patch is too large to apply safely.');
  }
  if (input.action === 'discard') {
    await saveBeforeDiscard(runner, input, 'Discard selected lines');
    const checked = await readRepositoryDiff(runner, {
      repositoryId: input.repositoryId,
      cwd: input.cwd,
      target: { kind: 'working', ...target },
      whitespace: 'normal',
    });
    if (checked.snapshot !== input.snapshot) throw new StaleWorkingSnapshotError();
  }
  await applyPatch(
    runner,
    input.cwd,
    input.action,
    patch,
    input.selection.contextLines === 0 && !input.selection.entireFile,
  );
}

/** Read-only, exact-content preview. The shared snapshot guards every file in a multi-file discard. */
export async function previewDiscard(
  runner: StagingRunner,
  input: Pick<ApplyWorkingChangeInput, 'repositoryId' | 'cwd' | 'targets'> & {
    readonly selection?: RepositoryWorkingChangeSelection | undefined;
  },
): Promise<RepositoryDiscardPreview> {
  if (input.targets.length === 0 || input.targets.length > 100)
    throw new WorkingChangeActionError('Select between 1 and 100 tracked files.');
  const files = [];
  let totalBytes = 0;
  for (const target of input.targets) {
    validateAction('discard', target, { kind: 'file' });
    const selection = input.selection;
    const diff = await readRepositoryDiff(runner, {
      repositoryId: input.repositoryId,
      cwd: input.cwd,
      target: { kind: 'working', ...target },
      whitespace: 'normal',
      options: {
        loadLarge: true,
        ...(selection && selection.kind !== 'file'
          ? { contextLines: selection.contextLines, entireFile: selection.entireFile }
          : {}),
      },
    });
    if (diff.state === 'unavailable' || diff.state === 'too-large')
      throw new WorkingChangeActionError(diff.message ?? 'This file cannot be previewed safely.');
    totalBytes += Buffer.byteLength(diff.content, 'utf8');
    if (totalBytes > maximumPatchBytes)
      throw new WorkingChangeActionError(
        'The selected files exceed the 8 MiB discard preview limit. Select fewer files.',
      );
    files.push(
      selection && selection.kind !== 'file'
        ? { ...diff, content: selectPatch(diff.content, selection) }
        : diff,
    );
  }
  return {
    files,
    snapshot:
      input.selection && input.selection.kind !== 'file'
        ? files[0]!.snapshot!
        : createHash('sha256')
            .update(JSON.stringify(files.map((file) => [file.target, file.snapshot])))
            .digest('hex'),
  };
}

async function saveBeforeDiscard(
  runner: StagingRunner,
  input: ApplyWorkingChangeInput,
  title: string,
): Promise<void> {
  const gitDir = (
    await runner.run(['rev-parse', '--absolute-git-dir'], {
      cwd: input.cwd,
      timeoutMs: stagingTimeoutMs,
      maxOutputBytes: 32768,
    })
  ).stdout.trim();
  await saveDiscardRecovery(
    runner,
    { id: input.repositoryId, cwd: input.cwd, gitDir, head: { state: 'unknown', name: null, commit: null } },
    title,
  );
}

/** Builds a Git patch containing one complete hunk or selected changed lines. */
export function selectPatch(
  content: string,
  selection: Exclude<RepositoryWorkingChangeSelection, { readonly kind: 'file' }>,
): string {
  const parsed = parsePatch(content);
  if (selection.kind === 'hunk') {
    const hunk = parsed.hunks[selection.hunk];
    if (!hunk)
      throw new WorkingChangeActionError('That diff hunk is no longer available. Refresh and try again.');
    return finishPatch(parsed.preamble, [hunk.header, ...hunk.lines.map((line) => line.raw)]);
  }

  const hunk = parsed.hunks[selection.hunk];
  if (!hunk)
    throw new WorkingChangeActionError('That diff hunk is no longer available. Refresh and try again.');
  const selected = new Set(selection.lineIndexes);
  const invalid = [...selected].some((index) => {
    const line = hunk.lines[index];
    return !line || (line.kind !== 'add' && line.kind !== 'remove');
  });
  if (invalid) throw new WorkingChangeActionError('Only added or removed lines can be selected.');
  const changedSelection = [...selected].filter((index) => {
    const line = hunk.lines[index];
    return line?.kind === 'add' || line?.kind === 'remove';
  });
  if (changedSelection.length === 0) return '';

  const firstGroup = changedGroupForIndex(hunk.lines, Math.min(...changedSelection));
  const lastGroup = changedGroupForIndex(hunk.lines, Math.max(...changedSelection));
  if (!firstGroup || !lastGroup) return '';
  const start = Math.max(0, firstGroup.start - contextBefore(hunk.lines, firstGroup.start));
  const end = Math.min(hunk.lines.length, lastGroup.end + contextAfter(hunk.lines, lastGroup.end));
  const output: PatchLine[] = [];
  let index = start;
  while (index < end) {
    const line = hunk.lines[index]!;
    if (line.kind === 'note') {
      if (output.length > 0) output.push(line);
      index += 1;
      continue;
    }
    if (line.kind === 'context') {
      output.push(line);
      index += 1;
      continue;
    }
    const group = changedGroupForIndex(hunk.lines, index);
    if (!group) {
      index += 1;
      continue;
    }
    output.push(...selectedGroupLines(hunk.lines, group.start, group.end, selected));
    index = group.end;
  }
  const changedOutput = output.filter((line) => line.kind === 'add' || line.kind === 'remove');
  if (changedOutput.length === 0) return '';
  const header = selectedHunkHeader(hunk, output);
  return finishPatch(parsed.preamble, [header, ...output.map((line) => line.raw)]);
}

function validateAction(
  action: RepositoryWorkingChangeAction,
  target: RepositoryWorkingChangeTarget,
  selection: RepositoryWorkingChangeSelection,
): void {
  if (target.area === 'ignored') {
    throw new WorkingChangeActionError('Ignored files cannot be staged or discarded from this view.');
  }
  if (action === 'stage' && target.area !== 'unstaged' && target.area !== 'untracked') {
    throw new WorkingChangeActionError('Only unstaged files can be staged.');
  }
  if (action === 'unstage' && target.area !== 'staged') {
    throw new WorkingChangeActionError('Only staged files can be unstaged.');
  }
  if (action === 'discard' && target.area !== 'unstaged') {
    throw new WorkingChangeActionError('Only unstaged tracked files can be discarded by hunk or line.');
  }
  if (selection.kind !== 'file' && target.area === 'untracked') {
    throw new WorkingChangeActionError('Untracked files can only be staged as a complete file.');
  }
  if (selection.kind !== 'file' && target.area === 'staged' && action !== 'unstage') {
    throw new WorkingChangeActionError('That selection is not valid for the staged changes pane.');
  }
}

async function applyFileTargets(runner: StagingRunner, input: ApplyWorkingChangeInput): Promise<void> {
  if (input.action === 'discard') {
    const preview = await previewDiscard(runner, input);
    if (!input.snapshot || preview.snapshot !== input.snapshot) throw new StaleWorkingSnapshotError();
    await saveBeforeDiscard(
      runner,
      input,
      `Discard ${input.targets.length} selected file${input.targets.length === 1 ? '' : 's'}`,
    );
    // A concurrent external edit during backup must not be overwritten.
    if ((await previewDiscard(runner, input)).snapshot !== input.snapshot)
      throw new StaleWorkingSnapshotError();
    const paths = [
      ...new Set(input.targets.flatMap((target) => uniquePaths(target.previousPath, target.path))),
    ];
    await runMutation(runner, input.cwd, ['restore', '--worktree', '--', ...paths]);
    return;
  }

  await ensureTargetsCurrent(runner, input);
  if (input.snapshot && input.targets.length === 1 && input.targets[0]) {
    // A single file staged from its diff keeps the exact content guard the renderer was shown.
    const current = await readRepositoryDiff(runner, {
      repositoryId: input.repositoryId,
      cwd: input.cwd,
      target: { kind: 'working' as const, ...input.targets[0] },
      whitespace: 'normal',
    });
    if (!current.snapshot || current.snapshot !== input.snapshot) throw new StaleWorkingSnapshotError();
  }

  const paths = [
    ...new Set(input.targets.flatMap((target) => uniquePaths(target.previousPath, target.path))),
  ];
  // `git reset <paths>` needs a HEAD. An unborn repository has only index additions, which can be
  // safely removed from the index with `rm --cached` while leaving the working file intact.
  const hasHead = input.action === 'stage' || (await repositoryHasHead(runner, input.cwd));
  for (const batch of batches(paths, pathBatchSize)) {
    const args =
      input.action === 'stage'
        ? ['add', '--', ...batch]
        : hasHead
          ? ['reset', '--quiet', '--', ...batch]
          : ['rm', '--cached', '--quiet', '--', ...batch];
    await runMutation(runner, input.cwd, args);
  }
}

/**
 * Whole-file actions do not depend on the exact bytes the renderer displayed, but they must still act
 * on the files the user actually selected, in the area they were selected from.
 */
async function ensureTargetsCurrent(runner: StagingRunner, input: ApplyWorkingChangeInput): Promise<void> {
  const changes = await readWorkingChanges(runner, {
    repositoryId: input.repositoryId,
    cwd: input.cwd,
    includeUntracked: true,
    includeIgnored: false,
  });
  const missing = input.targets.filter(
    (target) =>
      !changes[target.area].some(
        (change) => change.path === target.path && change.previousPath === target.previousPath,
      ),
  );
  if (missing.length === 0) return;
  const [first] = missing;
  throw new WorkingChangeActionError(
    missing.length === 1 && first
      ? `${first.path} is no longer among the ${first.area} changes. Refresh and try again.`
      : `${missing.length} selected files are no longer in the expected changes. Refresh and try again.`,
  );
}

function batches<Value>(values: readonly Value[], size: number): Value[][] {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function repositoryHasHead(runner: StagingRunner, cwd: string): Promise<boolean> {
  try {
    await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd,
      timeoutMs: stagingTimeoutMs,
      maxOutputBytes: 1_024,
    });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

async function applyPatch(
  runner: StagingRunner,
  cwd: string,
  action: RepositoryWorkingChangeAction,
  patch: string,
  zeroContext = false,
): Promise<void> {
  const args = ['apply', '--recount', '--whitespace=nowarn'];
  if (zeroContext) args.push('--unidiff-zero');
  if (action === 'stage' || action === 'unstage') args.push('--cached');
  if (action === 'unstage' || action === 'discard') args.push('--reverse');
  await runMutation(runner, cwd, args, patch);
}

async function runMutation(
  runner: StagingRunner,
  cwd: string,
  args: readonly string[],
  stdin?: string,
): Promise<void> {
  await runner.run(args, {
    cwd,
    timeoutMs: stagingTimeoutMs,
    maxOutputBytes: stagingOutputLimit,
    ...(stdin === undefined ? {} : { stdin }),
  });
}

function uniquePaths(previousPath: string | null, path: string): string[] {
  return [...new Set([previousPath, path].filter((candidate): candidate is string => candidate !== null))];
}

function parsePatch(content: string): ParsedPatch {
  const source = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lines = source ? source.split('\n') : [];
  const firstHunk = lines.findIndex((line) => line.startsWith('@@ -'));
  if (firstHunk < 0) throw new WorkingChangeActionError('The selected diff has no textual hunks.');
  const preamble = lines.slice(0, firstHunk);
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | undefined;
  let oldCursor = 0;
  let newCursor = 0;
  for (const line of lines.slice(firstHunk)) {
    const header = parseHunkHeader(line);
    if (header) {
      current = {
        header: line,
        oldStart: header.oldStart,
        newStart: header.newStart,
        suffix: header.suffix,
        lines: [],
      };
      oldCursor = header.oldStart;
      newCursor = header.newStart;
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line === '\\ No newline at end of file') {
      current.lines.push({
        kind: 'note',
        raw: line,
        oldLine: null,
        newLine: null,
        oldBefore: oldCursor,
        newBefore: newCursor,
      });
      continue;
    }
    const prefix = line[0];
    if (prefix === ' ') {
      current.lines.push({
        kind: 'context',
        raw: line,
        oldLine: oldCursor,
        newLine: newCursor,
        oldBefore: oldCursor,
        newBefore: newCursor,
      });
      oldCursor += 1;
      newCursor += 1;
    } else if (prefix === '-') {
      current.lines.push({
        kind: 'remove',
        raw: line,
        oldLine: oldCursor,
        newLine: null,
        oldBefore: oldCursor,
        newBefore: newCursor,
      });
      oldCursor += 1;
    } else if (prefix === '+') {
      current.lines.push({
        kind: 'add',
        raw: line,
        oldLine: null,
        newLine: newCursor,
        oldBefore: oldCursor,
        newBefore: newCursor,
      });
      newCursor += 1;
    } else {
      throw new WorkingChangeActionError('Git returned a diff with an invalid hunk line.');
    }
  }
  return { preamble, hunks };
}

function parseHunkHeader(
  line: string,
): { readonly oldStart: number; readonly newStart: number; readonly suffix: string } | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u.exec(line);
  if (!match?.[1] || !match[3]) return undefined;
  return { oldStart: Number(match[1]), newStart: Number(match[3]), suffix: match[5] ?? '' };
}

function changedGroupForIndex(
  lines: readonly PatchLine[],
  index: number,
): { start: number; end: number } | undefined {
  const line = lines[index];
  if (!line || (line.kind !== 'add' && line.kind !== 'remove')) return undefined;
  let start = index;
  while (start > 0 && lines[start - 1]!.kind !== 'context') start -= 1;
  let end = index + 1;
  while (end < lines.length && lines[end]!.kind !== 'context') end += 1;
  return { start, end };
}

function contextBefore(lines: readonly PatchLine[], start: number): number {
  let count = 0;
  for (
    let index = start - 1;
    index >= 0 && lines[index]!.kind === 'context' && count < patchContextLines;
    index -= 1
  ) {
    count += 1;
  }
  return count;
}

function contextAfter(lines: readonly PatchLine[], end: number): number {
  let count = 0;
  for (
    let index = end;
    index < lines.length && lines[index]!.kind === 'context' && count < patchContextLines;
    index += 1
  ) {
    count += 1;
  }
  return count;
}

function selectedHunkHeader(hunk: PatchHunk, lines: readonly PatchLine[]): string {
  const first = lines.find((line) => line.kind !== 'note');
  if (!first) return hunk.header;
  const oldStart = first.oldLine ?? first.oldBefore;
  const newStart = first.newLine ?? first.newBefore;
  const oldCount = lines.reduce(
    (count, line) => count + Number(line.kind === 'context' || line.kind === 'remove'),
    0,
  );
  const newCount = lines.reduce(
    (count, line) => count + Number(line.kind === 'context' || line.kind === 'add'),
    0,
  );
  return `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@${hunk.suffix}`;
}

function selectedGroupLines(
  lines: readonly PatchLine[],
  start: number,
  end: number,
  selected: ReadonlySet<number>,
): PatchLine[] {
  const removals = lines
    .slice(start, end)
    .map((line, offset) => ({ line, index: start + offset }))
    .filter(
      (entry): entry is { readonly line: PatchLine; readonly index: number } => entry.line.kind === 'remove',
    );
  const additions = lines
    .slice(start, end)
    .map((line, offset) => ({ line, index: start + offset }))
    .filter(
      (entry): entry is { readonly line: PatchLine; readonly index: number } => entry.line.kind === 'add',
    );
  const notes = new Map<number, PatchLine[]>();
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    if (line.kind !== 'note') continue;
    const previous = lines[index - 1];
    if (!previous) continue;
    const previousNotes = notes.get(index - 1) ?? [];
    previousNotes.push(line);
    notes.set(index - 1, previousNotes);
  }

  const output: PatchLine[] = [];
  const pairCount = Math.max(removals.length, additions.length);
  for (let pair = 0; pair < pairCount; pair += 1) {
    const removal = removals[pair];
    const addition = additions[pair];
    if (removal) {
      const removalSelected = selected.has(removal.index);
      const rendered = removalSelected
        ? removal.line
        : {
            ...removal.line,
            kind: 'context' as const,
            raw: ` ${removal.line.raw.slice(1)}`,
            newLine: removal.line.oldLine,
          };
      output.push(rendered);
      output.push(...(notes.get(removal.index) ?? []));
    }
    if (addition && selected.has(addition.index)) {
      output.push(addition.line);
      output.push(...(notes.get(addition.index) ?? []));
    }
  }
  return output;
}

function formatRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function finishPatch(preamble: readonly string[], hunk: readonly string[]): string {
  return [...preamble, ...hunk].join('\n') + '\n';
}
