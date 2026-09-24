import { useEffect, useRef, useState } from 'react';
import type { RepositoryConflictState } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { BranchIcon, WarningIcon } from './Icons';
import { stageConflictResolution } from '../lib/conflicts';

/** Captured Local Changes side cards. Selecting both opens the editor; one stages that source. */
export function ConflictPreview({
  repositoryId,
  path,
  refreshSignal,
  busy,
  onMerge,
  onResolved,
}: {
  readonly repositoryId: string;
  readonly path: string;
  readonly refreshSignal: number;
  readonly busy: boolean;
  readonly onMerge: () => void;
  readonly onResolved: () => void;
}) {
  const [state, setState] = useState<RepositoryConflictState>();
  const [error, setError] = useState<string>();
  const [ours, setOurs] = useState(true);
  const [theirs, setTheirs] = useState(true);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState(undefined);
    setError(undefined);
    setOurs(true);
    setTheirs(true);
    void window.desktop?.repository
      .getConflicts({ id: repositoryId, path })
      .then((result) => {
        if (active) setState(unwrapResult(result));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not read this conflict.');
      });
    return () => {
      active = false;
    };
  }, [path, refreshSignal, repositoryId]);
  const file = state?.selected;
  const submit = async () => {
    if (ours && theirs) {
      onMerge();
      return;
    }
    if (!window.desktop || !state || (!ours && !theirs)) return;
    setSaving(true);
    try {
      await stageConflictResolution(window.desktop, {
        id: repositoryId,
        path,
        snapshot: state.snapshot,
        choice: ours ? 'ours' : 'theirs',
      });
      if (alive.current) onResolved();
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Could not stage this resolution.');
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  return (
    <div className="file-preview" data-testid="conflict-preview">
      <div className="preview-header">
        <WarningIcon size={14} />
        <span>{path}</span>
      </div>
      <div className="conflict-cards-content">
        <h3>
          <WarningIcon size={18} />
          {file?.kind === 'submodule'
            ? 'Submodule conflict'
            : file?.kind === 'binary'
              ? 'Binary conflict'
              : 'Merge conflict'}
        </h3>
        <p className="muted">Select the changes or merge them manually</p>
        {file?.previousPath && <p>Renamed from {file.previousPath}</p>}
        {error && (
          <p className="inline-alert" role="alert">
            {error}
          </p>
        )}
        <div className="conflict-cards">
          {(['theirs', 'ours'] as const).map((side) => (
            <label
              key={side}
              className={`conflict-card ${(side === 'ours' ? ours : theirs) ? 'selected' : ''}`}
            >
              <span className="conflict-card-title">
                <BranchIcon size={14} />
                <strong>
                  {side === 'ours'
                    ? (state?.oursLabel ?? 'Current branch')
                    : (state?.theirsLabel ?? 'Incoming change')}
                </strong>
                <input
                  type="checkbox"
                  aria-label={`Select ${side === 'ours' ? 'current' : 'incoming'} version`}
                  checked={side === 'ours' ? ours : theirs}
                  disabled={busy || saving || !file}
                  onChange={(event) =>
                    side === 'ours' ? setOurs(event.target.checked) : setTheirs(event.target.checked)
                  }
                />
              </span>
              <span className="conflict-card-description">
                {!file
                  ? 'Reading…'
                  : !file.stages[side].objectId
                    ? 'Deleted'
                    : file.kind === 'submodule'
                      ? `Commit ${file.stages[side].objectId?.slice(0, 7)}`
                      : file.kind === 'binary'
                        ? 'Binary file'
                        : file.shape === 'add-add'
                          ? 'Added'
                          : 'Modified'}
              </span>
            </label>
          ))}
        </div>
        <div className="conflict-card-connector" aria-hidden="true" />
        <button
          className="button"
          data-testid="open-conflict-resolver"
          disabled={busy || saving || !file || (!ours && !theirs)}
          onClick={() => void submit()}
        >
          {saving
            ? 'Staging…'
            : ours && theirs
              ? 'Merge'
              : `Choose ${ours ? state?.oursLabel : state?.theirsLabel}`}
        </button>
        {file?.kind === 'submodule' && (
          <p className="muted">The chosen submodule revision is staged without changing its checkout.</p>
        )}
      </div>
    </div>
  );
}
