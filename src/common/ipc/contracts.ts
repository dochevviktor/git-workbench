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

export const repositoryHeadSchema = z.strictObject({
  state: z.enum(['branch', 'detached', 'unborn', 'unknown']),
  name: z.string().nullable(),
  commit: z.string().nullable(),
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
});

export const recentRepositorySchema = z.strictObject({
  id: repositoryIdSchema,
  name: z.string().min(1).max(512),
  path: repositoryPathSchema,
  lastOpenedAt: z.string().datetime({ offset: true }),
  status: z.enum(['available', 'missing', 'not-directory']),
  open: z.boolean(),
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
  removeRecentRepository: request('repository:remove-recent', repositorySessionSchema, z.null()),
} as const;

export const events = {
  windowStateChanged: { channel: 'window:state-changed', payload: windowStateSchema },
} as const;

export type AppInfo = z.infer<typeof appInfoSchema>;
export type WindowState = z.infer<typeof windowStateSchema>;
export type WindowCommand = z.infer<typeof windowCommandSchema>;
export type GitInfo = z.infer<typeof gitInfoSchema>;
export type RepositoryHead = z.infer<typeof repositoryHeadSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type RecentRepository = z.infer<typeof recentRepositorySchema>;
export type RepositoryOpenRequest = z.infer<typeof repositoryOpenSchema>;
export type RepositoryInitializeRequest = z.infer<typeof repositoryInitializeSchema>;
export type RepositorySession = z.infer<typeof repositorySessionSchema>;
