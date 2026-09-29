import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  RepositoryInteractiveRebaseCommand,
  RepositoryInteractiveRebasePlan,
  RepositoryInteractiveRebaseRequest,
  RepositoryHistoryCommit,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import type { Platform } from '../lib/platform';
import { formatListDate } from '../lib/format';
import { BranchIcon } from './Icons';
import { DialogShell } from './DialogShell';
import { CommitDetails } from './CommitDetails';
import { MenuButton } from './menu/MenuButton';
import { useContextMenu } from './menu/context-menu';
import { contextMenuAnchor, menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

const commands = ['pick', 'edit', 'reword', 'squash', 'fixup', 'drop'] as const;
const keys = ['p', 'e', 'r', 's', 'f', 'd'];
const labels = {
  pick: 'Pick',
  edit: 'Edit',
  reword: 'Reword',
  squash: 'Squash',
  fixup: 'Fixup',
  drop: 'Drop',
};

export interface InteractiveRebaseDialogRequest {
  readonly ontoCommitId: string | null;
  readonly quickAction?:
    { readonly commitId: string; readonly action: RepositoryInteractiveRebaseCommand } | undefined;
}

type Row = RepositoryInteractiveRebasePlan['commits'][number];
type Editor = { id: string; subject: string; body: string; combined: boolean; previousAction: Row['action'] };

// Presentation of the reviewed messages. Git execution and autosquash remain backend-owned.
function messageGroups(rows: readonly Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  let current: Row[] | undefined;
  for (const row of [...rows].reverse()) {
    if (row.action === 'drop') continue;
    if (['squash', 'fixup'].includes(row.action)) current?.push(row);
    else {
      current = [row];
      groups.set(row.commitId, current);
    }
  }
  return groups;
}
function message(row: Row, group: readonly Row[] | undefined): string {
  const original = (item: Row) => [item.subject, item.body].filter(Boolean).join('\n\n');
  if (!group?.some((item) => item.action === 'squash')) return original(row);
  return (
    row.combinedMessage ??
    group
      .filter((item, index) => index === 0 || item.action === 'squash')
      .map(original)
      .join('\n\n')
  );
}

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
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [autostash, setAutostash] = useState(false);
  const [updateRefs, setUpdateRefs] = useState(false);
  const [backupBranch, setBackupBranch] = useState(false);
  const [acknowledgePublished, setAcknowledgePublished] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<Editor>();
  const [dragId, setDragId] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const messageInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const initiallyFocused = useRef(false);
  const requestedRowFocus = useRef<string | undefined>(undefined);
  const [rowFocusRevision, setRowFocusRevision] = useState(0);
  const contextMenu = useContextMenu();
  const editingId = editor?.id;
  useLayoutEffect(() => {
    if (editingId) {
      messageInput.current?.focus();
      messageInput.current?.parentElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [editingId]);

  useEffect(() => {
    const epoch = ++generation.current;
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        if (!window.desktop) throw new Error('Open this application in Electron to edit history.');
        const value = unwrapResult(
          await window.desktop.repository.getInteractiveRebasePlan({
            id: repositoryId,
            ontoCommitId: request.ontoCommitId,
            ...(request.quickAction ? { quickAction: request.quickAction } : {}),
          }),
        );
        if (epoch !== generation.current) return;
        setPlan(value);
        setRows(value.commits);
        const selected =
          value.commits.find((row) => row.commitId === request.quickAction?.commitId) ?? value.commits[0]!;
        setSelectedId(selected.commitId);
        if (request.quickAction?.action === 'reword')
          setEditor({
            id: selected.commitId,
            subject: selected.subject,
            body: selected.body,
            combined: false,
            previousAction: 'reword',
          });
      } catch (reason) {
        if (epoch === generation.current)
          setError(reason instanceof Error ? reason.message : 'The plan could not be read.');
      } finally {
        if (epoch === generation.current) setLoading(false);
      }
    })();
    return () => {
      generation.current = epoch + 1;
    };
  }, [repositoryId, request]);

  const groups = useMemo(() => messageGroups(rows), [rows]);
  const selected = plan?.commits.find((row) => row.commitId === selectedId);
  const inspected: RepositoryHistoryCommit | undefined = selected
    ? { ...selected, id: selected.commitId, decorations: [] }
    : undefined;
  const loadedIds = useMemo(() => new Set(rows.map((row) => row.commitId)), [rows]);
  const emptyReferences = useMemo(() => new Map(), []);
  const first = [...rows].reverse().find((row) => row.action !== 'drop');
  const invalid = !first
    ? 'Keep at least one commit.'
    : ['squash', 'fixup'].includes(first.action)
      ? 'The oldest retained commit needs to be Pick, Edit or Reword.'
      : undefined;
  const changedCount = plan
    ? plan.workingChanges.paths.length + plan.workingChanges.untrackedPaths.length
    : 0;
  const locked = busy || loading;
  const submitDisabled =
    locked ||
    !plan ||
    Boolean(invalid) ||
    Boolean(editor) ||
    (changedCount > 0 && !autostash) ||
    (Boolean(plan?.publishedCommitCount) && !acknowledgePublished);
  const eligibleBranches =
    plan?.dependentBranches.filter(
      (branch) =>
        !branch.checkedOut && rows.find((row) => row.commitId === branch.commitId)?.action !== 'drop',
    ) ?? [];

  const focusRow = (id: string) => {
    requestedRowFocus.current = id;
    // Even Home on the selected row may need to return focus from a different element.
    setRowFocusRevision((revision) => revision + 1);
    setSelectedId(id);
  };
  useLayoutEffect(() => {
    const requested = requestedRowFocus.current;
    requestedRowFocus.current = undefined;
    if (selectedId && (!editor || requested === selectedId)) {
      const row = list.current?.querySelector<HTMLElement>('[data-commit-id="' + selectedId + '"]');
      row?.scrollIntoView({ block: 'nearest' });
      // Focus after React has moved the keyed row or removed the editor, in the same commit.
      // A later animation callback could steal a newer focus and send the next shortcut to this row.
      if (requested === selectedId || !initiallyFocused.current) {
        row?.focus();
        initiallyFocused.current = true;
      }
    }
  }, [selectedId, editor, rows, rowFocusRevision]);

  const updateRow = (id: string, update: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.commitId === id ? { ...row, ...update } : row)));
  const actionBlocked = (row: Row, action: Row['action']) =>
    locked
      ? 'An operation is running.'
      : editor
        ? 'Finish or cancel the message edit first.'
        : plan?.mergeCommitCount && ['squash', 'fixup'].includes(action)
          ? 'Merge plans keep their topology; combining commits is available in linear plans.'
          : row.parents.length > 1 && !['pick', 'reword'].includes(action)
            ? 'Keep this merge node; its message can be reworded.'
            : undefined;

  const changeAction = (row: Row, action: Row['action']) => {
    if (actionBlocked(row, action)) return;
    setSelectedId(row.commitId);
    if (action === 'reword') {
      const value = message(row, groups.get(row.commitId));
      const [subject = '', ...body] = value.split('\n');
      setEditor({
        id: row.commitId,
        subject,
        body: body.join('\n').replace(/^\n/u, ''),
        combined: Boolean(groups.get(row.commitId)?.some((item) => item.action === 'squash')),
        previousAction: row.action,
      });
    }
    updateRow(row.commitId, { action });
    if (action === 'squash') {
      const older = rows
        .slice(rows.indexOf(row) + 1)
        .find((item) => !['squash', 'fixup', 'drop'].includes(item.action));
      if (older?.action === 'pick') updateRow(older.commitId, { action: 'reword' });
    }
  };
  const move = (row: Row, delta: number) => {
    if (locked || plan?.mergeCommitCount || editor) return;
    const index = rows.indexOf(row);
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    next.splice(index, 1);
    next.splice(target, 0, row);
    setRows(next);
    focusRow(row.commitId);
  };
  const rowMenu = (row: Row): MenuEntry[] => [
    ...commands.map((action, index) => ({
      id: action,
      label: labels[action],
      shortcut: keys[index]!.toUpperCase(),
      disabled: Boolean(actionBlocked(row, action)),
      disabledReason: actionBlocked(row, action),
      run: () => changeAction(row, action),
    })),
    menuSeparator,
    {
      id: 'up',
      label: 'Move Up',
      shortcut: 'Ctrl+Up',
      disabled: locked || Boolean(plan?.mergeCommitCount) || rows.indexOf(row) === 0,
      run: () => move(row, -1),
    },
    {
      id: 'down',
      label: 'Move Down',
      shortcut: 'Ctrl+Down',
      disabled: locked || Boolean(plan?.mergeCommitCount) || rows.indexOf(row) === rows.length - 1,
      run: () => move(row, 1),
    },
  ];
  const autosquash = async () => {
    if (!window.desktop || !plan || locked) return;
    const epoch = generation.current;
    setLoading(true);
    try {
      const value = unwrapResult(
        await window.desktop.repository.getInteractiveRebasePlan({
          id: repositoryId,
          ontoCommitId: plan.ontoCommitId,
          autosquash: true,
          snapshot: plan.snapshot,
          actions: rows.map(({ commitId, action, subject, body, combinedMessage }) => ({
            commitId,
            action,
            subject,
            body,
            ...(combinedMessage === undefined ? {} : { combinedMessage }),
          })),
        }),
      );
      if (epoch !== generation.current) return;
      setRows(value.commits);
      setError(undefined);
    } catch (reason) {
      if (epoch === generation.current)
        setError(reason instanceof Error ? reason.message : 'Autosquash could not be prepared.');
    } finally {
      if (epoch === generation.current) setLoading(false);
    }
  };

  return (
    <DialogShell
      title="Interactive Rebase"
      subtitle=""
      icon={<BranchIcon size={20} />}
      platform={platform}
      className="p05-dialog p07-dialog"
      warning={failure ?? error ?? invalid ?? null}
      submitLabel="Rebase"
      submitDisabled={submitDisabled}
      busy={busy}
      onClose={onClose}
      status={
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={backupBranch}
            disabled={locked}
            onChange={(event) => setBackupBranch(event.target.checked)}
          />
          Backup current state with a temporary branch
        </label>
      }
      onSubmit={() => {
        if (!plan || submitDisabled) return;
        onSubmit({
          id: repositoryId,
          ontoCommitId: plan.ontoCommitId,
          snapshot: plan.snapshot,
          actions: rows.map(({ commitId, action, subject, body, combinedMessage }) => ({
            commitId,
            action,
            subject,
            body,
            ...(combinedMessage === undefined ? {} : { combinedMessage }),
          })),
          autosquash: false,
          autostash,
          updateRefs,
          backupBranch,
          acknowledgePublished,
          ...(autostash ? { changesSnapshot: plan.workingChanges.snapshot } : {}),
        });
      }}
    >
      <dt className="p07-plan-label">Rebase plan</dt>
      <dd className="p07-workspace">
        <div className="p07-context">
          <span>
            Rebase: <BranchIcon size={13} /> <strong>{plan?.branchName ?? '…'}</strong>
          </span>
          <span title={plan?.ontoCommitId ?? ''}>
            On:{' '}
            <strong>
              {plan?.root
                ? 'Root'
                : (plan?.ontoCommitId?.slice(0, 7) ?? '') + ' ' + (plan?.ontoSubject ?? '')}
            </strong>
          </span>
          <label
            className="reference-checkbox"
            title={
              eligibleBranches.length
                ? eligibleBranches.map((branch) => branch.name).join(', ')
                : 'No dependent branches are eligible.'
            }
          >
            <input
              type="checkbox"
              checked={updateRefs}
              disabled={locked || !eligibleBranches.length}
              onChange={(event) => setUpdateRefs(event.target.checked)}
            />
            Update dependent branches
          </label>
        </div>
        <div className="p07-inspection">
          <div
            className="interactive-rebase-plan"
            data-testid="interactive-rebase-plan"
            ref={list}
            role="listbox"
            aria-label="Rebase commits, newest first"
            aria-busy={loading}
          >
            {loading && <p className="dialog-inline-note">Reading commits…</p>}
            {rows.map((row, index) => {
              const combined = groups.get(row.commitId)?.some((item) => item.action === 'squash');
              const text = message(row, groups.get(row.commitId));
              const active = row.commitId === selectedId;
              return (
                <div key={row.commitId}>
                  <div
                    className={
                      'interactive-rebase-row interactive-rebase-' +
                      row.action +
                      (active ? ' is-selected' : '') +
                      (combined ? ' is-combined' : '')
                    }
                    role="option"
                    aria-selected={active}
                    aria-label={labels[row.action] + ' ' + (row.subject || '(no subject)')}
                    tabIndex={active ? 0 : -1}
                    data-testid="interactive-rebase-row"
                    data-commit-id={row.commitId}
                    draggable={!locked && !plan?.mergeCommitCount && !editor}
                    onDragStart={(event) => {
                      setDragId(row.commitId);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', row.commitId);
                    }}
                    onDragOver={(event) => {
                      if (dragId && !plan?.mergeCommitCount) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const dragged = rows.find((item) => item.commitId === dragId);
                      if (dragged) move(dragged, index - rows.indexOf(dragged));
                      setDragId(undefined);
                    }}
                    onDragEnd={() => setDragId(undefined)}
                    onClick={() => setSelectedId(row.commitId)}
                    onDoubleClick={() => changeAction(row, 'reword')}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedId(row.commitId);
                      contextMenu({
                        anchor: contextMenuAnchor(event, event.currentTarget),
                        label: 'Rebase action',
                        items: rowMenu(row),
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || locked) return;
                      if (event.ctrlKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                        event.preventDefault();
                        move(row, event.key === 'ArrowUp' ? -1 : 1);
                        return;
                      }
                      if (event.ctrlKey || event.metaKey || event.altKey) return;
                      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        focusRow(
                          rows[
                            event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? rows.length - 1
                                : Math.min(
                                    rows.length - 1,
                                    Math.max(0, index + (event.key === 'ArrowUp' ? -1 : 1)),
                                  )
                          ]!.commitId,
                        );
                        return;
                      }
                      const action = commands[keys.indexOf(event.key.toLowerCase())];
                      if (action) {
                        event.preventDefault();
                        changeAction(row, action);
                      }
                    }}
                  >
                    <MenuButton
                      className="interactive-rebase-action"
                      menuLabel="Rebase action"
                      aria-label={'Action for ' + row.subject}
                      items={rowMenu(row)}
                      disabledReason={locked ? 'An operation is running.' : undefined}
                    >
                      <span className="p07-action-dot" aria-hidden="true" />
                      {labels[row.action]}
                      <span className="p07-chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </MenuButton>
                    <span
                      className={
                        'interactive-rebase-connector' +
                        (['squash', 'fixup'].includes(row.action) ? ' is-joined' : '')
                      }
                      aria-hidden="true"
                    />
                    <span className="interactive-rebase-message" title={text}>
                      {text.split('\n')[0] || '(no subject)'}
                    </span>
                    <span className="p07-author" title={row.author.email}>
                      {row.author.name}
                    </span>
                    <span className="interactive-rebase-hash">{row.commitId.slice(0, 7)}</span>
                    <time className="p07-date" dateTime={row.author.date}>
                      {formatListDate(row.author.date)}
                    </time>
                  </div>
                  {editor?.id === row.commitId && (
                    <div
                      className="p07-message-editor"
                      role="group"
                      aria-label="Edit commit message"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          updateRow(editor.id, { action: editor.previousAction });
                          setEditor(undefined);
                          focusRow(row.commitId);
                        }
                      }}
                    >
                      <input
                        ref={messageInput}
                        aria-label="Commit subject"
                        value={editor.subject}
                        disabled={locked}
                        maxLength={16_384}
                        onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.parentElement
                              ?.querySelector<HTMLTextAreaElement>('textarea')
                              ?.focus();
                          }
                        }}
                      />
                      <textarea
                        aria-label="Commit description"
                        value={editor.body}
                        disabled={locked}
                        maxLength={262_144}
                        onChange={(event) => setEditor({ ...editor, body: event.target.value })}
                      />
                      <div>
                        <button
                          type="button"
                          className="button button-small"
                          disabled={locked}
                          onClick={() => {
                            updateRow(editor.id, { action: editor.previousAction });
                            setEditor(undefined);
                            focusRow(row.commitId);
                          }}
                        >
                          Cancel message
                        </button>
                        <button
                          type="button"
                          className="button button-small"
                          disabled={locked || !editor.subject.trim()}
                          onClick={() => {
                            updateRow(
                              editor.id,
                              editor.combined
                                ? {
                                    combinedMessage: [editor.subject, editor.body]
                                      .filter(Boolean)
                                      .join('\n\n'),
                                  }
                                : { subject: editor.subject, body: editor.body },
                            );
                            setEditor(undefined);
                            focusRow(row.commitId);
                          }}
                        >
                          OK
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <CommitDetails
            repositoryId={repositoryId}
            commit={inspected}
            lane={undefined}
            referencesByName={emptyReferences}
            loadedCommitIds={loadedIds}
            isolated
            onSelectCommit={(id) => {
              if (loadedIds.has(id)) focusRow(id);
            }}
            standalone
            initialTab="commit"
          />
        </div>
        <div className="interactive-rebase-options">
          <button
            type="button"
            className="button button-small"
            disabled={locked || Boolean(plan?.mergeCommitCount) || Boolean(editor)}
            onClick={() => void autosquash()}
          >
            Autosquash
          </button>
          {changedCount > 0 && (
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={autostash}
                disabled={locked}
                data-testid="interactive-rebase-autostash"
                onChange={(event) => setAutostash(event.target.checked)}
              />
              Stash and reapply {changedCount} local paths
            </label>
          )}
          {Boolean(plan?.mergeCommitCount) && (
            <span className="dialog-inline-note">
              Merges are preserved. Edit messages or individual commits; order and merge nodes stay fixed.
            </span>
          )}
          {updateRefs && (
            <span className="dialog-inline-note" data-testid="rebase-dependent-branches">
              Update: {eligibleBranches.map((branch) => branch.name).join(', ')}.
            </span>
          )}
          {plan?.dependentBranches.some((branch) => branch.checkedOut) && (
            <span className="dialog-inline-note">
              Branches checked out in another worktree will stay unchanged.
            </span>
          )}
        </div>
        {Boolean(plan?.publishedCommitCount) && (
          <div className="p07-published" role="note">
            <span>
              {plan?.publishedCommitCount} commits are reachable from remote-tracking branches. Rewriting
              published history changes commit IDs; coordinate with collaborators before pushing.
            </span>
            <label className="reference-checkbox">
              <input
                type="checkbox"
                checked={acknowledgePublished}
                disabled={locked}
                onChange={(event) => setAcknowledgePublished(event.target.checked)}
              />
              I understand that published history will be rewritten
            </label>
          </div>
        )}
      </dd>
    </DialogShell>
  );
}
