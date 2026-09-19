import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type {
  RepositoryCommitChange,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
  RepositorySummary,
  RepositoryWorkingChangeAction,
  RepositoryWorkingChangeSelection,
  RepositoryWorkingChangeTarget,
  RepositoryWorkingChange,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { changeDetail } from '../lib/change-status';
import { shortHash } from '../lib/format';
import { emptySelection, pruneSelection, selectKey, selectKeys } from '../lib/list-selection';
import type { ListSelection, SelectionModifiers } from '../lib/list-selection';
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import { useAmendChanges } from '../hooks/use-amend-changes';
import { useRepositoryDiff } from '../hooks/use-repository-diff';
import { useRepositoryWorkingChanges } from '../hooks/use-repository-working-changes';
import { FileChangeList } from './FileChangeList';
import type { FileChangeEntry, FileListMode } from './FileChangeList';
import { DiffViewer } from './DiffViewer';
import type { DiffDisplayMode, DiffWorkingAction } from './DiffViewer';
import { ListOptionsIcon, SearchIcon } from './Icons';
import { Splitter } from './Splitter';
import { StatusBadge } from './StatusBadge';
import { CommitComposer } from './CommitComposer';
import { MenuButton } from './menu/MenuButton';
import { useContextMenu } from './menu/context-menu';
import { compactMenu, contextMenuAnchor, menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';
import { copyText } from '../lib/clipboard';

const fileListModes = ['tree', 'list'] as const;
const diffDisplayModes = ['unified', 'split'] as const;
const diffWhitespaceModes = ['normal', 'ignore-all', 'ignore-space-change', 'ignore-space-at-eol'] as const;

const areaLabels: Record<RepositoryWorkingChange['area'], string> = {
  staged: 'Staged',
  unstaged: 'Unstaged',
  untracked: 'Untracked',
  ignored: 'Ignored',
};

interface WorkingEntry extends FileChangeEntry {
  readonly kind: 'working';
  readonly change: RepositoryWorkingChange;
}

/** A file the amended commit would contain, which may or may not also be staged right now. */
interface AmendEntry extends FileChangeEntry {
  readonly kind: 'amend';
  readonly change: RepositoryCommitChange;
  readonly inIndex: boolean;
}

type PaneEntry = WorkingEntry | AmendEntry;

function workingEntry(change: RepositoryWorkingChange): WorkingEntry {
  return {
    kind: 'working',
    key: `${change.area}:${encodeURIComponent(change.path)}`,
    status: change.status,
    path: change.path,
    previousPath: change.previousPath,
    detail: change.previousPath ? `from ${change.previousPath}` : undefined,
    change,
  };
}

function amendEntry(change: RepositoryCommitChange, inIndex: boolean): AmendEntry {
  return {
    kind: 'amend',
    key: `amend:${encodeURIComponent(change.path)}`,
    status: change.status,
    path: change.path,
    previousPath: change.previousPath,
    detail: inIndex ? undefined : 'in the amended commit',
    change,
    inIndex,
  };
}

/**
 * The working-tree file an action would touch. An amend preview row only has one when that path is
 * also staged right now; the rest of the amended commit cannot be unstaged without rewriting it.
 */
function workingTarget(
  entry: PaneEntry,
  stagedByPath: ReadonlyMap<string, WorkingEntry>,
): RepositoryWorkingChangeTarget | undefined {
  const working = entry.kind === 'working' ? entry : stagedByPath.get(entry.path);
  if (!working || working.change.area === 'ignored') return undefined;
  return {
    area: working.change.area,
    path: working.change.path,
    previousPath: working.change.previousPath,
  };
}

interface ChangesPaneProps {
  readonly id: 'unstaged' | 'staged';
  readonly title: string;
  readonly action: 'stage' | 'unstage';
  readonly entries: readonly PaneEntry[];
  readonly mode: FileListMode;
  readonly activeKey: string | undefined;
  readonly selectedKeys: ReadonlySet<string>;
  readonly emptyText: string;
  readonly onSelect: (entry: PaneEntry, modifiers: SelectionModifiers) => void;
  readonly onContextMenu: (entry: PaneEntry, event: ReactMouseEvent<HTMLElement>) => void;
  readonly onAction: () => void;
  readonly actionDisabled: boolean;
  readonly actionDisabledReason: string | undefined;
  readonly children?: ReactNode;
}

function ChangesPane({
  id,
  title,
  action,
  entries,
  mode,
  activeKey,
  selectedKeys,
  emptyText,
  onSelect,
  onContextMenu,
  onAction,
  actionDisabled,
  actionDisabledReason,
  children,
}: ChangesPaneProps) {
  const chosen = entries.filter((entry) => selectedKeys.has(entry.key)).length;
  const verb = action[0]!.toLocaleUpperCase() + action.slice(1);
  return (
    <section
      className={`changes-pane ${id}`}
      aria-labelledby={`changes-pane-${id}`}
      data-testid={`working-changes-${id}`}
    >
      <header className="changes-pane-header">
        <h2 id={`changes-pane-${id}`}>{title}</h2>
        <button
          type="button"
          className="button button-small"
          disabled={actionDisabled}
          title={
            actionDisabledReason ??
            (chosen > 0
              ? `${verb} the ${chosen === 1 ? 'selected file' : `${chosen} selected files`}.`
              : `${verb} every file in this pane.`)
          }
          data-testid={`working-${id}-action`}
          onClick={onAction}
        >
          {chosen > 0 ? verb : `${verb} All`}
        </button>
      </header>
      <div className="file-pane-body">
        {children}
        {entries.length === 0 ? (
          <p className="changes-empty">{emptyText}</p>
        ) : (
          <FileChangeList
            entries={entries}
            mode={mode}
            label={`${title} files`}
            idPrefix={`working-${id}`}
            selectedKey={activeKey}
            selectedKeys={selectedKeys}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            rowTestId="working-change"
          />
        )}
      </div>
    </section>
  );
}

interface ChangePreviewProps {
  readonly entry: PaneEntry;
  readonly diff: ReturnType<typeof useRepositoryDiff>;
  readonly mode: DiffDisplayMode;
  readonly onModeChange: (mode: DiffDisplayMode) => void;
  readonly whitespace: RepositoryDiffWhitespace;
  readonly onWhitespaceChange: (whitespace: RepositoryDiffWhitespace) => void;
  readonly showWhitespace: boolean;
  readonly onShowWhitespaceChange: (show: boolean) => void;
  readonly busy: boolean;
  readonly onWorkingAction: (
    action: RepositoryWorkingChangeAction,
    selection: RepositoryWorkingChangeSelection,
    snapshot: string | undefined,
  ) => Promise<boolean>;
}

function ChangePreview({
  entry,
  diff,
  mode,
  onModeChange,
  whitespace,
  onWhitespaceChange,
  showWhitespace,
  onShowWhitespaceChange,
  busy,
  onWorkingAction,
}: ChangePreviewProps) {
  const change = entry.change;
  const area = entry.kind === 'working' ? entry.change.area : undefined;
  const workingActions = useMemo<DiffWorkingAction[]>(() => {
    // The amend preview is a read of what the commit would contain, so it offers no staging actions.
    const actions: RepositoryWorkingChangeAction[] =
      area === 'staged'
        ? ['unstage']
        : area === 'unstaged'
          ? ['stage', ...(change.status === 'unmerged' ? [] : ['discard' as const])]
          : area === 'untracked'
            ? ['stage']
            : [];
    return actions.map((action) => ({
      action,
      disabled: busy,
      disabledReason: busy ? 'Another working-tree action is in progress.' : undefined,
      onApply: (selection) => onWorkingAction(action, selection, diff.value?.snapshot ?? undefined),
    }));
  }, [area, busy, change.status, diff.value?.snapshot, onWorkingAction]);
  return (
    <div className="file-preview" data-testid="working-change-preview">
      <div className="preview-header">
        <StatusBadge status={change.status} />
        <span
          className="preview-path"
          title={`${area ? areaLabels[area] : 'Amended commit'}: ${change.path}`}
        >
          {change.path}
        </span>
        {changeDetail(change) && <span className="preview-detail">{changeDetail(change)}</span>}
      </div>
      <div className="preview-body diff-preview-body">
        <DiffViewer
          value={diff.value}
          loading={diff.loading}
          error={diff.error}
          onRetry={diff.refresh}
          mode={mode}
          onModeChange={onModeChange}
          whitespace={whitespace}
          onWhitespaceChange={onWhitespaceChange}
          showWhitespace={showWhitespace}
          onShowWhitespaceChange={onShowWhitespaceChange}
          workingActions={workingActions}
          label={entry.kind === 'amend' ? 'Amended commit diff' : 'Working tree diff'}
        />
      </div>
    </div>
  );
}

interface ChangesViewProps {
  readonly operationBusy?: boolean;
  readonly repository: RepositorySummary;
  /** Increments when the user asks the application to refresh. */
  readonly refreshSignal: number;
  /** Lets a completed commit refresh the history, tabs, and repository summary. */
  readonly onCommitted: () => void;
  /** Opens the F15 stash dialog for the selected file paths. */
  readonly onStashPaths?: (paths: readonly string[]) => void;
  /** Saves the selected file paths as a bounded patch. */
  readonly onSavePatch?: (paths: readonly string[]) => void;
}

export function ChangesView({
  repository,
  refreshSignal,
  onCommitted,
  operationBusy = false,
  onStashPaths,
  onSavePatch,
}: ChangesViewProps) {
  const showContextMenu = useContextMenu();
  const [mode, setMode] = usePersistentState<FileListMode>(
    `repository.${repository.id}.changes.mode`,
    'tree',
    isOneOf(fileListModes),
  );
  const [includeUntracked, setIncludeUntracked] = usePersistentState(
    `repository.${repository.id}.changes.includeUntracked`,
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [includeIgnored, setIncludeIgnored] = usePersistentState(
    `repository.${repository.id}.changes.includeIgnored`,
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [filesWidth, setFilesWidth] = usePersistentState(
    'changes.filesWidth',
    380,
    isNumberBetween(200, 1600),
  );
  const [unstagedHeight, setUnstagedHeight] = usePersistentState(
    'changes.unstagedHeight',
    Math.max(160, Math.round((window.innerHeight - 160) * 0.5)),
    isNumberBetween(72, 4000),
  );
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState<ListSelection>(emptySelection);
  const [amend, setAmend] = usePersistentState(
    `repository.${repository.id}.commit.amend`,
    false,
    (candidate): candidate is boolean => typeof candidate === 'boolean',
  );
  const [diffMode, setDiffMode] = usePersistentState<DiffDisplayMode>(
    `repository.${repository.id}.diff.mode`,
    'unified',
    isOneOf(diffDisplayModes),
  );
  const [diffWhitespace, setDiffWhitespace] = usePersistentState<RepositoryDiffWhitespace>(
    `repository.${repository.id}.diff.whitespace`,
    'normal',
    isOneOf(diffWhitespaceModes),
  );
  const [showWhitespace, setShowWhitespace] = usePersistentState(
    `repository.${repository.id}.diff.showWhitespace`,
    false,
    (candidate): candidate is boolean => typeof candidate === 'boolean',
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const pendingSelection = useRef<
    { readonly paths: readonly string[]; readonly area: 'staged' | 'unstaged' } | undefined
  >(undefined);
  const { value, loading, error, refresh } = useRepositoryWorkingChanges(
    repository.id,
    includeUntracked,
    includeIgnored,
  );

  const handledRefresh = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === handledRefresh.current) return;
    handledRefresh.current = refreshSignal;
    refresh();
  }, [refresh, refreshSignal]);

  const { unstaged, staged } = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    const visible = (change: RepositoryWorkingChange) =>
      !query || change.path.toLocaleLowerCase().includes(query);
    if (!value) return { unstaged: [], staged: [] };
    return {
      // Fork lists untracked and, when shown, ignored files with the other unstaged changes.
      unstaged: [...value.unstaged, ...value.untracked, ...(includeIgnored ? value.ignored : [])]
        .filter(visible)
        .map(workingEntry),
      staged: value.staged.filter(visible).map(workingEntry),
    };
  }, [filter, includeIgnored, value]);

  /** The composer reloads its commit guard whenever HEAD or the staged entries change. */
  const changeToken = useMemo(() => {
    const head = `${repository.head.state}:${repository.head.commit ?? ''}`;
    if (!value) return `${head}|pending`;
    const entries = value.staged
      .map((change) =>
        [
          change.path,
          change.previousPath ?? '',
          change.indexStatus,
          change.oldObjectId ?? '',
          change.newObjectId ?? '',
        ].join(' '),
      )
      .join('');
    return `${head}|${value.counts.conflicted}|${entries}`;
  }, [repository.head.commit, repository.head.state, value]);

  const amendChanges = useAmendChanges(repository.id, amend, changeToken);

  /** Ticking Amend previews what the amended commit would contain; nothing is moved or reset. */
  const amendEntries = useMemo<AmendEntry[]>(() => {
    const preview = amendChanges.value;
    if (!amend || !preview) return [];
    const query = filter.trim().toLocaleLowerCase();
    const inIndex = new Set(preview.stagedPaths);
    return preview.changes
      .filter((change) => !query || change.path.toLocaleLowerCase().includes(query))
      .map((change) => amendEntry(change, inIndex.has(change.path)));
  }, [amend, amendChanges.value, filter]);

  const amendPreview = amend && amendChanges.value !== undefined;
  const stagedByPath = useMemo(() => new Map(staged.map((entry) => [entry.path, entry] as const)), [staged]);
  const stagedEntries: readonly PaneEntry[] = amendPreview ? amendEntries : staged;
  const order = useMemo(
    () => [...unstaged, ...stagedEntries].map((entry) => entry.key),
    [stagedEntries, unstaged],
  );

  useEffect(() => {
    setSelection((current) => pruneSelection(order, current));
  }, [order]);

  const selectEntry = useCallback(
    (entries: readonly PaneEntry[], entry: PaneEntry, modifiers: SelectionModifiers) => {
      // A pane owns its selection, so clicking in one pane drops what the other one had selected.
      const paneOrder = entries.map((candidate) => candidate.key);
      setSelection((current) =>
        selectKey(paneOrder, pruneSelection(paneOrder, current), entry.key, modifiers),
      );
    },
    [],
  );

  const selectedKeys = useMemo(() => new Set(selection.keys), [selection.keys]);
  const selected = [...unstaged, ...stagedEntries].find((entry) => entry.key === selection.activeKey);
  const openChangeMenu = useCallback(
    (entry: PaneEntry, event: ReactMouseEvent<HTMLElement>) => {
      const allEntries = [...unstaged, ...stagedEntries];
      const selectedEntries = selectedKeys.has(entry.key)
        ? allEntries.filter((candidate) => selectedKeys.has(candidate.key))
        : [entry];
      const paths = [
        ...new Set(
          selectedEntries
            .filter((candidate): candidate is WorkingEntry => candidate.kind === 'working')
            .filter((candidate) => candidate.change.area !== 'ignored')
            .map((candidate) => candidate.path),
        ),
      ];
      showContextMenu({
        anchor: contextMenuAnchor(event, event.currentTarget),
        label: paths.length === 1 ? paths[0]! : `${paths.length} changed files`,
        items: compactMenu([
          {
            id: 'stash-selected',
            label: paths.length > 1 ? `Stash ${paths.length} Files…` : 'Stash File…',
            disabled: paths.length === 0 || onStashPaths === undefined,
            disabledReason: paths.length === 0 ? 'This row is not a stashable working-tree file.' : undefined,
            run: () => onStashPaths?.(paths),
          },
          {
            id: 'save-selected-patch',
            label: 'Save as Patch…',
            disabled: paths.length === 0 || onSavePatch === undefined,
            disabledReason: paths.length === 0 ? 'This row is not a patchable working-tree file.' : undefined,
            run: () => onSavePatch?.(paths),
          },
          menuSeparator,
          { id: 'copy-path', label: 'Copy Path', run: () => copyText(entry.path) },
        ]),
      });
    },
    [onSavePatch, onStashPaths, selectedKeys, showContextMenu, stagedEntries, unstaged],
  );
  const diffTarget = useMemo<RepositoryDiffTarget | undefined>(() => {
    if (!selected) return undefined;
    return selected.kind === 'amend'
      ? { kind: 'amend', path: selected.path, previousPath: selected.previousPath }
      : {
          kind: 'working',
          area: selected.change.area,
          path: selected.change.path,
          previousPath: selected.change.previousPath,
        };
  }, [selected]);
  const diff = useRepositoryDiff(repository.id, diffTarget, diffWhitespace, refreshSignal);
  const refreshDiff = diff.refresh;
  const filtering = filter.trim().length > 0;

  const applyAction = useCallback(
    async (
      action: RepositoryWorkingChangeAction,
      targets: readonly RepositoryWorkingChangeTarget[],
      selection: RepositoryWorkingChangeSelection,
      snapshot?: string,
    ): Promise<boolean> => {
      const api = window.desktop;
      if (!api) {
        setActionError('Open this application in Electron to change working-tree files.');
        return false;
      }
      if (targets.length === 0) return false;
      setActionBusy(true);
      setActionError(undefined);
      try {
        let expectedSnapshot = snapshot ?? null;
        const first = targets[0];
        if (selection.kind !== 'file' && !expectedSnapshot && first) {
          const currentDiff = unwrapResult(
            await api.repository.getDiff({
              id: repository.id,
              target: { kind: 'working', ...first },
              whitespace: 'normal',
            }),
          );
          expectedSnapshot = currentDiff.snapshot;
        }
        if (selection.kind !== 'file' && !expectedSnapshot) {
          throw new Error('That file does not have a mutable working-tree snapshot.');
        }
        unwrapResult(
          await api.repository.applyWorkingChange({
            id: repository.id,
            action,
            targets: [...targets],
            snapshot: expectedSnapshot,
            selection,
          }),
        );
        await refresh();
        refreshDiff();
        return true;
      } catch (reason: unknown) {
        setActionError(
          reason instanceof Error ? reason.message : 'The working-tree action could not be completed.',
        );
        return false;
      } finally {
        setActionBusy(false);
      }
    },
    [refresh, refreshDiff, repository.id],
  );

  /** One Git invocation stages or unstages every chosen file, instead of one round trip each. */
  const applyFileEntries = useCallback(
    async (action: 'stage' | 'unstage', entries: readonly PaneEntry[]) => {
      const targets = entries
        .map((entry) => workingTarget(entry, stagedByPath))
        .filter((target): target is RepositoryWorkingChangeTarget => target !== undefined);
      if (targets.length === 0) return;
      // Keep the same files selected once they arrive in the other pane.
      pendingSelection.current = {
        paths: targets.map((target) => target.path),
        area: action === 'stage' ? 'staged' : 'unstaged',
      };
      await applyAction(action, targets, { kind: 'file' });
    },
    [applyAction, stagedByPath],
  );

  useEffect(() => {
    const pending = pendingSelection.current;
    if (!pending) return;
    pendingSelection.current = undefined;
    const pool = pending.area === 'staged' ? stagedEntries : unstaged;
    const moved = pool.filter((entry) => pending.paths.includes(entry.path)).map((entry) => entry.key);
    if (moved.length > 0) {
      setSelection(
        selectKeys(
          pool.map((entry) => entry.key),
          moved,
        ),
      );
    }
  }, [stagedEntries, unstaged]);

  const stageEntries = useMemo<PaneEntry[]>(
    () => unstaged.filter((entry) => entry.kind === 'working' && entry.change.area !== 'ignored'),
    [unstaged],
  );
  const selectedIn = useCallback(
    (entries: readonly PaneEntry[]) => entries.filter((entry) => selectedKeys.has(entry.key)),
    [selectedKeys],
  );
  const unstageEntries = useMemo<PaneEntry[]>(
    () => stagedEntries.filter((entry) => workingTarget(entry, stagedByPath) !== undefined),
    [stagedByPath, stagedEntries],
  );
  const actionFailure = actionError ? (
    <div className="inline-alert" role="alert">
      <span>{actionError}</span>
      <button
        type="button"
        className="button button-small"
        onClick={() => {
          setActionError(undefined);
          refresh();
          refreshDiff();
        }}
      >
        Refresh
      </button>
    </div>
  ) : null;
  const optionItems: MenuEntry[] = [
    {
      id: 'view-tree',
      label: 'View as Tree',
      checkable: 'radio',
      checked: mode === 'tree',
      run: () => setMode('tree'),
    },
    {
      id: 'view-list',
      label: 'View as List',
      checkable: 'radio',
      checked: mode === 'list',
      run: () => setMode('list'),
    },
    menuSeparator,
    {
      id: 'hide-untracked',
      label: 'Hide Untracked Files',
      checkable: 'checkbox',
      checked: !includeUntracked,
      run: () => setIncludeUntracked(!includeUntracked),
    },
    {
      id: 'show-ignored',
      label: 'Show Ignored Files',
      checkable: 'checkbox',
      checked: includeIgnored,
      run: () => setIncludeIgnored(!includeIgnored),
    },
  ];
  const status = !value
    ? repository.workingTree.state === 'unknown'
      ? 'The working-tree status could not be read.'
      : loading
        ? 'Reading working-tree status…'
        : undefined
    : undefined;

  return (
    <section
      className="changes-view"
      aria-label="Local Changes"
      data-testid="working-changes"
      style={
        {
          '--changes-files-width': `${filesWidth}px`,
          '--changes-unstaged-height': `${unstagedHeight}px`,
        } as CSSProperties
      }
    >
      <div className="changes-files">
        <div className="pane-strip">
          <label className="pane-filter">
            <SearchIcon size={12} />
            <input
              type="search"
              value={filter}
              placeholder="Filter"
              aria-label="Filter local changes"
              spellCheck={false}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && filter) {
                  event.preventDefault();
                  setFilter('');
                }
              }}
            />
          </label>
          <MenuButton
            className="pane-icon-button"
            aria-label="Local changes options"
            title="Local changes options"
            menuLabel="Local changes options"
            items={optionItems}
          >
            <ListOptionsIcon size={14} />
          </MenuButton>
        </div>
        {error && (
          <div className="inline-alert" role="alert">
            <span>{error}</span>
            <button type="button" className="button button-small" onClick={refresh}>
              Retry
            </button>
          </div>
        )}
        {actionFailure}
        {value?.truncated && (
          <p className="changes-truncated" role="status">
            Some sections are truncated at 10,000 entries.
          </p>
        )}
        <ChangesPane
          id="unstaged"
          title="Unstaged"
          action="stage"
          entries={unstaged}
          mode={mode}
          activeKey={selection.activeKey}
          selectedKeys={selectedKeys}
          emptyText={status ?? (filtering ? 'No unstaged files match the filter.' : 'No unstaged changes.')}
          onSelect={(entry, modifiers) => selectEntry(unstaged, entry, modifiers)}
          onContextMenu={openChangeMenu}
          onAction={() => {
            const chosen = selectedIn(stageEntries);
            void applyFileEntries('stage', chosen.length > 0 ? chosen : stageEntries);
          }}
          actionDisabled={actionBusy || loading || stageEntries.length === 0}
          actionDisabledReason={
            stageEntries.length === 0 ? 'There are no unstaged files to stage.' : undefined
          }
        >
          {value && value.counts.conflicted > 0 && (
            <p className="changes-conflicts" role="status">
              {value.counts.conflicted === 1
                ? '1 file has conflicts.'
                : `${value.counts.conflicted} files have conflicts.`}
            </p>
          )}
        </ChangesPane>
        <Splitter
          orientation="horizontal"
          label="Resize unstaged and staged files"
          value={unstagedHeight}
          minimum={72}
          maximum={4000}
          onChange={setUnstagedHeight}
        />
        <ChangesPane
          id="staged"
          title={amendPreview ? 'Staged and amended' : 'Staged'}
          action="unstage"
          entries={stagedEntries}
          mode={mode}
          activeKey={selection.activeKey}
          selectedKeys={selectedKeys}
          emptyText={
            amendPreview
              ? 'The amended commit would be empty.'
              : (status ?? (filtering ? 'No staged files match the filter.' : 'No staged changes.'))
          }
          onSelect={(entry, modifiers) => selectEntry(stagedEntries, entry, modifiers)}
          onContextMenu={openChangeMenu}
          onAction={() => {
            const chosen = selectedIn(unstageEntries);
            void applyFileEntries('unstage', chosen.length > 0 ? chosen : unstageEntries);
          }}
          actionDisabled={actionBusy || loading || unstageEntries.length === 0}
          actionDisabledReason={
            unstageEntries.length === 0
              ? amendPreview
                ? 'These changes belong to the commit being amended.'
                : 'There are no staged files to unstage.'
              : undefined
          }
        >
          {amendPreview && (
            <p className="changes-amend-note" role="status" data-testid="amend-note">
              Showing what amending {shortHash(amendChanges.value?.commitId ?? '')} would commit.
            </p>
          )}
          {amendChanges.error && (
            <div className="inline-alert" role="alert">
              <span>{amendChanges.error}</span>
              <button type="button" className="button button-small" onClick={amendChanges.refresh}>
                Retry
              </button>
            </div>
          )}
        </ChangesPane>
      </div>
      <Splitter
        orientation="vertical"
        label="Resize local changes file list"
        value={filesWidth}
        minimum={200}
        maximum={1600}
        onChange={setFilesWidth}
      />
      <div className="changes-detail">
        <div className="preview-pane">
          {selected ? (
            <ChangePreview
              entry={selected}
              diff={diff}
              mode={diffMode}
              onModeChange={setDiffMode}
              whitespace={diffWhitespace}
              onWhitespaceChange={setDiffWhitespace}
              showWhitespace={showWhitespace}
              onShowWhitespaceChange={setShowWhitespace}
              busy={actionBusy}
              onWorkingAction={(action, lines, snapshot) => {
                const target = workingTarget(selected, stagedByPath);
                return target ? applyAction(action, [target], lines, snapshot) : Promise.resolve(false);
              }}
            />
          ) : (
            <p className="preview-empty">Select a file to see its changes.</p>
          )}
        </div>
        <CommitComposer
          repository={repository}
          changeToken={changeToken}
          stagedCount={amendPreview ? amendEntries.length : (value?.counts.staged ?? 0)}
          conflictedCount={value?.counts.conflicted ?? 0}
          amend={amend}
          onAmendChange={setAmend}
          busy={actionBusy || operationBusy}
          onCommitted={onCommitted}
        />
      </div>
    </section>
  );
}
