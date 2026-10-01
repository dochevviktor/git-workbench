import { z } from 'zod';

export const workspaceIdSchema = z.union([z.literal('default'), z.uuid()]);
export const workspaceColorSchema = z.enum(['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple']);
export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{Cc}]+$/u);
export const workspaceSchema = z.strictObject({
  id: workspaceIdSchema,
  name: workspaceNameSchema,
  tabColors: z
    .record(z.string().regex(/^repo-[a-f0-9]{64}$/u), workspaceColorSchema)
    .refine((value) => Object.keys(value).length <= 1000),
});
export const workspacesSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  activeId: workspaceIdSchema,
  entries: z
    .array(workspaceSchema.extend({ open: z.boolean() }))
    .min(1)
    .max(20),
});
export const workspaceEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create'),
    revision: z.number().int().nonnegative(),
    name: workspaceNameSchema,
  }),
  z.strictObject({
    kind: z.literal('rename'),
    revision: z.number().int().nonnegative(),
    id: workspaceIdSchema,
    name: workspaceNameSchema,
  }),
  z.strictObject({
    kind: z.literal('remove'),
    revision: z.number().int().nonnegative(),
    id: workspaceIdSchema,
  }),
  z.strictObject({
    kind: z.literal('color'),
    revision: z.number().int().nonnegative(),
    repositoryId: z.string().min(1).max(128),
    color: workspaceColorSchema,
  }),
]);
export const workspaceOpenSchema = z.strictObject({ id: workspaceIdSchema, newWindow: z.boolean() });
export type Workspaces = z.infer<typeof workspacesSchema>;
export type WorkspaceEdit = z.infer<typeof workspaceEditSchema>;
export type WorkspaceColor = z.infer<typeof workspaceColorSchema>;
