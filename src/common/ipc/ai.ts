import { z } from 'zod';

export const aiModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u);
export const aiProviderSchema = z.enum(['openai', 'claude', 'codex', 'cursor', 'ollama']);
export const aiProviderNames = {
  openai: 'OpenAI',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  ollama: 'Ollama',
} as const;
export const defaultAiPrompts = {
  commit:
    'Write a concise Git commit message for the supplied diff. Return only a subject line, then an optional blank line and body.',
  review:
    'Review the supplied Git diff for concrete bugs and regressions. Cite paths and changed lines, explain impact, and distinguish uncertainty.',
};
const prompt = z
  .string()
  .trim()
  .min(1)
  .max(3000)
  .refine((value) => !value.includes('\0'));
export const aiConfigurationSchema = z.strictObject({
  provider: aiProviderSchema.default('openai'),
  model: aiModelSchema,
  commitPrompt: prompt.default(defaultAiPrompts.commit),
  reviewPrompt: prompt.default(defaultAiPrompts.review),
  remember: z.boolean().default(false),
});
const id = z.string().min(1).max(128);
const revision = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value) || /^refs\/(?:heads|remotes)\/[^\s\0]+$/u.test(value),
  );
export const aiTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('staged') }),
  z.strictObject({ kind: z.literal('amend') }),
  z.strictObject({ kind: z.literal('range'), base: revision, head: revision, mergeBase: z.boolean() }),
]);
export const aiPreviewRequestSchema = z.strictObject({ id, target: aiTargetSchema });
export const aiSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  provider: aiProviderSchema,
  model: aiModelSchema.nullable(),
  storage: z.literal('session'),
  remember: z.boolean(),
  commitPrompt: prompt,
  reviewPrompt: prompt,
  executable: z.string().max(4096).nullable(),
});
export const aiConfigureSchema = aiConfigurationSchema.extend({
  selectExecutable: z.boolean().default(false),
  replaceKey: z.boolean().default(true),
});
export const aiPreviewSchema = z.strictObject({
  token: z.uuid(),
  model: aiModelSchema,
  provider: aiProviderSchema,
  instructions: z.string().max(4096),
  material: z.string().min(1).max(131072),
  byteLength: z.number().int().positive().max(131072),
  scope: z.string().max(4096),
});
export const aiSendSchema = z.strictObject({ id, token: z.uuid() });
export const aiCancelSchema = z.strictObject({ id: id.optional() });
export const aiResultSchema = z.strictObject({ text: z.string().min(1).max(32768) });
export type AiTarget = z.infer<typeof aiTargetSchema>;
export type AiProviderId = z.infer<typeof aiProviderSchema>;
export type AiConfiguration = z.infer<typeof aiConfigurationSchema>;
export type AiConfigure = z.input<typeof aiConfigureSchema>;
export type AiPreviewRequest = z.infer<typeof aiPreviewRequestSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiPreview = z.infer<typeof aiPreviewSchema>;
export type AiSend = z.infer<typeof aiSendSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;
