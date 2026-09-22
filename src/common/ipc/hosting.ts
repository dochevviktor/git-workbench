import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/u);
export const hostingAccountSchema = z.strictObject({
  id: identifier,
  provider: z.literal('github'),
  login: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9-]+$/u),
  storage: z.enum(['session', 'keyring']),
});
export const hostingAccountsSchema = z.strictObject({
  accounts: z.array(hostingAccountSchema).max(20),
  secureStorageAvailable: z.boolean(),
});
export const hostingAccountRequestSchema = z.strictObject({ accountId: identifier });
export const hostingConnectRequestSchema = z.strictObject({
  accountId: identifier.optional(),
  remember: z.boolean(),
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
    .max(210)
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u),
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
    .max(500)
    .regex(/^(https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\.git$/u),
  name: z.string().min(1).max(100),
});
export type HostingAccount = z.infer<typeof hostingAccountSchema>;
export type HostingAccounts = z.infer<typeof hostingAccountsSchema>;
export type HostingConnectRequest = z.infer<typeof hostingConnectRequestSchema>;
export type HostingRepositoriesRequest = z.infer<typeof hostingRepositoriesRequestSchema>;
export type HostedRepository = z.infer<typeof hostedRepositorySchema>;
export type HostedRepositories = z.infer<typeof hostedRepositoriesSchema>;
export type HostingRepositoryRequest = z.infer<typeof hostingRepositoryRequestSchema>;
export type HostingCloneSelection = z.infer<typeof hostingCloneSelectionSchema>;
export type HostingCloneTarget = z.infer<typeof hostingCloneTargetSchema>;
