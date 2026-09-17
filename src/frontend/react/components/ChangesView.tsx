import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
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
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
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
import { menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

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
  readonly change: RepositoryWorkingChange;
}

function workingEntry(change: RepositoryWorkingChange): WorkingEntry {
  return {
    key: `${change.area}:${encodeURIComponent(change.path)}`,
    status: change.status,
    path: change.path,
    previousPath: change.previousPath,
    detail: change.previousPath ? `from ${change.previousPath}` : undefined,
    change,
  };
}

interface ChangesPaneProps {
  readonly id: 'unstaged' | 'staged';
  readonly title: string;
  readonly action: 'stage' | 'unstage';
  readonly entries: readonly WorkingEntry[];
  readonly mode: FileListMode;
  readonly selectedKey: string | undefined;
  readonly emptyText: string;
  readonly onSelect: (key: string) => void;
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
  selectedKey,
  emptyText,
  onSelect,
  onAction,
  actionDisabled,
  actionDisabledReason,
  children,
}: ChangesPaneProps) {
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
          title={actionDisabledReason}
          data-testid={`working-${id}-action`}
          onClick={onAction}
        >
          {action[0]!.toLocaleUpperCase() + action.slice(1)}
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
            selectedKey={selectedKey}
            onSelect={(entry) => onSelect(entry.key)}
            rowTestId="working-change"
          />
        )}
      </div>
    </section>
  );
}

interface ChangePreviewProps {
  readonly change: RepositoryWorkingChange;
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
  change,
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
  const workingActions = useMemo<DiffWorkingAction[]>(() => {
    const actions: RepositoryWorkingChangeAction[] =
      change.area === 'staged'
        ? ['unstage']
        : change.area === 'unstaged'
          ? ['stage', ...(change.status === 'unmerged' ? [] : ['discard' as const])]
          : change.area === 'untracked'
            ? ['stage']
            : [];
    return actions.map((action) => ({
      action,
      disabled: busy,
      disabledReason: busy ? 'Another working-tree action is in progress.' : undefined,
      onApply: (selection) => onWorkingAction(action, selection, diff.value?.snapshot ?? undefined),
    }));
  }, [busy, change.area, change.status, diff.value?.snapshot, onWorkingAction]);
  return (
    <div className="file-preview" data-testid="working-change-preview">
      <div className="preview-header">
        <StatusBadge status={change.status} />
        <span className="preview-path" title={`${areaLabels[change.area]}: ${change.path}`}>
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
          label="Working tree diff"
        />
      </div>
    </div>
  );
}

interface ChangesViewProps {
  readonly repository: RepositorySummary;
  /** Increments when the user asks the application to refresh. */
  readonly refreshSignal: number;
  /** Lets a completed commit refresh the history, tabs, and repository summary. */
  readonly onCommitted: () => void;
}

export function ChangesView({ repository, refreshSignal, onCommitted }: ChangesViewProps) {
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
  const [selectedKey, setSelectedKey] = useState<string>();
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

  const selected = [...unstaged, ...staged].find((entry) => entry.key === selectedKey)?.change;
  const diffTarget = useMemo<RepositoryDiffTarget | undefined>(
    () =>
      selected
        ? {
            kind: 'working',
            area: selected.area,
            path: selected.path,
            previousPath: selected.previousPath,
          }
        : undefined,
    [selected],
  );
  const diff = useRepositoryDiff(repository.id, diffTarget, diffWhitespace);
  const refreshDiff = diff.refresh;
  const filtering = filter.trim().length > 0;

  const applyAction = useCallback(
    async (
      action: RepositoryWorkingChangeAction,
      target: RepositoryWorkingChangeTarget,
      selection: RepositoryWorkingChangeSelection,
      snapshot?: string,
    ): Promise<boolean> => {
      const api = window.desktop;
      if (!api) {
        setActionError('Open this application in Electron to change working-tree files.');
        return false;
      }
      setActionBusy(true);
      setActionError(undefined);
      try {
        let expectedSnapshot = snapshot;
        if (!expectedSnapshot) {
          const currentDiff = unwrapResult(
            await api.repository.getDiff({
              id: repository.id,
              target: { kind: 'working', ...target },
              whitespace: 'normal',
            }),
          );
          expectedSnapshot = currentDiff.snapshot ?? undefined;
        }
        if (!expectedSnapshot) throw new Error('That file does not have a mutable working-tree snapshot.');
        unwrapResult(
          await api.repository.applyWorkingChange({
            id: repository.id,
            action,
            target,
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

  const applyFileEntries = useCallback(
    async (action: RepositoryWorkingChangeAction, entries: readonly WorkingEntry[]) => {
      for (const entry of entries) {
        if (entry.change.area === 'ignored') continue;
        const succeeded = await applyAction(
          action,
          {
            area: entry.change.area,
            path: entry.change.path,
            previousPath: entry.change.previousPath,
          },
          { kind: 'file' },
        );
        if (!succeeded) break;
      }
    },
    [applyAction],
  );

  const stageEntries = useMemo(() => unstaged.filter((entry) => entry.change.area !== 'ignored'), [unstaged]);
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
          selectedKey={selectedKey}
          emptyText={status ?? (filtering ? 'No unstaged files match the filter.' : 'No unstaged changes.')}
          onSelect={setSelectedKey}
          onAction={() => void applyFileEntries('stage', stageEntries)}
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
          title="Staged"
          action="unstage"
          entries={staged}
          mode={mode}
          selectedKey={selectedKey}
          emptyText={status ?? (filtering ? 'No staged files match the filter.' : 'No staged changes.')}
          onSelect={setSelectedKey}
          onAction={() => void applyFileEntries('unstage', staged)}
          actionDisabled={actionBusy || loading || staged.length === 0}
          actionDisabledReason={staged.length === 0 ? 'There are no staged files to unstage.' : undefined}
        />
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
              change={selected}
              diff={diff}
              mode={diffMode}
              onModeChange={setDiffMode}
              whitespace={diffWhitespace}
              onWhitespaceChange={setDiffWhitespace}
              showWhitespace={showWhitespace}
              onShowWhitespaceChange={setShowWhitespace}
              busy={actionBusy}
              onWorkingAction={(action, selection, snapshot) =>
                applyAction(
                  action,
                  {
                    area: selected.area,
                    path: selected.path,
                    previousPath: selected.previousPath,
                  },
                  selection,
                  snapshot,
                )
              }
            />
          ) : (
            <p className="preview-empty">Select a file to see its changes.</p>
          )}
        </div>
        <CommitComposer
          repository={repository}
          changeToken={changeToken}
          stagedCount={value?.counts.staged ?? 0}
          conflictedCount={value?.counts.conflicted ?? 0}
          busy={actionBusy}
          onCommitted={onCommitted}
        />
      </div>
    </section>
  );
}
