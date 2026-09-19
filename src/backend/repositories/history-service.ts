import type {
  RepositoryHead,
  RepositoryHistoryCommit,
  RepositoryHistoryDecoration,
  RepositoryHistoryFilter,
  RepositoryHistoryPage,
  RepositoryHistoryReference,
  RepositoryHistoryTracking,
  RepositoryStashEntry,
} from '../../common/ipc/contracts';
import { repositoryHistoryPageSchema } from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { readStashes } from './stash-service';

const historyReadTimeoutMs = 15_000;
const historyReadOutputLimit = 8 * 1024 * 1024;
const maxHistoryOffset = 1_000_000;
const commitFieldCount = 10;
const referenceFieldCount = 6;

const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface HistoryRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReadHistoryInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly head: RepositoryHead;
  readonly offset: number;
  readonly limit: number;
  readonly filter?: RepositoryHistoryFilter | undefined;
}

interface RawReference {
  readonly name: string;
  readonly fullName: string;
  readonly target: string;
  readonly kind: RepositoryHistoryReference['kind'];
  readonly isHead: boolean;
  readonly upstreamFullName: string | null;
  readonly upstream: string | null;
}

/** Reads one bounded, machine-formatted history page without exposing Git to the renderer. */
export async function readRepositoryHistory(
  runner: HistoryRunner,
  input: ReadHistoryInput,
): Promise<RepositoryHistoryPage> {
  const filter = input.filter ?? { kind: 'all' as const };
  const stashes = await readStashes(runner, input.cwd);
  const rawHistory = await runner.run(
    historyArguments(input, filter, stashes),
    readOptions(input.cwd, historyReadOutputLimit),
  );
  const parsedCommits = parseCommits(rawHistory.stdout);
  const hasMoreFromGit = parsedCommits.length > input.limit;
  const commitsWithoutLookahead = parsedCommits.slice(0, input.limit);

  const [rawReferences, peeledTargets] = await Promise.all([
    runner.run(
      ['for-each-ref', `--format=${referenceFormat}`],
      readOptions(input.cwd, historyReadOutputLimit),
    ),
    readPeeledTargets(runner, input.cwd),
  ]);
  const parsedReferences = parseReferences(rawReferences.stdout).filter(
    (reference) => reference.fullName !== 'refs/stash',
  );
  const references = createReferences(parsedReferences, peeledTargets, input.head, stashes);
  const tracking = await readTracking(runner, input.cwd, input.head, references, parsedReferences);
  const referencesWithTracking = references.map((reference) =>
    reference.isHead && reference.kind === 'branch'
      ? { ...reference, ahead: tracking.ahead, behind: tracking.behind }
      : reference,
  );
  const commits = addDecorations(commitsWithoutLookahead, referencesWithTracking);
  const canContinue = hasMoreFromGit && input.offset + input.limit <= maxHistoryOffset;

  return repositoryHistoryPageSchema.parse({
    repositoryId: input.repositoryId,
    offset: input.offset,
    commits,
    references: referencesWithTracking,
    head: input.head,
    tracking,
    hasMore: canContinue,
    nextOffset: canContinue ? input.offset + input.limit : null,
  });
}

function historyArguments(
  input: ReadHistoryInput,
  filter: RepositoryHistoryFilter,
  stashes: readonly RepositoryStashEntry[],
): readonly string[] {
  const argumentsList = ['log'];
  if (filter.kind !== 'reference') argumentsList.push('--all');
  argumentsList.push('--topo-order', '--no-decorate', '--no-color');
  if (filter.kind === 'commit-search') {
    // Search text is passed as one argument and treated literally. It never becomes shell code or
    // a regular expression supplied by the renderer.
    argumentsList.push('--fixed-strings', '--regexp-ignore-case', `--grep=${filter.query}`);
  }
  argumentsList.push(
    `--skip=${input.offset}`,
    `--max-count=${input.limit + 1}`,
    `--pretty=format:${commitFormat}`,
  );
  const startingCommit = filter.kind === 'reference' ? filter.target : input.head.commit;
  if (startingCommit) argumentsList.push(startingCommit);
  if (filter.kind === 'all') argumentsList.push(...stashes.map((stash) => stash.commitId));
  argumentsList.push('--');
  return argumentsList;
}

const commitFormat = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s', '%b'].join('%x00') + '%x00';

const referenceFormat =
  ['%(refname)', '%(objectname)', '%(objecttype)', '%(upstream)', '%(upstream:short)', '%(HEAD)'].join(
    '%00',
  ) + '%00';

function readOptions(cwd: string, maxOutputBytes: number): GitRunOptions {
  return { cwd, timeoutMs: historyReadTimeoutMs, maxOutputBytes };
}

function parseCommits(output: string): RepositoryHistoryCommit[] {
  return parseNulRecords(output, commitFieldCount, 'commit').map((fields) => {
    const [
      id,
      parents,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      subject,
      body,
    ] = fields;
    if (!id || !objectIdPattern.test(id)) throw new Error('Git returned an invalid commit ID.');
    if (!authorDate || !committerDate) {
      throw new Error('Git returned incomplete commit metadata.');
    }
    if (!isIsoDate(authorDate) || !isIsoDate(committerDate)) {
      throw new Error('Git returned an invalid commit date.');
    }

    const parentIds = (parents ?? '').split(' ').filter(Boolean);
    if (parentIds.some((parent) => !objectIdPattern.test(parent))) {
      throw new Error('Git returned an invalid parent commit ID.');
    }

    return {
      id,
      parents: parentIds,
      author: { name: authorName ?? '', email: authorEmail ?? '', date: authorDate },
      committer: { name: committerName ?? '', email: committerEmail ?? '', date: committerDate },
      subject: subject ?? '',
      body: body ?? '',
      decorations: [],
    };
  });
}

function parseReferences(output: string): RawReference[] {
  return parseNulRecords(output, referenceFieldCount, 'reference').map((fields) => {
    const [fullName, objectName, objectType, upstreamFullName, upstream, headMarker] = fields;
    if (!fullName || !objectName || !objectIdPattern.test(objectName) || !objectType) {
      throw new Error('Git returned an invalid reference.');
    }
    return {
      fullName,
      name: displayReferenceName(fullName),
      target: objectName,
      kind: referenceKind(fullName),
      isHead: headMarker?.trim() === '*',
      upstreamFullName: upstreamFullName?.trim() || null,
      upstream: upstream?.trim() || null,
    };
  });
}

function createReferences(
  rawReferences: readonly RawReference[],
  peeledTargets: ReadonlyMap<string, string>,
  head: RepositoryHead,
  stashes: readonly RepositoryStashEntry[],
): RepositoryHistoryReference[] {
  // An upstream that no reference resolves to is gone, which marks the branch as stale. Asking
  // `for-each-ref` for `%(upstream:track)` instead would walk history for every branch.
  const existingRefNames = new Set(rawReferences.map((reference) => reference.fullName));
  const references = rawReferences.map(
    (reference) =>
      ({
        name: reference.name,
        fullName: reference.fullName,
        kind: reference.kind,
        target: peeledTargets.get(reference.fullName) ?? reference.target,
        isHead:
          reference.isHead ||
          (head.state === 'branch' && head.name !== null && reference.fullName === `refs/heads/${head.name}`),
        upstream: reference.upstream,
        upstreamGone:
          reference.upstreamFullName !== null && !existingRefNames.has(reference.upstreamFullName),
        ahead: null,
        behind: null,
      }) satisfies RepositoryHistoryReference,
  );

  if (
    head.commit &&
    head.state === 'detached' &&
    !references.some((reference) => reference.fullName === 'HEAD')
  ) {
    references.push({
      name: 'HEAD',
      fullName: 'HEAD',
      kind: 'head',
      target: head.commit,
      isHead: true,
      upstream: null,
      upstreamGone: false,
      ahead: null,
      behind: null,
    });
  }

  const stashReferences = stashes.map(
    (stash) =>
      ({
        name: `${stash.selector}: ${stash.message}`,
        fullName: `refs/git-workbench/stash/${stash.commitId}`,
        kind: 'stash',
        target: stash.commitId,
        isHead: false,
        upstream: null,
        upstreamGone: false,
        ahead: null,
        behind: null,
      }) satisfies RepositoryHistoryReference,
  );
  return [...references, ...stashReferences].sort(compareReferences);
}

async function readPeeledTargets(runner: HistoryRunner, cwd: string): Promise<ReadonlyMap<string, string>> {
  try {
    const result = await runner.run(['show-ref', '--dereference'], readOptions(cwd, historyReadOutputLimit));
    const peeled = new Map<string, string>();
    for (const line of result.stdout.split(/\r?\n/u)) {
      const match = /^(?<target>[0-9a-f]{40}|[0-9a-f]{64}) (?<ref>.+)\^\{\}$/u.exec(line);
      if (match?.groups?.target && match.groups.ref) peeled.set(match.groups.ref, match.groups.target);
    }
    return peeled;
  } catch (error) {
    // show-ref exits 1 for an empty repository. for-each-ref still gives the authoritative empty list.
    if (error instanceof GitCommandError && error.exitCode === 1) return new Map();
    throw error;
  }
}

async function readTracking(
  runner: HistoryRunner,
  cwd: string,
  head: RepositoryHead,
  references: readonly RepositoryHistoryReference[],
  rawReferences: readonly RawReference[],
): Promise<RepositoryHistoryTracking> {
  const currentBranch = references.find((reference) => reference.isHead && reference.kind === 'branch');
  if (!head.commit || !currentBranch?.upstream) {
    return { upstream: currentBranch?.upstream ?? null, ahead: null, behind: null };
  }

  const rawCurrentBranch = rawReferences.find((reference) => reference.fullName === currentBranch.fullName);
  const upstreamRevision = rawCurrentBranch?.upstreamFullName ?? currentBranch.upstream;
  try {
    const result = await runner.run(
      ['rev-list', '--left-right', '--count', `${head.commit}...${upstreamRevision}`],
      readOptions(cwd, 1_024),
    );
    const [aheadText, behindText] = result.stdout.trim().split(/\s+/u);
    const ahead = parseCount(aheadText);
    const behind = parseCount(behindText);
    if (ahead === null || behind === null) {
      return { upstream: currentBranch.upstream, ahead: null, behind: null };
    }
    return { upstream: currentBranch.upstream, ahead, behind };
  } catch {
    // A deleted or inaccessible upstream remains useful as a label, but its counts are unknown.
    return { upstream: currentBranch.upstream, ahead: null, behind: null };
  }
}

function addDecorations(
  commits: readonly RepositoryHistoryCommit[],
  references: readonly RepositoryHistoryReference[],
): RepositoryHistoryCommit[] {
  const commitIds = new Set(commits.map((commit) => commit.id));
  const decorationsByTarget = new Map<string, RepositoryHistoryDecoration[]>();
  for (const reference of references) {
    if (!commitIds.has(reference.target)) continue;
    const decorations = decorationsByTarget.get(reference.target) ?? [];
    decorations.push({
      name: reference.name,
      fullName: reference.fullName,
      kind: reference.kind,
      target: reference.target,
      isHead: reference.isHead,
    });
    decorationsByTarget.set(reference.target, decorations);
  }

  return commits.map((commit) => ({
    ...commit,
    decorations: (decorationsByTarget.get(commit.id) ?? []).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    ),
  }));
}

function parseNulRecords(output: string, fieldCount: number, kind: string): string[][] {
  if (output.length === 0) return [];
  const fields = output.split('\0');
  const records: string[][] = [];
  let cursor = 0;
  while (cursor + fieldCount <= fields.length) {
    const first = stripRecordPrefix(fields[cursor] ?? '');
    if (first.length === 0 && fields.slice(cursor).every((field) => /^[\r\n]*$/u.test(field))) break;
    records.push([first, ...fields.slice(cursor + 1, cursor + fieldCount)]);
    cursor += fieldCount;
  }

  const remainder = fields.slice(cursor).join('\0');
  if (remainder.replace(/^[\r\n]+$/u, '').length > 0) {
    throw new Error(`Git returned an incomplete ${kind} record.`);
  }
  return records;
}

function stripRecordPrefix(value: string): string {
  return value.replace(/^\r?\n/u, '');
}

function isIsoDate(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

function parseCount(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function referenceKind(fullName: string): RepositoryHistoryReference['kind'] {
  if (fullName === 'HEAD') return 'head';
  if (fullName.startsWith('refs/heads/')) return 'branch';
  if (fullName.startsWith('refs/remotes/')) return 'remote';
  if (fullName === 'refs/stash' || fullName.startsWith('refs/stash/')) return 'stash';
  if (fullName.startsWith('refs/tags/')) return 'tag';
  return 'other';
}

function displayReferenceName(fullName: string): string {
  for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
    if (fullName.startsWith(prefix)) return fullName.slice(prefix.length);
  }
  if (fullName === 'refs/stash') return 'stash';
  return fullName;
}

function compareReferences(left: RepositoryHistoryReference, right: RepositoryHistoryReference): number {
  const order: Record<RepositoryHistoryReference['kind'], number> = {
    head: 0,
    branch: 1,
    remote: 2,
    tag: 3,
    stash: 4,
    other: 5,
  };
  return order[left.kind] - order[right.kind] || left.fullName.localeCompare(right.fullName);
}
