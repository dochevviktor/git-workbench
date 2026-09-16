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
});

export const windowCommandSchema = z.strictObject({
  action: z.enum(['minimize', 'toggle-maximize', 'close']),
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
  ahead: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  behind: z.number().int().nonnegative().max(1_000_000_000).nullable(),
});

export const repositoryHistoryTrackingSchema = z.strictObject({
  upstream: z.string().max(32_768).nullable(),
  ahead: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  behind: z.number().int().nonnegative().max(1_000_000_000).nullable(),
});

export const repositoryHistoryRequestSchema = z.strictObject({
  id: repositoryIdSchema,
  offset: z.number().int().nonnegative().max(1_000_000),
  limit: z.number().int().min(1).max(100),
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

export const requests = {
  getAppInfo: request('app:get-info', z.undefined(), appInfoSchema),
  getWindowState: request('window:get-state', z.undefined(), windowStateSchema),
  windowCommand: request('window:command', windowCommandSchema, z.null()),
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
} as const;

export const events = {
  windowStateChanged: { channel: 'window:state-changed', payload: windowStateSchema },
} as const;

export type AppInfo = z.infer<typeof appInfoSchema>;
export type WindowState = z.infer<typeof windowStateSchema>;
export type WindowCommand = z.infer<typeof windowCommandSchema>;
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
export type RepositoryHistoryReferenceKind = z.infer<typeof repositoryHistoryReferenceKindSchema>;
export type RepositoryHistoryDecoration = z.infer<typeof repositoryHistoryDecorationSchema>;
export type RepositoryHistoryPerson = z.infer<typeof repositoryHistoryPersonSchema>;
export type RepositoryHistoryCommit = z.infer<typeof repositoryHistoryCommitSchema>;
export type RepositoryHistoryReference = z.infer<typeof repositoryHistoryReferenceSchema>;
export type RepositoryHistoryTracking = z.infer<typeof repositoryHistoryTrackingSchema>;
export type RepositoryHistoryRequest = z.infer<typeof repositoryHistoryRequestSchema>;
export type RepositoryHistoryPage = z.infer<typeof repositoryHistoryPageSchema>;
