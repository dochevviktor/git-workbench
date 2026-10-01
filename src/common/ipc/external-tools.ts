import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes('\0'));
const path = text(4096)
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((part) => !part || part === '.' || part === '..'),
  );
export const externalToolKindSchema = z.enum(['editor', 'diff', 'merge', 'terminal']);
export const externalToolDefinitionSchema = z.strictObject({
  isDefault: z.boolean().optional(),
  kind: externalToolKindSchema,
  name: text(100).trim().min(1),
  executable: text(4096).min(1),
  args: z.array(text(4096)).max(64),
});
export const externalToolSchema = externalToolDefinitionSchema.extend({
  id: z.string().uuid(),
  revision: z.string().uuid(),
});
export const externalToolsSchema = z.array(externalToolSchema).max(32);
export const externalToolSaveSchema = z.strictObject({
  id: z.string().uuid().optional(),
  revision: z.string().uuid().optional(),
  definition: externalToolDefinitionSchema,
});
export const externalToolSelectionSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.string().uuid(),
});
export const externalTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('repository') }),
  z.strictObject({
    kind: z.literal('working'),
    path,
    area: z.enum(['staged', 'unstaged', 'untracked']).default('unstaged'),
    line: z.number().int().min(1).max(10000000).default(1),
  }),
  z.strictObject({
    kind: z.literal('revision'),
    path,
    commitId: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    line: z.number().int().min(1).max(10000000).default(1),
  }),
  z.strictObject({ kind: z.literal('conflict'), path, snapshot: z.string().regex(/^[a-f0-9]{64}$/u) }),
]);
export const externalToolRunSchema = z.strictObject({
  repositoryId: z.string().regex(/^repo-[a-f0-9]{64}$/u),
  tool: externalToolSelectionSchema,
  target: externalTargetSchema,
});
export const externalMergeDraftSchema = z.strictObject({
  path,
  snapshot: z.string().regex(/^[a-f0-9]{64}$/u),
  content: z.string().max(2 * 1024 * 1024),
});
export type ExternalTool = z.infer<typeof externalToolSchema>;
export type ExternalToolDefinition = z.infer<typeof externalToolDefinitionSchema>;
export type ExternalToolSave = z.infer<typeof externalToolSaveSchema>;
export type ExternalToolSelection = z.infer<typeof externalToolSelectionSchema>;
export type ExternalTarget = z.infer<typeof externalTargetSchema>;
export type ExternalToolRun = z.infer<typeof externalToolRunSchema>;
export type ExternalMergeDraft = z.infer<typeof externalMergeDraftSchema>;
