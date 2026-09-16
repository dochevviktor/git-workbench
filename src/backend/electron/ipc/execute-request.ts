import type { RequestContract } from '../../../common/ipc/contracts';
import { failure } from '../../../common/ipc/result';
import type { IpcResult } from '../../../common/ipc/result';
import { isExpectedBackendError } from '../../errors';

export async function executeRequest<Input, Output>(
  contract: RequestContract<Input, Output>,
  payload: unknown,
  authorized: boolean,
  handler: (input: Input) => Output | Promise<Output>,
  reportError: (error: unknown) => void,
): Promise<IpcResult<Output>> {
  if (!authorized) return failure('FORBIDDEN', 'This window cannot make that request.');
  const parsed = contract.input.safeParse(payload);
  if (!parsed.success) return failure('INVALID_REQUEST', 'The request is not valid.');

  try {
    const value = contract.output.parse(await handler(parsed.data));
    return { ok: true, value };
  } catch (error) {
    if (isExpectedBackendError(error)) return failure(error.code, error.message);
    reportError(error);
    // Do not serialize exceptions, stacks, or other backend details across IPC.
    return failure('INTERNAL_ERROR', 'The request could not be completed.');
  }
}
