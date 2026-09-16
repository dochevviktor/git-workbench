import { describe, expect, it, vi } from 'vitest';
import { ExpectedBackendError } from '../../src/backend/errors';
import { executeRequest } from '../../src/backend/electron/ipc/execute-request';
import { requests } from '../../src/common/ipc/contracts';
import type { WindowState } from '../../src/common/ipc/contracts';

describe('main-process request boundary', () => {
  it('returns a validated response', async () => {
    const handler = vi.fn(() => ({ maximized: false, focused: true }));
    expect(await executeRequest(requests.getWindowState, undefined, true, handler, vi.fn())).toEqual({
      ok: true,
      value: { maximized: false, focused: true },
    });
  });

  it.each([null, {}, { action: 'shell' }, { action: 'minimize', script: 'unexpected' }])(
    'rejects invalid window commands before calling a handler: %j',
    async (payload) => {
      const handler = vi.fn(() => null);
      const result = await executeRequest(requests.windowCommand, payload, true, handler, vi.fn());
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('rejects untrusted senders before invoking any backend work', async () => {
    const handler = vi.fn(() => null);
    const result = await executeRequest(requests.windowCommand, { action: 'close' }, false, handler, vi.fn());
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps backend exceptions out of the response', async () => {
    const report = vi.fn();
    const error = new Error('private backend details');
    const result = await executeRequest(
      requests.getWindowState,
      undefined,
      true,
      () => {
        throw error;
      },
      report,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(report).toHaveBeenCalledWith(error);
  });

  it('preserves safe, expected domain failures without logging backend details', async () => {
    const report = vi.fn();
    const result = await executeRequest(
      requests.getWindowState,
      undefined,
      true,
      () => {
        throw new ExpectedBackendError('NOT_A_REPOSITORY', 'Choose a Git repository.');
      },
      report,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_A_REPOSITORY', message: 'Choose a Git repository.' },
    });
    expect(report).not.toHaveBeenCalled();
  });

  it('rejects a malformed handler response', async () => {
    const result = await executeRequest(
      requests.getWindowState,
      undefined,
      true,
      () => ({ maximized: 'yes', focused: false }) as unknown as WindowState,
      vi.fn(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
