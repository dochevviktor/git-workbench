import { z } from 'zod';
import {
  aiSettingsSchema,
  aiConfigureSchema,
  aiPreviewRequestSchema,
  aiPreviewSchema,
  aiSendSchema,
  aiCancelSchema,
  aiResultSchema,
} from './ai';
import { statisticsRequestSchema, statisticsCancelSchema, statisticsSchema } from './statistics';
import {
  settingsTargetSchema,
  gitSettingsSchema,
  saveGitSettingsSchema,
  openIssueSchema,
  gitInstanceSchema,
} from './settings';
import {
  externalToolsSchema,
  externalToolSaveSchema,
  externalToolSelectionSchema,
  externalToolRunSchema,
  externalMergeDraftSchema,
} from './external-tools';
import {
  customCommandsSchema,
  customSaveSchema,
  customSelectionSchema,
  customPreviewRequestSchema,
  customPreviewSchema,
  customRunSchema,
} from './custom-commands';
import {
  hostingActivityRequestSchema,
  hostingActivityPageSchema,
  hostingActivitySelectionSchema,
  hostingAccountSchema,
  hostingAccountsSchema,
  hostingAccountRequestSchema,
  hostingConnectRequestSchema,
  hostingRepositoriesRequestSchema,
  hostedRepositoriesSchema,
  hostingRepositoryRequestSchema,
  hostingCloneSelectionSchema,
  hostingCloneTargetSchema,
} from './hosting';

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

export const repositoryLfsSaveResultSchema = z.strictObject({
  path: repositoryPathSchema,
  byteLength: z.number().int().nonnegative().max(1_000_000_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

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

export const repositoryClosedTabSchema = z.strictObject({
  id: repositoryIdSchema,
  path: repositoryPathSchema,
  name: z.string().min(1).max(512),
});

export const repositoryTabPreferencesSchema = z.strictObject({
  /** Legacy orientation mirrors repository-list visibility; horizontal tabs always remain visible. */
  tabOrientation: repositoryTabOrientationSchema,
  activeRepositoryId: repositoryIdSchema.nullable(),
  repositoryListVisible: z.boolean().default(false),
  recentlyClosed: z.array(repositoryClosedTabSchema).max(20).default([]),
});

export const repositorySummarySchema = z.strictObject({
  trusted: z.boolean().optional(),
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
  status: z.enum(['available', 'missing', 'unsupported', 'error']),
  version: z.string().nullable(),
  executable: z.string().nullable(),
  minimumVersion: z.string().optional(),
  capabilities: z
    .strictObject({
      supported: z.boolean(),
      porcelainV2: z.boolean(),
      pathspecFromFile: z.boolean(),
      rebaseUpdateRefs: z.boolean(),
    })
    .optional(),
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
  z.strictObject({
    kind: z.literal('worktree'),
    repositoryId: repositoryIdSchema,
    worktreeId: z.string().regex(/^worktree-[a-f0-9]{64}$/),
  }),
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
  decorations: z.array(repositoryHistoryDecorationSchema).max(10_000),
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

/** Named search fields and scopes keep Git arguments backend-owned. */
export const repositoryHistoryFilterSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({
    kind: z.literal('reference'),
    target: gitObjectIdSchema,
  }),
  z.strictObject({
    kind: z.literal('commit-search'),
    query: repositoryHistoryFilterQuerySchema,
    field: z.enum(['message', 'author', 'path', 'content']).optional(),
    scope: z.enum(['repository', 'current-branch']).optional(),
  }),
]);

export const repositoryHistoryAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('commit'), commitId: gitObjectIdSchema }),
  z.strictObject({ kind: z.literal('oldest') }),
]);

/** The normal graph or a bounded graph augmented with commits reachable only through reflogs. */
export const repositoryHistoryModeSchema = z.enum(['normal', 'reflog']);

export const repositoryHistoryRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  offset: z.number().int().nonnegative().max(1_000_000),
  limit: z.number().int().min(1).max(100),
  filter: repositoryHistoryFilterSchema.optional(),
  anchor: repositoryHistoryAnchorSchema.optional(),
  mode: repositoryHistoryModeSchema.optional(),
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

export const repositoryDiffOptionsSchema = z.strictObject({
  includeImages: z.boolean().optional(),
  contextLines: z.number().int().min(0).max(100).optional(),
  entireFile: z.boolean().optional(),
  loadLarge: z.boolean().optional(),
  readId: z.string().uuid().optional(),
});

export const repositoryDiffCancelSchema = z.strictObject({
  id: repositoryIdSchema,
  readId: z.string().uuid(),
});

export const repositoryDiffRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  target: repositoryDiffTargetSchema,
  whitespace: repositoryDiffWhitespaceSchema,
  options: repositoryDiffOptionsSchema.optional(),
});

export const repositoryDiffSnapshotSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const repositoryImageSideSchema = z.discriminatedUnion('state', [
  z
    .strictObject({
      state: z.literal('ready'),
      mime: z.enum(['image/png', 'image/jpeg']),
      width: z.number().int().min(1).max(8192),
      height: z.number().int().min(1).max(8192),
      base64: z
        .string()
        .max(5_592_408)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
    })
    .refine((image) => image.width * image.height <= 4_194_304),
  z.strictObject({
    state: z.enum(['missing', 'unsupported', 'too-large', 'unavailable']),
  }),
]);

export type RepositoryImageSide = z.infer<typeof repositoryImageSideSchema>;

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
  binaryMetadata: z
    .strictObject({
      beforeBytes: z.number().int().nonnegative().nullable(),
      afterBytes: z.number().int().nonnegative().nullable(),
    })
    .optional(),
  images: z.strictObject({ before: repositoryImageSideSchema, after: repositoryImageSideSchema }).optional(),
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

/** A bounded, inert view of one side of a conflict. Binary and oversized blobs never cross IPC. */
export const repositoryConflictContentSchema = z.strictObject({
  state: z.enum(['text', 'binary', 'too-large', 'unavailable']),
  content: z.string().max(2 * 1024 * 1024),
  byteLength: z
    .number()
    .int()
    .nonnegative()
    .max(8 * 1024 * 1024)
    .nullable(),
  message: z.string().max(512).nullable(),
});

export const repositoryConflictStageSchema = z.strictObject({
  mode: repositoryGitModeSchema.nullable(),
  objectId: gitObjectIdSchema.nullable(),
});

export const repositoryConflictRegionSchema = z.strictObject({
  id: z.number().int().nonnegative().max(100_000),
  startLine: z.number().int().nonnegative().max(100_000),
  endLine: z.number().int().positive().max(100_000),
  base: z
    .string()
    .max(2 * 1024 * 1024)
    .nullable(),
  ours: z.string().max(2 * 1024 * 1024),
  theirs: z.string().max(2 * 1024 * 1024),
});

export const repositoryConflictKindSchema = z.enum(['text', 'binary', 'submodule', 'unsupported']);

export const repositoryConflictFileSummarySchema = z.strictObject({
  path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'A conflict path is required.'),
  previousPath: repositoryRevisionPathSchema.nullable(),
  kind: repositoryConflictKindSchema,
  unresolvedRegions: z.number().int().nonnegative().max(100_000).nullable(),
});

export const repositoryConflictFileSchema = repositoryConflictFileSummarySchema.extend({
  stages: z.strictObject({
    base: repositoryConflictStageSchema,
    ours: repositoryConflictStageSchema,
    theirs: repositoryConflictStageSchema,
  }),
  base: repositoryConflictContentSchema,
  ours: repositoryConflictContentSchema,
  theirs: repositoryConflictContentSchema,
  result: repositoryConflictContentSchema,
  regions: z.array(repositoryConflictRegionSchema).max(1_000),
});

export const repositoryConflictOperationSchema = z.enum([
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'stash',
  'unknown',
]);

export const repositoryConflictRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  path: repositoryRevisionPathSchema.optional(),
});

export const repositoryConflictStateSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  operation: repositoryConflictOperationSchema,
  operationLabel: z.string().min(1).max(512),
  oursLabel: z.string().min(1).max(512),
  theirsLabel: z.string().min(1).max(512),
  files: z.array(repositoryConflictFileSummarySchema).max(1_000),
  selected: repositoryConflictFileSchema.nullable(),
  conflictedCount: z.number().int().nonnegative().max(100_000),
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryResolveConflictRequestSchema = z
  .strictObject({
    id: repositoryIdSchema,
    path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'A conflict path is required.'),
    snapshot: repositoryDiffSnapshotSchema,
    content: z.string().max(2 * 1024 * 1024),
  })
  .refine((request) => !request.content.includes('\0'), 'A text conflict result cannot contain NUL bytes.');

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
    contextLines: z.number().int().min(0).max(100).optional(),
    entireFile: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('lines'),
    hunk: z.number().int().nonnegative().max(1_000),
    lineIndexes: z.array(z.number().int().nonnegative().max(100_000)).min(1).max(10_000).readonly(),
    contextLines: z.number().int().min(0).max(100).optional(),
    entireFile: z.boolean().optional(),
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

export const repositoryDiscardPreviewRequestSchema = z
  .strictObject({
    id: repositoryIdSchema,
    targets: z.array(repositoryWorkingChangeTargetSchema).min(1).max(100),
    selection: repositoryWorkingChangeSelectionSchema.optional(),
  })
  .refine(
    (request) => !request.selection || request.selection.kind === 'file' || request.targets.length === 1,
    'A hunk or line preview needs exactly one file.',
  );

export const repositoryDiscardPreviewSchema = z.strictObject({
  snapshot: repositoryDiffSnapshotSchema,
  files: z.array(repositoryDiffSchema).min(1).max(100),
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

export const repositoryCommitPendingOperationSchema = z.enum([
  'merge',
  'squash',
  'cherry-pick',
  'revert',
  'rebase',
]);

export const repositorySigningModeSchema = z.enum(['inherit', 'gpg', 'unsigned']);
export const repositorySigningSettingsSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  key: z.string().max(4096).nullable(),
  localKey: z.string().max(4096).nullable(),
  format: z.string().max(128),
  commits: z.boolean(),
  tags: z.boolean(),
  snapshot: repositoryDiffSnapshotSchema,
});
export const repositorySigningSettingsRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  snapshot: repositoryDiffSnapshotSchema,
  key: z
    .string()
    .regex(/^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})!?$/u)
    .nullable(),
});
export const repositoryVerifySignatureRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  objectId: gitObjectIdSchema,
  kind: z.enum(['commit', 'tag']),
});
export const repositorySignatureSchema = z.strictObject({
  status: z.enum([
    'valid',
    'untrusted',
    'invalid',
    'missing-key',
    'expired',
    'revoked',
    'unsigned',
    'unsupported',
    'unavailable',
  ]),
  fingerprint: z
    .string()
    .regex(/^[0-9A-Fa-f]{40,64}$/u)
    .nullable(),
});
export type RepositorySigningMode = z.infer<typeof repositorySigningModeSchema>;
export type RepositorySigningSettings = z.infer<typeof repositorySigningSettingsSchema>;
export type RepositorySigningSettingsRequest = z.infer<typeof repositorySigningSettingsRequestSchema>;
export type RepositoryVerifySignatureRequest = z.infer<typeof repositoryVerifySignatureRequestSchema>;
export type RepositorySignature = z.infer<typeof repositorySignatureSchema>;

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
  /** An interactive rebase Edit pause has a distinct amend/continue transition. */
  rebaseEdit: z.enum(['none', 'needs-amend', 'ready-to-continue']),
  /** A message Git prepared for the pending operation, such as `MERGE_MSG`. */
  pendingMessage: z.string().max(262_144).nullable(),
  recentMessages: z.array(repositoryCommitMessageSchema).max(20),
  stagedCount: z.number().int().nonnegative().max(100_000),
  conflictedCount: z.number().int().nonnegative().max(100_000),
  /** Effective Git default; explicit per-operation choices override it. */
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
  signing: repositorySigningModeSchema.optional(),
  subject: z.string().max(16_384),
  body: z.string().max(262_144),
  amend: z.boolean(),
  snapshot: repositoryDiffSnapshotSchema,
  /** Passing `--no-verify` is always an explicit second action by the user. */
  skipHooks: z.boolean(),
});

export const repositoryCommitFailureReasonSchema = z.enum([
  'signing',
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

/** A fully qualified reference issued by the backend for merge/rebase source selection. */
export const repositoryMergeSourceSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine(
    (value) =>
      value.startsWith('refs/heads/') || value.startsWith('refs/tags/') || value.startsWith('refs/remotes/'),
    'Choose a branch, tag, or remote-tracking branch from the repository.',
  )
  .refine(
    // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    'A reference cannot contain control characters.',
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
  objectId: gitObjectIdSchema.optional(),
  tagger: z.string().max(16_384).nullable().optional(),
  taggedAt: z.string().max(128).nullable().optional(),
  message: z.string().max(65_536).optional(),
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
    signing: repositorySigningModeSchema.optional(),
    name: repositoryReferenceNameSchema,
    startPoint: repositoryReferenceStartPointSchema,
    /** This route always creates an annotated tag, including an empty annotation. */
    message: z.string().max(65_536),
    pushRemote: z.string().min(1).max(4_096).optional(),
  }),
  z.strictObject({
    kind: z.literal('delete-tag'),
    fullName: z.string().min(1).max(32_768),
    remoteNames: z.array(z.string().min(1).max(4_096)).max(1_000).optional(),
  }),
  z.strictObject({
    kind: z.literal('push-tag'),
    fullName: z.string().min(1).max(32_768),
    remote: z.string().min(1).max(4_096),
  }),
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
  'push-tag',
]);

export const repositoryReferenceActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositoryReferenceActionSchema,
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryMergeRebaseActionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('merge'),
      mode: z.enum(['default', 'no-ff', 'squash', 'no-commit']).optional(),
      sourceFullName: repositoryMergeSourceSchema,
      snapshot: repositoryDiffSnapshotSchema,
      autostash: z.boolean(),
      changesSnapshot: repositoryDiffSnapshotSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('rebase'),
      sourceFullName: repositoryMergeSourceSchema,
      snapshot: repositoryDiffSnapshotSchema,
      autostash: z.boolean(),
      changesSnapshot: repositoryDiffSnapshotSchema.optional(),
    }),
  ])
  .refine(
    (action) => !action.autostash || action.changesSnapshot !== undefined,
    'Stashing local changes requires a working-tree snapshot.',
  );

export const repositoryMergeRebaseRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositoryMergeRebaseActionSchema,
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

export const repositoryWorktreeIdSchema = z.string().regex(/^worktree-[a-f0-9]{64}$/);

export const repositoryWorktreeSchema = z.strictObject({
  id: repositoryWorktreeIdSchema,
  path: repositoryPathSchema,
  branchName: z.string().max(32_768).nullable(),
  branchFullName: z.string().startsWith('refs/heads/').max(32_768).nullable(),
  head: gitObjectIdSchema.nullable(),
  isCurrent: z.boolean(),
  isMain: z.boolean(),
  exists: z.boolean(),
  locked: z.boolean(),
  lockReason: z.string().max(512).nullable(),
  prunable: z.boolean(),
  pruneReason: z.string().max(512).nullable(),
  workingTree: repositoryWorkingTreeSchema,
});

export const repositoryWorktreeContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  worktrees: z.array(repositoryWorktreeSchema).max(1_000),
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryWorktreeSourceSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine(
    (value) => value.startsWith('refs/heads/') || value.startsWith('refs/remotes/'),
    'Choose a local or remote-tracking branch from the repository.',
  )
  .refine(
    // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    'A branch reference cannot contain control characters.',
  );

export const repositoryWorktreeActionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('create'),
      path: repositoryPathSchema,
      sourceFullName: repositoryWorktreeSourceSchema,
      /** Required when creating a local branch from a remote-tracking branch. */
      branchName: repositoryReferenceNameSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('remove'),
      worktreeId: repositoryWorktreeIdSchema,
      /** Explicitly permits deleting a dirty or locked linked worktree. */
      force: z.boolean(),
    }),
    z.strictObject({ kind: z.literal('prune') }),
  ])
  .refine(
    (action) =>
      action.kind !== 'create' ||
      !action.sourceFullName.startsWith('refs/remotes/') ||
      action.branchName !== undefined,
    'A local branch name is required for a remote worktree.',
  );

export const repositoryWorktreeActionKindSchema = z.enum(['create', 'remove', 'prune']);

export const repositoryWorktreeFailureReasonSchema = z.enum([
  'current',
  'main',
  'dirty',
  'locked',
  'exists',
  'checked-out',
  'not-found',
  'invalid-path',
  'stale',
  'other',
]);

export const repositoryWorktreeActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositoryWorktreeActionSchema,
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryWorktreeActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    repositoryId: repositoryIdSchema,
    kind: repositoryWorktreeActionKindSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    worktreeId: repositoryWorktreeIdSchema.nullable(),
    path: repositoryPathSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal('blocked'),
    repositoryId: repositoryIdSchema,
    kind: repositoryWorktreeActionKindSchema,
    reason: repositoryWorktreeFailureReasonSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    worktreeId: repositoryWorktreeIdSchema.nullable(),
    paths: z.array(repositoryRevisionPathSchema).max(200),
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

export const repositoryCloneRequestSchema = z.strictObject({
  url: repositoryRemoteUrlSchema,
  parentPath: repositoryPathSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine(
      (name) =>
        // eslint-disable-next-line no-control-regex -- reject control bytes in a destination component.
        name !== '.' && name !== '..' && !/[\\/\u0000-\u001F\u007F]/u.test(name) && !name.startsWith('-'),
      'Use a single folder name without separators or control characters.',
    ),
});

export const repositoryConnectionRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('url'), url: repositoryRemoteUrlSchema }),
  z.strictObject({ kind: z.literal('remote'), id: repositoryIdSchema, name: repositoryRemoteNameSchema }),
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

export const repositorySubmoduleIdSchema = z.string().regex(/^submodule-[a-f0-9]{64}$/);

export const repositorySubmoduleStateSchema = z.enum([
  'clean',
  'dirty',
  'changed',
  'detached',
  'uninitialized',
  'missing',
  'missing-commit',
  'conflicted',
  'unknown',
]);

export const repositorySubmoduleParentStatusSchema = z.enum([
  'clean',
  'modified',
  'staged',
  'staged-and-modified',
  'unmerged',
  'untracked',
  'unknown',
]);

/** The three pointers needed to explain a submodule change without treating it as a text diff. */
export const repositorySubmoduleRevisionsSchema = z.strictObject({
  /** The gitlink recorded by the parent commit. */
  head: gitObjectIdSchema.nullable(),
  /** The gitlink currently recorded in the parent index. */
  index: gitObjectIdSchema.nullable(),
  /** The commit checked out in the child worktree. */
  working: gitObjectIdSchema.nullable(),
});

export const repositorySubmoduleSchema = z.strictObject({
  id: repositorySubmoduleIdSchema,
  path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'A submodule path is required.'),
  name: z.string().min(1).max(4_096),
  url: z.string().max(32_768),
  branch: z.string().max(4_096).nullable(),
  nested: z.boolean(),
  initialized: z.boolean(),
  detached: z.boolean(),
  state: repositorySubmoduleStateSchema,
  parentStatus: repositorySubmoduleParentStatusSchema,
  statusCode: z.enum([' ', '+', '-', 'U', '?']),
  dirtyFileCount: z.number().int().nonnegative().max(100_000).nullable(),
  revisions: repositorySubmoduleRevisionsSchema,
  /** True when the parent index differs from its committed gitlink. */
  indexChanged: z.boolean(),
  /** True when the child HEAD differs from the gitlink recorded in the parent index. */
  workingChanged: z.boolean(),
  /** Relative paths reported by the child status, bounded for safe presentation. */
  dirtyPaths: z.array(repositoryRevisionPathSchema).max(10_000),
});

export const repositorySubmoduleContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  submodules: z.array(repositorySubmoduleSchema).max(1_000),
  snapshot: repositoryDiffSnapshotSchema,
  truncated: z.boolean(),
});

export const repositorySubmoduleActionKindSchema = z.enum(['add', 'init', 'update', 'sync', 'remove']);

export const repositorySubmoduleActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('add'),
    path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'A submodule path is required.'),
    url: repositoryRemoteUrlSchema,
    branch: z.string().min(1).max(4_096).optional(),
    recursive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('init'),
    submoduleId: repositorySubmoduleIdSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('update'),
    submoduleId: repositorySubmoduleIdSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('sync'),
    submoduleId: repositorySubmoduleIdSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('remove'),
    submoduleId: repositorySubmoduleIdSchema,
    force: z.boolean(),
  }),
]);

export const repositorySubmoduleActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositorySubmoduleActionSchema,
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositorySubmoduleRequestSchema = z.strictObject({ id: repositoryIdSchema });
export const repositoryOpenSubmoduleRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  submoduleId: repositorySubmoduleIdSchema,
});

export const repositorySubmoduleFailureReasonSchema = z.enum([
  'dirty',
  'conflict',
  'missing',
  'not-found',
  'invalid-path',
  'exists',
  'stale',
  'other',
]);

export const repositorySubmoduleActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    repositoryId: repositoryIdSchema,
    kind: repositorySubmoduleActionKindSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    context: repositorySubmoduleContextSchema,
  }),
  z.strictObject({
    status: z.literal('blocked'),
    repositoryId: repositoryIdSchema,
    kind: repositorySubmoduleActionKindSchema,
    reason: repositorySubmoduleFailureReasonSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    paths: z.array(repositoryRevisionPathSchema).max(200),
    context: repositorySubmoduleContextSchema,
  }),
]);

/** The three topic families supported by the bounded native Git-flow implementation. */
export const repositoryGitFlowTypeSchema = z.enum(['feature', 'release', 'hotfix']);

export const repositoryGitFlowPrefixSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.endsWith('/'), 'A Git-flow prefix must end with /.')
  .refine((value) => !value.startsWith('/'), 'A Git-flow prefix cannot start with /.')
  .refine((value) => !value.startsWith('-'), 'A Git-flow prefix cannot start with -.')
  .refine(
    // eslint-disable-next-line no-control-regex -- control characters are rejected, not interpreted.
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    'A Git-flow prefix cannot contain control characters.',
  );

export const repositoryGitFlowConfigSchema = z.strictObject({
  productionBranch: repositoryReferenceNameSchema,
  developBranch: repositoryReferenceNameSchema,
  featurePrefix: repositoryGitFlowPrefixSchema,
  releasePrefix: repositoryGitFlowPrefixSchema,
  hotfixPrefix: repositoryGitFlowPrefixSchema,
});

export const repositoryGitFlowBranchSchema = z.strictObject({
  type: repositoryGitFlowTypeSchema,
  name: repositoryReferenceNameSchema,
  fullName: z.string().startsWith('refs/heads/').max(32_768),
  baseBranch: repositoryReferenceNameSchema,
  target: gitObjectIdSchema,
  isHead: z.boolean(),
});

export const repositoryGitFlowLocalBranchSchema = z.strictObject({
  name: repositoryReferenceNameSchema,
  target: gitObjectIdSchema,
  isHead: z.boolean(),
});

export const repositoryGitFlowCapabilitiesSchema = z.strictObject({
  canInitialize: z.boolean(),
  initializeReason: z.string().max(512).nullable(),
  canStart: z.boolean(),
  startReason: z.string().max(512).nullable(),
  canFinish: z.boolean(),
  finishReason: z.string().max(512).nullable(),
});

export const repositoryGitFlowContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  status: z.enum(['unconfigured', 'configured', 'invalid']),
  configured: z.boolean(),
  config: repositoryGitFlowConfigSchema.nullable(),
  head: repositoryHeadSchema,
  localBranches: z.array(repositoryGitFlowLocalBranchSchema).max(10_000),
  branches: z.array(repositoryGitFlowBranchSchema).max(1_000),
  clean: z.boolean(),
  untrackedCount: z.number().int().nonnegative().max(100_000),
  conflictedCount: z.number().int().nonnegative().max(100_000),
  pendingOperation: repositoryCommitPendingOperationSchema.nullable(),
  capabilities: repositoryGitFlowCapabilitiesSchema,
  message: z.string().max(512),
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryGitFlowActionKindSchema = z.enum(['initialize', 'start', 'finish']);

export const repositoryGitFlowActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('initialize'),
    config: repositoryGitFlowConfigSchema,
    snapshot: repositoryDiffSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('start'),
    type: repositoryGitFlowTypeSchema,
    name: repositoryReferenceNameSchema,
    snapshot: repositoryDiffSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal('finish'),
    type: repositoryGitFlowTypeSchema,
    name: repositoryReferenceNameSchema,
    snapshot: repositoryDiffSnapshotSchema,
    noFastForward: z.boolean(),
    mergeIntoDevelop: z.boolean(),
    tagMessage: z.string().max(65_536),
    keepBranch: z.boolean(),
  }),
]);

export const repositoryGitFlowActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: repositoryGitFlowActionSchema,
});

export const repositoryGitFlowFailureReasonSchema = z.enum([
  'already-configured',
  'invalid-config',
  'unconfigured',
  'dirty',
  'pending-operation',
  'detached',
  'missing-base',
  'branch-exists',
  'branch-not-found',
  'not-current',
  'tag-exists',
  'active-hotfix',
  'conflict',
  'identity',
  'invalid-name',
  'other',
]);

export const repositoryGitFlowActionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    repositoryId: repositoryIdSchema,
    kind: repositoryGitFlowActionKindSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    context: repositoryGitFlowContextSchema,
    createdBranch: z.string().startsWith('refs/heads/').max(32_768).nullable(),
    deletedBranch: z.string().startsWith('refs/heads/').max(32_768).nullable(),
    tag: z.string().startsWith('refs/tags/').max(32_768).nullable(),
  }),
  z.strictObject({
    status: z.literal('blocked'),
    repositoryId: repositoryIdSchema,
    kind: repositoryGitFlowActionKindSchema,
    reason: repositoryGitFlowFailureReasonSchema,
    message: z.string().min(1).max(512),
    output: z.string().max(65_536),
    context: repositoryGitFlowContextSchema,
    paths: z.array(z.string().min(1).max(32_768)).max(200),
    createdBranch: z.string().startsWith('refs/heads/').max(32_768).nullable(),
    deletedBranch: z.string().startsWith('refs/heads/').max(32_768).nullable(),
    tag: z.string().startsWith('refs/tags/').max(32_768).nullable(),
  }),
]);

export const leanBranchNameSchema = z
  .string()
  .min(1)
  .max(1024)
  // eslint-disable-next-line no-control-regex -- reject control bytes in branch input.
  .refine((name) => !name.startsWith('-') && !/[\s\x00-\x1f\x7f]/u.test(name));
export const repositoryLeanReadSchema = z.strictObject({
  id: repositoryIdSchema,
  base: leanBranchNameSchema.optional(),
});
export const repositoryLeanContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  branches: z.array(z.string().min(1).max(32768)).max(10000),
  current: z.string().max(32768).nullable(),
  base: z.string().max(32768).nullable(),
  baseTarget: gitObjectIdSchema.nullable(),
  startTarget: gitObjectIdSchema.nullable(),
  upstream: z.string().max(32768).nullable(),
  commitCount: z.number().int().nonnegative(),
  startReason: z.string().max(4096).nullable(),
  syncReason: z.string().max(4096).nullable(),
  finishReason: z.string().max(4096).nullable(),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const repositoryLeanActionSchema = z
  .strictObject({
    id: repositoryIdSchema,
    kind: z.enum(['start', 'sync', 'finish']),
    base: leanBranchNameSchema,
    name: leanBranchNameSchema.optional(),
    snapshot: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .superRefine((value, ctx) => {
    if ((value.kind === 'start') !== (value.name !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Only Start requires a new branch name.' });
  });
export type RepositoryLeanRead = z.infer<typeof repositoryLeanReadSchema>;
export type RepositoryLeanContext = z.infer<typeof repositoryLeanContextSchema>;
export type RepositoryLeanAction = z.infer<typeof repositoryLeanActionSchema>;

export const repositoryOperationIdSchema = z.string().regex(/^op-[a-f0-9]{32}$/);

export const repositoryBisectContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  active: z.boolean(),
  original: z.string().max(4096).nullable(),
  head: z
    .string()
    .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)
    .nullable(),
  bad: z
    .string()
    .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)
    .nullable(),
  good: z.array(z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)).max(10000),
  skipped: z.array(z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)).max(10000),
  firstBad: z
    .string()
    .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)
    .nullable(),
  candidates: z.array(z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)).max(10000),
  blockedReason: z.string().max(4096).nullable(),
  snapshot: z.string().regex(/^[0-9a-f]{64}$/u),
});
export const repositoryBisectActionRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  action: z.enum(['start', 'bad', 'good', 'skip', 'reset']),
  snapshot: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type RepositoryBisectContext = z.infer<typeof repositoryBisectContextSchema>;
export type RepositoryBisectActionRequest = z.infer<typeof repositoryBisectActionRequestSchema>;

export const repositoryOperationKindSchema = z.enum([
  'lean-branching',
  'patch',
  'external-tool',
  'custom-command',
  'clone',
  'connection',
  'fetch',
  'pull',
  'push',
  'delete-remote-branch',
  'commit',
  'reference',
  'fast-forward',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'reset',
  'recovery',
  'stash',
  'worktree',
  'submodule',
  'lfs',
  'git-flow',
  'bisect',
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
  'conflict',
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
  cancelRequested: z.boolean().optional(),
  /** Monotonically increasing; late IPC replies cannot overwrite newer events. */
  revision: z.number().int().nonnegative().optional(),
  result: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('external-merge'), value: externalMergeDraftSchema }),
      z.strictObject({ kind: z.literal('clone'), value: repositorySummarySchema }),
      z.strictObject({ kind: z.literal('commit'), value: repositoryCommitResultSchema }),
      z.strictObject({ kind: z.literal('reference'), value: repositoryReferenceActionResultSchema }),
      z.strictObject({ kind: z.literal('worktree'), value: repositoryWorktreeActionResultSchema }),
      z.strictObject({ kind: z.literal('submodule'), value: repositorySubmoduleActionResultSchema }),
      z.strictObject({ kind: z.literal('git-flow'), value: repositoryGitFlowActionResultSchema }),
      z.strictObject({ kind: z.literal('bisect'), value: repositoryBisectContextSchema }),
      z.strictObject({ kind: z.literal('lfs'), value: repositoryLfsSaveResultSchema }),
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
  /** Pull can use Git's ordinary merge or rebase path; unfinished states surface through Recovery. */
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

export const repositoryHistoryOperationKindSchema = z.enum(['cherry-pick', 'revert', 'reset']);
export const repositoryHistoryResetModeSchema = z.enum(['soft', 'mixed', 'hard']);

export const repositoryHistoryOperationPreviewRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cherry-pick'),
    id: repositoryIdSchema,
    commitId: gitObjectIdSchema,
  }),
  z.strictObject({
    kind: z.literal('revert'),
    id: repositoryIdSchema,
    commitId: gitObjectIdSchema,
  }),
  z.strictObject({
    kind: z.literal('reset'),
    id: repositoryIdSchema,
    targetCommitId: gitObjectIdSchema,
    mode: repositoryHistoryResetModeSchema,
  }),
]);

export const repositoryHistoryOperationChangesSchema = z.strictObject({
  snapshot: repositoryDiffSnapshotSchema,
  paths: z.array(z.string().max(32_768)).max(10_000),
  untrackedPaths: z.array(z.string().max(32_768)).max(10_000),
  pendingOperation: repositoryCommitPendingOperationSchema.nullable(),
  conflictedCount: z.number().int().nonnegative().max(100_000),
});

/** A fresh, read-only plan for one selected commit operation. The renderer sends this token back. */
export const repositoryHistoryOperationPreviewSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  kind: repositoryHistoryOperationKindSchema,
  currentHead: repositoryHeadSchema,
  currentBranch: z.string().max(4_096).nullable(),
  targetCommitId: gitObjectIdSchema,
  targetSubject: z.string().max(16_384),
  targetParents: z.array(gitObjectIdSchema).max(128),
  mode: repositoryHistoryResetModeSchema.nullable(),
  workingChanges: repositoryHistoryOperationChangesSchema,
  snapshot: repositoryDiffSnapshotSchema,
  canStart: z.boolean(),
  message: z.string().min(1).max(512),
});

export const repositoryHistoryOperationActionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('cherry-pick'),
      commitId: gitObjectIdSchema,
      snapshot: repositoryDiffSnapshotSchema,
      commitChanges: z.boolean(),
      appendOrigin: z.boolean(),
      mainlineParent: z.number().int().positive().max(128).optional(),
      autostash: z.boolean(),
      changesSnapshot: repositoryDiffSnapshotSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('revert'),
      commitId: gitObjectIdSchema,
      snapshot: repositoryDiffSnapshotSchema,
      commitChanges: z.boolean(),
      mainlineParent: z.number().int().positive().max(128).optional(),
      autostash: z.boolean(),
      changesSnapshot: repositoryDiffSnapshotSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal('reset'),
      targetCommitId: gitObjectIdSchema,
      mode: repositoryHistoryResetModeSchema,
      snapshot: repositoryDiffSnapshotSchema,
      changesSnapshot: repositoryDiffSnapshotSchema.optional(),
      /** Hard reset is destructive to tracked local files and must be confirmed explicitly. */
      confirmDiscard: z.boolean(),
    }),
  ])
  .refine(
    (action) => !('autostash' in action) || !action.autostash || action.changesSnapshot !== undefined,
    'Stashing local changes requires a working-tree snapshot.',
  );

export const repositoryInteractiveRebaseCommandSchema = z.enum([
  'pick',
  'reword',
  'edit',
  'squash',
  'fixup',
  'drop',
]);

export const repositoryInteractiveRebaseCommitSchema = z.strictObject({
  commitId: gitObjectIdSchema,
  subject: z.string().max(16_384),
  body: z.string().max(262_144),
  author: repositoryHistoryPersonSchema,
  committer: repositoryHistoryPersonSchema,
  action: repositoryInteractiveRebaseCommandSchema,
});

/** A newest-first, backend-reviewed plan. The renderer may reorder and edit only these rows. */
export const repositoryInteractiveRebasePlanSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  branchName: z.string().min(1).max(4_096),
  headCommit: gitObjectIdSchema,
  ontoCommitId: gitObjectIdSchema.nullable(),
  ontoSubject: z.string().max(16_384).nullable(),
  root: z.boolean(),
  commits: z.array(repositoryInteractiveRebaseCommitSchema).min(1).max(500),
  workingChanges: repositoryLocalChangesPreviewSchema,
  mergeCommitCount: z.number().int().nonnegative().max(500),
  snapshot: repositoryDiffSnapshotSchema,
});

export const repositoryInteractiveRebasePlanRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  ontoCommitId: gitObjectIdSchema.nullable(),
});

export const repositoryInteractiveRebaseActionSchema = z
  .strictObject({
    id: repositoryIdSchema,
    ontoCommitId: gitObjectIdSchema.nullable(),
    snapshot: repositoryDiffSnapshotSchema,
    actions: z
      .array(
        z.strictObject({
          commitId: gitObjectIdSchema,
          action: repositoryInteractiveRebaseCommandSchema,
          subject: z.string().max(16_384),
          body: z.string().max(262_144),
        }),
      )
      .min(1)
      .max(500),
    autosquash: z.boolean(),
    autostash: z.boolean(),
    changesSnapshot: repositoryDiffSnapshotSchema.optional(),
  })
  .refine(
    (action) => !action.autostash || action.changesSnapshot !== undefined,
    'Stashing local changes requires a working-tree snapshot.',
  );

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
  conflictedCount: z.number().int().nonnegative().max(100_000).optional(),
  rebaseEdit: z.enum(['none', 'needs-amend', 'ready-to-continue']),
});
export const repositoryRecoveryRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  snapshot: repositoryDiffSnapshotSchema,
  action: z.enum(['continue', 'skip', 'abort', 'apply', 'finish', 'drop']),
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
    /** Stage previously untracked paths before saving a two-parent stash. */
    stageNewFiles: z.boolean().optional(),
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
  z.strictObject({
    kind: z.literal('rename'),
    stashId: gitObjectIdSchema,
    message: z.string().trim().min(1).max(512),
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
export const repositoryPatchImportRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  source: z.enum(['file', 'clipboard']),
});
export const repositoryPatchPreviewSchema = z.strictObject({
  token: z.string().uuid(),
  location: z.string().max(32_768),
  state: z.enum(['clean', 'warning', 'invalid']),
  message: z.string().max(4096),
  byteLength: z
    .number()
    .int()
    .min(1)
    .max(8 * 1024 * 1024),
});
export const repositoryPatchApplyRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  token: z.string().uuid(),
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

export const repositoryLfsPointerSchema = z.strictObject({
  version: z.literal('https://git-lfs.github.com/spec/v1'),
  oid: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  size: z.number().int().nonnegative().max(1_000_000_000_000),
});

export const repositoryLfsFileSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'An LFS path is required.'),
  tracked: z.boolean(),
  history: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('lfs'),
      pointer: repositoryLfsPointerSchema,
      pointerByteLength: z.number().int().positive().max(1_048_576),
      payloadState: z.enum(['available', 'missing', 'invalid']),
      payloadByteLength: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
    }),
    z.strictObject({
      kind: z.literal('regular'),
      byteLength: z.number().int().nonnegative().max(1_000_000_000_000),
    }),
    z.strictObject({ kind: z.literal('missing') }),
  ]),
  worktree: z.strictObject({
    state: z.enum(['pointer', 'materialized', 'missing', 'not-lfs', 'unavailable']),
    byteLength: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
  }),
  gitLfs: z.strictObject({ available: z.boolean(), version: z.string().max(256).nullable() }),
});

export const repositoryLfsFileRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'An LFS path is required.'),
});

export const repositoryLfsInitializationRequestSchema = z.strictObject({ id: repositoryIdSchema });

export const repositoryLfsSaveRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryRevisionPathSchema.refine((value) => value.length > 0, 'An LFS path is required.'),
});

const repositoryHistoricalFilePathSchema = repositoryRevisionPathSchema.refine(
  (value) => value.length > 0,
  'A historical file path is required.',
);

export const repositoryFileHistoryRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryHistoricalFilePathSchema,
});

export const repositoryFileHistoryOpenRequestSchema = repositoryFileHistoryRequestSchema.extend({
  theme: z.enum(['system', 'light', 'dark']),
});

export const repositoryFileHistoryRevisionSchema = z.strictObject({
  commit: repositoryHistoryCommitSchema,
  /** The path at this revision, which can be the pre-rename name. */
  path: repositoryHistoricalFilePathSchema,
  previousPath: repositoryHistoricalFilePathSchema.nullable(),
  status: repositoryCommitChangeStatusSchema,
  similarity: z.number().int().nonnegative().max(100).nullable(),
});

export const repositoryFileHistorySchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  startingCommitId: gitObjectIdSchema,
  path: repositoryHistoricalFilePathSchema,
  revisions: z.array(repositoryFileHistoryRevisionSchema).max(2_000),
  truncated: z.boolean(),
});

export const repositoryFileHistoryContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryHistoricalFilePathSchema,
  theme: z.enum(['system', 'light', 'dark']),
});

export const repositoryBlameRequestSchema = repositoryFileHistoryRequestSchema;

export const repositoryBlameOpenRequestSchema = repositoryBlameRequestSchema.extend({
  theme: z.enum(['system', 'light', 'dark']),
});

export const repositoryBlameLineSchema = z.strictObject({
  line: z.number().int().positive().max(1_000_000),
  commitId: gitObjectIdSchema,
  content: z.string().max(262_144),
});

export const repositoryBlameSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryHistoricalFilePathSchema,
  state: z.enum(['text', 'binary', 'too-large']),
  byteLength: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
  commits: z.array(repositoryHistoryCommitSchema).max(2_000),
  lines: z.array(repositoryBlameLineSchema).max(100_000),
  truncated: z.boolean(),
  message: z.string().max(512).nullable(),
});

export const repositoryBlameContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  path: repositoryHistoricalFilePathSchema,
  theme: z.enum(['system', 'light', 'dark']),
});

export const repositoryCommitDetailsRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  commitId: gitObjectIdSchema,
  tab: z.enum(['commit', 'changes', 'tree']),
  path: repositoryRevisionPathSchema.optional(),
  theme: z.enum(['system', 'light', 'dark']),
});

export const repositoryCommitDetailsContextSchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  commit: repositoryHistoryCommitSchema,
  references: z.array(repositoryHistoryReferenceSchema).max(10_000),
  tab: z.enum(['commit', 'changes', 'tree']),
  path: repositoryRevisionPathSchema.optional(),
  theme: z.enum(['system', 'light', 'dark']),
});

export const requests = {
  getAiSettings: request('ai:get-settings', z.undefined(), aiSettingsSchema),
  configureAi: request('ai:configure', aiConfigureSchema, aiSettingsSchema),
  disableAi: request('ai:disable', z.undefined(), aiSettingsSchema),
  previewAi: request('ai:preview', aiPreviewRequestSchema, aiPreviewSchema),
  sendAi: request('ai:send', aiSendSchema, aiResultSchema),
  cancelAi: request('ai:cancel', aiCancelSchema, z.null()),
  getRepositoryStatistics: request('repository:get-statistics', statisticsRequestSchema, statisticsSchema),
  cancelRepositoryStatistics: request('repository:cancel-statistics', statisticsCancelSchema, z.null()),
  getGitInstance: request('settings:get-git-instance', z.undefined(), gitInstanceSchema),
  saveGitInstance: request('settings:save-git-instance', gitInstanceSchema, gitInstanceSchema),
  pickGitInstance: request('settings:pick-git-instance', z.undefined(), z.string().max(4096).nullable()),
  getGitSettings: request('settings:get-git', settingsTargetSchema, gitSettingsSchema),
  saveGitSettings: request('settings:save-git', saveGitSettingsSchema, gitSettingsSchema),
  openIssue: request('settings:open-issue', openIssueSchema, z.null()),
  listCustomCommands: request('custom-commands:list', z.undefined(), customCommandsSchema),
  listExternalTools: request('external-tools:list', z.undefined(), externalToolsSchema),
  saveExternalTool: request('external-tools:save', externalToolSaveSchema, externalToolsSchema),
  removeExternalTool: request('external-tools:remove', externalToolSelectionSchema, externalToolsSchema),
  pickExternalTool: request('external-tools:pick-executable', z.undefined(), z.string().max(4096).nullable()),
  runExternalTool: request('external-tools:run', externalToolRunSchema, repositoryOperationSchema),
  saveCustomCommand: request('custom-commands:save', customSaveSchema, customCommandsSchema),
  removeCustomCommand: request('custom-commands:remove', customSelectionSchema, customCommandsSchema),
  importCustomCommands: request('custom-commands:import', z.undefined(), customCommandsSchema.nullable()),
  exportCustomCommand: request('custom-commands:export', customSelectionSchema, z.null()),
  pickCustomCommandFile: request(
    'custom-commands:pick-input-file',
    z.undefined(),
    z.string().max(32768).nullable(),
  ),
  previewCustomCommand: request('custom-commands:preview', customPreviewRequestSchema, customPreviewSchema),
  runCustomCommand: request('custom-commands:run', customRunSchema, repositoryOperationSchema),
  listHostingAccounts: request('hosting:list-accounts', z.undefined(), hostingAccountsSchema),
  listHostingActivity: request(
    'hosting:list-activity',
    hostingActivityRequestSchema,
    hostingActivityPageSchema,
  ),
  openHostingActivity: request('hosting:open-activity', hostingActivitySelectionSchema, z.null()),
  connectHostingAccount: request(
    'hosting:connect-account',
    hostingConnectRequestSchema,
    hostingAccountSchema.nullable(),
  ),
  disconnectHostingAccount: request('hosting:disconnect-account', hostingAccountRequestSchema, z.null()),
  useHostingAccountForGit: request('hosting:use-for-git', hostingAccountRequestSchema, z.null()),
  openHostingTokenSettings: request('hosting:open-token-settings', z.undefined(), z.null()),
  listHostedRepositories: request(
    'hosting:list-repositories',
    hostingRepositoriesRequestSchema,
    hostedRepositoriesSchema,
  ),
  getHostedCloneTarget: request(
    'hosting:get-clone-target',
    hostingCloneSelectionSchema,
    hostingCloneTargetSchema,
  ),
  openHostedRepository: request('hosting:open-repository', hostingRepositoryRequestSchema, z.null()),
  cancelHostingRequests: request('hosting:cancel-requests', z.undefined(), z.null()),
  getAppInfo: request('app:get-info', z.undefined(), appInfoSchema),
  getWindowState: request('window:get-state', z.undefined(), windowStateSchema),
  windowCommand: request('window:command', windowCommandSchema, z.null()),
  editCommand: request('edit:command', editCommandSchema, z.null()),
  writeClipboardText: request('clipboard:write-text', clipboardTextSchema, z.null()),
  getGitInfo: request('git:get-info', z.undefined(), gitInfoSchema),
  setRepositoryTrust: request(
    'repository:set-trust',
    z.strictObject({ id: repositoryIdSchema, trusted: z.boolean() }),
    z.null(),
  ),
  openRepositoryCommitDetails: request(
    'repository:open-commit-details',
    repositoryCommitDetailsRequestSchema,
    z.null(),
  ),
  getRepositoryCommitDetailsContext: request(
    'repository:get-commit-details-context',
    z.undefined(),
    repositoryCommitDetailsContextSchema,
  ),
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
  cloneRepository: request('repository:clone', repositoryCloneRequestSchema, repositoryOperationSchema),
  testRepositoryConnection: request(
    'repository:test-connection',
    repositoryConnectionRequestSchema,
    repositoryOperationSchema,
  ),
  getAutomaticFetchPreference: request(
    'repository:get-automatic-fetch',
    z.undefined(),
    z.strictObject({ enabled: z.boolean() }),
  ),
  setAutomaticFetchPreference: request(
    'repository:set-automatic-fetch',
    z.strictObject({ enabled: z.boolean() }),
    z.strictObject({ enabled: z.boolean() }),
  ),
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
  setRepositoryListVisible: request(
    'repository:set-list-visible',
    z.strictObject({ visible: z.boolean() }),
    repositoryTabPreferencesSchema,
  ),
  reorderRepositoryTabs: request(
    'repository:reorder-tabs',
    z.strictObject({
      ids: z
        .array(repositoryIdSchema)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length),
    }),
    z.array(repositorySummarySchema).max(20),
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
  previewRepositoryDiscard: request(
    'repository:preview-discard',
    repositoryDiscardPreviewRequestSchema,
    repositoryDiscardPreviewSchema,
  ),
  cancelRepositoryDiff: request('repository:cancel-diff', repositoryDiffCancelSchema, z.null()),
  getRepositoryWorkingChanges: request(
    'repository:get-working-changes',
    repositoryWorkingChangesRequestSchema,
    repositoryWorkingChangesSchema,
  ),
  getRepositoryConflicts: request(
    'repository:get-conflicts',
    repositoryConflictRequestSchema,
    repositoryConflictStateSchema,
  ),
  resolveRepositoryConflict: request(
    'repository:resolve-conflict',
    repositoryResolveConflictRequestSchema,
    repositoryConflictStateSchema,
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
  getRepositoryWorktrees: request(
    'repository:get-worktrees',
    repositorySessionSchema,
    repositoryWorktreeContextSchema,
  ),
  startRepositoryWorktreeOperation: request(
    'repository:start-worktree-operation',
    repositoryWorktreeActionRequestSchema,
    repositoryOperationSchema,
  ),
  getRepositorySubmodules: request(
    'repository:get-submodules',
    repositorySubmoduleRequestSchema,
    repositorySubmoduleContextSchema,
  ),
  startRepositorySubmoduleOperation: request(
    'repository:start-submodule-operation',
    repositorySubmoduleActionRequestSchema,
    repositoryOperationSchema,
  ),
  getRepositoryBisect: request(
    'repository:get-bisect',
    repositorySessionSchema,
    repositoryBisectContextSchema,
  ),
  getRepositorySigningSettings: request(
    'repository:get-signing-settings',
    repositorySessionSchema,
    repositorySigningSettingsSchema,
  ),
  setRepositorySigningKey: request(
    'repository:set-signing-key',
    repositorySigningSettingsRequestSchema,
    repositorySigningSettingsSchema,
  ),
  verifyRepositorySignature: request(
    'repository:verify-signature',
    repositoryVerifySignatureRequestSchema,
    repositorySignatureSchema,
  ),
  startRepositoryBisectOperation: request(
    'repository:start-bisect-operation',
    repositoryBisectActionRequestSchema,
    repositoryOperationSchema,
  ),
  getRepositoryLean: request('repository:get-lean', repositoryLeanReadSchema, repositoryLeanContextSchema),
  startRepositoryLean: request(
    'repository:start-lean',
    repositoryLeanActionSchema,
    repositoryOperationSchema,
  ),
  getRepositoryGitFlow: request(
    'repository:get-git-flow',
    repositorySessionSchema,
    repositoryGitFlowContextSchema,
  ),
  startRepositoryGitFlowOperation: request(
    'repository:start-git-flow-operation',
    repositoryGitFlowActionRequestSchema,
    repositoryOperationSchema,
  ),
  openRepositorySubmodule: request(
    'repository:open-submodule',
    repositoryOpenSubmoduleRequestSchema,
    repositorySummarySchema,
  ),
  startRepositoryMergeRebase: request(
    'repository:start-merge-rebase',
    repositoryMergeRebaseRequestSchema,
    repositoryOperationSchema,
  ),
  getRepositoryHistoryOperationPreview: request(
    'repository:get-history-operation-preview',
    repositoryHistoryOperationPreviewRequestSchema,
    repositoryHistoryOperationPreviewSchema,
  ),
  startRepositoryHistoryOperation: request(
    'repository:start-history-operation',
    z.strictObject({ id: repositoryIdSchema, action: repositoryHistoryOperationActionSchema }),
    repositoryOperationSchema,
  ),
  getRepositoryInteractiveRebasePlan: request(
    'repository:get-interactive-rebase-plan',
    repositoryInteractiveRebasePlanRequestSchema,
    repositoryInteractiveRebasePlanSchema,
  ),
  startRepositoryInteractiveRebase: request(
    'repository:start-interactive-rebase',
    repositoryInteractiveRebaseActionSchema,
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
  copyRepositoryPatch: request('repository:copy-patch', repositoryPatchExportRequestSchema, z.null()),
  previewRepositoryPatch: request(
    'repository:preview-patch',
    repositoryPatchImportRequestSchema,
    repositoryPatchPreviewSchema.nullable(),
  ),
  applyRepositoryPatch: request(
    'repository:apply-patch',
    repositoryPatchApplyRequestSchema,
    repositoryOperationSchema,
  ),
  releaseRepositoryPatch: request('repository:release-patch', repositoryPatchApplyRequestSchema, z.null()),
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
  getRepositoryLfsFile: request(
    'repository:get-lfs-file',
    repositoryLfsFileRequestSchema,
    repositoryLfsFileSchema,
  ),
  startRepositoryLfsInitialization: request(
    'repository:start-lfs-initialization',
    repositoryLfsInitializationRequestSchema,
    repositoryOperationSchema,
  ),
  saveRepositoryLfsPayload: request(
    'repository:save-lfs-payload',
    repositoryLfsSaveRequestSchema,
    repositoryOperationSchema.nullable(),
  ),
  openRepositoryFileHistory: request(
    'repository:open-file-history',
    repositoryFileHistoryOpenRequestSchema,
    z.null(),
  ),
  getRepositoryFileHistoryContext: request(
    'repository:get-file-history-context',
    z.undefined(),
    repositoryFileHistoryContextSchema,
  ),
  getRepositoryFileHistory: request(
    'repository:get-file-history',
    repositoryFileHistoryRequestSchema,
    repositoryFileHistorySchema,
  ),
  openRepositoryBlame: request('repository:open-blame', repositoryBlameOpenRequestSchema, z.null()),
  getRepositoryBlameContext: request(
    'repository:get-blame-context',
    z.undefined(),
    repositoryBlameContextSchema,
  ),
  getRepositoryBlame: request('repository:get-blame', repositoryBlameRequestSchema, repositoryBlameSchema),
  openRepositoryInFileManager: request('repository:open-in-file-manager', repositoryLocationSchema, z.null()),
} as const;

export const events = {
  settingsChanged: { channel: 'settings:changed', payload: z.null() },
  windowStateChanged: { channel: 'window:state-changed', payload: windowStateSchema },
  repositoryActivated: { channel: 'repository:activated', payload: repositorySummarySchema },
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
export type RepositoryCloneRequest = z.infer<typeof repositoryCloneRequestSchema>;
export type RepositoryConnectionRequest = z.infer<typeof repositoryConnectionRequestSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type RepositoryCommitDetailsRequest = z.infer<typeof repositoryCommitDetailsRequestSchema>;
export type RepositoryCommitDetailsContext = z.infer<typeof repositoryCommitDetailsContextSchema>;
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
export type RepositoryHistoryAnchor = z.infer<typeof repositoryHistoryAnchorSchema>;
export type RepositoryHistoryMode = z.infer<typeof repositoryHistoryModeSchema>;
export type RepositoryHistoryRequest = z.infer<typeof repositoryHistoryRequestSchema>;
export type RepositoryHistoryPage = z.infer<typeof repositoryHistoryPageSchema>;
export type RepositoryCommitChangeStatus = z.infer<typeof repositoryCommitChangeStatusSchema>;
export type RepositoryCommitChange = z.infer<typeof repositoryCommitChangeSchema>;
export type RepositoryCommitChangesRequest = z.infer<typeof repositoryCommitChangesRequestSchema>;
export type RepositoryCommitChanges = z.infer<typeof repositoryCommitChangesSchema>;
export type RepositoryDiffWhitespace = z.infer<typeof repositoryDiffWhitespaceSchema>;
export type RepositoryDiffOptions = z.infer<typeof repositoryDiffOptionsSchema>;
export type RepositoryDiffCancel = z.infer<typeof repositoryDiffCancelSchema>;
export type RepositoryDiscardPreviewRequest = z.infer<typeof repositoryDiscardPreviewRequestSchema>;
export type RepositoryDiscardPreview = z.infer<typeof repositoryDiscardPreviewSchema>;
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
export type RepositoryConflictContent = z.infer<typeof repositoryConflictContentSchema>;
export type RepositoryConflictStage = z.infer<typeof repositoryConflictStageSchema>;
export type RepositoryConflictRegion = z.infer<typeof repositoryConflictRegionSchema>;
export type RepositoryConflictKind = z.infer<typeof repositoryConflictKindSchema>;
export type RepositoryConflictFileSummary = z.infer<typeof repositoryConflictFileSummarySchema>;
export type RepositoryConflictFile = z.infer<typeof repositoryConflictFileSchema>;
export type RepositoryConflictOperation = z.infer<typeof repositoryConflictOperationSchema>;
export type RepositoryConflictRequest = z.infer<typeof repositoryConflictRequestSchema>;
export type RepositoryConflictState = z.infer<typeof repositoryConflictStateSchema>;
export type RepositoryResolveConflictRequest = z.infer<typeof repositoryResolveConflictRequestSchema>;
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
export type RepositoryWorktree = z.infer<typeof repositoryWorktreeSchema>;
export type RepositoryWorktreeContext = z.infer<typeof repositoryWorktreeContextSchema>;
export type RepositoryWorktreeAction = z.infer<typeof repositoryWorktreeActionSchema>;
export type RepositoryWorktreeActionKind = z.infer<typeof repositoryWorktreeActionKindSchema>;
export type RepositoryWorktreeActionRequest = z.infer<typeof repositoryWorktreeActionRequestSchema>;
export type RepositoryWorktreeFailureReason = z.infer<typeof repositoryWorktreeFailureReasonSchema>;
export type RepositoryWorktreeActionResult = z.infer<typeof repositoryWorktreeActionResultSchema>;
export type RepositorySubmoduleState = z.infer<typeof repositorySubmoduleStateSchema>;
export type RepositorySubmoduleParentStatus = z.infer<typeof repositorySubmoduleParentStatusSchema>;
export type RepositorySubmoduleRevisions = z.infer<typeof repositorySubmoduleRevisionsSchema>;
export type RepositorySubmodule = z.infer<typeof repositorySubmoduleSchema>;
export type RepositorySubmoduleContext = z.infer<typeof repositorySubmoduleContextSchema>;
export type RepositorySubmoduleAction = z.infer<typeof repositorySubmoduleActionSchema>;
export type RepositorySubmoduleActionKind = z.infer<typeof repositorySubmoduleActionKindSchema>;
export type RepositorySubmoduleActionRequest = z.infer<typeof repositorySubmoduleActionRequestSchema>;
export type RepositorySubmoduleRequest = z.infer<typeof repositorySubmoduleRequestSchema>;
export type RepositoryOpenSubmoduleRequest = z.infer<typeof repositoryOpenSubmoduleRequestSchema>;
export type RepositorySubmoduleFailureReason = z.infer<typeof repositorySubmoduleFailureReasonSchema>;
export type RepositorySubmoduleActionResult = z.infer<typeof repositorySubmoduleActionResultSchema>;
export type RepositoryGitFlowType = z.infer<typeof repositoryGitFlowTypeSchema>;
export type RepositoryGitFlowPrefix = z.infer<typeof repositoryGitFlowPrefixSchema>;
export type RepositoryGitFlowConfig = z.infer<typeof repositoryGitFlowConfigSchema>;
export type RepositoryGitFlowBranch = z.infer<typeof repositoryGitFlowBranchSchema>;
export type RepositoryGitFlowLocalBranch = z.infer<typeof repositoryGitFlowLocalBranchSchema>;
export type RepositoryGitFlowCapabilities = z.infer<typeof repositoryGitFlowCapabilitiesSchema>;
export type RepositoryGitFlowContext = z.infer<typeof repositoryGitFlowContextSchema>;
export type RepositoryGitFlowActionKind = z.infer<typeof repositoryGitFlowActionKindSchema>;
export type RepositoryGitFlowAction = z.infer<typeof repositoryGitFlowActionSchema>;
export type RepositoryGitFlowActionRequest = z.infer<typeof repositoryGitFlowActionRequestSchema>;
export type RepositoryGitFlowFailureReason = z.infer<typeof repositoryGitFlowFailureReasonSchema>;
export type RepositoryGitFlowActionResult = z.infer<typeof repositoryGitFlowActionResultSchema>;
export type RepositoryMergeRebaseAction = z.infer<typeof repositoryMergeRebaseActionSchema>;
export type RepositoryMergeRebaseRequest = z.infer<typeof repositoryMergeRebaseRequestSchema>;
export type RepositoryInteractiveRebaseCommand = z.infer<typeof repositoryInteractiveRebaseCommandSchema>;
export type RepositoryInteractiveRebaseCommit = z.infer<typeof repositoryInteractiveRebaseCommitSchema>;
export type RepositoryInteractiveRebasePlan = z.infer<typeof repositoryInteractiveRebasePlanSchema>;
export type RepositoryInteractiveRebasePlanRequest = z.infer<
  typeof repositoryInteractiveRebasePlanRequestSchema
>;
export type RepositoryInteractiveRebaseRequest = z.infer<typeof repositoryInteractiveRebaseActionSchema>;
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
export type RepositoryHistoryOperationKind = z.infer<typeof repositoryHistoryOperationKindSchema>;
export type RepositoryHistoryResetMode = z.infer<typeof repositoryHistoryResetModeSchema>;
export type RepositoryHistoryOperationPreviewRequest = z.infer<
  typeof repositoryHistoryOperationPreviewRequestSchema
>;
export type RepositoryHistoryOperationChanges = z.infer<typeof repositoryHistoryOperationChangesSchema>;
export type RepositoryHistoryOperationPreview = z.infer<typeof repositoryHistoryOperationPreviewSchema>;
export type RepositoryHistoryOperationAction = z.infer<typeof repositoryHistoryOperationActionSchema>;
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
export type RepositoryPatchImportRequest = z.infer<typeof repositoryPatchImportRequestSchema>;
export type RepositoryPatchPreview = z.infer<typeof repositoryPatchPreviewSchema>;
export type RepositoryPatchApplyRequest = z.infer<typeof repositoryPatchApplyRequestSchema>;
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
export type RepositoryLfsPointer = z.infer<typeof repositoryLfsPointerSchema>;
export type RepositoryLfsFileRequest = z.infer<typeof repositoryLfsFileRequestSchema>;
export type RepositoryLfsFile = z.infer<typeof repositoryLfsFileSchema>;
export type RepositoryLfsInitializationRequest = z.infer<typeof repositoryLfsInitializationRequestSchema>;
export type RepositoryLfsSaveRequest = z.infer<typeof repositoryLfsSaveRequestSchema>;
export type RepositoryLfsSaveResult = z.infer<typeof repositoryLfsSaveResultSchema>;
export type RepositoryFileHistoryRequest = z.infer<typeof repositoryFileHistoryRequestSchema>;
export type RepositoryFileHistoryOpenRequest = z.infer<typeof repositoryFileHistoryOpenRequestSchema>;
export type RepositoryFileHistoryRevision = z.infer<typeof repositoryFileHistoryRevisionSchema>;
export type RepositoryFileHistory = z.infer<typeof repositoryFileHistorySchema>;
export type RepositoryFileHistoryContext = z.infer<typeof repositoryFileHistoryContextSchema>;
export type RepositoryBlameRequest = z.infer<typeof repositoryBlameRequestSchema>;
export type RepositoryBlameOpenRequest = z.infer<typeof repositoryBlameOpenRequestSchema>;
export type RepositoryBlameLine = z.infer<typeof repositoryBlameLineSchema>;
export type RepositoryBlame = z.infer<typeof repositoryBlameSchema>;
export type RepositoryBlameContext = z.infer<typeof repositoryBlameContextSchema>;
