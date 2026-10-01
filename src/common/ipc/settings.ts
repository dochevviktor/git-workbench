import { z } from 'zod';

export const productivityPreferencesSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  fetchAllTags: z.boolean(),
  verboseGitOutput: z.boolean(),
  updateSubmodulesOnCheckout: z.boolean().default(false),
});
export type ProductivityPreferences = z.infer<typeof productivityPreferencesSchema>;

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
export const gitOptionKeys = ['user.signingkey', 'commit.gpgsign', 'tag.gpgsign', 'commit.template'] as const;
const gitOptionKeySchema = z.enum(gitOptionKeys);
const gitOptionSchema = z
  .strictObject({
    key: gitOptionKeySchema,
    value: z
      .string()
      .max(4096)
      .regex(/^[^\p{Cc}]*$/u)
      .nullable(),
  })
  .refine(
    (entry) =>
      !entry.key.endsWith('gpgsign') ||
      entry.value === null ||
      entry.value === 'true' ||
      entry.value === 'false',
    'Choose inherit, enabled or disabled for signing.',
  );
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
    options: z
      .array(z.strictObject({ key: gitOptionKeySchema, value: text.nullable(), effective: field }))
      .max(4)
      .optional(),
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
    options: z
      .array(gitOptionSchema)
      .max(4)
      .refine((entries) => new Set(entries.map((entry) => entry.key)).size === entries.length)
      .optional(),
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
