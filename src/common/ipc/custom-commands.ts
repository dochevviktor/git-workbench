import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes('\0'));
const identifier = z.string().uuid();
export const customTargetSchema = z.enum(['repository', 'commit', 'branch', 'file', 'submodule']);
export const customActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bash'), script: text(16384).min(1) }),
  z.strictObject({
    kind: z.literal('process'),
    executable: text(4096).min(1),
    args: z.array(text(4096)).max(64),
  }),
  z.strictObject({ kind: z.literal('url'), url: text(8192).min(1) }),
]);
export const customFieldSchema = z.strictObject({
  label: text(100).min(1),
  kind: z.enum(['text', 'branch', 'file']),
  required: z.boolean(),
  initial: text(4096),
});
export const customDefinitionSchema = z.strictObject({
  name: text(100).trim().min(1),
  target: customTargetSchema,
  action: customActionSchema,
  fields: z.array(customFieldSchema).max(8),
});
export const customCommandSchema = customDefinitionSchema.extend({
  id: identifier,
  enabled: z.boolean(),
  revision: identifier,
});
export const customCommandsSchema = z.array(customCommandSchema).max(100);
export const customSaveSchema = z.strictObject({
  id: identifier.optional(),
  revision: identifier.optional(),
  definition: customDefinitionSchema,
  enabled: z.boolean(),
});
export const customSelectionSchema = z.strictObject({ id: identifier, revision: identifier });
export const customContextSchema = z.strictObject({
  repositoryId: z.string().regex(/^repo-[a-f0-9]{64}$/u),
  target: customTargetSchema,
  value: text(4096),
});
export const customPreviewRequestSchema = z.strictObject({
  commandId: identifier,
  context: customContextSchema,
  inputs: z.array(text(4096)).max(8),
});
export const customPreviewSchema = z.strictObject({
  token: identifier,
  name: text(100),
  cwd: text(32768),
  action: customActionSchema,
  variables: z.record(z.string().max(100), text(32768)),
});
export const customRunSchema = z.strictObject({ token: identifier });
export const customSharedSchema = z.strictObject({
  format: z.literal('git-workbench-custom-commands'),
  version: z.literal(1),
  commands: z.array(customDefinitionSchema).min(1).max(100),
});
export type CustomCommand = z.infer<typeof customCommandSchema>;
export type CustomDefinition = z.infer<typeof customDefinitionSchema>;
export type CustomAction = z.infer<typeof customActionSchema>;
export type CustomSave = z.infer<typeof customSaveSchema>;
export type CustomSelection = z.infer<typeof customSelectionSchema>;
export type CustomContext = z.infer<typeof customContextSchema>;
export type CustomPreviewRequest = z.infer<typeof customPreviewRequestSchema>;
export type CustomPreview = z.infer<typeof customPreviewSchema>;
