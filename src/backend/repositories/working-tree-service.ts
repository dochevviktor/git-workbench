import type {
  RepositoryWorkingChange,
  RepositoryWorkingChangeArea,
  RepositoryWorkingChanges,
} from '../../common/ipc/contracts';
import { repositoryWorkingChangesSchema } from '../../common/ipc/contracts';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

const workingTreeReadTimeoutMs = 10_000;
const workingTreeReadOutputLimit = 4 * 1024 * 1024;
const workingChangeLimit = 10_000;
const zeroObjectIdPattern = /^0+$/u;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const modePattern = /^\d{6}$/u;

export interface WorkingTreeRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReadWorkingChangesInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly includeUntracked: boolean;
  readonly includeIgnored: boolean;
}

interface RawWorkingChange {
  readonly kind: 'tracked' | 'unmerged' | 'untracked' | 'ignored';
  readonly path: string;
  readonly previousPath: string | null;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
  readonly headMode: string | null;
  readonly indexMode: string | null;
  readonly worktreeMode: string | null;
  readonly headObjectId: string | null;
  readonly indexObjectId: string | null;
  readonly similarity: number | null;
}

interface ParsedPrefix {
  readonly tokens: readonly string[];
  readonly path: string;
}

/** Reads bounded porcelain-v2 status data without exposing Git arguments to the renderer. */
export async function readWorkingChanges(
  runner: WorkingTreeRunner,
  input: ReadWorkingChangesInput,
): Promise<RepositoryWorkingChanges> {
  const args = [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    input.includeUntracked ? '--untracked-files=all' : '--untracked-files=no',
  ];
  if (input.includeIgnored) args.push('--ignored=matching');
  args.push('-z', '--');

  const result = await runner.run(args, {
    cwd: input.cwd,
    timeoutMs: workingTreeReadTimeoutMs,
    maxOutputBytes: workingTreeReadOutputLimit,
  });
  const records = parseWorkingTreeStatus(result.stdout);
  const staged: RepositoryWorkingChange[] = [];
  const unstaged: RepositoryWorkingChange[] = [];
  const untracked: RepositoryWorkingChange[] = [];
  const ignored: RepositoryWorkingChange[] = [];
  const conflicted = new Set<string>();

  for (const record of records) {
    if (record.kind === 'untracked') {
      untracked.push(toChange(record, 'untracked', '?'));
      continue;
    }
    if (record.kind === 'ignored') {
      ignored.push(toChange(record, 'ignored', '!'));
      continue;
    }

    if (record.kind === 'unmerged') {
      const key = `${record.path}\0${record.previousPath ?? ''}`;
      conflicted.add(key);
      staged.push(toChange(record, 'staged', 'U'));
      unstaged.push(toChange(record, 'unstaged', 'U'));
      continue;
    }

    const indexCode = record.indexStatus;
    const worktreeCode = record.worktreeStatus;
    if (indexCode !== '.') staged.push(toChange(record, 'staged', indexCode));
    if (worktreeCode !== '.') unstaged.push(toChange(record, 'unstaged', worktreeCode));
  }

  const response = {
    repositoryId: input.repositoryId,
    staged: staged.slice(0, workingChangeLimit),
    unstaged: unstaged.slice(0, workingChangeLimit),
    untracked: untracked.slice(0, workingChangeLimit),
    ignored: ignored.slice(0, workingChangeLimit),
    counts: {
      staged: boundedCount(staged.length),
      unstaged: boundedCount(unstaged.length),
      untracked: boundedCount(untracked.length),
      ignored: boundedCount(ignored.length),
      conflicted: boundedCount(conflicted.size),
    },
    truncated:
      staged.length > workingChangeLimit ||
      unstaged.length > workingChangeLimit ||
      untracked.length > workingChangeLimit ||
      ignored.length > workingChangeLimit,
  } satisfies RepositoryWorkingChanges;
  return repositoryWorkingChangesSchema.parse(response);
}

/** Parses NUL-delimited porcelain-v2 records; paths remain opaque strings. */
export function parseWorkingTreeStatus(output: string): RawWorkingChange[] {
  const records = output.split('\0');
  const changes: RawWorkingChange[] = [];
  for (let cursor = 0; cursor < records.length; cursor += 1) {
    const record = records[cursor] ?? '';
    if (record.length === 0 || record.startsWith('#')) continue;

    switch (record[0]) {
      case '1': {
        const parsed = parsePrefix(record, 8);
        const [type, pair, , headMode, indexMode, worktreeMode, headObjectId, indexObjectId] = parsed.tokens;
        if (
          type !== '1' ||
          !pair ||
          !headMode ||
          !indexMode ||
          !worktreeMode ||
          !headObjectId ||
          !indexObjectId
        ) {
          throw new Error('Git returned an incomplete working-tree record.');
        }
        const statuses = parseStatusPair(pair);
        changes.push({
          kind: 'tracked',
          path: parsed.path,
          previousPath: null,
          indexStatus: statuses.index,
          worktreeStatus: statuses.worktree,
          headMode: parseMode(headMode),
          indexMode: parseMode(indexMode),
          worktreeMode: parseMode(worktreeMode),
          headObjectId: parseObjectId(headObjectId),
          indexObjectId: parseObjectId(indexObjectId),
          similarity: null,
        });
        break;
      }
      case '2': {
        const parsed = parsePrefix(record, 9);
        const [type, pair, , headMode, indexMode, worktreeMode, headObjectId, indexObjectId, renameToken] =
          parsed.tokens;
        const previousPath = records[++cursor];
        if (
          type !== '2' ||
          !pair ||
          !headMode ||
          !indexMode ||
          !worktreeMode ||
          !headObjectId ||
          !indexObjectId ||
          !renameToken ||
          !previousPath
        ) {
          throw new Error('Git returned an incomplete rename/copy record.');
        }
        const statuses = parseStatusPair(pair);
        const renameCode = renameToken[0];
        if (renameCode !== 'R' && renameCode !== 'C') {
          throw new Error('Git returned an invalid rename/copy record.');
        }
        changes.push({
          kind: 'tracked',
          path: parsed.path,
          previousPath,
          indexStatus: statuses.index,
          worktreeStatus: statuses.worktree,
          headMode: parseMode(headMode),
          indexMode: parseMode(indexMode),
          worktreeMode: parseMode(worktreeMode),
          headObjectId: parseObjectId(headObjectId),
          indexObjectId: parseObjectId(indexObjectId),
          similarity: parseSimilarity(renameToken),
        });
        break;
      }
      case 'u': {
        const parsed = parsePrefix(record, 10);
        const [
          type,
          pair,
          ,
          firstMode,
          secondMode,
          thirdMode,
          worktreeMode,
          firstObjectId,
          secondObjectId,
          thirdObjectId,
        ] = parsed.tokens;
        if (
          type !== 'u' ||
          !pair ||
          !firstMode ||
          !secondMode ||
          !thirdMode ||
          !worktreeMode ||
          !firstObjectId ||
          !secondObjectId ||
          !thirdObjectId
        ) {
          throw new Error('Git returned an incomplete conflict record.');
        }
        const statuses = parseStatusPair(pair);
        parseMode(firstMode);
        parseMode(secondMode);
        parseMode(thirdMode);
        parseMode(worktreeMode);
        parseObjectId(firstObjectId);
        parseObjectId(secondObjectId);
        parseObjectId(thirdObjectId);
        changes.push({
          kind: 'unmerged',
          path: parsed.path,
          previousPath: null,
          indexStatus: statuses.index,
          worktreeStatus: statuses.worktree,
          headMode: null,
          indexMode: null,
          worktreeMode: parseMode(worktreeMode),
          headObjectId: null,
          indexObjectId: null,
          similarity: null,
        });
        break;
      }
      case '?':
        changes.push(untrackedRecord(record.slice(2)));
        break;
      case '!':
        changes.push(ignoredRecord(record.slice(2)));
        break;
      default:
        throw new Error('Git returned an invalid working-tree record.');
    }
  }
  return changes;
}

function parsePrefix(record: string, tokenCount: number): ParsedPrefix {
  const tokens: string[] = [];
  let cursor = 0;
  for (let index = 0; index < tokenCount; index += 1) {
    const separator = record.indexOf(' ', cursor);
    if (separator < 0) throw new Error('Git returned an incomplete working-tree record.');
    const token = record.slice(cursor, separator);
    if (!token) throw new Error('Git returned an invalid working-tree field.');
    tokens.push(token);
    cursor = separator + 1;
  }
  const path = record.slice(cursor);
  if (!path) throw new Error('Git returned an empty working-tree path.');
  return { tokens, path };
}

function parseStatusPair(pair: string): { readonly index: string; readonly worktree: string } {
  if (pair.length !== 2) throw new Error('Git returned an invalid working-tree status.');
  return { index: normalizeStatusCode(pair[0]!), worktree: normalizeStatusCode(pair[1]!) };
}

function normalizeStatusCode(code: string): string {
  if (code === ' ') return '.';
  if (/^[.ACDMRTUX?!]$/u.test(code)) return code;
  return 'X';
}

function parseMode(value: string): string | null {
  if (!modePattern.test(value)) throw new Error('Git returned an invalid working-tree mode.');
  return value === '000000' ? null : value;
}

function parseObjectId(value: string): string | null {
  if (zeroObjectIdPattern.test(value)) return null;
  if (!objectIdPattern.test(value)) throw new Error('Git returned an invalid working-tree object ID.');
  return value;
}

function parseSimilarity(value: string): number | null {
  const match = /^[RC](\d{1,3})$/u.exec(value);
  if (!match?.[1]) return null;
  const similarity = Number(match[1]);
  return Number.isInteger(similarity) && similarity >= 0 && similarity <= 100 ? similarity : null;
}

function untrackedRecord(path: string): RawWorkingChange {
  if (!path) throw new Error('Git returned an empty untracked path.');
  return {
    kind: 'untracked',
    path,
    previousPath: null,
    indexStatus: '?',
    worktreeStatus: '?',
    headMode: null,
    indexMode: null,
    worktreeMode: null,
    headObjectId: null,
    indexObjectId: null,
    similarity: null,
  };
}

function ignoredRecord(path: string): RawWorkingChange {
  if (!path) throw new Error('Git returned an empty ignored path.');
  return {
    kind: 'ignored',
    path,
    previousPath: null,
    indexStatus: '!',
    worktreeStatus: '!',
    headMode: null,
    indexMode: null,
    worktreeMode: null,
    headObjectId: null,
    indexObjectId: null,
    similarity: null,
  };
}

function toChange(
  record: RawWorkingChange,
  area: RepositoryWorkingChangeArea,
  code: string,
): RepositoryWorkingChange {
  const status = record.kind === 'unmerged' ? 'unmerged' : statusForCode(record.kind, code);
  const staged = area === 'staged';
  const unstaged = area === 'unstaged';
  return {
    area,
    status,
    statusCode: code,
    indexStatus: record.indexStatus,
    worktreeStatus: record.worktreeStatus,
    path: record.path,
    previousPath: record.previousPath,
    similarity: record.similarity,
    oldMode: staged ? record.headMode : unstaged ? record.indexMode : null,
    newMode: staged ? record.indexMode : unstaged ? record.worktreeMode : null,
    oldObjectId: staged ? record.headObjectId : unstaged ? record.indexObjectId : null,
    // Porcelain-v2 does not expose a worktree object ID without reading the file contents.
    newObjectId: staged ? record.indexObjectId : null,
  };
}

function statusForCode(kind: RawWorkingChange['kind'], code: string): RepositoryWorkingChange['status'] {
  if (kind === 'untracked') return 'untracked';
  if (kind === 'ignored') return 'ignored';
  switch (code) {
    case 'A':
      return 'added';
    case 'C':
      return 'copied';
    case 'D':
      return 'deleted';
    case 'M':
      return 'modified';
    case 'R':
      return 'renamed';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    default:
      return 'unknown';
  }
}

function boundedCount(value: number): number {
  return Math.min(value, 100_000);
}
