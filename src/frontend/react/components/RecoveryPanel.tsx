import { useEffect, useState } from 'react';
import type { RepositoryRecoveryRequest, RepositoryRecoveryState } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';

export function RecoveryPanel({
  repositoryId,
  refreshSignal,
  busy,
  onRecovered,
}: {
  readonly repositoryId: string;
  readonly refreshSignal: number;
  readonly busy: boolean;
  readonly onRecovered: () => void;
}) {
  const [state, setState] = useState<RepositoryRecoveryState>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState<string>();
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const result = await window.desktop?.repository.getRecovery({ id: repositoryId });
        if (result && active) {
          setState(unwrapResult(result));
          setError(undefined);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Recovery could not be read.');
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshSignal, repositoryId]);

  const run = async (
    action: RepositoryRecoveryRequest['action'],
    copyId?: string,
    expectedSnapshot?: string,
  ) => {
    const api = window.desktop;
    if (!api || !state || running || busy) return;
    setRunning(true);
    setError(undefined);
    try {
      const operation = await waitForOperation(
        api,
        unwrapResult(
          await api.repository.recover({
            id: repositoryId,
            action,
            copyId,
            snapshot: expectedSnapshot ?? state.snapshot,
          }),
        ),
      );
      if (operation.status !== 'succeeded') throw new Error(operation.message);
      setConfirmAbort(undefined);
      setState(unwrapResult(await api.repository.getRecovery({ id: repositoryId })));
      onRecovered();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recovery failed.');
    } finally {
      setRunning(false);
    }
  };
  if (!error && !state?.pendingOperation && !state?.copies.length) return null;
  const disabled = running || busy;
  return (
    <details
      className="recovery-panel"
      open={Boolean(error || state?.pendingOperation || state?.copies.some((copy) => copy.pending))}
      data-testid="recovery-panel"
    >
      <summary>Recovery{state?.pendingOperation ? ` — ${state.pendingOperation} in progress` : ''}</summary>
      <div className="recovery-content">
        {error && <p role="alert">{error}</p>}
        {state?.pendingOperation && (
          <div>
            <p>
              Resolve conflicted files and stage them in Local Changes, then continue. Abort returns to the
              state before this Git operation.
            </p>
            <button className="button button-small" disabled={disabled} onClick={() => void run('continue')}>
              Continue {state.pendingOperation}
            </button>
            {state.pendingOperation === 'rebase' && (
              <button className="button button-small" disabled={disabled} onClick={() => void run('skip')}>
                Skip rebase commit
              </button>
            )}
            <button
              className="button button-small"
              disabled={disabled}
              onClick={() => setConfirmAbort(state.snapshot)}
            >
              Abort {state.pendingOperation}…
            </button>
            {confirmAbort && (
              <span>
                Discard the current conflict-resolution work?{' '}
                <button
                  className="button danger"
                  disabled={disabled}
                  onClick={() => void run('abort', undefined, confirmAbort)}
                >
                  Confirm Abort
                </button>
                <button className="button" onClick={() => setConfirmAbort(undefined)}>
                  Cancel
                </button>
              </span>
            )}
          </div>
        )}
        {state?.copies.map((copy) => (
          <div className="recovery-copy" key={copy.id}>
            <span>
              {copy.title}
              {copy.pending ? ' — saved changes need attention' : ' — recovery copy kept'}
            </span>
            <button
              className="button button-small"
              disabled={disabled || Boolean(state.pendingOperation) || !copy.commitId}
              onClick={() => void run('apply', copy.id)}
            >
              Apply to clean working tree
            </button>
            {copy.pending ? (
              <button
                className="button button-small"
                disabled={disabled || Boolean(state.pendingOperation)}
                onClick={() => void run('finish', copy.id)}
              >
                Mark saved changes resolved
              </button>
            ) : (
              <button
                className="button button-small"
                title="Dismiss this entry; the saved Git stash is retained"
                disabled={disabled}
                onClick={() => void run('drop', copy.id)}
              >
                Dismiss entry
              </button>
            )}
          </div>
        ))}
        {Boolean(state?.copies.length) && (
          <p className="muted">
            Recovery copies preserve staged, unstaged, and untracked changes. The corresponding Git stashes
            remain available after an entry is dismissed.
          </p>
        )}
      </div>
    </details>
  );
}
