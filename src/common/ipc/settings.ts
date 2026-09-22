import { z } from 'zod';

const text = z.string().max(4096);
const identity = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}<>]+$/u)
  .nullable();
export const settingsTargetSchema = z.object({ id: z.string().min(1).max(128).nullable() }).strict();
export const issueRuleSchema = z
  .object({
    prefix: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9#_-]+$/u),
    url: z
      .url()
      .max(2048)
      .refine(
        (value) =>
          /^https:\/\/[^\s@/?#{}\\]+\//u.test(value) &&
          value.split('{id}').length === 2 &&
          !/[\p{Cc}\s\\]/u.test(value),
        'Use an HTTPS URL with one {id} placeholder in its path or query and no credentials.',
      ),
  })
  .strict();
const field = z.object({ value: text.nullable(), origin: text.nullable(), scope: text.nullable() }).strict();
export const gitSettingsSchema = z
  .object({
    id: z.string().nullable(),
    path: text,
    snapshot: z.string().regex(/^[a-f0-9]{64}$/u),
    name: text.nullable(),
    email: text.nullable(),
    effectiveName: field,
    effectiveEmail: field,
    issueRule: issueRuleSchema.nullable(),
  })
  .strict();
export const saveGitSettingsSchema = settingsTargetSchema
  .extend({
    snapshot: z.string().regex(/^[a-f0-9]{64}$/u),
    name: identity,
    email: identity.refine(
      (value) => value === null || /^[^\s@]+@[^\s@]+$/u.test(value),
      'Enter an email address.',
    ),
    issueRule: issueRuleSchema.nullable(),
  })
  .strict();
export const openIssueSchema = z
  .object({ id: z.string().min(1).max(128), number: z.string().regex(/^\d{1,12}$/u) })
  .strict();
export type GitSettings = z.infer<typeof gitSettingsSchema>;
export type SettingsTarget = z.infer<typeof settingsTargetSchema>;
export type SaveGitSettings = z.infer<typeof saveGitSettingsSchema>;
export type IssueRule = z.infer<typeof issueRuleSchema>;
export const gitInstanceSchema = z
  .object({
    executable: z.string().max(4096).nullable(),
    revision: z.string().max(64),
  })
  .strict();
export type GitInstance = z.infer<typeof gitInstanceSchema>;
