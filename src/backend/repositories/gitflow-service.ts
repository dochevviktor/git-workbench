import { createHash } from 'node:crypto';
import type {
  RepositoryGitFlowAction,
  RepositoryGitFlowActionResult,
  RepositoryGitFlowBranch,
  RepositoryGitFlowConfig,
  RepositoryGitFlowContext,
  RepositoryGitFlowFailureReason,
  RepositoryGitFlowType,
  RepositoryHead,
} from '../../common/ipc/contracts';
import {
  repositoryGitFlowActionResultSchema,
  repositoryGitFlowConfigSchema,
  repositoryGitFlowContextSchema,
} from '../../common/ipc/contracts';
import { GitCancelledError, GitCommandError, GitTimeoutError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';
import { readReferenceContext } from './reference-service';

const gitFlowReadTimeoutMs = 15_000;
const gitFlowWriteTimeoutMs = 120_000;
const gitFlowReadOutputLimit = 8 * 1024 * 1024;
const gitFlowWriteOutputLimit = 2 * 1024 * 1024;
const displayedOutputLimit = 65_536;
const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const configKeys = {
  productionBranch: 'gitflow.branch.master',
  developBranch: 'gitflow.branch.develop',
  featurePrefix: 'gitflow.prefix.feature',
  releasePrefix: 'gitflow.prefix.release',
  hotfixPrefix: 'gitflow.prefix.hotfix',
} as const;

export interface GitFlowRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface GitFlowContextInput {
  readonly repositoryId: string;
  readonly cwd: string;
  readonly gitDir: string;
  readonly worktreePath: string;
}

export interface GitFlowActionInput extends GitFlowContextInput {
  readonly action: RepositoryGitFlowAction;
  readonly signal?: AbortSignal | undefined;
  readonly onCommand?: ((args: readonly string[]) => void) | undefined;
}

export class GitFlowSnapshotError extends Error {
  constructor() {
    super('The Git-flow configuration or branches changed after they were read. Refresh and try again.');
    this.name = 'GitFlowSnapshotError';
  }
}

export class GitFlowRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitFlowRequestError';
  }
}

interface FlowDefinition {
  readonly type: RepositoryGitFlowType;
  readonly prefix: string;
  readonly baseBranch: string;
}

interface ConfigRead {
  readonly status: RepositoryGitFlowContext['status'];
  readonly config: RepositoryGitFlowConfig | null;
  readonly message: string;
}

interface ActionProgress {
  readonly output: string[];
  createdBranch: string | null;
  deletedBranch: string | null;
  tag: string | null;
}

type GitFlowActionInputFor<Kind extends RepositoryGitFlowAction['kind']> = Omit<
  GitFlowActionInput,
  'action'
> & {
  readonly action: Extract<RepositoryGitFlowAction, { readonly kind: Kind }>;
};

/** Reads the native gitflow.* configuration and the topic branches it governs. */
export async function readGitFlowContext(
  runner: GitFlowRunner,
  input: GitFlowContextInput,
): Promise<RepositoryGitFlowContext> {
  const head = await readCurrentHead(runner, input.cwd);
  const [configuration, references] = await Promise.all([
    readConfiguration(runner, input.cwd),
    readReferenceContext(runner, {
      repositoryId: input.repositoryId,
      cwd: input.cwd,
      gitDir: input.gitDir,
      worktreePath: input.worktreePath,
      head,
    }),
  ]);
  const config = configuration.config;
  const localBranches = references.branches.slice(0, 10_000).map((branch) => ({
    name: branch.name,
    target: branch.target,
    isHead: branch.isHead,
  }));
  const branches = config ? flowBranches(references.branches, config) : [];
  const clean = !references.dirty && references.untrackedCount === 0 && references.conflictedCount === 0;
  const capabilities = capabilitiesFor({
    configuration,
    references,
    head,
    clean,
    branches,
    config,
  });
  const status = configuration.status;
  const message =
    status === 'unconfigured'
      ? 'Git-flow is not initialized in this repository.'
      : status === 'invalid'
        ? configuration.message
        : 'Git-flow is ready.';
  const snapshot = createSnapshot({
    configuration,
    head,
    localBranches,
    branches,
    clean,
    untrackedCount: references.untrackedCount,
    conflictedCount: references.conflictedCount,
    pendingOperation: references.pendingOperation,
  });

  return repositoryGitFlowContextSchema.parse({
    repositoryId: input.repositoryId,
    status,
    configured: status === 'configured',
    config,
    head,
    localBranches,
    branches,
    clean,
    untrackedCount: references.untrackedCount,
    conflictedCount: references.conflictedCount,
    pendingOperation: references.pendingOperation,
    capabilities,
    message,
    snapshot,
  } satisfies RepositoryGitFlowContext);
}

/** Runs one explicit Git-flow action. The operation never invokes an external git-flow executable. */
export async function applyGitFlowAction(
  runner: GitFlowRunner,
  input: GitFlowActionInput,
): Promise<RepositoryGitFlowActionResult> {
  const before = await readGitFlowContext(runner, input);
  if (before.snapshot !== input.action.snapshot) throw new GitFlowSnapshotError();

  const progress: ActionProgress = { output: [], createdBranch: null, deletedBranch: null, tag: null };
  try {
    switch (input.action.kind) {
      case 'initialize':
        return await initialize(runner, input as GitFlowActionInputFor<'initialize'>, before, progress);
      case 'start':
        return await startTopic(runner, input as GitFlowActionInputFor<'start'>, before, progress);
      case 'finish':
        return await finishTopic(runner, input as GitFlowActionInputFor<'finish'>, before, progress);
    }
  } catch (error) {
    if (error instanceof GitCancelledError || error instanceof GitTimeoutError) throw error;
    if (error instanceof GitFlowRequestError)
      return blockedResult(input, before, input.action.kind, 'other', error.message, progress, '');
    if (!(error instanceof GitCommandError)) throw error;
    const output = displayOutput(error.stdout, error.stderr);
    const classified = classifyFailure(output);
    const after = await readGitFlowContext(runner, input).catch(() => before);
    return blockedResult(
      input,
      after,
      input.action.kind,
      classified.reason,
      classified.message,
      progress,
      output,
    );
  }
}

async function initialize(
  runner: GitFlowRunner,
  input: GitFlowActionInputFor<'initialize'>,
  before: RepositoryGitFlowContext,
  progress: ActionProgress,
): Promise<RepositoryGitFlowActionResult> {
  if (before.status === 'configured')
    return blockedResult(
      input,
      before,
      'initialize',
      'already-configured',
      'Git-flow is already initialized in this repository.',
      progress,
      '',
    );
  if (before.status === 'invalid')
    return blockedResult(
      input,
      before,
      'initialize',
      'invalid-config',
      'Repair the existing gitflow.* configuration before initializing it again.',
      progress,
      '',
    );
  const refusal = commonRefusal(before);
  if (refusal)
    return blockedResult(input, before, 'initialize', refusal.reason, refusal.message, progress, '');

  const config = input.action.config;
  const configProblem = await validateConfiguration(runner, input.cwd, config);
  if (configProblem)
    return blockedResult(input, before, 'initialize', 'invalid-config', configProblem, progress, '');
  const production = beforeContextBranch(before, config.productionBranch);
  if (!production)
    return blockedResult(
      input,
      before,
      'initialize',
      'missing-base',
      `The production branch '${config.productionBranch}' does not exist.`,
      progress,
      '',
    );

  const develop = beforeContextBranch(before, config.developBranch);
  if (!develop) {
    const result = await runGit(runner, input, [
      'branch',
      '--no-track',
      '--',
      config.developBranch,
      production.target,
    ]);
    progress.output.push(displayOutput(result.stdout, result.stderr));
    progress.createdBranch = `refs/heads/${config.developBranch}`;
  }
  for (const [field, key] of Object.entries(configKeys) as Array<[keyof RepositoryGitFlowConfig, string]>) {
    const result = await runGit(runner, input, ['config', '--local', key, config[field]]);
    progress.output.push(displayOutput(result.stdout, result.stderr));
  }

  const context = await readGitFlowContext(runner, input);
  return appliedResult(
    input,
    context,
    'initialize',
    develop
      ? `Git-flow is configured for '${config.productionBranch}' and '${config.developBranch}'.`
      : `Git-flow is initialized and created '${config.developBranch}'.`,
    progress,
  );
}

async function startTopic(
  runner: GitFlowRunner,
  input: GitFlowActionInputFor<'start'>,
  before: RepositoryGitFlowContext,
  progress: ActionProgress,
): Promise<RepositoryGitFlowActionResult> {
  if (before.status === 'unconfigured')
    return blockedResult(
      input,
      before,
      'start',
      'unconfigured',
      'Initialize Git-flow before starting a topic.',
      progress,
      '',
    );
  if (before.status === 'invalid' || !before.config)
    return blockedResult(input, before, 'start', 'invalid-config', before.message, progress, '');
  const refusal = commonRefusal(before);
  if (refusal) return blockedResult(input, before, 'start', refusal.reason, refusal.message, progress, '');

  const definition = flowDefinition(input.action.type, before.config);
  const base = beforeContextBranch(before, definition.baseBranch);
  if (!base)
    return blockedResult(
      input,
      before,
      'start',
      'missing-base',
      `The ${input.action.type} base branch '${definition.baseBranch}' does not exist.`,
      progress,
      '',
    );
  if (input.action.type === 'hotfix' && before.branches.some((branch) => branch.type === 'hotfix'))
    return blockedResult(
      input,
      before,
      'start',
      'active-hotfix',
      'Finish the existing hotfix before starting another hotfix.',
      progress,
      '',
    );

  const fullName = `${definition.prefix}${input.action.name}`;
  const nameProblem = await validateBranchName(runner, input.cwd, fullName);
  if (nameProblem) return blockedResult(input, before, 'start', 'invalid-name', nameProblem, progress, '');
  if (await refExists(runner, input.cwd, `refs/heads/${fullName}`))
    return blockedResult(
      input,
      before,
      'start',
      'branch-exists',
      `The branch '${fullName}' already exists.`,
      progress,
      '',
    );

  const result = await runGit(runner, input, ['checkout', '-b', fullName, base.target, '--']);
  progress.output.push(displayOutput(result.stdout, result.stderr));
  progress.createdBranch = `refs/heads/${fullName}`;
  const context = await readGitFlowContext(runner, input);
  return appliedResult(
    input,
    context,
    'start',
    `Started ${input.action.type} '${input.action.name}'.`,
    progress,
  );
}

async function finishTopic(
  runner: GitFlowRunner,
  input: GitFlowActionInputFor<'finish'>,
  before: RepositoryGitFlowContext,
  progress: ActionProgress,
): Promise<RepositoryGitFlowActionResult> {
  if (before.status === 'unconfigured')
    return blockedResult(
      input,
      before,
      'finish',
      'unconfigured',
      'Initialize Git-flow before finishing a topic.',
      progress,
      '',
    );
  if (before.status === 'invalid' || !before.config)
    return blockedResult(input, before, 'finish', 'invalid-config', before.message, progress, '');
  const refusal = commonRefusal(before);
  if (refusal) return blockedResult(input, before, 'finish', refusal.reason, refusal.message, progress, '');

  const definition = flowDefinition(input.action.type, before.config);
  const sourceFullName = `${definition.prefix}${input.action.name}`;
  const source = before.branches.find(
    (branch) => branch.type === input.action.type && branch.fullName === `refs/heads/${sourceFullName}`,
  );
  if (!source)
    return blockedResult(
      input,
      before,
      'finish',
      'branch-not-found',
      `The ${input.action.type} branch '${sourceFullName}' no longer exists.`,
      progress,
      '',
    );
  if (!source.isHead)
    return blockedResult(
      input,
      before,
      'finish',
      'not-current',
      `Check out '${sourceFullName}' before finishing it.`,
      progress,
      '',
    );

  const production = beforeContextBranch(before, before.config.productionBranch);
  const develop = beforeContextBranch(before, before.config.developBranch);
  if (!production || !develop)
    return blockedResult(
      input,
      before,
      'finish',
      'missing-base',
      'Both the production and develop branches must exist before finishing a Git-flow topic.',
      progress,
      '',
    );

  const tagName = input.action.type === 'feature' ? null : input.action.name;
  if (tagName) {
    const tagProblem = await validateTagName(runner, input.cwd, tagName);
    if (tagProblem) return blockedResult(input, before, 'finish', 'invalid-name', tagProblem, progress, '');
    if (await refExists(runner, input.cwd, `refs/tags/${tagName}`))
      return blockedResult(
        input,
        before,
        'finish',
        'tag-exists',
        `The tag '${tagName}' already exists.`,
        progress,
        '',
      );
    try {
      await runGit(runner, input, ['var', 'GIT_COMMITTER_IDENT']);
    } catch (error) {
      if (error instanceof GitCommandError) {
        return blockedResult(
          input,
          before,
          'finish',
          'identity',
          'Git needs a configured committer identity before it can create the release tag.',
          progress,
          displayOutput(error.stdout, error.stderr),
        );
      }
      throw error;
    }
  }

  await checkoutBranch(runner, input, before.config.productionBranch, progress);
  await mergeBranch(
    runner,
    input,
    source,
    before.config.productionBranch,
    input.action.noFastForward,
    progress,
  );

  if (tagName) {
    const tagMessage = input.action.tagMessage.trim() || `${input.action.type} ${input.action.name}`;
    const result = await runGit(
      runner,
      input,
      ['tag', '--annotate', '--cleanup=whitespace', '--file=-', tagName, 'HEAD'],
      tagMessage + '\n',
    );
    progress.output.push(displayOutput(result.stdout, result.stderr));
    progress.tag = `refs/tags/${tagName}`;
  }

  if (input.action.type !== 'feature' && !input.action.mergeIntoDevelop) {
    if (!input.action.keepBranch) {
      await deleteTopicBranch(runner, input, sourceFullName, progress);
    }
    const context = await readGitFlowContext(runner, input);
    return appliedResult(
      input,
      context,
      'finish',
      `Finished ${input.action.type} '${input.action.name}' on '${before.config.productionBranch}'.`,
      progress,
    );
  }

  await checkoutBranch(runner, input, before.config.developBranch, progress);
  await mergeBranch(runner, input, source, before.config.developBranch, input.action.noFastForward, progress);
  if (!input.action.keepBranch) await deleteTopicBranch(runner, input, sourceFullName, progress);

  const context = await readGitFlowContext(runner, input);
  return appliedResult(
    input,
    context,
    'finish',
    `Finished ${input.action.type} '${input.action.name}'${tagName ? ` and created tag '${tagName}'.` : '.'}`,
    progress,
  );
}

async function checkoutBranch(
  runner: GitFlowRunner,
  input: GitFlowActionInput,
  branch: string,
  progress: ActionProgress,
): Promise<void> {
  const result = await runGit(runner, input, ['checkout', '--no-guess', branch, '--']);
  progress.output.push(displayOutput(result.stdout, result.stderr));
}

async function mergeBranch(
  runner: GitFlowRunner,
  input: GitFlowActionInput,
  source: RepositoryGitFlowBranch,
  target: string,
  noFastForward: boolean,
  progress: ActionProgress,
): Promise<void> {
  const result = await runGit(runner, input, [
    'merge',
    '--no-edit',
    ...(noFastForward ? ['--no-ff'] : []),
    '-m',
    `Merge branch '${source.fullName.slice('refs/heads/'.length)}' into ${target}`,
    source.target,
  ]);
  progress.output.push(displayOutput(result.stdout, result.stderr));
}

async function deleteTopicBranch(
  runner: GitFlowRunner,
  input: GitFlowActionInput,
  fullName: string,
  progress: ActionProgress,
): Promise<void> {
  const result = await runGit(runner, input, ['branch', '--delete', '--', fullName]);
  progress.output.push(displayOutput(result.stdout, result.stderr));
  progress.deletedBranch = `refs/heads/${fullName}`;
}

async function runGit(
  runner: GitFlowRunner,
  input: GitFlowActionInput,
  args: readonly string[],
  stdin?: string,
): Promise<GitCommandResult> {
  input.onCommand?.(args);
  const options: GitRunOptions = {
    cwd: input.cwd,
    timeoutMs: gitFlowWriteTimeoutMs,
    maxOutputBytes: gitFlowWriteOutputLimit,
    signal: input.signal,
    ...(stdin === undefined ? {} : { stdin }),
    env: { GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
  };
  return runner.run(args, options);
}

async function readConfiguration(runner: GitFlowRunner, cwd: string): Promise<ConfigRead> {
  const values = await Promise.all(
    (Object.entries(configKeys) as Array<[keyof RepositoryGitFlowConfig, string]>).map(
      async ([field, key]) =>
        [field, await optionalOutput(runner, cwd, ['config', '--local', '--get', key])] as const,
    ),
  );
  const present = values.some(([, value]) => value !== null);
  if (!present)
    return {
      status: 'unconfigured',
      config: null,
      message: 'Git-flow is not initialized in this repository.',
    };
  if (values.some(([, value]) => value === null))
    return { status: 'invalid', config: null, message: 'The gitflow.* configuration is incomplete.' };

  const raw = Object.fromEntries(values.map(([field, value]) => [field, value as string])) as Record<
    keyof RepositoryGitFlowConfig,
    string
  >;
  const parsed = repositoryGitFlowConfigSchema.safeParse(raw);
  if (!parsed.success)
    return { status: 'invalid', config: null, message: 'The gitflow.* configuration is invalid.' };
  if (parsed.data.productionBranch === parsed.data.developBranch)
    return { status: 'invalid', config: null, message: 'Production and develop must be different branches.' };
  if (new Set([parsed.data.featurePrefix, parsed.data.releasePrefix, parsed.data.hotfixPrefix]).size !== 3)
    return {
      status: 'invalid',
      config: null,
      message: 'Feature, release, and hotfix prefixes must be different.',
    };
  return { status: 'configured', config: parsed.data, message: 'Git-flow is ready.' };
}

async function validateConfiguration(
  runner: GitFlowRunner,
  cwd: string,
  config: RepositoryGitFlowConfig,
): Promise<string | null> {
  if (config.productionBranch === config.developBranch)
    return 'Production and develop must be different branches.';
  if (new Set([config.featurePrefix, config.releasePrefix, config.hotfixPrefix]).size !== 3)
    return 'Feature, release, and hotfix prefixes must be different.';
  for (const branch of [config.productionBranch, config.developBranch]) {
    const problem = await validateBranchName(runner, cwd, branch);
    if (problem) return problem;
  }
  for (const prefix of [config.featurePrefix, config.releasePrefix, config.hotfixPrefix]) {
    const problem = await validateBranchName(runner, cwd, `${prefix}sample`);
    if (problem) return `Git does not accept the Git-flow prefix '${prefix}'.`;
  }
  return null;
}

async function validateBranchName(runner: GitFlowRunner, cwd: string, name: string): Promise<string | null> {
  try {
    await runner.run(['check-ref-format', `refs/heads/${name}`], {
      cwd,
      timeoutMs: gitFlowReadTimeoutMs,
      maxOutputBytes: 4_096,
    });
    return null;
  } catch (error) {
    if (error instanceof GitCommandError) return `Git does not accept '${name}' as a branch name.`;
    throw error;
  }
}

async function validateTagName(runner: GitFlowRunner, cwd: string, name: string): Promise<string | null> {
  try {
    await runner.run(['check-ref-format', `refs/tags/${name}`], {
      cwd,
      timeoutMs: gitFlowReadTimeoutMs,
      maxOutputBytes: 4_096,
    });
    return null;
  } catch (error) {
    if (error instanceof GitCommandError) return `Git does not accept '${name}' as a tag name.`;
    throw error;
  }
}

async function refExists(runner: GitFlowRunner, cwd: string, fullName: string): Promise<boolean> {
  try {
    await runner.run(['show-ref', '--verify', '--quiet', fullName], {
      cwd,
      timeoutMs: gitFlowReadTimeoutMs,
      maxOutputBytes: 4_096,
    });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return false;
    throw error;
  }
}

async function optionalOutput(
  runner: GitFlowRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await runner.run(args, {
      cwd,
      timeoutMs: gitFlowReadTimeoutMs,
      maxOutputBytes: gitFlowReadOutputLimit,
    });
    const value = result.stdout.trim();
    return value || null;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return null;
    throw error;
  }
}

async function readCurrentHead(runner: GitFlowRunner, cwd: string): Promise<RepositoryHead> {
  const branch = await optionalOutput(runner, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const commit = await optionalOutput(runner, cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const validCommit = commit && objectIdPattern.test(commit) ? commit : null;
  if (branch) return { state: validCommit ? 'branch' : 'unborn', name: branch, commit: validCommit };
  if (validCommit) return { state: 'detached', name: null, commit: validCommit };
  return { state: 'unknown', name: null, commit: null };
}

function flowDefinitions(config: RepositoryGitFlowConfig): FlowDefinition[] {
  return [
    { type: 'feature', prefix: config.featurePrefix, baseBranch: config.developBranch },
    { type: 'release', prefix: config.releasePrefix, baseBranch: config.developBranch },
    { type: 'hotfix', prefix: config.hotfixPrefix, baseBranch: config.productionBranch },
  ];
}

function flowDefinition(type: RepositoryGitFlowType, config: RepositoryGitFlowConfig): FlowDefinition {
  return flowDefinitions(config).find((definition) => definition.type === type)!;
}

function flowBranches(
  branches: readonly {
    readonly name: string;
    readonly fullName: string;
    readonly target: string;
    readonly isHead: boolean;
  }[],
  config: RepositoryGitFlowConfig,
): RepositoryGitFlowBranch[] {
  const definitions = flowDefinitions(config).sort((left, right) => right.prefix.length - left.prefix.length);
  return branches.flatMap((branch) => {
    const definition = definitions.find(
      (candidate) => branch.name.startsWith(candidate.prefix) && branch.name.length > candidate.prefix.length,
    );
    if (!definition) return [];
    return [
      {
        type: definition.type,
        name: branch.name.slice(definition.prefix.length),
        fullName: branch.fullName,
        baseBranch: definition.baseBranch,
        target: branch.target,
        isHead: branch.isHead,
      },
    ];
  });
}

function beforeContextBranch(
  context: RepositoryGitFlowContext,
  name: string,
): { readonly name: string; readonly target: string } | undefined {
  return context.localBranches.find((branch) => branch.name === name);
}

function capabilitiesFor(input: {
  readonly configuration: ConfigRead;
  readonly references: Awaited<ReturnType<typeof readReferenceContext>>;
  readonly head: RepositoryHead;
  readonly clean: boolean;
  readonly branches: readonly RepositoryGitFlowBranch[];
  readonly config: RepositoryGitFlowConfig | null;
}): RepositoryGitFlowContext['capabilities'] {
  const common = commonBlock(input.head, input.clean, input.references.pendingOperation);
  const productionExists = input.config
    ? input.references.branches.some((branch) => branch.name === input.config!.productionBranch)
    : false;
  const developExists = input.config
    ? input.references.branches.some((branch) => branch.name === input.config!.developBranch)
    : false;
  const currentTopic = input.branches.find((branch) => branch.isHead);
  const initializeReason =
    input.configuration.status === 'configured'
      ? 'Git-flow is already initialized.'
      : input.configuration.status === 'invalid'
        ? input.configuration.message
        : (common ?? null);
  const startReason =
    input.configuration.status !== 'configured'
      ? input.configuration.status === 'invalid'
        ? input.configuration.message
        : 'Initialize Git-flow before starting a topic.'
      : (common ?? (!developExists || !productionExists ? 'Both Git-flow base branches must exist.' : null));
  const finishReason =
    input.configuration.status !== 'configured'
      ? input.configuration.status === 'invalid'
        ? input.configuration.message
        : 'Initialize Git-flow before finishing a topic.'
      : (common ??
        (!productionExists || !developExists
          ? 'Both Git-flow base branches must exist.'
          : currentTopic
            ? null
            : 'Check out a feature, release, or hotfix branch to finish it.'));
  return {
    canInitialize:
      input.configuration.status === 'unconfigured' &&
      input.head.state === 'branch' &&
      input.head.commit !== null &&
      input.clean,
    initializeReason:
      typeof initializeReason === 'string' ? initializeReason : (initializeReason?.message ?? null),
    canStart:
      input.configuration.status === 'configured' && common === null && productionExists && developExists,
    startReason: typeof startReason === 'string' ? startReason : (startReason?.message ?? null),
    canFinish:
      input.configuration.status === 'configured' &&
      common === null &&
      productionExists &&
      developExists &&
      currentTopic !== undefined,
    finishReason: typeof finishReason === 'string' ? finishReason : (finishReason?.message ?? null),
  };
}

function commonBlock(
  head: RepositoryHead,
  clean: boolean,
  pendingOperation: RepositoryGitFlowContext['pendingOperation'],
): { readonly reason: RepositoryGitFlowFailureReason; readonly message: string } | null {
  if (pendingOperation)
    return {
      reason: 'pending-operation',
      message: `Finish or abort the ${pendingOperation} in progress before using Git-flow.`,
    };
  if (!clean)
    return {
      reason: 'dirty',
      message: 'Save, commit, or stash local changes before using Git-flow.',
    };
  if (head.state !== 'branch' || !head.name || !head.commit)
    return {
      reason: 'detached',
      message: 'Check out a committed branch before using Git-flow.',
    };
  return null;
}

function commonRefusal(
  context: RepositoryGitFlowContext,
): { readonly reason: RepositoryGitFlowFailureReason; readonly message: string } | null {
  return commonBlock(context.head, context.clean, context.pendingOperation);
}

function createSnapshot(input: {
  readonly configuration: ConfigRead;
  readonly head: RepositoryHead;
  readonly localBranches: readonly {
    readonly name: string;
    readonly target: string;
    readonly isHead: boolean;
  }[];
  readonly branches: readonly RepositoryGitFlowBranch[];
  readonly clean: boolean;
  readonly untrackedCount: number;
  readonly conflictedCount: number;
  readonly pendingOperation: RepositoryGitFlowContext['pendingOperation'];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        status: input.configuration.status,
        config: input.configuration.config,
        head: input.head,
        localBranches: input.localBranches,
        branches: input.branches,
        clean: input.clean,
        untrackedCount: input.untrackedCount,
        conflictedCount: input.conflictedCount,
        pendingOperation: input.pendingOperation,
      }),
      'utf8',
    )
    .digest('hex');
}

function appliedResult(
  input: GitFlowActionInput,
  context: RepositoryGitFlowContext,
  kind: RepositoryGitFlowAction['kind'],
  message: string,
  progress: ActionProgress,
): RepositoryGitFlowActionResult {
  return repositoryGitFlowActionResultSchema.parse({
    status: 'applied',
    repositoryId: input.repositoryId,
    kind,
    message: message.slice(0, 512),
    output: outputText(progress.output),
    context,
    createdBranch: progress.createdBranch,
    deletedBranch: progress.deletedBranch,
    tag: progress.tag,
  } satisfies RepositoryGitFlowActionResult);
}

function blockedResult(
  input: GitFlowActionInput,
  context: RepositoryGitFlowContext,
  kind: RepositoryGitFlowAction['kind'],
  reason: RepositoryGitFlowFailureReason,
  message: string,
  progress: ActionProgress,
  output: string,
): RepositoryGitFlowActionResult {
  return repositoryGitFlowActionResultSchema.parse({
    status: 'blocked',
    repositoryId: input.repositoryId,
    kind,
    reason,
    message: message.slice(0, 512),
    output: outputText([...progress.output, output]),
    context,
    paths: [],
    createdBranch: progress.createdBranch,
    deletedBranch: progress.deletedBranch,
    tag: progress.tag,
  } satisfies RepositoryGitFlowActionResult);
}

function classifyFailure(output: string): {
  readonly reason: RepositoryGitFlowFailureReason;
  readonly message: string;
} {
  if (/CONFLICT|automatic merge failed|fix conflicts/iu.test(output))
    return {
      reason: 'conflict',
      message: 'Git-flow stopped with conflicts. Resolve and continue or abort from Recovery.',
    };
  if (/please tell me who you are|unable to auto-detect email|empty ident name/iu.test(output))
    return {
      reason: 'identity',
      message: 'Git needs a configured author identity before it can finish this Git-flow action.',
    };
  if (/would be overwritten|local changes|would overwrite/iu.test(output))
    return {
      reason: 'dirty',
      message: 'Git-flow could not switch branches because local changes would be overwritten.',
    };
  if (/already exists/iu.test(output))
    return { reason: 'branch-exists', message: 'The requested Git-flow reference already exists.' };
  return {
    reason: 'other',
    message: 'Git could not complete the Git-flow action. Its output is shown below.',
  };
}

function outputText(parts: readonly string[]): string {
  const value = parts.filter(Boolean).join('\n');
  return value.length > displayedOutputLimit
    ? `…\n${value.slice(value.length - displayedOutputLimit + 2)}`
    : value;
}

function displayOutput(stdout: string, stderr: string): string {
  return `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`;
}
