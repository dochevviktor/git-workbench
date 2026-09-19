import { z } from 'zod';

export interface RequestContract<Input, Output> {
  readonly channel: string;
  readonly input: z.ZodType<Input>;
  readonly output: z.ZodType<Output>;
}

function request<Input, Output>(
  channel: string,
  input: z.ZodType<Input>,
  output: z.ZodType<Output>,
): RequestContract<Input, Output> {
  return { channel, input, output };
}

export const appInfoSchema = z.strictObject({
  name: z.string(),
  version: z.string(),
  platform: z.enum(['linux', 'darwin', 'win32']),
  mode: z.enum(['development', 'production']),
  versions: z.strictObject({ electron: z.string(), chrome: z.string(), node: z.string() }),
});

export const windowStateSchema = z.strictObject({
  maximized: z.boolean(),
  focused: z.boolean(),
  fullScreen: z.boolean(),
});

export const windowCommandSchema = z.strictObject({
  action: z.enum([
    'minimize',
    'toggle-maximize',
    'close',
    'toggle-full-screen',
    'zoom-in',
    'zoom-out',
    'reset-zoom',
    'reload',
    'toggle-developer-tools',
    'quit',
  ]),
});

/** Standard editing commands applied by the owning window to its focused renderer element. */
export const editCommandSchema = z.strictObject({
  action: z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'select-all']),
});

export const clipboardTextSchema = z.strictObject({
  text: z.string().max(1_048_576),
});

// Paths are intentionally opaque strings in the shared layer. Absolute-path and filesystem
// validation belongs to the main process, where the platform rules and the selected window are
// available.
export const repositoryPathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes('\0'), 'A repository path cannot contain a NUL byte.');

export const repositoryIdSchema = z.string().regex(/^repo-[a-f0-9]{64}$/);

export const sourceDirectoryIdSchema = z.string().regex(/^source-[a-f0-9]{64}$/);
export const repositoryManagerFolderIdSchema = z.string().regex(/^folder-[a-f0-9]{64}$/);
export const repositoryManagerRepositoryIdSchema = z.string().regex(/^manager-repo-[a-f0-9]{64}$/);
export const gitObjectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

export const repositoryHeadSchema = z.strictObject({
  state: z.enum(['branch', 'detached', 'unborn', 'unknown']),
  name: z.string().nullable(),
  commit: gitObjectIdSchema.nullable(),
});

export const repositoryWorkingTreeSchema = z.strictObject({
  state: z.enum(['clean', 'dirty', 'unavailable', 'unknown']),
  changedFileCount: z.number().int().nonnegative().max(100_000).nullable(),
});

export const repositoryWorkingChangeAreaSchema = z.enum(['staged', 'unstaged', 'untracked', 'ignored']);

export const repositoryWorkingChangeStatusSchema = z.enum([
  'added',
  'copied',
  'deleted',
  'modified',
  'renamed',
  'type-changed',
  'unmerged',
  'untracked',
  'ignored',
  'unknown',
]);

export const repositoryTabOrientationSchema = z.enum(['vertical', 'horizontal']);

export const repositoryTabPreferencesSchema = z.strictObject({
  tabOrientation: repositoryTabOrientationSchema,
  activeRepositoryId: repositoryIdSchema.nullable(),
});

export const repositorySummarySchema = z.strictObject({
  id: repositoryIdSchema,
  name: z.string().min(1).max(512),
  path: repositoryPathSchema,
  worktreePath: repositoryPathSchema.nullable(),
  gitDir: repositoryPathSchema,
  commonDir: repositoryPathSchema,
  bare: z.boolean(),
  head: repositoryHeadSchema,
  workingTree: repositoryWorkingTreeSchema,
  referenceVersion: z.string().max(64).optional(),
});

export const recentRepositorySchema = z.strictObject({
  id: repositoryIdSchema,
  name: z.string().min(1).max(512),
  path: repositoryPathSchema,
  lastOpenedAt: z.string().datetime({ offset: true }),
  status: z.enum(['available', 'missing', 'not-directory']),
  open: z.boolean(),
});

export const sourceDirectoryStatusSchema = z.enum(['available', 'missing', 'not-directory', 'unreadable']);

export const repositoryManagerSourceDirectorySchema = z.strictObject({
  id: sourceDirectoryIdSchema,
  name: z.string().min(1).max(512),
  path: repositoryPathSchema,
  status: sourceDirectoryStatusSchema,
  repositoryCount: z.number().int().nonnegative().max(5_000),
  lastScannedAt: z.string().datetime({ offset: true }).nullable(),
  truncated: z.boolean(),
});

export const repositoryManagerFolderSchema = z.strictObject({
  id: repositoryManagerFolderIdSchema,
  sourceDirectoryId: sourceDirectoryIdSchema,
  name: z.string().min(1).max(512),
  relativePath: z.string().max(32_768),
  parentId: repositoryManagerFolderIdSchema.nullable(),
});

export const repositoryManagerRepositorySchema = z.strictObject({
  id: repositoryManagerRepositoryIdSchema,
  sourceDirectoryId: sourceDirectoryIdSchema,
  folderId: repositoryManagerFolderIdSchema.nullable(),
  name: z.string().min(1).max(512),
  path: repositoryPathSchema,
  relativePath: z.string().max(32_768),
  kind: z.enum(['worktree', 'bare']),
  sessionId: repositoryIdSchema.nullable(),
});

export const repositoryManagerWarningSchema = z.strictObject({
  code: z.enum(['unreadable', 'scan-limit', 'depth-limit', 'symlink-skipped']),
  path: repositoryPathSchema,
  message: z.string().min(1).max(512),
});

export const repositoryManagerSnapshotSchema = z.strictObject({
  sourceDirectories: z.array(repositoryManagerSourceDirectorySchema).max(20),
  folders: z.array(repositoryManagerFolderSchema).max(20_000),
  repositories: z.array(repositoryManagerRepositorySchema).max(5_000),
  warnings: z.array(repositoryManagerWarningSchema).max(100),
});

export const gitInfoSchema = z.strictObject({
  status: z.enum(['available', 'missing', 'error']),
  version: z.string().nullable(),
  executable: z.string().nullable(),
});

export const repositoryOpenSchema = z.strictObject({ path: repositoryPathSchema });
export const repositoryInitializeSchema = z.strictObject({
  path: repositoryPathSchema,
  bare: z.boolean(),
});
export const repositorySessionSchema = z.strictObject({ id: repositoryIdSchema });
export const repositoryTabOrientationRequestSchema = z.strictObject({
  tabOrientation: repositoryTabOrientationSchema,
});
export const sourceDirectoryRequestSchema = z.strictObject({ path: repositoryPathSchema });
export const sourceDirectorySessionSchema = z.strictObject({ id: sourceDirectoryIdSchema });

// A location is addressed only by an identifier the backend issued. The main process resolves the
// path itself, so the renderer cannot ask the file manager to open an arbitrary location.
export const repositoryLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open'), id: repositoryIdSchema }),
  z.strictObject({ kind: z.literal('recent'), id: repositoryIdSchema }),
  z.strictObject({ kind: z.literal('manager-repository'), id: repositoryManagerRepositoryIdSchema }),
  z.strictObject({ kind: z.literal('source-directory'), id: sourceDirectoryIdSchema }),
]);

export const repositoryHistoryReferenceKindSchema = z.enum([
  'head',
  'branch',
  'remote',
  'tag',
  'stash',
  'other',
]);

export const repositoryHistoryDecorationSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  fullName: z.string().min(1).max(32_768),
  kind: repositoryHistoryReferenceKindSchema,
  target: gitObjectIdSchema,
  isHead: z.boolean(),
});

export const repositoryHistoryPersonSchema = z.strictObject({
  name: z.string().max(4_096),
  email: z.string().max(4_096),
  date: z.string().datetime({ offset: true }),
});

export const repositoryHistoryCommitSchema = z.strictObject({
  id: gitObjectIdSchema,
  parents: z.array(gitObjectIdSchema).max(128),
  author: repositoryHistoryPersonSchema,
  committer: repositoryHistoryPersonSchema,
  subject: z.string().max(16_384),
  body: z.string().max(262_144),
  decorations: z.array(repositoryHistoryDecorationSchema).max(256),
});

export const repositoryHistoryReferenceSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  fullName: z.string().min(1).max(32_768),
  kind: repositoryHistoryReferenceKindSchema,
  target: gitObjectIdSchema,
  isHead: z.boolean(),
  upstream: z.string().max(32_768).nullable(),
  /** A configured upstream that no longer exists locally, so the branch is stale. */
  upstreamGone: z.boolean(),
  ahead: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  behind: z.number().int().nonnegative().max(1_000_000_000).nullable(),
});

export const repositoryHistoryTrackingSchema = z.strictObject({
  upstream: z.string().max(32_768).nullable(),
  ahead: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  behind: z.number().int().nonnegative().max(1_000_000_000).nullable(),
});

const repositoryHistoryFilterQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !value.includes('\0'), 'A history search cannot contain a NUL byte.');

/** The first F06 slice keeps filtering explicit so Git arguments remain backend-owned. */
export const repositoryHistoryFilterSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({
    kind: z.literal('reference'),
    target: gitObjectIdSchema,
  }),
  z.strictObject({
    kind: z.literal('commit-search'),
    query: repositoryHistoryFilterQuerySchema,
  }),
]);

export const repositoryHistoryRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  offset: z.number().int().nonnegative().max(1_000_000),
  limit: z.number().int().min(1).max(100),
  filter: repositoryHistoryFilterSchema.optional(),
});

export const repositoryHistoryPageSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  offset: z.number().int().nonnegative().max(1_000_000),
  commits: z.array(repositoryHistoryCommitSchema).max(100),
  references: z.array(repositoryHistoryReferenceSchema).max(10_000),
  head: repositoryHeadSchema,
  tracking: repositoryHistoryTrackingSchema,
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().max(1_000_000).nullable(),
});

export const repositoryRevisionPathSchema = z
  .string()
  .max(32_768)
  .refine((value) => !value.includes('\0'), 'A revision path cannot contain a NUL byte.')
  .refine(
    (value) =>
      value.length === 0 ||
      (!value.startsWith('/') &&
        !value.endsWith('/') &&
        !value.includes('//') &&
        !value.split('/').some((part) => part === '.' || part === '..')),
    'A revision path must be relative and normalized.',
  );

export const repositoryCommitChangeStatusSchema = z.enum([
  'added',
  'copied',
  'deleted',
  'modified',
  'renamed',
  'type-changed',
  'unmerged',
  'unknown',
]);

const repositoryGitModeSchema = z.string().regex(/^\d{6}$/u);

export const repositoryCommitChangeSchema = z.strictObject({
  status: repositoryCommitChangeStatusSchema,
  path: z.string().min(1).max(32_768),
  previousPath: z.string().min(1).max(32_768).nullable(),
  similarity: z.number().int().nonnegative().max(100).nullable(),
  oldMode: repositoryGitModeSchema.nullable(),
  newMode: repositoryGitModeSchema.nullable(),
  oldObjectId: gitObjectIdSchema.nullable(),
  newObjectId: gitObjectIdSchema.nullable(),
});

export const repositoryCommitChangesRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
});

export const repositoryCommitChangesSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  changes: z.array(repositoryCommitChangeSchema).max(10_000),
  truncated: z.boolean(),
});

export const repositoryDiffWhitespaceSchema = z.enum([
  'normal',
  'ignore-all',
  'ignore-space-change',
  'ignore-space-at-eol',
]);

const repositoryDiffFilePathSchema = repositoryRevisionPathSchema.refine(
  (value) => value.length > 0,
  'A diff file path is required.',
);

/** A diff target is issued by the repository views; paths remain data, never command strings. */
export const repositoryDiffTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('working'),
    area: repositoryWorkingChangeAreaSchema,
    path: repositoryDiffFilePathSchema,
    previousPath: repositoryDiffFilePathSchema.nullable(),
  }),
  /** What an amended commit would contain for one path: the index compared with HEAD's parent. */
  z.strictObject({
    kind: z.literal('amend'),
    path: repositoryDiffFilePathSchema,
    previousPath: repositoryDiffFilePathSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('commit'),
    commitId: gitObjectIdSchema,
    path: repositoryDiffFilePathSchema,
    previousPath: repositoryDiffFilePathSchema.nullable(),
  }),
]);

export const repositoryDiffRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  target: repositoryDiffTargetSchema,
  whitespace: repositoryDiffWhitespaceSchema,
});

export const repositoryDiffSnapshotSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const repositoryDiffSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  target: repositoryDiffTargetSchema,
  state: z.enum(['text', 'binary', 'too-large', 'unavailable']),
  content: z.string().max(8 * 1024 * 1024),
  byteLength: z
    .number()
    .int()
    .nonnegative()
    .max(8 * 1024 * 1024)
    .nullable(),
  message: z.string().max(512).nullable(),
  /** Working-tree diffs carry a backend-issued compare-and-swap token for mutations. */
  snapshot: repositoryDiffSnapshotSchema.nullable(),
});

const repositoryWorkingChangeCodeSchema = z.string().regex(/^[.ACDMRTUX?!]$/u);

export const repositoryWorkingChangeSchema = z.strictObject({
  area: repositoryWorkingChangeAreaSchema,
  status: repositoryWorkingChangeStatusSchema,
  statusCode: repositoryWorkingChangeCodeSchema,
  indexStatus: repositoryWorkingChangeCodeSchema,
  worktreeStatus: repositoryWorkingChangeCodeSchema,
  path: z.string().min(1).max(32_768),
  previousPath: z.string().min(1).max(32_768).nullable(),
  similarity: z.number().int().nonnegative().max(100).nullable(),
  oldMode: repositoryGitModeSchema.nullable(),
  newMode: repositoryGitModeSchema.nullable(),
  oldObjectId: gitObjectIdSchema.nullable(),
  newObjectId: gitObjectIdSchema.nullable(),
});

export const repositoryWorkingChangeCountsSchema = z.strictObject({
  staged: z.number().int().nonnegative().max(100_000),
  unstaged: z.number().int().nonnegative().max(100_000),
  untracked: z.number().int().nonnegative().max(100_000),
  ignored: z.number().int().nonnegative().max(100_000),
  conflicted: z.number().int().nonnegative().max(100_000),
});

export const repositoryWorkingChangesRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  includeUntracked: z.boolean(),
  includeIgnored: z.boolean(),
});

export const repositoryWorkingChangesSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  staged: z.array(repositoryWorkingChangeSchema).max(10_000),
  unstaged: z.array(repositoryWorkingChangeSchema).max(10_000),
  untracked: z.array(repositoryWorkingChangeSchema).max(10_000),
  ignored: z.array(repositoryWorkingChangeSchema).max(10_000),
  counts: repositoryWorkingChangeCountsSchema,
  truncated: z.boolean(),
});

export const repositoryWorkingChangeActionSchema = z.enum(['stage', 'unstage', 'discard']);

export const repositoryWorkingChangeTargetSchema = z.strictObject({
  area: repositoryWorkingChangeAreaSchema,
  path: repositoryDiffFilePathSchema,
  previousPath: repositoryDiffFilePathSchema.nullable(),
});

/** Selection coordinates refer to the currently rendered, normal-whitespace diff. */
export const repositoryWorkingChangeSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file') }),
  z.strictObject({
    kind: z.literal('hunk'),
    hunk: z.number().int().nonnegative().max(1_000),
  }),
  z.strictObject({
    kind: z.literal('lines'),
    hunk: z.number().int().nonnegative().max(1_000),
    lineIndexes: z.array(z.number().int().nonnegative().max(100_000)).min(1).max(10_000).readonly(),
  }),
]);

/**
 * One action applies to whole files, or to a hunk or line selection inside a single file. A hunk or
 * line selection carries the diff's snapshot token, because rebuilding that patch depends on the exact
 * content the renderer displayed. Whole-file actions may name several files and revalidate each one
 * against a fresh status read instead.
 */
export const repositoryWorkingChangeActionRequestSchema = z
  .strictObject({
    id: repositoryIdSchema,
    action: repositoryWorkingChangeActionSchema,
    targets: z.array(repositoryWorkingChangeTargetSchema).min(1).max(1_000),
    snapshot: repositoryDiffSnapshotSchema.nullable(),
    selection: repositoryWorkingChangeSelectionSchema,
  })
  .refine(
    (request) => request.selection.kind === 'file' || (request.targets.length === 1 && request.snapshot),
    'A hunk or line action needs exactly one file and its diff snapshot.',
  );

export const repositoryWorkingChangeActionResultSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  action: repositoryWorkingChangeActionSchema,
  targets: z.array(repositoryWorkingChangeTargetSchema).min(1).max(1_000),
  selection: repositoryWorkingChangeSelectionSchema,
  changes: repositoryWorkingChangesSchema,
});

/** How the author/committer identity Git would use for a new commit was determined. */
export const repositoryCommitIdentitySchema = z.strictObject({
  name: z.string().max(4_096),
  email: z.string().max(4_096),
  source: z.enum(['configured', 'implicit', 'missing']),
});

export const repositoryCommitMessageSchema = z.strictObject({
  subject: z.string().max(16_384),
  body: z.string().max(262_144),
});

export const repositoryCommitAmendTargetSchema = z.strictObject({
  commitId: gitObjectIdSchema,
  subject: z.string().max(16_384),
  body: z.string().max(262_144),
  author: repositoryHistoryPersonSchema,
  parentCount: z.number().int().nonnegative().max(128),
  /** `null` when Git could not answer within the bounded check. */
  published: z.boolean().nullable(),
  publishedRefs: z.array(z.string().min(1).max(32_768)).max(10),
});

export const repositoryCommitPendingOperationSchema = z.enum(['merge', 'cherry-pick', 'revert', 'rebase']);

export const repositoryCommitContextRequestSchema = z.strictObject({ id: repositoryIdSchema });

export const repositoryCommitContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  head: repositoryHeadSchema,
  identity: repositoryCommitIdentitySchema,
  /** The commit an amend would replace, when one exists. */
  amend: repositoryCommitAmendTargetSchema.nullable(),
  amendBlockedReason: z.string().max(512).nullable(),
  /** `commit.template` contents with comment lines removed, when configured and readable. */
  template: z.string().max(65_536).nullable(),
  pendingOperation: repositoryCommitPendingOperationSchema.nullable(),
  /** A message Git prepared for the pending operation, such as `MERGE_MSG`. */
  pendingMessage: z.string().max(262_144).nullable(),
  recentMessages: z.array(repositoryCommitMessageSchema).max(20),
  stagedCount: z.number().int().nonnegative().max(100_000),
  conflictedCount: z.number().int().nonnegative().max(100_000),
  /** `commit.gpgsign` is enabled; signing itself is a later phase. */
  signing: z.boolean(),
  hooks: z.array(z.string().min(1).max(64)).max(8),
  /** Compare-and-swap token over HEAD, the pending operation, and the staged entries. */
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryAmendChangesRequestSchema = z.strictObject({ id: repositoryIdSchema });

/** Everything an amended commit would contain: the current index compared with HEAD's parent. */
export const repositoryAmendChangesSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  /** `null` when HEAD is a root commit, so the comparison uses the empty tree. */
  parentId: gitObjectIdSchema.nullable(),
  changes: z.array(repositoryCommitChangeSchema).max(10_000),
  /** Paths that are also staged in the index right now, so the view can separate them. */
  stagedPaths: z.array(z.string().min(1).max(32_768)).max(10_000),
  truncated: z.boolean(),
});

export const repositoryCommitRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  subject: z.string().max(16_384),
  body: z.string().max(262_144),
  amend: z.boolean(),
  snapshot: repositoryDiffSnapshotSchema,
  /** Passing `--no-verify` is always an explicit second action by the user. */
  skipHooks: z.boolean(),
});

export const repositoryCommitFailureReasonSchema = z.enum([
  'hook',
  'identity',
  'empty-message',
  'nothing-staged',
  'conflicts',
  'other',
]);

export const repositoryCommitResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('committed'),
    repositoryId: repositoryIdSchema,
    commitId: gitObjectIdSchema,
    amended: z.boolean(),
    subject: z.string().max(16_384),
    output: z.string().max(65_536),
  }),
  z.strictObject({
    status: z.literal('failed'),
    repositoryId: repositoryIdSchema,
    reason: repositoryCommitFailureReasonSchema,
    message: z.string().min(1).max(512),
    /** Git and hook output, kept as inert text for display. */
    output: z.string().max(65_536),
    canSkipHooks: z.boolean(),
  }),
]);

/**
 * A branch or tag name as the renderer sends it. Git's own `check-ref-format` stays authoritative in
 * the main process; this only bounds the transport and keeps a name from being read as an option.
 */
export const repositoryReferenceNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith('-'), 'A reference name cannot begin with a dash.')
  .refine(
    // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    'A reference name cannot contain control characters.',
  );

export const repositoryBranchSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  fullName: z.string().min(1).max(32_768),
  target: gitObjectIdSchema,
  isHead: z.boolean(),
  upstream: z.string().max(32_768).nullable(),
  /** Exact configured refs; display-name prefix matching is ambiguous. */
  upstreamFullName: z.string().max(32_768).nullable().optional(),
  upstreamRemote: z.string().max(4_096).nullable().optional(),
  upstreamBranch: z.string().max(32_768).nullable().optional(),
  /** The configured upstream no longer exists locally, so the branch is stale. */
  upstreamGone: z.boolean(),
  /** Commits this branch has that its upstream does not, and the other way round. */
  ahead: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  behind: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  /** The linked worktree that has this branch checked out, when it is not the one in this tab. */
  worktreePath: z.string().max(32_768).nullable(),
  /** The tip is reachable from HEAD, so deleting the branch loses no commits from it. */
  merged: z.boolean(),
});

export const repositoryTagSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  fullName: z.string().min(1).max(32_768),
  /** The commit the tag resolves to, after peeling an annotated tag object. */
  target: gitObjectIdSchema,
  annotated: z.boolean(),
});

export const repositoryReferenceContextRequestSchema = z.strictObject({ id: repositoryIdSchema });

export const repositoryReferenceContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  head: repositoryHeadSchema,
  branches: z.array(repositoryBranchSchema).max(10_000),
  tags: z.array(repositoryTagSchema).max(10_000),
  remotes: z.array(z.string().min(1).max(4_096)).max(1_000),
  /** Short remote-tracking branch names, for choosing an upstream. */
  remoteBranches: z.array(z.string().min(1).max(32_768)).max(5_000),
  /** Tracked files differ from HEAD or the index, so a checkout may be refused. */
  dirty: z.boolean(),
  untrackedCount: z.number().int().nonnegative().max(100_000),
  conflictedCount: z.number().int().nonnegative().max(100_000),
  pendingOperation: repositoryCommitPendingOperationSchema.nullable(),
  /** A reference list was longer than this read returns, so the lists above are incomplete. */
  truncated: z.boolean(),
  /** Compare-and-swap token over HEAD, the local branches, the tags, and the worktree checkouts. */
  snapshot: repositoryDiffSnapshotSchema,
});

/**
 * Where a new branch or tag starts. A reference is named rather than resolved in the renderer, so
 * Git can set up tracking from a remote-tracking branch by itself; the backend accepts only a name
 * the same read reported, never arbitrary revision syntax.
 */
export const repositoryReferenceStartPointSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('commit'), commitId: gitObjectIdSchema }),
  z.strictObject({ kind: z.literal('reference'), fullName: z.string().min(1).max(32_768) }),
]);

export const repositoryReferenceTrackingSchema = z.enum(['auto', 'track', 'no-track']);
export const repositoryLocalChangesPolicySchema = z.enum(['keep', 'stash', 'discard']);
const localChangesOptions = {
  localChanges: repositoryLocalChangesPolicySchema.optional(),
  changesSnapshot: repositoryDiffSnapshotSchema.optional(),
};

export const repositoryReferenceActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create-branch'),
    ...localChangesOptions,
    name: repositoryReferenceNameSchema,
    startPoint: repositoryReferenceStartPointSchema,
    checkout: z.boolean(),
    tracking: repositoryReferenceTrackingSchema,
  }),
  z.strictObject({
    kind: z.literal('rename-branch'),
    fullName: z.string().min(1).max(32_768),
    name: repositoryReferenceNameSchema,
  }),
  z.strictObject({
    kind: z.literal('delete-branch'),
    fullName: z.string().min(1).max(32_768),
    /** `git branch -D`: set only by a confirmation that names the branch and its unmerged state. */
    force: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('set-upstream'),
    fullName: z.string().min(1).max(32_768),
    /** `null` unsets the upstream. */
    upstream: z.string().min(1).max(32_768).nullable(),
  }),
  z.strictObject({
    kind: z.literal('checkout-branch'),
    fullName: z.string().min(1).max(32_768),
    ...localChangesOptions,
  }),
  z.strictObject({
    kind: z.literal('checkout-remote-branch'),
    ...localChangesOptions,
    fullName: z.string().min(1).max(32_768),
    name: repositoryReferenceNameSchema,
  }),
  z.strictObject({ kind: z.literal('checkout-commit'), commitId: gitObjectIdSchema, ...localChangesOptions }),
  z.strictObject({
    kind: z.literal('create-tag'),
    name: repositoryReferenceNameSchema,
    startPoint: repositoryReferenceStartPointSchema,
    /** An empty message creates a lightweight tag; any message creates an annotated one. */
    message: z.string().max(65_536),
  }),
  z.strictObject({ kind: z.literal('delete-tag'), fullName: z.string().min(1).max(32_768) }),
]);

export const repositoryReferenceActionKindSchema = z.enum([
  'create-branch',
  'rename-branch',
  'delete-branch',
  'set-upstream',
  'checkout-branch',
  'checkout-remote-branch',
  'checkout-commit',
  'create-tag',
  'delete-tag',
]);

export const repositoryReferenceActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositoryReferenceActionSchema,
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryReferenceFailureReasonSchema = z.enum([
  'exists',
  'invalid-name',
  'not-merged',
  'local-changes',
  'checked-out',
  'not-found',
  'current-branch',
  'pending-operation',
  'identity',
  'other',
]);

export const repositoryReferenceActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    repositoryId: repositoryIdSchema,
    kind: repositoryReferenceActionKindSchema,
    /** A short sentence naming exactly what changed, for the status line. */
    message: z.string().min(1).max(512),
    /** Git's own output, kept as bounded inert text. */
    output: z.string().max(65_536),
    head: repositoryHeadSchema,
  }),
  z.strictObject({
    status: z.literal('blocked'),
    repositoryId: repositoryIdSchema,
    kind: repositoryReferenceActionKindSchema,
    reason: repositoryReferenceFailureReasonSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    /** The same action would succeed with an explicit force, which the user must choose. */
    canForce: z.boolean(),
    /** Working-tree paths Git named as the obstacle, so the message can be exact. */
    paths: z.array(z.string().min(1).max(32_768)).max(200),
  }),
]);

/** A remote as Git has it configured. URLs are the user's own configuration, shown so they can edit it. */
export const repositoryRemoteSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  fetchUrl: z.string().max(32_768),
  /** `null` when pushes use the fetch URL. */
  pushUrl: z.string().max(32_768).nullable(),
  /** The remote-tracking branches this remote currently has locally. */
  branchCount: z.number().int().nonnegative().max(100_000),
  /** A Git Workbench preference; it does not alter the remote's Git configuration. */
  fetchAutomatically: z.boolean().default(true),
});

export const repositoryRemoteNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith('-'), 'A remote name cannot begin with a dash.')
  .refine(
    // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
    (value) => !/[\u0000-\u001F\u007F\s]/u.test(value),
    'A remote name cannot contain spaces or control characters.',
  );

export const repositoryRemoteUrlSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.startsWith('-'), 'A remote URL cannot begin with a dash.')
  .refine(
    // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    'A remote URL cannot contain control characters.',
  );

export const repositoryRemoteActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('add'),
    name: repositoryRemoteNameSchema,
    url: repositoryRemoteUrlSchema,
  }),
  z.strictObject({
    kind: z.literal('rename'),
    name: repositoryRemoteNameSchema,
    newName: repositoryRemoteNameSchema,
  }),
  z.strictObject({ kind: z.literal('remove'), name: repositoryRemoteNameSchema }),
  z.strictObject({
    kind: z.literal('set-url'),
    name: repositoryRemoteNameSchema,
    url: repositoryRemoteUrlSchema,
    /** Sets the separate push URL instead of the fetch URL. */
    push: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('set-automatic-fetch'),
    name: repositoryRemoteNameSchema,
    enabled: z.boolean(),
  }),
]);

export const repositoryRemoteActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositoryRemoteActionSchema,
});

export const repositoryRemoteFailureReasonSchema = z.enum([
  'exists',
  'invalid-name',
  'invalid-url',
  'not-found',
  'other',
]);

export const repositoryRemoteActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    repositoryId: repositoryIdSchema,
    message: z.string().min(1).max(512),
    remotes: z.array(repositoryRemoteSchema).max(1_000),
  }),
  z.strictObject({
    status: z.literal('blocked'),
    repositoryId: repositoryIdSchema,
    reason: repositoryRemoteFailureReasonSchema,
    message: z.string().min(1).max(512),
    remotes: z.array(repositoryRemoteSchema).max(1_000),
  }),
]);

export const repositoryOperationIdSchema = z.string().regex(/^op-[a-f0-9]{32}$/);

export const repositoryOperationKindSchema = z.enum([
  'fetch',
  'pull',
  'push',
  'delete-remote-branch',
  'commit',
  'reference',
  'fast-forward',
  'recovery',
  'stash',
]);

export const repositoryOperationStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled']);

export const repositoryOperationSourceSchema = z.enum(['user', 'background']).default('user');

export const repositoryOperationFailureReasonSchema = z.enum([
  'authentication',
  'network',
  'rejected',
  'lease',
  'no-upstream',
  'not-fast-forward',
  'not-found',
  'local-changes',
  'cancelled',
  'timeout',
  'other',
]);

export const repositoryOperationProgressSchema = z.strictObject({
  /** Git's own phase name, such as `Receiving objects`. */
  phase: z.string().min(1).max(128),
  percent: z.number().int().min(0).max(100).nullable(),
});

/**
 * One long-running Git operation. It outlives the request that started it: the renderer receives the
 * accepted record immediately and follows the rest through `repository:operation-changed` events or a
 * later list, so an IPC timeout never decides the outcome of a fetch or a push.
 */
export const repositoryOperationSchema = z.strictObject({
  id: repositoryOperationIdSchema,
  repositoryId: repositoryIdSchema,
  kind: repositoryOperationKindSchema,
  /** Whether the operation was explicitly started by the user or by automatic scheduling. */
  source: repositoryOperationSourceSchema,
  title: z.string().min(1).max(512),
  status: repositoryOperationStatusSchema,
  /** Monotonically increasing; late IPC replies cannot overwrite newer events. */
  revision: z.number().int().nonnegative().optional(),
  result: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('commit'), value: repositoryCommitResultSchema }),
      z.strictObject({ kind: z.literal('reference'), value: repositoryReferenceActionResultSchema }),
    ])
    .optional(),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  progress: repositoryOperationProgressSchema.nullable(),
  /** The Git command as it was run, with any URL credentials removed. */
  command: z.string().max(4_096),
  /** Git's output, redacted and kept as bounded inert text. */
  output: z.string().max(65_536),
  message: z.string().max(512),
  failureReason: repositoryOperationFailureReasonSchema.nullable(),
  /** A rejected push that a lease-checked force would complete; never applied automatically. */
  canForceWithLease: z.boolean(),
});

export const repositoryPushTargetSchema = z.strictObject({
  fullName: z.string().min(1).max(32_768),
  /** The branch name on the remote; the local name by default. */
  remoteBranch: repositoryReferenceNameSchema,
  setUpstream: z.boolean().optional(),
});

export const repositoryNetworkRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('fetch'),
    /** `null` fetches every configured remote. */
    remote: repositoryRemoteNameSchema.nullable(),
    prune: z.boolean(),
    tags: z.boolean(),
  }),
  /** Fast-forward only. Merge and rebase pulls wait for the recovery paths in P06 and P07. */
  z.strictObject({
    kind: z.literal('pull'),
    prune: z.boolean(),
    remote: repositoryRemoteNameSchema.optional(),
    branch: repositoryReferenceNameSchema.optional(),
    into: z.string().startsWith('refs/heads/').max(32_768).optional(),
    expectedHead: gitObjectIdSchema.optional(),
    snapshot: repositoryDiffSnapshotSchema.optional(),
    rebase: z.boolean().optional(),
    autostash: z.boolean().optional(),
    changesSnapshot: repositoryDiffSnapshotSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('fast-forward'),
    fullName: z.string().startsWith('refs/heads/').max(32_768),
    snapshot: repositoryDiffSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('push'),
    remote: repositoryRemoteNameSchema,
    targets: z.array(repositoryPushTargetSchema).min(1).max(50),
    setUpstream: z.boolean(),
    /** `with-lease` is only ever chosen by an explicit confirmation naming the branches. */
    force: z.enum(['none', 'with-lease']),
    tags: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('delete-remote-branch'),
    remote: repositoryRemoteNameSchema,
    remoteBranch: repositoryReferenceNameSchema,
  }),
]);

export const repositoryNetworkRequestEnvelopeSchema = z.strictObject({
  id: repositoryIdSchema,
  request: repositoryNetworkRequestSchema,
});

export const repositoryOperationSessionSchema = z.strictObject({
  operationId: repositoryOperationIdSchema,
});

export const repositoryLocalChangesPreviewSchema = z.strictObject({
  snapshot: repositoryDiffSnapshotSchema,
  paths: z.array(z.string().max(32_768)).max(10_000),
  untrackedPaths: z.array(z.string().max(32_768)).max(10_000),
  pendingOperation: repositoryCommitPendingOperationSchema.nullable(),
});
export const repositoryRecoveryCopySchema = z.strictObject({
  id: z.uuid(),
  commitId: gitObjectIdSchema.nullable(),
  title: z.string().max(512),
  createdAt: z.string().datetime(),
  pending: z.boolean(),
});
export const repositoryRecoveryStateSchema = z.strictObject({
  snapshot: repositoryDiffSnapshotSchema,
  pendingOperation: repositoryCommitPendingOperationSchema.nullable(),
  copies: z.array(repositoryRecoveryCopySchema).max(100),
});
export const repositoryRecoveryRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  snapshot: repositoryDiffSnapshotSchema,
  action: z.enum(['continue', 'abort', 'apply', 'finish', 'drop']),
  copyId: z.uuid().optional(),
});

export const repositoryStashSelectorSchema = z.string().regex(/^stash@\{\d+\}$/u);
export const repositoryStashPathSchema = repositoryRevisionPathSchema.refine(
  (value) => value.length > 0,
  'A stash path is required.',
);
export const repositoryStashEntrySchema = z.strictObject({
  /** A display selector only; mutations use the stable commit ID after re-reading the list. */
  selector: repositoryStashSelectorSchema,
  commitId: gitObjectIdSchema,
  message: z.string().max(16_384),
  branch: z.string().max(4_096).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  includesUntracked: z.boolean(),
});
export const repositoryStashDetailsRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  stashId: gitObjectIdSchema,
});
export const repositoryStashDetailsSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  stashId: gitObjectIdSchema,
  entry: repositoryStashEntrySchema,
  state: z.enum(['text', 'too-large']),
  content: z.string().max(8 * 1024 * 1024),
  byteLength: z
    .number()
    .int()
    .nonnegative()
    .max(8 * 1024 * 1024)
    .nullable(),
  message: z.string().max(512).nullable(),
});
export const repositoryStashActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('save'),
    message: z.string().max(512),
    includeUntracked: z.boolean(),
    /** Empty means all supported local changes; otherwise these are validated changed paths. */
    paths: z.array(repositoryStashPathSchema).max(1_000),
    changesSnapshot: repositoryDiffSnapshotSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('apply'),
    stashId: gitObjectIdSchema,
    changesSnapshot: repositoryDiffSnapshotSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('pop'),
    stashId: gitObjectIdSchema,
    changesSnapshot: repositoryDiffSnapshotSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('drop'),
    stashId: gitObjectIdSchema,
  }),
]);
export const repositoryStashActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  request: repositoryStashActionSchema,
});

export const repositoryPatchTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('commit'), commitId: gitObjectIdSchema }),
  z.strictObject({ kind: z.literal('stash'), stashId: gitObjectIdSchema }),
  z.strictObject({
    kind: z.literal('working'),
    paths: z.array(repositoryStashPathSchema).min(1).max(1_000),
    includeUntracked: z.boolean(),
    changesSnapshot: repositoryDiffSnapshotSchema.optional(),
  }),
]);
export const repositoryPatchExportRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  target: repositoryPatchTargetSchema,
});
export const repositoryPatchExportResultSchema = z.strictObject({
  status: z.enum(['saved', 'cancelled']),
  path: repositoryPathSchema.nullable(),
  byteLength: z
    .number()
    .int()
    .nonnegative()
    .max(8 * 1024 * 1024),
  message: z.string().max(512),
});
export const repositoryPullRequestHandoffSchema = z.strictObject({
  id: repositoryIdSchema,
  fullName: z.string().startsWith('refs/heads/').max(32_768),
  remote: repositoryRemoteNameSchema,
});

export const repositoryRevisionTreeRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryRevisionPathSchema,
});

export const repositoryRevisionTreeEntrySchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  path: z.string().min(1).max(32_768),
  type: z.enum(['blob', 'tree', 'commit', 'unknown']),
  mode: repositoryGitModeSchema,
  objectId: gitObjectIdSchema,
  size: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
});

export const repositoryRevisionTreeSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryRevisionPathSchema,
  entries: z.array(repositoryRevisionTreeEntrySchema).max(5_000),
  truncated: z.boolean(),
});

export const repositoryRevisionBlobRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'A blob path is required.'),
});

export const repositoryRevisionBlobSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: z.string().min(1).max(32_768),
  state: z.enum(['text', 'binary', 'too-large']),
  content: z.string().max(1_048_576),
  byteLength: z.number().int().nonnegative().max(1_000_000_000_000),
});

export const requests = {
  getAppInfo: request('app:get-info', z.undefined(), appInfoSchema),
  getWindowState: request('window:get-state', z.undefined(), windowStateSchema),
  windowCommand: request('window:command', windowCommandSchema, z.null()),
  editCommand: request('edit:command', editCommandSchema, z.null()),
  writeClipboardText: request('clipboard:write-text', clipboardTextSchema, z.null()),
  getGitInfo: request('git:get-info', z.undefined(), gitInfoSchema),
  pickRepositoryDirectory: request(
    'repository:pick-directory',
    z.undefined(),
    repositoryPathSchema.nullable(),
  ),
  listRecentRepositories: request(
    'repository:list-recent',
    z.undefined(),
    z.array(recentRepositorySchema).max(50),
  ),
  listOpenRepositories: request(
    'repository:list-open',
    z.undefined(),
    z.array(repositorySummarySchema).max(20),
  ),
  openRepository: request('repository:open', repositoryOpenSchema, repositorySummarySchema),
  initializeRepository: request('repository:initialize', repositoryInitializeSchema, repositorySummarySchema),
  closeRepository: request('repository:close', repositorySessionSchema, z.null()),
  getRepositoryTabPreferences: request(
    'repository:get-tab-preferences',
    z.undefined(),
    repositoryTabPreferencesSchema,
  ),
  setRepositoryTabOrientation: request(
    'repository:set-tab-orientation',
    repositoryTabOrientationRequestSchema,
    repositoryTabPreferencesSchema,
  ),
  selectRepositoryTab: request(
    'repository:select-tab',
    repositorySessionSchema,
    repositoryTabPreferencesSchema,
  ),
  removeRecentRepository: request('repository:remove-recent', repositorySessionSchema, z.null()),
  listRepositoryManager: request('repository-manager:list', z.undefined(), repositoryManagerSnapshotSchema),
  addSourceDirectory: request(
    'repository-manager:add-source-directory',
    sourceDirectoryRequestSchema,
    repositoryManagerSnapshotSchema,
  ),
  removeSourceDirectory: request(
    'repository-manager:remove-source-directory',
    sourceDirectorySessionSchema,
    z.null(),
  ),
  rescanSourceDirectory: request(
    'repository-manager:rescan-source-directory',
    sourceDirectorySessionSchema,
    repositoryManagerSnapshotSchema,
  ),
  getRepositoryHistory: request(
    'repository:get-history',
    repositoryHistoryRequestSchema,
    repositoryHistoryPageSchema,
  ),
  getRepositoryCommitChanges: request(
    'repository:get-commit-changes',
    repositoryCommitChangesRequestSchema,
    repositoryCommitChangesSchema,
  ),
  getRepositoryDiff: request('repository:get-diff', repositoryDiffRequestSchema, repositoryDiffSchema),
  getRepositoryWorkingChanges: request(
    'repository:get-working-changes',
    repositoryWorkingChangesRequestSchema,
    repositoryWorkingChangesSchema,
  ),
  applyRepositoryWorkingChange: request(
    'repository:apply-working-change',
    repositoryWorkingChangeActionRequestSchema,
    repositoryWorkingChangeActionResultSchema,
  ),
  getRepositoryCommitContext: request(
    'repository:get-commit-context',
    repositoryCommitContextRequestSchema,
    repositoryCommitContextSchema,
  ),
  commitRepositoryChanges: request(
    'repository:commit',
    repositoryCommitRequestSchema,
    repositoryOperationSchema,
  ),
  getRepositoryAmendChanges: request(
    'repository:get-amend-changes',
    repositoryAmendChangesRequestSchema,
    repositoryAmendChangesSchema,
  ),
  getRepositoryReferenceContext: request(
    'repository:get-reference-context',
    repositoryReferenceContextRequestSchema,
    repositoryReferenceContextSchema,
  ),
  applyRepositoryReferenceAction: request(
    'repository:apply-reference-action',
    repositoryReferenceActionRequestSchema,
    repositoryOperationSchema,
  ),
  listRepositoryRemotes: request(
    'repository:list-remotes',
    repositorySessionSchema,
    z.array(repositoryRemoteSchema).max(1_000),
  ),
  applyRepositoryRemoteAction: request(
    'repository:apply-remote-action',
    repositoryRemoteActionRequestSchema,
    repositoryRemoteActionResultSchema,
  ),
  startRepositoryNetworkOperation: request(
    'repository:start-network-operation',
    repositoryNetworkRequestEnvelopeSchema,
    repositoryOperationSchema,
  ),
  listRepositoryOperations: request(
    'repository:list-operations',
    z.undefined(),
    z.array(repositoryOperationSchema).max(100),
  ),
  cancelRepositoryOperation: request(
    'repository:cancel-operation',
    repositoryOperationSessionSchema,
    repositoryOperationSchema.nullable(),
  ),
  previewRepositoryLocalChanges: request(
    'repository:preview-local-changes',
    repositorySessionSchema,
    repositoryLocalChangesPreviewSchema,
  ),
  getRepositoryRecovery: request(
    'repository:get-recovery',
    repositorySessionSchema,
    repositoryRecoveryStateSchema,
  ),
  listRepositoryStashes: request(
    'repository:list-stashes',
    repositorySessionSchema,
    z.array(repositoryStashEntrySchema).max(100),
  ),
  getRepositoryStashDetails: request(
    'repository:get-stash-details',
    repositoryStashDetailsRequestSchema,
    repositoryStashDetailsSchema,
  ),
  startRepositoryStashOperation: request(
    'repository:start-stash-operation',
    repositoryStashActionRequestSchema,
    repositoryOperationSchema,
  ),
  saveRepositoryPatch: request(
    'repository:save-patch',
    repositoryPatchExportRequestSchema,
    repositoryPatchExportResultSchema,
  ),
  recoverRepository: request(
    'repository:recover',
    repositoryRecoveryRequestSchema,
    repositoryOperationSchema,
  ),
  openRepositoryPullRequest: request(
    'repository:open-pull-request',
    repositoryPullRequestHandoffSchema,
    z.null(),
  ),
  getRepositoryRevisionTree: request(
    'repository:get-revision-tree',
    repositoryRevisionTreeRequestSchema,
    repositoryRevisionTreeSchema,
  ),
  getRepositoryRevisionBlob: request(
    'repository:get-revision-blob',
    repositoryRevisionBlobRequestSchema,
    repositoryRevisionBlobSchema,
  ),
  openRepositoryInFileManager: request('repository:open-in-file-manager', repositoryLocationSchema, z.null()),
} as const;

export const events = {
  windowStateChanged: { channel: 'window:state-changed', payload: windowStateSchema },
  repositoryOperationChanged: {
    channel: 'repository:operation-changed',
    payload: repositoryOperationSchema,
  },
} as const;

export type AppInfo = z.infer<typeof appInfoSchema>;
export type WindowState = z.infer<typeof windowStateSchema>;
export type WindowCommand = z.infer<typeof windowCommandSchema>;
export type EditCommand = z.infer<typeof editCommandSchema>;
export type ClipboardText = z.infer<typeof clipboardTextSchema>;
export type GitInfo = z.infer<typeof gitInfoSchema>;
export type RepositoryHead = z.infer<typeof repositoryHeadSchema>;
export type RepositoryWorkingTree = z.infer<typeof repositoryWorkingTreeSchema>;
export type RepositoryTabOrientation = z.infer<typeof repositoryTabOrientationSchema>;
export type RepositoryTabPreferences = z.infer<typeof repositoryTabPreferencesSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type RecentRepository = z.infer<typeof recentRepositorySchema>;
export type SourceDirectoryStatus = z.infer<typeof sourceDirectoryStatusSchema>;
export type RepositoryManagerSourceDirectory = z.infer<typeof repositoryManagerSourceDirectorySchema>;
export type RepositoryManagerFolder = z.infer<typeof repositoryManagerFolderSchema>;
export type RepositoryManagerRepository = z.infer<typeof repositoryManagerRepositorySchema>;
export type RepositoryManagerWarning = z.infer<typeof repositoryManagerWarningSchema>;
export type RepositoryManagerSnapshot = z.infer<typeof repositoryManagerSnapshotSchema>;
export type RepositoryOpenRequest = z.infer<typeof repositoryOpenSchema>;
export type RepositoryInitializeRequest = z.infer<typeof repositoryInitializeSchema>;
export type RepositorySession = z.infer<typeof repositorySessionSchema>;
export type RepositoryTabOrientationRequest = z.infer<typeof repositoryTabOrientationRequestSchema>;
export type SourceDirectoryRequest = z.infer<typeof sourceDirectoryRequestSchema>;
export type SourceDirectorySession = z.infer<typeof sourceDirectorySessionSchema>;
export type RepositoryLocation = z.infer<typeof repositoryLocationSchema>;
export type RepositoryHistoryReferenceKind = z.infer<typeof repositoryHistoryReferenceKindSchema>;
export type RepositoryHistoryDecoration = z.infer<typeof repositoryHistoryDecorationSchema>;
export type RepositoryHistoryPerson = z.infer<typeof repositoryHistoryPersonSchema>;
export type RepositoryHistoryCommit = z.infer<typeof repositoryHistoryCommitSchema>;
export type RepositoryHistoryReference = z.infer<typeof repositoryHistoryReferenceSchema>;
export type RepositoryHistoryTracking = z.infer<typeof repositoryHistoryTrackingSchema>;
export type RepositoryHistoryFilter = z.infer<typeof repositoryHistoryFilterSchema>;
export type RepositoryHistoryRequest = z.infer<typeof repositoryHistoryRequestSchema>;
export type RepositoryHistoryPage = z.infer<typeof repositoryHistoryPageSchema>;
export type RepositoryCommitChangeStatus = z.infer<typeof repositoryCommitChangeStatusSchema>;
export type RepositoryCommitChange = z.infer<typeof repositoryCommitChangeSchema>;
export type RepositoryCommitChangesRequest = z.infer<typeof repositoryCommitChangesRequestSchema>;
export type RepositoryCommitChanges = z.infer<typeof repositoryCommitChangesSchema>;
export type RepositoryDiffWhitespace = z.infer<typeof repositoryDiffWhitespaceSchema>;
export type RepositoryDiffTarget = z.infer<typeof repositoryDiffTargetSchema>;
export type RepositoryDiffRequest = z.infer<typeof repositoryDiffRequestSchema>;
export type RepositoryDiffSnapshot = z.infer<typeof repositoryDiffSnapshotSchema>;
export type RepositoryDiff = z.infer<typeof repositoryDiffSchema>;
export type RepositoryWorkingChangeArea = z.infer<typeof repositoryWorkingChangeAreaSchema>;
export type RepositoryWorkingChangeStatus = z.infer<typeof repositoryWorkingChangeStatusSchema>;
export type RepositoryWorkingChange = z.infer<typeof repositoryWorkingChangeSchema>;
export type RepositoryWorkingChangeCounts = z.infer<typeof repositoryWorkingChangeCountsSchema>;
export type RepositoryWorkingChangesRequest = z.infer<typeof repositoryWorkingChangesRequestSchema>;
export type RepositoryWorkingChanges = z.infer<typeof repositoryWorkingChangesSchema>;
export type RepositoryWorkingChangeAction = z.infer<typeof repositoryWorkingChangeActionSchema>;
export type RepositoryWorkingChangeTarget = z.infer<typeof repositoryWorkingChangeTargetSchema>;
export type RepositoryWorkingChangeSelection = z.infer<typeof repositoryWorkingChangeSelectionSchema>;
export type RepositoryWorkingChangeActionRequest = z.infer<typeof repositoryWorkingChangeActionRequestSchema>;
export type RepositoryWorkingChangeActionResult = z.infer<typeof repositoryWorkingChangeActionResultSchema>;
export type RepositoryCommitIdentity = z.infer<typeof repositoryCommitIdentitySchema>;
export type RepositoryCommitMessage = z.infer<typeof repositoryCommitMessageSchema>;
export type RepositoryCommitAmendTarget = z.infer<typeof repositoryCommitAmendTargetSchema>;
export type RepositoryCommitPendingOperation = z.infer<typeof repositoryCommitPendingOperationSchema>;
export type RepositoryCommitContextRequest = z.infer<typeof repositoryCommitContextRequestSchema>;
export type RepositoryCommitContext = z.infer<typeof repositoryCommitContextSchema>;
export type RepositoryAmendChangesRequest = z.infer<typeof repositoryAmendChangesRequestSchema>;
export type RepositoryAmendChanges = z.infer<typeof repositoryAmendChangesSchema>;
export type RepositoryCommitRequest = z.infer<typeof repositoryCommitRequestSchema>;
export type RepositoryCommitFailureReason = z.infer<typeof repositoryCommitFailureReasonSchema>;
export type RepositoryCommitResult = z.infer<typeof repositoryCommitResultSchema>;
export type RepositoryBranch = z.infer<typeof repositoryBranchSchema>;
export type RepositoryTag = z.infer<typeof repositoryTagSchema>;
export type RepositoryReferenceContextRequest = z.infer<typeof repositoryReferenceContextRequestSchema>;
export type RepositoryReferenceContext = z.infer<typeof repositoryReferenceContextSchema>;
export type RepositoryReferenceStartPoint = z.infer<typeof repositoryReferenceStartPointSchema>;
export type RepositoryReferenceTracking = z.infer<typeof repositoryReferenceTrackingSchema>;
export type RepositoryReferenceAction = z.infer<typeof repositoryReferenceActionSchema>;
export type RepositoryReferenceActionKind = z.infer<typeof repositoryReferenceActionKindSchema>;
export type RepositoryReferenceActionRequest = z.infer<typeof repositoryReferenceActionRequestSchema>;
export type RepositoryReferenceFailureReason = z.infer<typeof repositoryReferenceFailureReasonSchema>;
export type RepositoryReferenceActionResult = z.infer<typeof repositoryReferenceActionResultSchema>;
export type RepositoryRemote = z.infer<typeof repositoryRemoteSchema>;
export type RepositoryRemoteAction = z.infer<typeof repositoryRemoteActionSchema>;
export type RepositoryRemoteActionRequest = z.infer<typeof repositoryRemoteActionRequestSchema>;
export type RepositoryRemoteActionResult = z.infer<typeof repositoryRemoteActionResultSchema>;
export type RepositoryRemoteFailureReason = z.infer<typeof repositoryRemoteFailureReasonSchema>;
export type RepositoryOperation = z.infer<typeof repositoryOperationSchema>;
export type RepositoryOperationKind = z.infer<typeof repositoryOperationKindSchema>;
export type RepositoryOperationStatus = z.infer<typeof repositoryOperationStatusSchema>;
export type RepositoryOperationSource = z.infer<typeof repositoryOperationSourceSchema>;
export type RepositoryOperationProgress = z.infer<typeof repositoryOperationProgressSchema>;
export type RepositoryOperationFailureReason = z.infer<typeof repositoryOperationFailureReasonSchema>;
export type RepositoryOperationSession = z.infer<typeof repositoryOperationSessionSchema>;
export type RepositoryNetworkRequest = z.infer<typeof repositoryNetworkRequestSchema>;
export type RepositoryLocalChangesPolicy = z.infer<typeof repositoryLocalChangesPolicySchema>;
export type RepositoryLocalChangesPreview = z.infer<typeof repositoryLocalChangesPreviewSchema>;
export type RepositoryRecoveryCopy = z.infer<typeof repositoryRecoveryCopySchema>;
export type RepositoryRecoveryState = z.infer<typeof repositoryRecoveryStateSchema>;
export type RepositoryRecoveryRequest = z.infer<typeof repositoryRecoveryRequestSchema>;
export type RepositoryStashSelector = z.infer<typeof repositoryStashSelectorSchema>;
export type RepositoryStashEntry = z.infer<typeof repositoryStashEntrySchema>;
export type RepositoryStashDetailsRequest = z.infer<typeof repositoryStashDetailsRequestSchema>;
export type RepositoryStashDetails = z.infer<typeof repositoryStashDetailsSchema>;
export type RepositoryStashAction = z.infer<typeof repositoryStashActionSchema>;
export type RepositoryStashActionRequest = z.infer<typeof repositoryStashActionRequestSchema>;
export type RepositoryPatchTarget = z.infer<typeof repositoryPatchTargetSchema>;
export type RepositoryPatchExportRequest = z.infer<typeof repositoryPatchExportRequestSchema>;
export type RepositoryPatchExportResult = z.infer<typeof repositoryPatchExportResultSchema>;
export type RepositoryPullRequestHandoff = z.infer<typeof repositoryPullRequestHandoffSchema>;
export type RepositoryNetworkRequestEnvelope = z.infer<typeof repositoryNetworkRequestEnvelopeSchema>;
export type RepositoryPushTarget = z.infer<typeof repositoryPushTargetSchema>;
export type RepositoryRevisionTreeRequest = z.infer<typeof repositoryRevisionTreeRequestSchema>;
export type RepositoryRevisionTreeEntry = z.infer<typeof repositoryRevisionTreeEntrySchema>;
export type RepositoryRevisionTree = z.infer<typeof repositoryRevisionTreeSchema>;
export type RepositoryRevisionBlobRequest = z.infer<typeof repositoryRevisionBlobRequestSchema>;
export type RepositoryRevisionBlob = z.infer<typeof repositoryRevisionBlobSchema>;
