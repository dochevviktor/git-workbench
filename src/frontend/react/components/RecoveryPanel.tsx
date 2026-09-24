import { useEffect, useState } from 'react';
import type { RepositoryRecoveryRequest, RepositoryRecoveryState } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';
import { WarningIcon } from './Icons';
import { DialogShell } from './DialogShell';
import type { Platform } from '../lib/platform';

export function RecoveryPanel({
  repositoryId,
  refreshSignal,
  busy,
  onRecovered,
  onResolve,
  platform,
}: {
  readonly repositoryId: string;
  readonly refreshSignal: number;
  readonly busy: boolean;
  readonly onRecovered: () => void;
  readonly onResolve: () => void;
  readonly platform: Platform;
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
    <div className="recovery-panel" data-testid="recovery-panel">
      <div className="recovery-content">
        {error && <p role="alert">{error}</p>}
        {state?.pendingOperation && (
          <div className="operation-banner" role="status">
            <WarningIcon size={14} />
            <p>
              <span>{state.operationLabel ?? `${state.pendingOperation} in progress`}. </span>
              {state.pendingOperation === 'rebase' && state.rebaseEdit === 'needs-amend'
                ? 'Paused for Edit. Amend the current commit, then continue.'
                : state.pendingOperation === 'squash'
                  ? 'Review the staged changes, then choose Squash.'
                  : state.conflictedCount
                    ? `Fix ${state.conflictedCount} conflict${state.conflictedCount === 1 ? '' : 's'} and then continue.`
                    : 'All conflicts fixed.'}
            </p>
            {Boolean(state.conflictedCount) && (
              <button className="button button-small" disabled={disabled} onClick={onResolve}>
                Resolve
              </button>
            )}
            <button
              className="button button-small"
              disabled={disabled || Boolean(state.conflictedCount) || state.rebaseEdit === 'needs-amend'}
              onClick={() => void run('continue')}
            >
              {state.pendingOperation === 'squash'
                ? 'Squash with generated message'
                : `Continue ${state.pendingOperation}`}
            </button>
            {['rebase', 'cherry-pick', 'revert'].includes(state.pendingOperation) && (
              <button className="button button-small" disabled={disabled} onClick={() => void run('skip')}>
                Skip {state.pendingOperation} commit
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
              <DialogShell
                title={`Abort ${state.pendingOperation}?`}
                subtitle={
                  state.pendingOperation === 'rebase'
                    ? 'Undo this rebase and return to the original branch? Current resolution work will be discarded.'
                    : state.pendingOperation === 'squash'
                      ? 'Discard the staged squash result. Unrelated unstaged changes are retained when Git can preserve them.'
                      : state.pendingOperation === 'stash'
                        ? 'Discard the applied stash changes. The stash and unrelated files are retained.'
                        : `Abort this ${state.pendingOperation} and discard its resolution work?`
                }
                icon={<WarningIcon size={24} />}
                platform={platform}
                warning={error ?? null}
                submitLabel="Confirm Abort"
                submitDisabled={disabled}
                danger
                busy={running}
                className="p05-dialog p06-dialog"
                onSubmit={() => void run('abort', undefined, confirmAbort)}
                onClose={() => setConfirmAbort(undefined)}
              >
                {null}
              </DialogShell>
            )}
          </div>
        )}
        {!state?.pendingOperation && Boolean(state?.conflictedCount) && (
          <p role="status" className="operation-banner">
            Resolve and stage {state?.conflictedCount} unmerged file{state?.conflictedCount === 1 ? '' : 's'}{' '}
            in Local Changes. Any stash whose application failed remains in the stash list.
            <button className="button button-small" disabled={disabled} onClick={onResolve}>
              Resolve
            </button>
          </p>
        )}
        {Boolean(state?.copies.length) && (
          <details className="recovery-copies" open={state?.copies.some((copy) => copy.pending)}>
            <summary>
              Recovery — {state?.copies.length} saved {state?.copies.length === 1 ? 'copy' : 'copies'}
            </summary>
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
                Recovery copies preserve staged, unstaged, and untracked changes. The corresponding Git
                stashes remain available after an entry is dismissed.
              </p>
            )}
          </details>
        )}
      </div>
    </div>
  );
}
