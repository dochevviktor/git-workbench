import { createHash } from 'node:crypto';
import { access, constants, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type {
  RepositoryAmendChanges,
  RepositoryCommitAmendTarget,
  RepositoryCommitContext,
  RepositoryCommitFailureReason,
  RepositoryCommitIdentity,
  RepositoryCommitMessage,
  RepositoryCommitPendingOperation,
  RepositoryCommitResult,
  RepositoryHead,
  RepositoryWorkingChange,
  RepositorySigningMode,
} from '../../common/ipc/contracts';
import {
  repositoryAmendChangesSchema,
  repositoryCommitContextSchema,
  repositoryCommitResultSchema,
} from '../../common/ipc/contracts';
import { GitCommandError, GitTimeoutError, redactUrlCredentials } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { parseRawChanges, resolveAmendBase } from './revision-service';
import { readWorkingChanges } from './working-tree-service';
import { finishStashApplication, readStashApplication } from './stash-application';

const commitReadTimeoutMs = 10_000;
const commitReadOutputLimit = 1024 * 1024;
/** Hooks, filters, and signing programs run inside `git commit`, so it gets its own longer bound. */
const commitRunTimeoutMs = 120_000;
const publishedCheckTimeoutMs = 5_000;
const recentMessageLimit = 20;
const recentMessageScanLimit = 100;
const templateByteLimit = 64 * 1024;
const outputDisplayLimit = 64 * 1024;
const amendReadOutputLimit = 8 * 1024 * 1024;
const amendChangeLimit = 10_000;
const commitHookNames = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit'] as const;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface CommitRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface CommitContextInput {
  readonly repositoryId: string;
  readonly cwd: string;
  /** This worktree's Git directory; `MERGE_HEAD` and friends are per-worktree state. */
  readonly gitDir: string;
  readonly head: RepositoryHead;
}

export interface CommitChangesInput extends CommitContextInput {
  readonly signing?: RepositorySigningMode | undefined;
  readonly onCommand?: ((args: readonly string[]) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly subject: string;
  readonly body: string;
  readonly amend: boolean;
  readonly snapshot: string;
  readonly skipHooks: boolean;
}

export class AmendUnavailableError extends Error {
  constructor() {
    super('This branch has no commit to amend.');
    this.name = 'AmendUnavailableError';
  }
}

export class StaleCommitSnapshotError extends Error {
  constructor() {
    super('The repository changed after the commit details were read. Refresh and try again.');
    this.name = 'StaleCommitSnapshotError';
  }
}

/**
 * Reads everything the commit composer needs in one bounded pass: the identity Git would use, the
 * commit an amend would replace, a configured template, pending merge state, recent messages, and a
 * compare-and-swap token over HEAD and the staged entries.
 */
export async function readCommitContext(
  runner: CommitRunner,
  input: CommitContextInput,
): Promise<RepositoryCommitContext> {
  const changes = await readWorkingChanges(runner, {
    repositoryId: input.repositoryId,
    cwd: input.cwd,
    includeUntracked: false,
    includeIgnored: false,
  });
  const pending = await readPendingOperation(input.gitDir);
  const rebaseEdit =
    pending.operation === 'rebase'
      ? await readRebaseEditState(runner, input.cwd, input.gitDir, input.head.commit)
      : ('none' as const);
  const [identity, amend, template, recentMessages, signing, hooks] = await Promise.all([
    readIdentity(runner, input.cwd),
    readAmendTarget(runner, input.cwd, input.head),
    readTemplate(runner, input.cwd),
    readRecentMessages(runner, input.cwd, input.head),
    readSigningConfigured(runner, input.cwd),
    readCommitHooks(runner, input.cwd),
  ]);

  return repositoryCommitContextSchema.parse({
    repositoryId: input.repositoryId,
    head: input.head,
    identity,
    amend: !pending.operation || rebaseEdit === 'needs-amend' ? amend.target : null,
    amendBlockedReason:
      pending.operation && rebaseEdit !== 'needs-amend'
        ? `${pendingOperationLabel(pending.operation)} is in progress, so the previous commit cannot be amended.`
        : amend.blockedReason,
    template,
    pendingOperation: pending.operation,
    rebaseEdit,
    pendingMessage: pending.message,
    recentMessages,
    stagedCount: changes.counts.staged,
    conflictedCount: changes.counts.conflicted,
    signing,
    hooks,
    snapshot: commitSnapshot(input.head, pending.operation, changes.staged),
  } satisfies RepositoryCommitContext);
}

/**
 * Lists everything an amended commit would contain: the current index compared with HEAD's parent.
 * This is a read; ticking Amend never moves a commit's changes into the index.
 */
export async function readAmendChanges(
  runner: CommitRunner,
  input: CommitContextInput,
): Promise<RepositoryAmendChanges> {
  const amendBase = await resolveAmendBase(runner, input.cwd);
  if (!amendBase) throw new AmendUnavailableError();

  const [raw, staged] = await Promise.all([
    runner.run(
      [
        'diff-index',
        '--cached',
        '--no-ext-diff',
        '--no-textconv',
        '--raw',
        '-M',
        '-C',
        '-z',
        amendBase.base,
        '--',
      ],
      { cwd: input.cwd, timeoutMs: commitReadTimeoutMs, maxOutputBytes: amendReadOutputLimit },
    ),
    readWorkingChanges(runner, {
      repositoryId: input.repositoryId,
      cwd: input.cwd,
      includeUntracked: false,
      includeIgnored: false,
    }),
  ]);

  const changes = parseRawChanges(raw.stdout);
  return repositoryAmendChangesSchema.parse({
    repositoryId: input.repositoryId,
    commitId: amendBase.commitId,
    parentId: amendBase.parentId,
    changes: changes.slice(0, amendChangeLimit),
    stagedPaths: staged.staged.map((change) => change.path).slice(0, amendChangeLimit),
    truncated: changes.length > amendChangeLimit,
  } satisfies RepositoryAmendChanges);
}

/**
 * Creates or amends one commit. The context is read again immediately before the mutation, so the
 * renderer's token is a compare-and-swap guard rather than a promise that nothing has changed.
 */
export async function commitChanges(
  runner: CommitRunner,
  input: CommitChangesInput,
): Promise<RepositoryCommitResult> {
  const context = await readCommitContext(runner, input);
  if (context.snapshot !== input.snapshot) throw new StaleCommitSnapshotError();

  const message = buildCommitMessage(input.subject, input.body);
  const refusal = refuseCommit(context, input.amend, message);
  if (refusal) return failed(input.repositoryId, refusal.reason, refusal.message, '', false);

  const args = [
    ...(input.signing === 'gpg' ? ['-c', 'gpg.format=openpgp'] : []),
    'commit',
    '--cleanup=whitespace',
    '--file=-',
  ];
  if (input.signing === 'gpg') args.push('--gpg-sign');
  if (input.signing === 'unsigned') args.push('--no-gpg-sign');
  const signing = input.signing === 'gpg' || (input.signing !== 'unsigned' && context.signing);
  if (input.amend) args.push('--amend');
  if (input.skipHooks) args.push('--no-verify');
  input.onCommand?.(args);

  let result: GitCommandResult;
  try {
    result = await runner.run(args, {
      cwd: input.cwd,
      timeoutMs: commitRunTimeoutMs,
      maxOutputBytes: commitReadOutputLimit,
      stdin: message,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof GitTimeoutError) {
      return failed(
        input.repositoryId,
        'other',
        'Git was stopped before it reported the result. Refresh the repository to see whether the commit was created.',
        '',
        false,
      );
    }
    if (!(error instanceof GitCommandError)) throw error;
    const output = displayOutput(error.stdout, error.stderr);
    const reason = /gpg failed|failed to sign|signing failed/iu.test(output)
      ? 'signing'
      : classifyFailure(output, context, input.skipHooks);
    return failed(
      input.repositoryId,
      reason,
      failureMessage(reason, context),
      signing ? '' : output,
      reason === 'hook' && !input.skipHooks,
    );
  }

  const commitId = await readHeadCommitId(runner, input.cwd);
  if (context.pendingOperation === 'stash') await finishStashApplication(input.gitDir);
  const noCommit = await readSingleNoCommitOperation(input.gitDir);
  if (noCommit && noCommit === context.pendingOperation)
    await runner.run([noCommit, '--quit'], {
      cwd: input.cwd,
      timeoutMs: commitReadTimeoutMs,
      maxOutputBytes: commitReadOutputLimit,
    });
  return repositoryCommitResultSchema.parse({
    status: 'committed',
    repositoryId: input.repositoryId,
    commitId,
    amended: input.amend,
    subject: message.split('\n', 1)[0] ?? '',
    output: signing ? '' : displayOutput(result.stdout, result.stderr),
  } satisfies RepositoryCommitResult);
}

/** Joins the composer fields the way Git reads a message file: subject, blank line, then the body. */
export function buildCommitMessage(subject: string, body: string): string {
  const normalizedSubject = subject.replace(/\r\n?/gu, '\n').split('\n').join(' ').trim();
  const normalizedBody = body.replace(/\r\n?/gu, '\n').replace(/^\n+/u, '').trimEnd();
  if (!normalizedSubject) return normalizedBody ? `${normalizedBody}\n` : '';
  return normalizedBody ? `${normalizedSubject}\n\n${normalizedBody}\n` : `${normalizedSubject}\n`;
}

function refuseCommit(
  context: RepositoryCommitContext,
  amend: boolean,
  message: string,
): { readonly reason: RepositoryCommitFailureReason; readonly message: string } | undefined {
  if (!message.trim()) {
    return { reason: 'empty-message', message: 'Enter a commit message before committing.' };
  }
  if (context.conflictedCount > 0) {
    return {
      reason: 'conflicts',
      message:
        context.conflictedCount === 1
          ? 'Resolve the conflicted file and stage it before committing.'
          : `Resolve the ${context.conflictedCount} conflicted files and stage them before committing.`,
    };
  }
  if (amend && !context.amend) {
    return {
      reason: 'other',
      message: context.amendBlockedReason ?? 'There is no commit to amend in this repository.',
    };
  }
  if (!amend && context.stagedCount === 0 && !context.pendingOperation) {
    return { reason: 'nothing-staged', message: 'Stage at least one change before committing.' };
  }
  return undefined;
}

function failed(
  repositoryId: string,
  reason: RepositoryCommitFailureReason,
  message: string,
  output: string,
  canSkipHooks: boolean,
): RepositoryCommitResult {
  return repositoryCommitResultSchema.parse({
    status: 'failed',
    repositoryId,
    reason,
    message,
    output,
    canSkipHooks,
  } satisfies RepositoryCommitResult);
}

function classifyFailure(
  output: string,
  context: RepositoryCommitContext,
  skipHooks: boolean,
): RepositoryCommitFailureReason {
  if (
    /please tell me who you are|unable to auto-detect email|empty ident name|no name was given/iu.test(output)
  ) {
    return 'identity';
  }
  if (/aborting commit due to empty commit message|empty commit message/iu.test(output)) {
    return 'empty-message';
  }
  if (/unmerged files|unmerged paths|needs merge/iu.test(output)) return 'conflicts';
  if (/nothing to commit|no changes added to commit|nothing added to commit/iu.test(output)) {
    return 'nothing-staged';
  }
  if (!skipHooks && (context.hooks.length > 0 || /\bhook\b/iu.test(output))) return 'hook';
  return 'other';
}

function failureMessage(reason: RepositoryCommitFailureReason, context: RepositoryCommitContext): string {
  switch (reason) {
    case 'signing':
      return 'Signing failed or was cancelled. Check the configured key and native GPG agent before retrying.';
    case 'hook':
      return 'A commit hook stopped the commit. Its output is shown below.';
    case 'identity':
      return 'Git needs an author identity. Configure user.name and user.email for this repository.';
    case 'empty-message':
      return 'Git rejected the commit message as empty.';
    case 'nothing-staged':
      return 'Git found nothing staged to commit.';
    case 'conflicts':
      return 'Git cannot commit while the repository has unmerged files.';
    case 'other':
      return context.signing
        ? 'Git could not complete the signed commit. Check the configured key and native GPG agent, then retry.'
        : 'Git could not complete the commit.';
  }
}

async function readIdentity(runner: CommitRunner, cwd: string): Promise<RepositoryCommitIdentity> {
  const [name, email] = await Promise.all([
    optionalOutput(runner, cwd, ['config', '--get', 'user.name']),
    optionalOutput(runner, cwd, ['config', '--get', 'user.email']),
  ]);
  if (name && email) return { name, email, source: 'configured' };

  const ident = await optionalOutput(runner, cwd, ['var', 'GIT_COMMITTER_IDENT']);
  const guessed = ident ? parseIdent(ident) : undefined;
  if (!guessed) return { name: name ?? '', email: email ?? '', source: 'missing' };
  return { name: name || guessed.name, email: email || guessed.email, source: 'implicit' };
}

function parseIdent(value: string): { readonly name: string; readonly email: string } | undefined {
  const match = /^(.*?)\s*<([^>]*)>/u.exec(value.trim());
  if (!match) return undefined;
  return { name: match[1] ?? '', email: match[2] ?? '' };
}

async function readAmendTarget(
  runner: CommitRunner,
  cwd: string,
  head: RepositoryHead,
): Promise<{
  readonly target: RepositoryCommitAmendTarget | null;
  readonly blockedReason: string | null;
}> {
  if (head.state === 'unborn' || !head.commit) {
    return { target: null, blockedReason: 'This branch has no commits yet, so there is nothing to amend.' };
  }

  const format = ['%H', '%P', '%an', '%ae', '%aI', '%s', '%b'].join('%x00');
  const raw = await optionalOutput(runner, cwd, [
    'log',
    '--max-count=1',
    '--no-decorate',
    '--no-color',
    `--format=${format}`,
    head.commit,
    '--',
  ]);
  if (!raw) return { target: null, blockedReason: 'The current commit could not be read.' };
  const [commitId, parents, authorName, authorEmail, authorDate, subject, body] = raw.split('\0');
  if (!commitId || !objectIdPattern.test(commitId) || !authorDate) {
    return { target: null, blockedReason: 'The current commit could not be read.' };
  }

  const published = await readPublishedRefs(runner, cwd, commitId);
  return {
    target: {
      commitId,
      subject: subject ?? '',
      body: (body ?? '').replace(/\n+$/u, ''),
      author: { name: authorName ?? '', email: authorEmail ?? '', date: authorDate },
      parentCount: (parents ?? '').split(' ').filter(Boolean).length,
      published: published.published,
      publishedRefs: published.refs,
    },
    blockedReason: null,
  };
}

async function readPublishedRefs(
  runner: CommitRunner,
  cwd: string,
  commitId: string,
): Promise<{ readonly published: boolean | null; readonly refs: string[] }> {
  try {
    const result = await runner.run(
      ['for-each-ref', '--format=%(refname)', '--count=10', `--contains=${commitId}`, 'refs/remotes'],
      { cwd, timeoutMs: publishedCheckTimeoutMs, maxOutputBytes: commitReadOutputLimit },
    );
    const refs = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10);
    return { published: refs.length > 0, refs };
  } catch {
    // An old Git, a slow history walk, or a missing object leaves this unknown rather than "private".
    return { published: null, refs: [] };
  }
}

async function readTemplate(runner: CommitRunner, cwd: string): Promise<string | null> {
  // `--path` expands a leading `~`, so the renderer never resolves a filesystem path.
  const configured = await optionalOutput(runner, cwd, ['config', '--path', '--get', 'commit.template']);
  if (!configured) return null;
  const templatePath = isAbsolute(configured) ? configured : resolve(cwd, configured);
  try {
    const details = await stat(templatePath);
    if (!details.isFile() || details.size > templateByteLimit) return null;
    const contents = await readFile(templatePath, 'utf8');
    const commentChar = await readCommentPrefix(runner, cwd);
    const kept = contents
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .filter((line) => !line.startsWith(commentChar));
    return kept.join('\n').trim() || null;
  } catch {
    return null;
  }
}

async function readCommentPrefix(runner: CommitRunner, cwd: string): Promise<string> {
  const configured =
    (await optionalOutput(runner, cwd, ['config', '--get', 'core.commentString'])) ??
    (await optionalOutput(runner, cwd, ['config', '--get', 'core.commentChar']));
  if (!configured || configured === 'auto') return '#';
  return configured;
}

async function readRecentMessages(
  runner: CommitRunner,
  cwd: string,
  head: RepositoryHead,
): Promise<RepositoryCommitMessage[]> {
  if (!head.commit) return [];
  const raw = await optionalOutput(runner, cwd, [
    'log',
    `--max-count=${recentMessageScanLimit}`,
    '--no-decorate',
    '--no-color',
    '--format=%s%x00%b%x00%x00',
    head.commit,
    '--',
  ]);
  if (!raw) return [];

  const messages: RepositoryCommitMessage[] = [];
  const seen = new Set<string>();
  for (const record of raw.split('\0\0')) {
    const [subject, body] = record.replace(/^\n+/u, '').split('\0');
    const trimmedSubject = (subject ?? '').trim();
    if (!trimmedSubject) continue;
    const trimmedBody = (body ?? '').replace(/\n+$/u, '');
    const key = `${trimmedSubject}\0${trimmedBody}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({ subject: trimmedSubject, body: trimmedBody });
    if (messages.length >= recentMessageLimit) break;
  }
  return messages;
}

async function readSigningConfigured(runner: CommitRunner, cwd: string): Promise<boolean> {
  const value = await optionalOutput(runner, cwd, ['config', '--bool', '--get', 'commit.gpgsign']);
  return value === 'true';
}

async function readCommitHooks(runner: CommitRunner, cwd: string): Promise<string[]> {
  // `rev-parse --git-path` resolves `core.hooksPath` and linked-worktree layouts for us.
  const configured = await optionalOutput(runner, cwd, ['rev-parse', '--git-path', 'hooks']);
  if (!configured) return [];
  const directory = isAbsolute(configured) ? configured : resolve(cwd, configured);
  const present = await Promise.all(
    commitHookNames.map(async (hook) => ((await isExecutableFile(join(directory, hook))) ? hook : null)),
  );
  return present.filter((hook): hook is (typeof commitHookNames)[number] => hook !== null);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const details = await stat(path);
    if (!details.isFile()) return false;
    if (process.platform === 'win32') return true;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPendingOperation(gitDir: string): Promise<{
  readonly operation: RepositoryCommitPendingOperation | null;
  readonly message: string | null;
}> {
  const operation = await detectPendingOperation(gitDir);
  if (operation === 'stash') return { operation, message: null };
  const message =
    (await readGitDirText(gitDir, 'MERGE_MSG')) ??
    (await readGitDirText(gitDir, 'CHERRY_PICK_MSG')) ??
    (await readGitDirText(gitDir, 'REVERT_MSG')) ??
    (await readGitDirText(gitDir, 'SQUASH_MSG')) ??
    null;
  return { operation, message: operation ? message : null };
}

export async function readSingleNoCommitOperation(gitDir: string): Promise<'cherry-pick' | 'revert' | null> {
  const opts = await readGitDirText(gitDir, 'sequencer/opts');
  if (!/no-commit\s*=\s*true/u.test(opts ?? '')) return null;
  const todo =
    (await readGitDirText(gitDir, 'sequencer/todo'))
      ?.split('\n')
      .filter((line) => /^(pick|revert) /u.test(line)) ?? [];
  return todo.length === 1 ? (todo[0]!.startsWith('pick ') ? 'cherry-pick' : 'revert') : null;
}

/** Shared with the reference workflows, which must not check out while a sequencer is running. */
export async function detectPendingOperation(
  gitDir: string,
): Promise<RepositoryCommitPendingOperation | null> {
  // Rebase owns replay conflicts even when Git also leaves CHERRY_PICK_HEAD.
  if ((await pathExists(join(gitDir, 'rebase-merge'))) || (await pathExists(join(gitDir, 'rebase-apply'))))
    return 'rebase';
  if (await pathExists(join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (await pathExists(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await pathExists(join(gitDir, 'REVERT_HEAD'))) return 'revert';
  const todo = await readGitDirText(gitDir, 'sequencer/todo');
  if (/^pick /mu.test(todo ?? '')) return 'cherry-pick';
  if (/^revert /mu.test(todo ?? '')) return 'revert';
  if (await pathExists(join(gitDir, 'SQUASH_MSG'))) return 'squash';
  if (await readStashApplication(gitDir)) return 'stash';
  return null;
}

/** Identifies the captured interactive-Edit pause without treating an ordinary rebase as amendable. */
export async function readRebaseEditState(
  runner: CommitRunner,
  cwd: string,
  gitDir: string,
  headCommit: string | null,
): Promise<'none' | 'needs-amend' | 'ready-to-continue'> {
  if (!headCommit) return 'none';
  const done = await readGitDirText(gitDir, 'rebase-merge/done');
  const last = done
    ?.split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .at(-1);
  if (!last || !/^edit /u.test(last)) return 'none';
  const stopped =
    (await readGitDirText(gitDir, 'rebase-merge/stopped-sha')) ??
    (await readGitDirText(gitDir, 'rebase-apply/stopped-sha'));
  if (!stopped || !objectIdPattern.test(stopped)) return 'none';
  if (stopped === headCommit) return 'needs-amend';
  const [original, current] = await Promise.all([
    optionalOutput(runner, cwd, ['show', '-s', '--format=%T%x00%an%x00%ae%x00%B', stopped]),
    optionalOutput(runner, cwd, ['show', '-s', '--format=%T%x00%an%x00%ae%x00%B', headCommit]),
  ]);
  if (!original || !current) return 'needs-amend';
  return normalizeEditSignature(original) === normalizeEditSignature(current)
    ? 'needs-amend'
    : 'ready-to-continue';
}

function normalizeEditSignature(value: string): string {
  return value.replace(/\r\n?/gu, '\n').replace(/\n+$/u, '');
}

function pendingOperationLabel(operation: RepositoryCommitPendingOperation): string {
  switch (operation) {
    case 'stash':
      return 'A stash application';
    case 'merge':
      return 'A merge';
    case 'squash':
      return 'A squash merge';
    case 'cherry-pick':
      return 'A cherry-pick';
    case 'revert':
      return 'A revert';
    case 'rebase':
      return 'A rebase';
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readGitDirText(gitDir: string, name: string): Promise<string | null> {
  try {
    const path = join(gitDir, name);
    const details = await stat(path);
    if (!details.isFile() || details.size > templateByteLimit) return null;
    const contents = (await readFile(path, 'utf8')).replace(/\r\n?/gu, '\n');
    return contents.trim() ? contents.replace(/\n+$/u, '') : null;
  } catch {
    return null;
  }
}

async function readHeadCommitId(runner: CommitRunner, cwd: string): Promise<string> {
  const commitId = await optionalOutput(runner, cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!commitId || !objectIdPattern.test(commitId)) {
    throw new Error('Git did not report the new commit.');
  }
  return commitId;
}

/**
 * Hashes the state a composed commit depends on. Staging, an external commit, or a new merge state
 * all change the token, so a stale composer cannot commit a different set of changes than it showed.
 */
function commitSnapshot(
  head: RepositoryHead,
  pending: RepositoryCommitPendingOperation | null,
  staged: readonly RepositoryWorkingChange[],
): string {
  const state = {
    head: { state: head.state, name: head.name, commit: head.commit },
    pending,
    staged: staged.map((change) => ({
      path: change.path,
      previousPath: change.previousPath,
      status: change.status,
      indexStatus: change.indexStatus,
      oldObjectId: change.oldObjectId,
      newObjectId: change.newObjectId,
      oldMode: change.oldMode,
      newMode: change.newMode,
    })),
  };
  return createHash('sha256').update(JSON.stringify(state), 'utf8').digest('hex');
}

async function optionalOutput(
  runner: CommitRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await runner.run(args, {
      cwd,
      timeoutMs: commitReadTimeoutMs,
      maxOutputBytes: commitReadOutputLimit,
    });
    const output = result.stdout.replace(/\r?\n$/u, '');
    return output.length > 0 ? output : null;
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
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
