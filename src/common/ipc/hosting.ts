import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/u);
export const hostingProviderSchema = z.enum([
  'gitea',
  'github',
  'github-enterprise',
  'gitlab',
  'gitlab-server',
  'bitbucket',
  'bitbucket-server',
]);
export type HostingProviderId = z.infer<typeof hostingProviderSchema>;
export const hostingProviderNames: Record<HostingProviderId, string> = {
  gitea: 'Gitea',
  github: 'GitHub',
  'github-enterprise': 'GitHub Enterprise',
  gitlab: 'GitLab',
  'gitlab-server': 'GitLab Server',
  bitbucket: 'Bitbucket',
  'bitbucket-server': 'Bitbucket Server',
};
export const hostingActivityProviders: readonly HostingProviderId[] = ['github', 'github-enterprise'];
// Public server metadata only; canonicalization and destination policy belong to main.
export const hostingServerUrlSchema = z
  .string()
  .max(500)
  .regex(
    /^https:\/\/(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::[0-9]{1,5})?(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\/?$/u,
  );
const login = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/u);
export const hostingAccountSchema = z.strictObject({
  id: identifier,
  provider: hostingProviderSchema,
  serverUrl: hostingServerUrlSchema.optional(),
  authentication: z.enum(['token', 'oauth']).optional(),
  login,
  storage: z.enum(['session', 'keyring']),
  notificationsEnabled: z.boolean().optional(),
});
export const hostingAccountsSchema = z.strictObject({
  accounts: z.array(hostingAccountSchema).max(20),
  secureStorageAvailable: z.boolean(),
  gitAccountId: identifier.nullable().default(null),
  githubOAuthAvailable: z.boolean().optional(),
});
export const hostingAccountRequestSchema = z.strictObject({ accountId: identifier });
export const hostingConnectRequestSchema = z
  .strictObject({
    accountId: identifier.optional(),
    remember: z.boolean(),
    provider: hostingProviderSchema,
    serverUrl: hostingServerUrlSchema.optional(),
    username: z
      .string()
      .max(254)
      .regex(/^[A-Za-z0-9_.@+-]*$/u)
      .optional(),
    // Write-only, transient credential entry. Never included in an account/result or persisted UI state.
    token: z
      .string()
      .min(10)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/u),
  })
  .refine((value) =>
    ['github', 'gitlab', 'bitbucket'].includes(value.provider) ? !value.serverUrl : Boolean(value.serverUrl),
  )
  .refine((value) =>
    value.provider === 'bitbucket'
      ? Boolean(value.username && /^[^@]+@[^@]+\.[^@]+$/u.test(value.username))
      : value.provider === 'bitbucket-server'
        ? Boolean(value.username)
        : !value.username,
  );
export const hostingOAuthRequestSchema = z.strictObject({
  accountId: identifier.optional(),
  remember: z.boolean(),
  username: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9-]*$/u),
});
export const hostingOAuthStateSchema = z.strictObject({
  userCode: z.string().max(32),
  expiresAt: z.number().int().positive(),
  interval: z.number().int().min(1).max(60),
});
export const hostingOAuthResultSchema = z.strictObject({
  account: hostingAccountSchema.nullable(),
  interval: z.number().int().min(1).max(60),
});
export const hostingRepositoriesRequestSchema = z.strictObject({
  accountId: identifier,
  page: z.number().int().min(1).max(10000),
});
export const hostedRepositorySchema = z.strictObject({
  id: identifier,
  fullName: z
    .string()
    .min(3)
    .max(500)
    .regex(/^[A-Za-z0-9_~.-]+(?:\/[A-Za-z0-9_~.-]+)+$/u)
    .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..')),
  private: z.boolean(),
  archived: z.boolean(),
});
export const hostedRepositoriesSchema = z.strictObject({
  repositories: z.array(hostedRepositorySchema).max(100),
  page: z.number().int().min(1).max(10000),
  nextPage: z.number().int().min(1).max(10000).nullable(),
});
export const hostingRepositoryRequestSchema = z.strictObject({
  accountId: identifier,
  repositoryId: identifier,
  destination: z.enum(['website', 'pull-requests', 'issues']),
});
export const hostingCloneSelectionSchema = z.strictObject({
  accountId: identifier,
  repositoryId: identifier,
  protocol: z.enum(['https', 'ssh']),
});
export const hostingCloneTargetSchema = z.strictObject({
  url: z
    .string()
    .max(1200)
    .regex(
      /^(?:https:\/\/(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::[0-9]+)?\/|ssh:\/\/git@(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::[0-9]+)?\/|git@[A-Za-z0-9.-]+:)[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)+\.git$/u,
    ),
  name: z.string().min(1).max(100),
});
export type HostingAccount = z.infer<typeof hostingAccountSchema>;
export type HostingAccounts = z.infer<typeof hostingAccountsSchema>;
export type HostingConnectRequest = z.infer<typeof hostingConnectRequestSchema>;
export type HostingOAuthRequest = z.infer<typeof hostingOAuthRequestSchema>;
export type HostingOAuthState = z.infer<typeof hostingOAuthStateSchema>;
export type HostingOAuthResult = z.infer<typeof hostingOAuthResultSchema>;
export type HostingRepositoriesRequest = z.infer<typeof hostingRepositoriesRequestSchema>;
export type HostedRepository = z.infer<typeof hostedRepositorySchema>;
export type HostedRepositories = z.infer<typeof hostedRepositoriesSchema>;
export type HostingRepositoryRequest = z.infer<typeof hostingRepositoryRequestSchema>;
export type HostingCloneSelection = z.infer<typeof hostingCloneSelectionSchema>;
export type HostingCloneTarget = z.infer<typeof hostingCloneTargetSchema>;

const pageNumber = z.number().int().min(1).max(10000);
const loginFilter = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9-]*$/u);
export const hostingActivityRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    accountId: identifier,
    kind: z.literal('notifications'),
    page: pageNumber,
    all: z.boolean(),
    participating: z.boolean(),
  }),
  z.strictObject({
    accountId: identifier,
    repositoryId: identifier,
    kind: z.enum(['issues', 'pull-requests']),
    page: z.number().int().min(1).max(10),
    state: z.enum(['open', 'closed', 'all']),
    author: loginFilter,
    assignee: loginFilter,
    text: z
      .string()
      .max(200)
      // eslint-disable-next-line no-control-regex
      .regex(/^[^\u0000-\u001f"\\]*$/u),
  }),
]);
export const hostingActivityItemSchema = z.strictObject({
  id: identifier,
  repository: hostedRepositorySchema.shape.fullName,
  title: z.string().max(1024),
  kind: z.enum(['issue', 'pull-request', 'notification']),
  number: z.number().int().positive().nullable(),
  state: z.enum(['open', 'closed', 'merged']).nullable(),
  updatedAt: z.iso.datetime(),
  unread: z.boolean(),
  reason: z.string().max(100),
});
export const hostingActivityPageSchema = z.strictObject({
  items: z.array(hostingActivityItemSchema).max(100),
  page: pageNumber,
  nextPage: pageNumber.nullable(),
  limited: z.boolean(),
  recentSearches: z.array(z.string().max(200)).max(10).optional(),
});
export const hostingActivitySelectionSchema = z.strictObject({ accountId: identifier, itemId: identifier });
export type HostingActivityRequest = z.infer<typeof hostingActivityRequestSchema>;
export type HostingActivityItem = z.infer<typeof hostingActivityItemSchema>;
export type HostingActivityPage = z.infer<typeof hostingActivityPageSchema>;
export type HostingActivitySelection = z.infer<typeof hostingActivitySelectionSchema>;

export const hostingNotificationPreferenceSchema = z.strictObject({
  accountId: identifier,
  enabled: z.boolean(),
});
export const hostingNotificationSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  accounts: z
    .array(
      z.strictObject({
        account: hostingAccountSchema,
        items: z.array(hostingActivityItemSchema).max(100),
        hasMore: z.boolean(),
        checkedAt: z.iso.datetime().nullable(),
        error: z.string().max(500),
      }),
    )
    .max(20),
});
export type HostingNotificationPreference = z.infer<typeof hostingNotificationPreferenceSchema>;
export type HostingNotificationSnapshot = z.infer<typeof hostingNotificationSnapshotSchema>;
