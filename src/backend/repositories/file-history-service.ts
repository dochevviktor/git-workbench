import type {
  RepositoryBlame,
  RepositoryBlameLine,
  RepositoryFileHistory,
  RepositoryFileHistoryRevision,
  RepositoryHistoryCommit,
  RepositoryHistoryPerson,
  RepositoryHistoryScope,
} from '../../common/ipc/contracts';
import {
  repositoryBlameSchema,
  repositoryFileHistorySchema,
  repositoryRevisionPathSchema,
  repositoryHistoryScopeSchema,
} from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import type { GitRunOptions, GitCommandResult } from '../git/runner';

const fileHistoryReadTimeoutMs = 20_000;
const fileHistoryReadOutputLimit = 16 * 1024 * 1024;
const maximumFileHistoryRevisions = 2_000;
const maximumBlameBytes = 4 * 1024 * 1024;
const maximumBlameLines = 100_000;
const maximumBlameCommits = 2_000;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const statusPattern = /^(?:[ACDMRTUX?]|[RC]\d{1,3})$/u;

export interface FileHistoryRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReadFileHistoryInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly commitId: string;
  readonly path: string;
  readonly scope?: RepositoryHistoryScope | undefined;
}

export type ReadBlameInput = ReadFileHistoryInput;

interface ParsedFileHistoryChange {
  readonly status: RepositoryFileHistoryRevision['status'];
  readonly path: string;
  readonly previousPath: string | null;
  readonly similarity: number | null;
}

interface ParsedFileHistoryRecord {
  readonly commit: RepositoryHistoryCommit;
  readonly changes: readonly ParsedFileHistoryChange[];
}

type ParsedBlameLine = RepositoryBlameLine;

/** Reads one bounded file timeline. Git's --follow output is kept backend-owned and parsed as data. */
export async function readFileHistory(
  runner: FileHistoryRunner,
  input: ReadFileHistoryInput,
): Promise<RepositoryFileHistory> {
  assertRevisionPath(input.path);
  await ensureCommit(runner, input.cwd, input.commitId);
  const scope = repositoryHistoryScopeSchema.parse(input.scope ?? { kind: 'file' });
  const directory = scope.kind === 'directory';
  let lineCommits: Set<string> | undefined;
  if (scope.kind === 'lines') {
    const bytes = await readHistoricalFile(runner, input);
    if (bytes.includes(0)) throw new FileHistoryPathError('Select lines in a text file.');
    const count =
      bytes.length === 0 ? 0 : bytes.toString('utf8').split('\n').length - (bytes.at(-1) === 10 ? 1 : 0);
    if (scope.end > count) throw new FileHistoryPathError('The selected lines are outside this revision.');
    const output = await runner.run(
      [
        'log',
        '--no-ext-diff',
        '--no-textconv',
        '--no-patch',
        '--format=%H',
        `--max-count=${maximumFileHistoryRevisions + 1}`,
        `-L${scope.start},${scope.end}:${input.path}`,
        input.commitId,
      ],
      readOptions(input.cwd),
    );
    lineCommits = new Set(output.stdout.trim().split('\n').filter(Boolean));
    if ([...lineCommits].some((id) => !objectIdPattern.test(id)))
      throw new Error('Invalid line-history output.');
  }
  if (directory) {
    const type = await runner.run(
      ['cat-file', '-t', `${input.commitId}:${input.path}`],
      readOptions(input.cwd),
    );
    if (type.stdout.trim() !== 'tree') throw new FileHistoryPathError('Select a directory at this revision.');
  }
  const result = await runner.run(
    [
      '-c',
      'core.quotepath=false',
      'log',
      ...(directory ? ['--full-history', '--topo-order'] : ['--follow']),
      '--find-renames',
      '--no-ext-diff',
      '--no-textconv',
      `--max-count=${maximumFileHistoryRevisions + 1}`,
      '--date=iso-strict',
      '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00',
      '--name-status',
      '-z',
      input.commitId,
      '--',
      ...(directory ? [] : [input.path]),
    ],
    readOptions(input.cwd),
  );
  const records = parseFileHistoryLog(result.stdout);
  // Track individual renamed descendants, without inferring that one moved file renamed a directory.
  const followed = new Set<string>();
  const revisions = records.flatMap((record) => {
    if (lineCommits && !lineCommits.has(record.commit.id)) return [];
    if (directory) {
      const changes = record.changes.filter(
        (change) =>
          change.path.startsWith(`${input.path}/`) ||
          followed.has(change.path) ||
          change.previousPath?.startsWith(`${input.path}/`),
      );
      for (const change of changes)
        if (change.previousPath && change.status === 'renamed') {
          followed.delete(change.path);
          followed.add(change.previousPath);
        }
      return changes[0] ? [{ commit: record.commit, ...changes[0], changes }] : [];
    }
    const change = chooseFileHistoryChange(record.changes, input.path);
    return change ? [{ commit: record.commit, ...change }] : [];
  });
  const response = {
    repositoryId: input.repositoryId,
    startingCommitId: input.commitId,
    path: input.path,
    revisions: revisions.slice(0, maximumFileHistoryRevisions),
    truncated: revisions.length > maximumFileHistoryRevisions || records.length > maximumFileHistoryRevisions,
  } satisfies RepositoryFileHistory;
  return repositoryFileHistorySchema.parse(response);
}

/** Exact object bytes, never a worktree read or a checkout. */
export async function readHistoricalFile(
  runner: FileHistoryRunner,
  input: ReadFileHistoryInput,
): Promise<Buffer> {
  assertRevisionPath(input.path);
  await ensureCommit(runner, input.cwd, input.commitId);
  const object = `${input.commitId}:${input.path}`;
  const type = await runner.run(['cat-file', '-t', object], readOptions(input.cwd, 1024));
  if (type.stdout.trim() !== 'blob') throw new FileHistoryPathError('The selected path is not a file.');
  const size = await runner.run(['cat-file', '-s', object], readOptions(input.cwd, 1024));
  if (parseBlobSize(size.stdout.trim()) > 8 * 1024 * 1024)
    throw new FileHistoryPathError('Historical Save As supports files up to 8 MiB.');
  const result = await runner.run(['cat-file', 'blob', object], {
    ...readOptions(input.cwd, 8 * 1024 * 1024),
    stdoutEncoding: 'base64',
  });
  return Buffer.from(result.stdout, 'base64');
}

/** Reads line attribution at a committed revision without reading or changing the checkout. */
export async function readBlame(runner: FileHistoryRunner, input: ReadBlameInput): Promise<RepositoryBlame> {
  assertRevisionPath(input.path);
  await ensureCommit(runner, input.cwd, input.commitId);
  const object = `${input.commitId}:${input.path}`;
  const typeResult = await runner.run(['cat-file', '-t', object], readOptions(input.cwd, 1_024));
  if (typeResult.stdout.trim() !== 'blob')
    throw new FileHistoryPathError('The selected revision path is not a file.');
  const sizeResult = await runner.run(['cat-file', '-s', object], readOptions(input.cwd, 1_024));
  const byteLength = parseBlobSize(sizeResult.stdout.trim());
  if (byteLength > maximumBlameBytes) {
    return repositoryBlameSchema.parse({
      repositoryId: input.repositoryId,
      commitId: input.commitId,
      path: input.path,
      state: 'too-large',
      byteLength,
      commits: [],
      lines: [],
      truncated: false,
      message: 'This file is too large for inline blame.',
    });
  }

  const result = await runner.run(
    [
      '-c',
      'core.quotepath=false',
      'blame',
      '--line-porcelain',
      '-M',
      '-C',
      '-C',
      input.commitId,
      '--',
      input.path,
    ],
    readOptions(input.cwd),
  );
  if (result.stdout.includes('\0')) {
    return repositoryBlameSchema.parse({
      repositoryId: input.repositoryId,
      commitId: input.commitId,
      path: input.path,
      state: 'binary',
      byteLength,
      commits: [],
      lines: [],
      truncated: false,
      message: 'Binary files do not have inline blame.',
    });
  }

  const parsedLines = parseBlamePorcelain(result.stdout);
  const uniqueCommitIds = [...new Set(parsedLines.map((line) => line.commitId))];
  if (uniqueCommitIds.length > maximumBlameCommits) {
    return repositoryBlameSchema.parse({
      repositoryId: input.repositoryId,
      commitId: input.commitId,
      path: input.path,
      state: 'too-large',
      byteLength,
      commits: [],
      lines: [],
      truncated: true,
      message: 'This file has too many attribution groups for inline blame.',
    });
  }
  const commits = await readCommitMetadata(runner, input.cwd, uniqueCommitIds);
  const lines: RepositoryBlameLine[] = parsedLines.slice(0, maximumBlameLines);
  const response = {
    repositoryId: input.repositoryId,
    commitId: input.commitId,
    path: input.path,
    state: 'text' as const,
    byteLength,
    commits,
    lines,
    truncated: parsedLines.length > maximumBlameLines,
    message: null,
  } satisfies RepositoryBlame;
  return repositoryBlameSchema.parse(response);
}

/** Exported for parser-focused tests; it never accepts Git expressions as input. */
export function parseFileHistoryLog(output: string): ParsedFileHistoryRecord[] {
  const fields = output.split('\0');
  const records: ParsedFileHistoryRecord[] = [];
  let cursor = 0;
  while (cursor < fields.length) {
    cursor = skipEmptyFields(fields, cursor);
    const id = normalizeCommitIdField(fields[cursor]);
    if (!id) break;
    if (!objectIdPattern.test(id)) throw new Error('Git returned an invalid file-history commit.');
    const parents = fields[cursor + 1];
    const authorName = fields[cursor + 2];
    const authorEmail = fields[cursor + 3];
    const authorDate = fields[cursor + 4];
    const committerName = fields[cursor + 5];
    const committerEmail = fields[cursor + 6];
    const committerDate = fields[cursor + 7];
    const subject = fields[cursor + 8];
    const body = fields[cursor + 9];
    if (
      parents === undefined ||
      authorName === undefined ||
      authorEmail === undefined ||
      authorDate === undefined ||
      committerName === undefined ||
      committerEmail === undefined ||
      committerDate === undefined ||
      subject === undefined ||
      body === undefined
    ) {
      throw new Error('Git returned an incomplete file-history commit.');
    }
    if (!isObjectIdList(parents) || !isIsoDate(authorDate) || !isIsoDate(committerDate)) {
      throw new Error('Git returned invalid file-history metadata.');
    }
    const commit: RepositoryHistoryCommit = {
      id,
      parents: parents.length === 0 ? [] : parents.split(' ').filter(Boolean),
      author: person(authorName, authorEmail, authorDate),
      committer: person(committerName, committerEmail, committerDate),
      subject,
      body,
      decorations: [],
    };
    cursor += 10;
    const changes: ParsedFileHistoryChange[] = [];
    while (cursor < fields.length) {
      const rawStatus = fields[cursor];
      if (rawStatus === undefined) break;
      const status = normalizeStatus(rawStatus);
      if (status === '') {
        cursor += 1;
        continue;
      }
      const normalizedCommitId = normalizeCommitIdField(status);
      if (normalizedCommitId && objectIdPattern.test(normalizedCommitId)) break;
      if (!statusPattern.test(status)) {
        throw new Error('Git returned an invalid file-history change.');
      }
      const code = status[0];
      if (!code) throw new Error('Git returned an invalid file-history change.');
      if (code === 'R' || code === 'C') {
        const previousPath = fields[cursor + 1];
        const path = fields[cursor + 2];
        if (
          previousPath === undefined ||
          path === undefined ||
          previousPath.length === 0 ||
          path.length === 0
        ) {
          throw new Error('Git returned an incomplete file-history rename.');
        }
        changes.push({
          status: code === 'R' ? 'renamed' : 'copied',
          path,
          previousPath,
          similarity: parseSimilarity(status),
        });
        cursor += 3;
      } else {
        const path = fields[cursor + 1];
        if (path === undefined || path.length === 0)
          throw new Error('Git returned an incomplete file-history path.');
        changes.push({
          status: changeStatus(code),
          path,
          previousPath: null,
          similarity: null,
        });
        cursor += 2;
      }
    }
    records.push({ commit, changes });
  }
  return records;
}

export function parseBlamePorcelain(output: string): ParsedBlameLine[] {
  const lines = output.split('\n');
  const result: ParsedBlameLine[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const header = lines[cursor]?.replace(/\r$/u, '') ?? '';
    if (header.length === 0) {
      cursor += 1;
      continue;
    }
    const match = /^(?<commit>[0-9a-f]{40}|[0-9a-f]{64}) (?<original>\d+) (?<line>\d+)(?: \d+)?$/u.exec(
      header,
    );
    if (!match?.groups?.commit || !match.groups.line) {
      throw new Error('Git returned an invalid blame line header.');
    }
    const line = Number(match.groups.line);
    if (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000) {
      throw new Error('Git returned an invalid blame line number.');
    }
    cursor += 1;
    let content: string | undefined;
    let originalPath: string | undefined;
    while (cursor < lines.length) {
      const metadata = lines[cursor] ?? '';
      if (metadata.startsWith('filename ')) originalPath = decodeGitPath(metadata.slice(9));
      if (metadata.startsWith('\t')) {
        content = metadata.slice(1).replace(/\r$/u, '');
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    if (content === undefined || !originalPath) throw new Error('Git returned an incomplete blame line.');
    result.push({
      line,
      commitId: match.groups.commit,
      content,
      originalPath,
      originalLine: Number(match.groups.original),
    });
  }
  return result;
}

function decodeGitPath(value: string): string {
  if (!value.startsWith('"')) return value;
  const bytes: number[] = [];
  const inner = value.slice(1, -1);
  for (let index = 0; index < inner.length; index++) {
    if (inner[index] !== '\\') {
      const point = inner.codePointAt(index)!;
      bytes.push(...Buffer.from(String.fromCodePoint(point)));
      if (point > 0xffff) index++;
      continue;
    }
    const octal = /^[0-7]{1,3}/u.exec(inner.slice(index + 1))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8));
      index += octal.length;
    } else {
      const char = inner[++index]!;
      bytes.push(
        ...Buffer.from(
          ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07' } as Record<string, string>)[
            char
          ] ?? char,
        ),
      );
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

async function readCommitMetadata(
  runner: FileHistoryRunner,
  cwd: string,
  commitIds: readonly string[],
): Promise<RepositoryHistoryCommit[]> {
  if (commitIds.length === 0) return [];
  const result = await runner.run(
    [
      '-c',
      'core.quotepath=false',
      'log',
      '--no-walk=unsorted',
      '--date=iso-strict',
      '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00',
      ...commitIds,
    ],
    readOptions(cwd),
  );
  return parseCommitMetadata(result.stdout);
}

function parseCommitMetadata(output: string): RepositoryHistoryCommit[] {
  const fields = output.split('\0');
  const commits: RepositoryHistoryCommit[] = [];
  let cursor = 0;
  while (cursor < fields.length) {
    cursor = skipEmptyFields(fields, cursor);
    const id = normalizeCommitIdField(fields[cursor]);
    if (!id) break;
    if (!objectIdPattern.test(id)) throw new Error('Git returned an invalid blame commit.');
    const parents = fields[cursor + 1];
    const authorName = fields[cursor + 2];
    const authorEmail = fields[cursor + 3];
    const authorDate = fields[cursor + 4];
    const committerName = fields[cursor + 5];
    const committerEmail = fields[cursor + 6];
    const committerDate = fields[cursor + 7];
    const subject = fields[cursor + 8];
    const body = fields[cursor + 9];
    if (
      parents === undefined ||
      authorName === undefined ||
      authorEmail === undefined ||
      authorDate === undefined ||
      committerName === undefined ||
      committerEmail === undefined ||
      committerDate === undefined ||
      subject === undefined ||
      body === undefined
    )
      throw new Error('Git returned an incomplete blame commit.');
    if (!isObjectIdList(parents) || !isIsoDate(authorDate) || !isIsoDate(committerDate))
      throw new Error('Git returned invalid blame metadata.');
    commits.push({
      id,
      parents: parents.length === 0 ? [] : parents.split(' ').filter(Boolean),
      author: person(authorName, authorEmail, authorDate),
      committer: person(committerName, committerEmail, committerDate),
      subject,
      body,
      decorations: [],
    });
    cursor += 10;
  }
  return commits;
}

function chooseFileHistoryChange(
  changes: readonly ParsedFileHistoryChange[],
  requestedPath: string,
): ParsedFileHistoryChange | undefined {
  return (
    changes.find((change) => change.path === requestedPath) ??
    changes.find((change) => change.previousPath === requestedPath) ??
    changes[0]
  );
}

function skipEmptyFields(fields: readonly string[], cursor: number): number {
  while (cursor < fields.length) {
    const field = fields[cursor] ?? '';
    if (field.length > 0 && !/^\r?\n$/u.test(field)) break;
    cursor += 1;
  }
  return cursor;
}

function normalizeStatus(value: string): string {
  const match = /^(?:\r?\n)*(?<status>[ACDMRTUX?]|[RC]\d{1,3})$/u.exec(value);
  return match?.groups?.status ?? value;
}

function normalizeCommitIdField(value: string | undefined): string | undefined {
  return value?.replace(/^\r?\n(?=[0-9a-f]{40}(?:[0-9a-f]{24})?\b)/u, '');
}

function person(name: string, email: string, date: string): RepositoryHistoryPerson {
  return { name, email, date };
}

function isObjectIdList(value: string): boolean {
  return value.length === 0 || value.split(' ').every((entry) => objectIdPattern.test(entry));
}

function isIsoDate(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

function parseSimilarity(status: string): number | null {
  const match = /^[RC](\d{1,3})$/u.exec(status);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function changeStatus(code: string): RepositoryFileHistoryRevision['status'] {
  switch (code) {
    case 'A':
      return 'added';
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

async function ensureCommit(runner: FileHistoryRunner, cwd: string, commitId: string): Promise<void> {
  if (!objectIdPattern.test(commitId)) throw new FileHistoryNotFoundError();
  try {
    await runner.run(['cat-file', '-e', `${commitId}^{commit}`], readOptions(cwd, 1_024));
  } catch (error) {
    if (error instanceof GitCommandError) throw new FileHistoryNotFoundError();
    throw error;
  }
}

function assertRevisionPath(path: string): void {
  const parsed = repositoryRevisionPathSchema.safeParse(path);
  if (!parsed.success || path.length === 0)
    throw new FileHistoryPathError('The historical file path is not valid.');
}

function parseBlobSize(value: string): number {
  if (!/^\d+$/u.test(value)) throw new Error('Git returned an invalid historical file size.');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0 || size > 1_000_000_000_000)
    throw new Error('Git returned an unsupported historical file size.');
  return size;
}

function readOptions(cwd: string, maxOutputBytes = fileHistoryReadOutputLimit): GitRunOptions {
  return { cwd, timeoutMs: fileHistoryReadTimeoutMs, maxOutputBytes };
}

export class FileHistoryNotFoundError extends Error {
  constructor() {
    super('The selected historical revision is not available.');
    this.name = 'FileHistoryNotFoundError';
  }
}

export class FileHistoryPathError extends Error {
  constructor(message = 'The selected historical file path is not available.') {
    super(message);
    this.name = 'FileHistoryPathError';
  }
}
