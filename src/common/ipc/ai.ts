import { z } from 'zod';

export const aiModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
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
  z.strictObject({ kind: z.literal('range'), base: revision, head: revision, mergeBase: z.boolean() }),
]);
export const aiPreviewRequestSchema = z.strictObject({ id, target: aiTargetSchema });
export const aiSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  provider: z.literal('openai'),
  model: aiModelSchema.nullable(),
  storage: z.literal('session'),
});
export const aiConfigureSchema = z.strictObject({ model: aiModelSchema });
export const aiPreviewSchema = z.strictObject({
  token: z.uuid(),
  model: aiModelSchema,
  instructions: z.string().max(4096),
  material: z.string().min(1).max(131072),
  byteLength: z.number().int().positive().max(131072),
  scope: z.string().max(4096),
});
export const aiSendSchema = z.strictObject({ id, token: z.uuid() });
export const aiCancelSchema = z.strictObject({ id: id.optional() });
export const aiResultSchema = z.strictObject({ text: z.string().min(1).max(32768) });
export type AiTarget = z.infer<typeof aiTargetSchema>;
export type AiPreviewRequest = z.infer<typeof aiPreviewRequestSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiPreview = z.infer<typeof aiPreviewSchema>;
export type AiSend = z.infer<typeof aiSendSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;
