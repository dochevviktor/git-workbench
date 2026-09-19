import { createHash } from 'node:crypto';
import type {
  RepositoryBranch,
  RepositoryHead,
  RepositoryReferenceAction,
  RepositoryReferenceActionKind,
  RepositoryReferenceActionResult,
  RepositoryReferenceContext,
  RepositoryReferenceFailureReason,
  RepositoryReferenceStartPoint,
  RepositoryTag,
} from '../../common/ipc/contracts';
import {
  repositoryReferenceActionResultSchema,
  repositoryReferenceContextSchema,
} from '../../common/ipc/contracts';
import { GitCommandError, GitTimeoutError, redactUrlCredentials } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { detectPendingOperation } from './commit-service';
import { readWorkingChanges } from './working-tree-service';

const referenceReadTimeoutMs = 15_000;
const referenceReadOutputLimit = 8 * 1024 * 1024;
/** A checkout writes the working tree and can run filters and post-checkout hooks. */
const referenceWriteTimeoutMs = 120_000;
const referenceWriteOutputLimit = 1024 * 1024;
const branchLimit = 10_000;
const tagLimit = 10_000;
const remoteLimit = 1_000;
const remoteBranchLimit = 5_000;
const outputDisplayLimit = 64 * 1024;
const blockedPathLimit = 200;
const messageLimit = 512;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface ReferenceRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface ReferenceContextInput {
  readonly repositoryId: string;
  readonly cwd: string;
  /** This worktree's Git directory; a pending merge or rebase is per-worktree state. */
  readonly gitDir: string;
  /** The worktree this tab shows, so a branch checked out here is not reported as another's. */
  readonly worktreePath: string;
  readonly head: RepositoryHead;
}

export interface ReferenceActionInput extends ReferenceContextInput {
  readonly onCommand?: ((args: readonly string[]) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly action: RepositoryReferenceAction;
  readonly snapshot: string;
}

export class StaleReferenceSnapshotError extends Error {
  constructor() {
    super('The repository references changed after they were read. Refresh and try again.');
    this.name = 'StaleReferenceSnapshotError';
  }
}

interface RawBranch {
  readonly fullName: string;
  readonly name: string;
  readonly target: string;
  readonly upstreamShort: string | null;
  readonly upstreamFullName: string | null;
  readonly upstreamRemote: string | null;
  readonly upstreamBranch: string | null;
  readonly track: string | null;
  readonly isHead: boolean;
}

/**
 * Reads the branches, tags, remotes, worktree checkouts, and working-tree state that the branch and
 * tag workflows need, plus a compare-and-swap token over the parts a mutation depends on.
 */
export async function readReferenceContext(
  runner: ReferenceRunner,
  input: ReferenceContextInput,
): Promise<RepositoryReferenceContext> {
  const [rawBranches, rawTags, rawRemoteBranches, remotes, worktrees, merged, pendingOperation, changes] =
    await Promise.all([
      readBranches(runner, input.cwd),
      readTags(runner, input.cwd),
      readRemoteBranchNames(runner, input.cwd),
      readRemotes(runner, input.cwd),
      readWorktreeBranches(runner, input.cwd),
      readMergedBranches(runner, input.cwd, input.head),
      detectPendingOperation(input.gitDir),
      readWorkingChanges(runner, {
        repositoryId: input.repositoryId,
        cwd: input.cwd,
        includeUntracked: true,
        includeIgnored: false,
      }),
    ]);

  const branches = rawBranches.slice(0, branchLimit).map((branch): RepositoryBranch => {
    const isHead =
      branch.isHead ||
      (input.head.state === 'branch' && `refs/heads/${input.head.name ?? ''}` === branch.fullName);
    return {
      name: branch.name,
      fullName: branch.fullName,
      target: branch.target,
      isHead,
      upstream: branch.upstreamShort,
      upstreamFullName: branch.upstreamFullName,
      upstreamRemote: branch.upstreamRemote,
      upstreamBranch: branch.upstreamBranch,
      upstreamGone: branch.track === 'gone',
      ...parseTracking(branch.track, branch.upstreamShort !== null),
      // This worktree's own branch is never another worktree's, even where the two recorded paths
      // differ, such as a worktree reached through a symbolic link.
      worktreePath: isHead ? null : otherWorktree(worktrees.get(branch.fullName), input.worktreePath),
      merged: merged.has(branch.fullName),
    };
  });

  return repositoryReferenceContextSchema.parse({
    repositoryId: input.repositoryId,
    head: input.head,
    branches,
    tags: rawTags.slice(0, tagLimit),
    remotes: remotes.slice(0, remoteLimit),
    remoteBranches: rawRemoteBranches.slice(0, remoteBranchLimit),
    dirty: changes.counts.staged > 0 || changes.counts.unstaged > 0,
    untrackedCount: changes.counts.untracked,
    conflictedCount: changes.counts.conflicted,
    pendingOperation,
    truncated:
      rawBranches.length > branchLimit ||
      rawTags.length > tagLimit ||
      remotes.length > remoteLimit ||
      rawRemoteBranches.length > remoteBranchLimit,
    snapshot: referenceSnapshot(input.head, branches, rawTags.slice(0, tagLimit)),
  } satisfies RepositoryReferenceContext);
}

/**
 * Creates, renames, deletes, checks out, or retargets one reference. The context is read again here,
 * inside the caller's per-repository mutation queue, so the renderer's token is a compare-and-swap
 * guard; a refusal Git or this service can foresee comes back as a structured result, not an error.
 */
export async function applyReferenceAction(
  runner: ReferenceRunner,
  input: ReferenceActionInput,
): Promise<RepositoryReferenceActionResult> {
  const context = await readReferenceContext(runner, input);
  if (context.snapshot !== input.snapshot) throw new StaleReferenceSnapshotError();

  const action = input.action;
  const refusal = await refuseAction(runner, input.cwd, context, action);
  if (refusal) {
    return blocked(input.repositoryId, action.kind, refusal.reason, refusal.message, refusal.canForce);
  }

  const plan = planAction(context, action);
  if ('reason' in plan) {
    return blocked(input.repositoryId, action.kind, plan.reason, plan.message, false);
  }

  let result: GitCommandResult;
  input.onCommand?.(plan.args);
  try {
    result = await runner.run(plan.args, {
      cwd: input.cwd,
      timeoutMs: plan.write ? referenceWriteTimeoutMs : referenceReadTimeoutMs,
      maxOutputBytes: referenceWriteOutputLimit,
      signal: input.signal,
      ...(plan.stdin === undefined ? {} : { stdin: plan.stdin }),
    });
  } catch (error) {
    if (error instanceof GitTimeoutError) {
      return blocked(
        input.repositoryId,
        action.kind,
        'other',
        'Git was stopped before it reported the result. Refresh the repository to see what changed.',
        false,
      );
    }
    if (!(error instanceof GitCommandError)) throw error;
    const output = displayOutput(error.stdout, error.stderr);
    const failure = classifyFailure(action, output);
    return repositoryReferenceActionResultSchema.parse({
      status: 'blocked',
      repositoryId: input.repositoryId,
      kind: action.kind,
      reason: failure.reason,
      message: boundedMessage(failure.message),
      output,
      canForce: failure.canForce,
      paths: blockedPaths(output),
    } satisfies RepositoryReferenceActionResult);
  }

  return repositoryReferenceActionResultSchema.parse({
    status: 'applied',
    repositoryId: input.repositoryId,
    kind: action.kind,
    message: boundedMessage(plan.message),
    output: displayOutput(result.stdout, result.stderr),
    head: await readHead(runner, input.cwd),
  } satisfies RepositoryReferenceActionResult);
}

interface ActionPlan {
  readonly args: readonly string[];
  readonly message: string;
  /** A write touches the working tree, so it gets the longer bound and may run hooks. */
  readonly write: boolean;
  readonly stdin?: string;
}

interface ActionRefusal {
  readonly reason: RepositoryReferenceFailureReason;
  readonly message: string;
  readonly canForce: boolean;
}

/** Turns one validated action into exactly one Git invocation with backend-owned arguments. */
function planAction(
  context: RepositoryReferenceContext,
  action: RepositoryReferenceAction,
): ActionPlan | ActionRefusal {
  switch (action.kind) {
    case 'create-branch': {
      const start = resolveStartPoint(context, action.startPoint);
      if (!start) return notFound('That starting point is no longer in this repository.');
      const tracking =
        action.tracking === 'track' ? ['--track'] : action.tracking === 'no-track' ? ['--no-track'] : [];
      return action.checkout
        ? {
            args: ['checkout', '-b', action.name, ...tracking, start.revision, '--'],
            message: `Created and checked out '${action.name}'.`,
            write: true,
          }
        : {
            args: ['branch', ...tracking, action.name, start.revision],
            message: `Created branch '${action.name}'.`,
            write: false,
          };
    }
    case 'rename-branch': {
      const branch = context.branches.find((candidate) => candidate.fullName === action.fullName);
      if (!branch) return notFound('That branch is no longer in this repository.');
      return {
        args: ['branch', '--move', branch.name, action.name],
        message: `Renamed '${branch.name}' to '${action.name}'.`,
        write: false,
      };
    }
    case 'delete-branch': {
      const branch = context.branches.find((candidate) => candidate.fullName === action.fullName);
      if (!branch) return notFound('That branch is no longer in this repository.');
      return {
        args: ['branch', '--delete', ...(action.force ? ['--force'] : []), branch.name],
        message: `Deleted branch '${branch.name}'.`,
        write: false,
      };
    }
    case 'set-upstream': {
      const branch = context.branches.find((candidate) => candidate.fullName === action.fullName);
      if (!branch) return notFound('That branch is no longer in this repository.');
      if (action.upstream === null) {
        return {
          args: ['branch', '--unset-upstream', branch.name],
          message: `'${branch.name}' no longer tracks a branch.`,
          write: false,
        };
      }
      const candidates = [
        ...context.remoteBranches.map((name) => ({ name, fullName: `refs/remotes/${name}` })),
        ...context.branches,
      ].filter((candidate) => candidate.fullName === action.upstream || candidate.name === action.upstream);
      if (candidates.length !== 1)
        return notFound('Choose an unambiguous upstream reference from the refreshed list.');
      return {
        args: ['branch', `--set-upstream-to=${candidates[0]!.fullName}`, branch.name],
        message: `'${branch.name}' now tracks '${action.upstream}'.`,
        write: false,
      };
    }
    case 'checkout-branch': {
      const branch = context.branches.find((candidate) => candidate.fullName === action.fullName);
      if (!branch) return notFound('That branch is no longer in this repository.');
      return {
        args: ['checkout', '--no-guess', branch.name, '--'],
        message: `Checked out '${branch.name}'.`,
        write: true,
      };
    }
    case 'checkout-remote-branch': {
      if (!context.remoteBranches.includes(shortRemoteName(action.fullName))) {
        return notFound('That remote branch is no longer in this repository.');
      }
      return {
        args: ['checkout', '-b', action.name, '--track', action.fullName, '--'],
        message: `Checked out '${action.name}' tracking '${shortRemoteName(action.fullName)}'.`,
        write: true,
      };
    }
    case 'checkout-commit':
      return {
        args: ['checkout', '--detach', action.commitId, '--'],
        message: `Checked out ${action.commitId.slice(0, 7)} with a detached HEAD.`,
        write: true,
      };
    case 'create-tag': {
      const start = resolveStartPoint(context, action.startPoint);
      if (!start) return notFound('That starting point is no longer in this repository.');
      const message = action.message.replace(/\r\n?/gu, '\n').trim();
      return message
        ? {
            // The message is read from standard input, so it never becomes a Git argument.
            args: ['tag', '--annotate', '--cleanup=whitespace', '--file=-', action.name, start.revision],
            message: `Created annotated tag '${action.name}'.`,
            write: false,
            stdin: `${message}\n`,
          }
        : {
            args: ['tag', action.name, start.revision],
            message: `Created tag '${action.name}'.`,
            write: false,
          };
    }
    case 'delete-tag': {
      const tag = context.tags.find((candidate) => candidate.fullName === action.fullName);
      if (!tag) return notFound('That tag is no longer in this repository.');
      return {
        args: ['tag', '--delete', tag.name],
        message: `Deleted tag '${tag.name}'.`,
        write: false,
      };
    }
  }
}

/** Refusals this service can state precisely, before Git produces a message of its own. */
async function refuseAction(
  runner: ReferenceRunner,
  cwd: string,
  context: RepositoryReferenceContext,
  action: RepositoryReferenceAction,
): Promise<ActionRefusal | undefined> {
  if ('name' in action) {
    const kind = action.kind === 'create-tag' ? 'tags' : 'heads';
    if (!(await isValidReferenceName(runner, cwd, kind, action.name))) {
      return {
        reason: 'invalid-name',
        message: `Git does not accept '${action.name}' as a ${kind === 'tags' ? 'tag' : 'branch'} name.`,
        canForce: false,
      };
    }
  }

  if (action.kind === 'create-branch' || action.kind === 'rename-branch') {
    const existing = context.branches.find((branch) => branch.name === action.name);
    if (existing) {
      return {
        reason: 'exists',
        message: `A branch named '${action.name}' already exists.`,
        canForce: false,
      };
    }
  }
  if (action.kind === 'checkout-remote-branch') {
    const existing = context.branches.find((branch) => branch.name === action.name);
    if (existing) {
      return {
        reason: 'exists',
        message: `A local branch named '${action.name}' already exists. Check it out instead.`,
        canForce: false,
      };
    }
  }
  if (action.kind === 'create-tag' && context.tags.some((tag) => tag.name === action.name)) {
    return { reason: 'exists', message: `A tag named '${action.name}' already exists.`, canForce: false };
  }

  const branch =
    'fullName' in action && action.kind !== 'checkout-remote-branch' && action.kind !== 'delete-tag'
      ? context.branches.find((candidate) => candidate.fullName === action.fullName)
      : undefined;

  if (branch?.worktreePath && action.kind !== 'set-upstream') {
    return {
      reason: 'checked-out',
      message: `'${branch.name}' is checked out in the worktree at ${branch.worktreePath}.`,
      canForce: false,
    };
  }
  if (branch?.isHead && action.kind === 'delete-branch') {
    return {
      reason: 'current-branch',
      message: `'${branch.name}' is the current branch. Check out another branch before deleting it.`,
      canForce: false,
    };
  }
  if (branch?.isHead && action.kind === 'checkout-branch') {
    return {
      reason: 'other',
      message: `'${branch.name}' is already checked out.`,
      canForce: false,
    };
  }
  if (action.kind === 'delete-branch' && !action.force && branch && !branch.merged) {
    return {
      reason: 'not-merged',
      message: `'${branch.name}' is not fully merged into the current branch.`,
      canForce: true,
    };
  }

  const checksOut = isCheckout(action.kind) || (action.kind === 'create-branch' && action.checkout);
  if (checksOut && context.pendingOperation) {
    return {
      reason: 'pending-operation',
      message: `Finish or abort the ${context.pendingOperation} in progress before checking out.`,
      canForce: false,
    };
  }
  if (checksOut && context.conflictedCount > 0) {
    return {
      reason: 'local-changes',
      message: 'Resolve the unmerged files before checking out.',
      canForce: false,
    };
  }
  return undefined;
}

function isCheckout(kind: RepositoryReferenceActionKind): boolean {
  return kind === 'checkout-branch' || kind === 'checkout-commit' || kind === 'checkout-remote-branch';
}

function notFound(message: string): ActionRefusal {
  return { reason: 'not-found', message, canForce: false };
}

function shortRemoteName(fullName: string): string {
  return fullName.startsWith('refs/remotes/') ? fullName.slice('refs/remotes/'.length) : fullName;
}

/**
 * A start point is a commit this window already saw or a reference the same read reported. Nothing
 * else reaches Git, so the renderer cannot supply revision syntax such as `HEAD@{1}` or `:/subject`.
 */
function resolveStartPoint(
  context: RepositoryReferenceContext,
  startPoint: RepositoryReferenceStartPoint,
): { readonly revision: string } | undefined {
  if (startPoint.kind === 'commit') return { revision: startPoint.commitId };
  const branch = context.branches.find((candidate) => candidate.fullName === startPoint.fullName);
  if (branch) return { revision: branch.fullName };
  const tag = context.tags.find((candidate) => candidate.fullName === startPoint.fullName);
  if (tag) return { revision: startPoint.fullName };
  const remote = shortRemoteName(startPoint.fullName);
  if (startPoint.fullName.startsWith('refs/remotes/') && context.remoteBranches.includes(remote)) {
    return { revision: startPoint.fullName };
  }
  return undefined;
}

function classifyFailure(
  action: RepositoryReferenceAction,
  output: string,
): {
  readonly reason: RepositoryReferenceFailureReason;
  readonly message: string;
  readonly canForce: boolean;
} {
  if (/already exists|cannot lock ref|exists; cannot create/iu.test(output)) {
    return {
      reason: 'exists',
      message: 'Git refused the name because a reference already exists.',
      canForce: false,
    };
  }
  if (/is not a valid branch name|is not a valid (?:ref|tag) name/iu.test(output)) {
    return { reason: 'invalid-name', message: 'Git does not accept that name.', canForce: false };
  }
  if (/not fully merged/iu.test(output)) {
    return {
      reason: 'not-merged',
      message: 'That branch is not fully merged, so deleting it would drop its commits.',
      canForce: true,
    };
  }
  if (/already used by worktree|used by worktree at/iu.test(output)) {
    return {
      reason: 'checked-out',
      message: 'That branch is checked out in another worktree.',
      canForce: false,
    };
  }
  if (
    /would be overwritten by checkout|would be overwritten by merge|please commit your changes/iu.test(output)
  ) {
    return {
      reason: 'local-changes',
      message: 'Local changes would be overwritten. Commit, stage, or stash them first.',
      canForce: false,
    };
  }
  if (
    /did not match any file\(s\) known to git|unknown revision|not a valid object name|no such branch/iu.test(
      output,
    )
  ) {
    return { reason: 'not-found', message: 'Git could not find that reference any more.', canForce: false };
  }
  if (/please tell me who you are|unable to auto-detect email|empty ident name/iu.test(output)) {
    return {
      reason: 'identity',
      message: 'Git needs a tagger identity. Configure user.name and user.email for this repository.',
      canForce: false,
    };
  }
  return { reason: 'other', message: `Git could not ${actionDescription(action)}.`, canForce: false };
}

function actionDescription(action: RepositoryReferenceAction): string {
  switch (action.kind) {
    case 'create-branch':
      return `create the branch '${action.name}'`;
    case 'rename-branch':
      return `rename that branch to '${action.name}'`;
    case 'delete-branch':
      return 'delete that branch';
    case 'set-upstream':
      return 'change the upstream branch';
    case 'checkout-branch':
    case 'checkout-remote-branch':
      return 'check out that branch';
    case 'checkout-commit':
      return 'check out that commit';
    case 'create-tag':
      return `create the tag '${action.name}'`;
    case 'delete-tag':
      return 'delete that tag';
  }
}

/** Collects the tab-indented paths Git lists under a "would be overwritten" refusal. */
function blockedPaths(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^\t(.+)$/u.exec(line);
    if (match?.[1]) paths.push(match[1]);
    if (paths.length >= blockedPathLimit) break;
  }
  return paths;
}

function blocked(
  repositoryId: string,
  kind: RepositoryReferenceActionKind,
  reason: RepositoryReferenceFailureReason,
  message: string,
  canForce: boolean,
): RepositoryReferenceActionResult {
  return repositoryReferenceActionResultSchema.parse({
    status: 'blocked',
    repositoryId,
    kind,
    reason,
    message: boundedMessage(message),
    output: '',
    canForce,
    paths: [],
  } satisfies RepositoryReferenceActionResult);
}

/** A reference name or a worktree path can be longer than one sentence of the result contract. */
function boundedMessage(message: string): string {
  return message.length <= messageLimit ? message : `${message.slice(0, messageLimit - 1)}…`;
}

/** Git itself decides whether a name is acceptable, including its platform-specific rules. */
async function isValidReferenceName(
  runner: ReferenceRunner,
  cwd: string,
  kind: 'heads' | 'tags',
  name: string,
): Promise<boolean> {
  if (name.startsWith('-') || name.includes('\0')) return false;
  try {
    await runner.run(['check-ref-format', `refs/${kind}/${name}`], {
      cwd,
      timeoutMs: referenceReadTimeoutMs,
      maxOutputBytes: 4_096,
    });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}

// `upstream:track` makes Git count ahead and behind for every branch in the same pass, which is what
// the sidebar shows beside each name.
const branchFormat = [
  '%(refname)',
  '%(objectname)',
  '%(upstream)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(HEAD)',
  '%(upstream:remotename)',
  '%(upstream:remoteref)',
].join('%00');

async function readBranches(runner: ReferenceRunner, cwd: string): Promise<RawBranch[]> {
  const result = await runner.run(
    ['for-each-ref', `--format=${branchFormat}`, 'refs/heads'],
    readOptions(cwd),
  );
  const branches: RawBranch[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [
      fullName,
      target,
      upstreamFullName,
      upstreamShort,
      track,
      headMarker,
      upstreamRemote,
      upstreamRef,
    ] = line.split('\0');
    if (!fullName || !target || !objectIdPattern.test(target)) {
      throw new Error('Git returned an invalid branch record.');
    }
    branches.push({
      fullName,
      name: fullName.slice('refs/heads/'.length),
      target,
      upstreamShort: upstreamShort?.trim() || null,
      upstreamFullName: upstreamFullName || null,
      upstreamRemote: upstreamRemote || null,
      upstreamBranch: upstreamRef?.startsWith('refs/heads/') ? upstreamRef.slice('refs/heads/'.length) : null,
      track: track?.trim() || null,
      isHead: headMarker?.trim() === '*',
    });
  }
  return branches;
}

const tagFormat = ['%(refname)', '%(objectname)', '%(objecttype)', '%(*objectname)'].join('%00');

async function readTags(runner: ReferenceRunner, cwd: string): Promise<RepositoryTag[]> {
  const result = await runner.run(['for-each-ref', `--format=${tagFormat}`, 'refs/tags'], readOptions(cwd));
  const tags: RepositoryTag[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [fullName, objectName, objectType, peeled] = line.split('\0');
    if (!fullName || !objectName || !objectIdPattern.test(objectName)) {
      throw new Error('Git returned an invalid tag record.');
    }
    const target = peeled && objectIdPattern.test(peeled) ? peeled : objectName;
    tags.push({
      name: fullName.slice('refs/tags/'.length),
      fullName,
      target,
      annotated: objectType === 'tag',
    });
  }
  return tags;
}

async function readRemoteBranchNames(runner: ReferenceRunner, cwd: string): Promise<string[]> {
  const result = await runner.run(
    ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/remotes'],
    readOptions(cwd),
  );
  const names: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, symbolicTarget] = line.split('\0');
    // `origin/HEAD` is a symbolic pointer, not a branch a user picks as an upstream.
    if (!name || symbolicTarget?.trim()) continue;
    names.push(name.slice('refs/remotes/'.length));
  }
  return names;
}

async function readRemotes(runner: ReferenceRunner, cwd: string): Promise<string[]> {
  const result = await runner.run(['remote'], readOptions(cwd));
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Maps each branch that a linked worktree has checked out to that worktree's path. */
async function readWorktreeBranches(
  runner: ReferenceRunner,
  cwd: string,
): Promise<ReadonlyMap<string, string>> {
  const assignments = new Map<string, string>();
  let result: GitCommandResult;
  try {
    result = await runner.run(['worktree', 'list', '--porcelain'], readOptions(cwd));
  } catch (error) {
    // An old Git or an unreadable worktree list leaves the checkouts unknown rather than empty.
    if (error instanceof GitCommandError) return assignments;
    throw error;
  }
  let worktreePath: string | undefined;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length);
    else if (line.startsWith('branch ') && worktreePath) {
      assignments.set(line.slice('branch '.length), worktreePath);
    } else if (line.trim().length === 0) worktreePath = undefined;
  }
  return assignments;
}

/**
 * Reads `%(upstream:track,nobracket)`, which Git writes as `ahead 1, behind 2`, `gone`, or nothing at
 * all. A branch with an upstream and no divergence is exactly level, so it counts as zero and zero.
 */
export function parseTracking(
  track: string | null,
  hasUpstream: boolean,
): { readonly ahead: number | null; readonly behind: number | null } {
  if (!hasUpstream || track === 'gone') return { ahead: null, behind: null };
  if (track === null) return { ahead: 0, behind: 0 };
  const ahead = /\bahead (\d+)\b/u.exec(track);
  const behind = /\bbehind (\d+)\b/u.exec(track);
  if (!ahead && !behind) return { ahead: 0, behind: 0 };
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}

function otherWorktree(assigned: string | undefined, current: string): string | null {
  return assigned && assigned !== current ? assigned : null;
}

async function readMergedBranches(
  runner: ReferenceRunner,
  cwd: string,
  head: RepositoryHead,
): Promise<ReadonlySet<string>> {
  if (!head.commit) return new Set();
  try {
    const result = await runner.run(
      ['for-each-ref', '--format=%(refname)', `--merged=${head.commit}`, 'refs/heads'],
      readOptions(cwd),
    );
    return new Set(
      result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch (error) {
    // Without this answer every deletion asks for a confirmation, which is the safe direction.
    if (error instanceof GitCommandError) return new Set();
    throw error;
  }
}

async function readHead(runner: ReferenceRunner, cwd: string): Promise<RepositoryHead> {
  const fullName = await optionalOutput(runner, cwd, ['symbolic-ref', '--quiet', 'HEAD']);
  const branch = fullName?.startsWith('refs/heads/') ? fullName.slice('refs/heads/'.length) : fullName;
  const commit = await optionalOutput(runner, cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (branch && commit && objectIdPattern.test(commit)) return { state: 'branch', name: branch, commit };
  if (branch) return { state: 'unborn', name: branch, commit: null };
  if (commit && objectIdPattern.test(commit)) return { state: 'detached', name: null, commit };
  return { state: 'unknown', name: null, commit: null };
}

async function optionalOutput(
  runner: ReferenceRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await runner.run(args, { cwd, timeoutMs: referenceReadTimeoutMs, maxOutputBytes: 4_096 });
    return result.stdout.replace(/\r?\n$/u, '') || null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

function readOptions(cwd: string): GitRunOptions {
  return { cwd, timeoutMs: referenceReadTimeoutMs, maxOutputBytes: referenceReadOutputLimit };
}

/**
 * Hashes what a branch or tag action depends on: HEAD, the local branches with their upstreams and
 * worktree checkouts, and the tags. Remote-tracking refs are deliberately left out, so a background
 * fetch does not invalidate a dialog the user is still filling in.
 */
function referenceSnapshot(
  head: RepositoryHead,
  branches: readonly RepositoryBranch[],
  tags: readonly RepositoryTag[],
): string {
  const state = {
    head: { state: head.state, name: head.name, commit: head.commit },
    branches: branches
      .map((branch) => ({
        fullName: branch.fullName,
        target: branch.target,
        upstream: branch.upstreamFullName ?? branch.upstream,
        remote: branch.upstreamRemote,
        remoteBranch: branch.upstreamBranch,
        worktreePath: branch.worktreePath,
      }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    tags: tags
      .map((tag) => ({ fullName: tag.fullName, target: tag.target }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName)),
  };
  return createHash('sha256').update(JSON.stringify(state), 'utf8').digest('hex');
}

/** Keeps Git and hook output as bounded inert text: no escape sequences, no unbounded growth. */
function displayOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
  const plain = redactUrlCredentials(combined)
    // eslint-disable-next-line no-control-regex -- terminal escapes are stripped, not interpreted.
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/gu, '')
    // eslint-disable-next-line no-control-regex -- keep newlines and tabs, drop other control bytes.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
  return plain.length > outputDisplayLimit
    ? `${plain.slice(0, outputDisplayLimit - '\n… output truncated.'.length)}\n… output truncated.`
    : plain;
}
