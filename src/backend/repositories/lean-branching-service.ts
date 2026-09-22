import { createHash } from 'node:crypto';
import type {
  RepositoryHead,
  RepositoryLeanAction,
  RepositoryLeanContext,
  RepositoryReferenceContext,
} from '../../common/ipc/contracts';
import { repositoryLeanContextSchema } from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError } from '../git/runner';
import type { GitRunOptions } from '../git/runner';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import { applyReferenceAction, readReferenceContext, StaleReferenceSnapshotError } from './reference-service';
import type { ReferenceRunner } from './reference-service';
import { runMergeRebase } from './merge-rebase-service';
import { readRecovery } from './recovery-service';

interface Input {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
  readonly worktreePath: string;
  readonly base?: string | undefined;
}

async function read(runner: ReferenceRunner, cwd: string, args: readonly string[], optional = false) {
  try {
    return (await runner.run(args, { cwd, timeoutMs: 15000, maxOutputBytes: 8 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    if (optional && error instanceof GitCommandError && error.exitCode === 1) return null;
    throw error;
  }
}

async function references(runner: ReferenceRunner, input: Input) {
  const name = await read(runner, input.cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  const commit = await read(runner, input.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], true);
  const head: RepositoryHead = {
    state: name ? (commit ? 'branch' : 'unborn') : commit ? 'detached' : 'unknown',
    name,
    commit,
  };
  return readReferenceContext(runner, { ...input, head });
}

async function ancestor(runner: ReferenceRunner, cwd: string, older: string, newer: string) {
  return (await read(runner, cwd, ['merge-base', '--is-ancestor', older, newer], true)) !== null;
}

async function state(runner: ReferenceRunner, input: Input) {
  const refs = await references(runner, input);
  const current = refs.branches.find((branch) => branch.isHead);
  const base = refs.branches.find(
    (branch) =>
      branch.name ===
      (input.base ??
        ['main', 'master', 'develop'].find((name) => refs.branches.some((branch) => branch.name === name)) ??
        current?.name),
  );
  const upstreams: Record<string, string | null> = {};
  for (const branch of [base, current]) {
    if (branch?.upstreamFullName && !(branch.upstreamFullName in upstreams))
      upstreams[branch.upstreamFullName] = await read(
        runner,
        input.cwd,
        ['rev-parse', '--verify', '--quiet', `${branch.upstreamFullName}^{commit}`],
        true,
      );
  }
  const recovery = await readRecovery(runner, {
    id: input.repositoryId,
    cwd: input.cwd,
    gitDir: input.gitDir,
    head: refs.head,
  });
  const reason =
    refs.head.state !== 'branch' || !current
      ? 'Check out a branch with a commit first.'
      : refs.pendingOperation || recovery.copies.some((copy) => copy.pending)
        ? 'Finish or abort the pending operation in Recovery first.'
        : refs.dirty || refs.untrackedCount || refs.conflictedCount
          ? 'Commit or stash local changes, including untracked files, first.'
          : !base
            ? 'Select an existing local base branch.'
            : null;
  let startTarget = base?.target ?? null;
  let baseReason: string | null = null;
  const baseUpstream = base?.upstreamFullName ? upstreams[base.upstreamFullName] : undefined;
  if (baseUpstream === null)
    baseReason = 'The base upstream is missing. Fetch or repair its tracking configuration first.';
  else if (base && baseUpstream && base.target !== baseUpstream) {
    if (await ancestor(runner, input.cwd, base.target, baseUpstream)) startTarget = baseUpstream;
    else if (!(await ancestor(runner, input.cwd, baseUpstream, base.target)))
      baseReason = 'The base and its upstream have diverged. Reconcile them first.';
  }
  const currentUpstream = current?.upstreamFullName ? upstreams[current.upstreamFullName] : undefined;
  const includesBase =
    base && current ? await ancestor(runner, input.cwd, base.target, current.target) : false;
  const commitCount =
    base && current && includesBase
      ? Number(await read(runner, input.cwd, ['rev-list', '--count', `${base.target}..${current.target}`]))
      : 0;
  const value = repositoryLeanContextSchema.parse({
    repositoryId: input.repositoryId,
    branches: refs.branches.map((branch) => branch.name),
    current: current?.name ?? null,
    base: base?.name ?? null,
    baseTarget: base?.target ?? null,
    startTarget,
    upstream: current?.upstreamFullName ?? null,
    commitCount,
    startReason: reason ?? baseReason,
    syncReason:
      reason ??
      (current?.name === base?.name ? null : baseReason) ??
      (currentUpstream === null ? 'The current upstream is missing. Fetch or repair tracking first.' : null),
    finishReason:
      reason ??
      baseReason ??
      (base?.name === current?.name
        ? 'The base branch cannot be finished into itself.'
        : base?.worktreePath
          ? 'The base is checked out in another worktree.'
          : baseUpstream && baseUpstream !== base?.target
            ? 'Synchronize the base with its upstream before finishing.'
            : !includesBase
              ? 'Sync this branch with the base before finishing.'
              : !commitCount
                ? 'This branch has no commits to finish.'
                : null),
    snapshot: createHash('sha256')
      .update(JSON.stringify([refs.snapshot, base?.name, upstreams, reason, recovery.snapshot]))
      .digest('hex'),
  });
  return { value, refs, base, current, upstreams };
}

export async function readLeanContext(runner: ReferenceRunner, input: Input): Promise<RepositoryLeanContext> {
  return (await state(runner, input)).value;
}

/** Called under the common-directory mutation queue. Existing P06 services own replay and recovery. */
export async function runLeanAction(
  runner: ReferenceRunner,
  input: Input,
  action: RepositoryLeanAction,
  handle: OperationHandle,
): Promise<OperationOutcome> {
  const before = await state(runner, { ...input, base: action.base });
  if (handle.signal.aborted) throw new GitCancelledError();
  if (action.snapshot !== before.value.snapshot) throw new StaleReferenceSnapshotError();
  const reason = before.value[`${action.kind}Reason`];
  if (reason) return { status: 'failed', failureReason: 'other', message: reason, output: '' };
  const base = before.base!;
  const current = before.current!;
  const onCommand = (args: readonly string[]) =>
    handle.setCommand?.(['git', ...args.map((arg) => JSON.stringify(arg))].join(' '));
  const referenceAction = async (
    refs: RepositoryReferenceContext,
    request: Parameters<typeof applyReferenceAction>[1]['action'],
  ) => {
    const result = await applyReferenceAction(runner, {
      ...input,
      head: refs.head,
      snapshot: refs.snapshot,
      action: request,
      signal: handle.signal,
      onCommand,
    });
    return {
      status: result.status === 'applied' ? ('succeeded' as const) : ('failed' as const),
      message: result.message,
      output: result.output,
    };
  };
  if (action.kind === 'start') {
    return referenceAction(before.refs, {
      kind: 'create-branch',
      name: action.name!,
      checkout: true,
      tracking: 'no-track',
      startPoint: { kind: 'commit', commitId: before.value.startTarget! },
    });
  }
  // Disable configured dependent-ref rewrites and merge-preserving/interactive replay for this policy.
  const replayRunner: ReferenceRunner = {
    run: (args: readonly string[], options: GitRunOptions) => {
      const command =
        args[0] === 'rebase'
          ? ['-c', 'rebase.updateRefs=false', '-c', 'rebase.autoSquash=false', ...args, '--no-rebase-merges']
          : args;
      if (args[0] === 'rebase') onCommand(command);
      return runner.run(command, options);
    },
  };
  const integrate = async (
    sourceFullName: string,
    kind: 'merge' | 'rebase',
    mode: 'default' | 'no-ff' = 'default',
  ) => {
    if (handle.signal.aborted) throw new GitCancelledError();
    const refs = await references(runner, input);
    return runMergeRebase(replayRunner, {
      ...input,
      head: refs.head,
      action: {
        sourceFullName,
        snapshot: refs.snapshot,
        autostash: false,
        ...(kind === 'merge' ? { kind, mode } : { kind }),
      },
      signal: handle.signal,
      handle,
    });
  };
  if (action.kind === 'sync') {
    const targets = [
      ...new Set(
        [
          current.upstreamFullName,
          ...(current.name === base.name
            ? []
            : [before.value.startTarget === base.target ? base.fullName : base.upstreamFullName]),
        ].filter((target): target is string => target !== null),
      ),
    ];
    for (const target of targets) {
      const targetCommit = await read(runner, input.cwd, ['rev-parse', '--verify', `${target}^{commit}`]);
      const expected = target === base.fullName ? base.target : before.upstreams[target];
      if (targetCommit !== expected) throw new StaleReferenceSnapshotError();
      const head = await read(runner, input.cwd, ['rev-parse', '--verify', 'HEAD']);
      if (await ancestor(runner, input.cwd, targetCommit!, head!)) continue;
      const result = await integrate(target, 'rebase');
      handle.appendOutput(result.output);
      if (result.status !== 'succeeded') return result;
    }
    return {
      status: 'succeeded',
      message: 'Branch synchronized. Remote refs were not changed; review any push separately.',
      output: '',
    };
  }
  const checkout = await referenceAction(before.refs, { kind: 'checkout-branch', fullName: base.fullName });
  if (checkout.status !== 'succeeded') return checkout;
  const afterCheckout = await references(runner, input);
  if (
    afterCheckout.head.name !== base.name ||
    afterCheckout.head.commit !== base.target ||
    afterCheckout.branches.find((branch) => branch.fullName === current.fullName)?.target !== current.target
  )
    throw new StaleReferenceSnapshotError();
  const result = await integrate(
    current.fullName,
    'merge',
    before.value.commitCount === 1 ? 'default' : 'no-ff',
  );
  return result.status === 'succeeded'
    ? { ...result, message: 'Branch finished into the base. The topic branch was retained.' }
    : result;
}
