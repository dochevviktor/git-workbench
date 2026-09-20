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
  if (!error && !state?.pendingOperation && !state?.copies.length && !state?.conflictedCount) return null;
  const disabled = running || busy;
  return (
    <details
      className="recovery-panel"
      open={Boolean(
        error ||
        state?.pendingOperation ||
        state?.conflictedCount ||
        state?.copies.some((copy) => copy.pending),
      )}
      data-testid="recovery-panel"
    >
      <summary>Recovery{state?.pendingOperation ? ` — ${state.pendingOperation} in progress` : ''}</summary>
      <div className="recovery-content">
        {error && <p role="alert">{error}</p>}
        {state?.pendingOperation && (
          <div>
            <p>
              {state.pendingOperation === 'rebase' && state.rebaseEdit === 'needs-amend'
                ? 'Interactive rebase is paused for Edit. Amend the current commit in Local Changes before continuing.'
                : state.pendingOperation === 'squash'
                  ? 'Squashing commits. Review the staged changes and generated message in Local Changes, then choose Squash.'
                  : state.conflictedCount
                    ? `Resolve ${state.conflictedCount} conflicted file${state.conflictedCount === 1 ? '' : 's'} and stage them in Local Changes, then continue ${state.pendingOperation}.`
                    : `All conflicts fixed. Continue ${state.pendingOperation} or review the staged changes before completing it.`}
            </p>
            <button
              className="button button-small"
              disabled={disabled || Boolean(state.conflictedCount) || state.rebaseEdit === 'needs-amend'}
              onClick={() => void run('continue')}
            >
              {state.pendingOperation === 'squash'
                ? 'Squash with generated message'
                : `Continue ${state.pendingOperation}`}
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
                {state.pendingOperation === 'rebase'
                  ? 'Undo this rebase and return to the original branch? Current resolution work will be discarded.'
                  : state.pendingOperation === 'squash'
                    ? 'Discard the staged squash result? Unrelated unstaged changes are preserved when Git can safely retain them.'
                    : `Abort this ${state.pendingOperation} and discard its resolution work?`}{' '}
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
        {!state?.pendingOperation && Boolean(state?.conflictedCount) && (
          <p role="status">
            Resolve and stage {state?.conflictedCount} unmerged file{state?.conflictedCount === 1 ? '' : 's'}{' '}
            in Local Changes. Any stash whose application failed remains in the stash list.
          </p>
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
