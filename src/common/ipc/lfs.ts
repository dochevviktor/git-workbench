import { z } from 'zod';

const id = z.string().regex(/^repo-[a-f0-9]{64}$/u);
const snapshot = z.string().regex(/^[a-f0-9]{64}$/u);
const remote = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.startsWith('-') && !/[\s\0]/u.test(value));
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'),
  );
const pattern = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith('-') && !value.startsWith('!') && !/[\r\n\0]/u.test(value));
export const lfsLockSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  path,
  owner: z.string().max(256),
  lockedAt: z.string().max(100),
  ours: z.boolean(),
});
export const lfsLocksSchema = z.strictObject({
  remote,
  locks: z.array(lfsLockSchema).max(1000),
  truncated: z.boolean(),
});
export const lfsContextSchema = z.strictObject({
  repositoryId: id,
  snapshot,
  available: z.boolean(),
  version: z.string().max(256).nullable(),
  head: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    .nullable(),
  remotes: z
    .array(
      z.strictObject({
        name: remote,
        url: z.string().max(4096),
        endpoint: z.string().max(4096).nullable(),
        pushUrl: z.string().max(4096),
      }),
    )
    .max(100),
  defaultRemote: remote.nullable(),
  patterns: z
    .array(z.strictObject({ pattern, source: z.string().max(4096), lockable: z.boolean() }))
    .max(1000),
});
export const lfsActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fetch'), remote, refetch: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('push'), remote }),
  z.strictObject({ kind: z.literal('locks'), remote }),
  z.strictObject({ kind: z.literal('lock'), remote, path }),
  z.strictObject({ kind: z.literal('unlock'), remote, lockId: lfsLockSchema.shape.id, path }),
  z.strictObject({ kind: z.literal('track'), pattern, lockable: z.boolean() }),
  z.strictObject({ kind: z.literal('untrack'), pattern }),
]);
export const lfsOperationRequestSchema = z.strictObject({ id, snapshot, action: lfsActionSchema });
export type LfsContext = z.infer<typeof lfsContextSchema>;
export type LfsLocks = z.infer<typeof lfsLocksSchema>;
export type LfsAction = z.infer<typeof lfsActionSchema>;
export type LfsOperationRequest = z.infer<typeof lfsOperationRequestSchema>;
