import { z } from 'zod';

export const ipcErrorSchema = z.strictObject({
  code: z.enum([
    'INVALID_REQUEST',
    'FORBIDDEN',
    'INTERNAL_ERROR',
    'UNAVAILABLE',
    'TIMEOUT',
    'GIT_UNAVAILABLE',
    'PATH_NOT_FOUND',
    'NOT_A_DIRECTORY',
    'NOT_A_REPOSITORY',
    'REPOSITORY_NOT_OPEN',
    'SOURCE_DIRECTORY_NOT_FOUND',
    'OPERATION_FAILED',
    'STALE_SNAPSHOT',
  ]),
  message: z.string(),
});

export type IpcError = z.infer<typeof ipcErrorSchema>;
export type IpcResult<Value> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: IpcError };

export function resultSchema<Value>(value: z.ZodType<Value>) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: ipcErrorSchema }),
  ]);
}

export function failure(code: IpcError['code'], message: string): IpcResult<never> {
  return { ok: false, error: { code, message } };
}

/** Unwrap at the consumer, where an Error never has to cross contextBridge. */
export function unwrapResult<Value>(result: IpcResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
