import type { IpcError } from '../common/ipc/result';

export class ExpectedBackendError extends Error {
  readonly code: IpcError['code'];

  constructor(code: IpcError['code'], message: string) {
    super(message);
    this.name = 'ExpectedBackendError';
    this.code = code;
  }
}

export function isExpectedBackendError(error: unknown): error is ExpectedBackendError {
  return error instanceof ExpectedBackendError;
}
