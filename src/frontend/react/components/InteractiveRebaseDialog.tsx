import { useEffect, useMemo, useState } from 'react';
import type {
  RepositoryInteractiveRebaseCommand,
  RepositoryInteractiveRebasePlan,
  RepositoryInteractiveRebaseRequest,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import type { Platform } from '../lib/platform';
import { BranchIcon } from './Icons';
import { DialogShell } from './DialogShell';

const commands: readonly RepositoryInteractiveRebaseCommand[] = [
  'pick',
  'reword',
  'edit',
  'squash',
  'fixup',
  'drop',
];

const commandLabels: Record<RepositoryInteractiveRebaseCommand, string> = {
  pick: 'Pick',
  reword: 'Reword',
  edit: 'Edit',
  squash: 'Squash',
  fixup: 'Fixup',
  drop: 'Drop',
};

export interface InteractiveRebaseDialogRequest {
  readonly ontoCommitId: string | null;
}

type EditableRow = RepositoryInteractiveRebasePlan['commits'][number];

export function InteractiveRebaseDialog({
  repositoryId,
  request,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  readonly repositoryId: string;
  readonly request: InteractiveRebaseDialogRequest;
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (request: RepositoryInteractiveRebaseRequest) => void;
  readonly onClose: () => void;
}) {
  const [plan, setPlan] = useState<RepositoryInteractiveRebasePlan>();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [autosquash, setAutosquash] = useState(false);
  const [autostash, setAutostash] = useState(false);
  const [editingId, setEditingId] = useState<string>();

  useEffect(() => {
    let active = true;
    setPlan(undefined);
    setRows([]);
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const api = window.desktop;
        if (!api) throw new Error('Open this application in Electron to edit repository history.');
        const value = unwrapResult(
          await api.repository.getInteractiveRebasePlan({
            id: repositoryId,
            ontoCommitId: request.ontoCommitId,
          }),
        );
        if (!active) return;
        setPlan(value);
        setRows(value.commits);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'The rebase plan could not be read.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [repositoryId, request.ontoCommitId]);

  const changedCount = plan
    ? plan.workingChanges.paths.length + plan.workingChanges.untrackedPaths.length
    : 0;
  const firstRetained = rows.find((row) => row.action !== 'drop');
  const invalidFirst = firstRetained?.action === 'squash' || firstRetained?.action === 'fixup';
  const warning =
    failure ??
    error ??
    (plan?.mergeCommitCount
      ? 'Merge-preserving interactive rebase is not supported for this plan.'
      : undefined);
  const submitDisabled =
    loading ||
    !plan ||
    busy ||
    plan.mergeCommitCount > 0 ||
    invalidFirst ||
    !firstRetained ||
    (changedCount > 0 && !autostash);

  const subtitle = useMemo(() => {
    if (!plan) return 'Reviewing the commits…';
    return plan.root
      ? `Rewrite '${plan.branchName}' from its root commit`
      : `Rewrite '${plan.branchName}' after ${plan.ontoSubject || plan.ontoCommitId?.slice(0, 7)}`;
  }, [plan]);

  const updateRow = (commitId: string, update: Partial<EditableRow>) => {
    setRows((current) => current.map((row) => (row.commitId === commitId ? { ...row, ...update } : row)));
  };

  const moveRow = (index: number, delta: -1 | 1) => {
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (!row) return current;
      next.splice(target, 0, row);
      return next;
    });
  };

  return (
    <DialogShell
      title="Interactive Rebase"
      subtitle={subtitle}
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={warning ?? null}
      submitLabel="Rebase"
      submitDisabled={submitDisabled}
      busy={busy}
      onSubmit={() => {
        if (!plan || submitDisabled) return;
        onSubmit({
          id: repositoryId,
          ontoCommitId: plan.ontoCommitId,
          snapshot: plan.snapshot,
          actions: rows.map(({ commitId, action, subject, body }) => ({ commitId, action, subject, body })),
          autosquash,
          autostash,
          ...(autostash ? { changesSnapshot: plan.workingChanges.snapshot } : {}),
        });
      }}
      onClose={onClose}
    >
      <dt className="interactive-rebase-label">Plan:</dt>
      <dd className="interactive-rebase-plan" data-testid="interactive-rebase-plan">
        {loading && <p className="dialog-inline-note">Reading commits…</p>}
        {!loading && rows.length === 0 && <p className="dialog-inline-note">No commits are available.</p>}
        {rows.map((row, index) => (
          <div
            className={`interactive-rebase-row interactive-rebase-${row.action}${row.action === 'drop' ? ' is-dropped' : ''}`}
            key={row.commitId}
            tabIndex={0}
            data-testid="interactive-rebase-row"
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault();
                moveRow(index, event.key === 'ArrowUp' ? -1 : 1);
                return;
              }
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              const action =
                event.key.toLocaleLowerCase() === 'p'
                  ? 'pick'
                  : event.key.toLocaleLowerCase() === 'e'
                    ? 'edit'
                    : event.key.toLocaleLowerCase() === 'r'
                      ? 'reword'
                      : event.key.toLocaleLowerCase() === 's'
                        ? 'squash'
                        : event.key.toLocaleLowerCase() === 'f'
                          ? 'fixup'
                          : event.key.toLocaleLowerCase() === 'd'
                            ? 'drop'
                            : undefined;
              if (!action) return;
              event.preventDefault();
              updateRow(row.commitId, { action });
              if (action === 'reword') setEditingId(row.commitId);
            }}
          >
            <span className="interactive-rebase-connector" aria-hidden="true" />
            <select
              className="interactive-rebase-action"
              aria-label={`Action for ${row.subject}`}
              value={row.action}
              disabled={busy}
              onChange={(event) => {
                const action = event.target.value as RepositoryInteractiveRebaseCommand;
                updateRow(row.commitId, { action });
                if (action === 'reword') setEditingId(row.commitId);
              }}
            >
              {commands.map((command) => (
                <option value={command} key={command}>
                  {commandLabels[command]}
                </option>
              ))}
            </select>
            <div className="interactive-rebase-message">
              {editingId === row.commitId ? (
                <>
                  <input
                    type="text"
                    value={row.subject}
                    aria-label={`Subject for ${row.subject}`}
                    disabled={busy}
                    onChange={(event) => updateRow(row.commitId, { subject: event.target.value })}
                  />
                  <textarea
                    value={row.body}
                    aria-label={`Description for ${row.subject}`}
                    disabled={busy}
                    onChange={(event) => updateRow(row.commitId, { body: event.target.value })}
                  />
                  <button
                    type="button"
                    className="button button-small"
                    disabled={busy}
                    onClick={() => setEditingId(undefined)}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <strong>{row.subject || '(no subject)'}</strong>
                  {row.body.trim() && <span className="muted">{row.body.trim().split('\n')[0]}</span>}
                  <button
                    type="button"
                    className="button button-small interactive-rebase-edit-message"
                    disabled={busy || row.action === 'drop'}
                    onClick={() => {
                      updateRow(row.commitId, { action: 'reword' });
                      setEditingId(row.commitId);
                    }}
                  >
                    Edit message
                  </button>
                </>
              )}
            </div>
            <span className="interactive-rebase-hash">{row.commitId.slice(0, 7)}</span>
            <div className="interactive-rebase-move">
              <button
                type="button"
                className="button button-small"
                disabled={busy || index === 0}
                onClick={() => moveRow(index, -1)}
              >
                Up
              </button>
              <button
                type="button"
                className="button button-small"
                disabled={busy || index === rows.length - 1}
                onClick={() => moveRow(index, 1)}
              >
                Down
              </button>
            </div>
          </div>
        ))}
      </dd>
      <dt />
      <dd className="interactive-rebase-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={autosquash}
            disabled={busy}
            onChange={(event) => setAutosquash(event.target.checked)}
          />
          Autosquash fixup! and squash! commits
        </label>
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={autostash}
            disabled={busy || changedCount === 0}
            data-testid="interactive-rebase-autostash"
            onChange={(event) => setAutostash(event.target.checked)}
          />
          Stash and reapply local changes
        </label>
        {changedCount > 0 && (
          <p className="dialog-inline-note">
            {changedCount} local path{changedCount === 1 ? '' : 's'} will be saved in Recovery.
          </p>
        )}
        {plan?.mergeCommitCount === 0 && (
          <p className="dialog-inline-note">
            Rows are shown newest first. Use Edit to pause, amend, then Continue Rebase.
          </p>
        )}
      </dd>
    </DialogShell>
  );
}
