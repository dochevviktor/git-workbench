import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { repositorySessionMap } from '../lib/repository-session';
import { IssueLinks } from './IssueLinks';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type {
  RepositoryCommitChange,
  RepositoryHistoryCommit,
  RepositoryHistoryPerson,
  RepositoryHistoryReference,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
} from '../../../common/ipc/contracts';
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import { useRepositoryDiff } from '../hooks/use-repository-diff';
import { useRevisionInspection } from '../hooks/use-revision-inspection';
import type { RevisionInspection } from '../hooks/use-revision-inspection';
import { useRepositoryLfs } from '../hooks/use-repository-lfs';
import { changeDetail, statusBadge } from '../lib/change-status';
import {
  avatarColor,
  countLabel,
  formatDetailDate,
  formatListDate,
  initials,
  shortHash,
} from '../lib/format';
import { referenceChips } from '../lib/references';
import { CodePreview } from './CodePreview';
import { DiffViewer } from './DiffViewer';
import type { DiffDisplayMode } from './DiffViewer';
import { FileChangeList } from './FileChangeList';
import type { FileChangeEntry, FileListMode } from './FileChangeList';
import { FileIcon, FolderIcon, ListOptionsIcon, SearchIcon, PopOutIcon, DetailsPanelIcon } from './Icons';
import { unwrapResult } from '../../../common/ipc/result';
import { SignatureCheck } from './SigningControls';
import { ReferenceChipList } from './ReferenceChipList';
import { Splitter } from './Splitter';
import { SearchMatch } from './SearchMatch';
import { StatusBadge } from './StatusBadge';
import { TreeView } from './TreeView';
import type { TreeItem } from './TreeView';
import { MenuButton } from './menu/MenuButton';
import { useContextMenu } from './menu/context-menu';
import { compactMenu, contextMenuAnchor, menuSeparator } from './menu/menu-model';
import { useExternalTools } from './external-tools-context';
import { copyText } from '../lib/clipboard';

type DetailTab = 'commit' | 'changes' | 'tree';
interface DetailPresentation {
  readonly activeTab: DetailTab;
  readonly commitId: string | undefined;
  readonly selectedChangeKey: string | undefined;
  readonly fileFilter: string;
  readonly treeActiveKey: string | undefined;
  readonly expandedFolders: ReadonlySet<string>;
}
const detailPresentations = repositorySessionMap<DetailPresentation>();

const fileListModes = ['tree', 'list'] as const;
const diffDisplayModes = ['unified', 'split'] as const;
const diffWhitespaceModes = ['normal', 'ignore-all', 'ignore-space-change', 'ignore-space-at-eol'] as const;
/** Changed files load shortly after selection so moving through the list does not request every commit. */
const changesDelayMs = 120;

interface CommitDetailsProps {
  readonly repositoryId: string | undefined;
  readonly commit: RepositoryHistoryCommit | undefined;
  readonly lane: number | undefined;
  readonly referencesByName: ReadonlyMap<string, RepositoryHistoryReference>;
  readonly loadedCommitIds: ReadonlySet<string>;
  readonly onSelectCommit: (id: string) => void;
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  readonly standalone?: boolean;
  readonly initialTab?: DetailTab;
  readonly initialPath?: string | undefined;
  readonly searchQuery?: string;
}

function Person({ caption, person }: { readonly caption: string; readonly person: RepositoryHistoryPerson }) {
  return (
    <div className="details-person">
      <span className="details-caption">{caption}</span>
      <div className="details-person-body">
        <span
          className={`avatar large avatar-${avatarColor(person.email || person.name)}`}
          aria-hidden="true"
        >
          {initials(person.name, person.email)}
        </span>
        <div className="details-person-copy">
          <div>
            <strong>{person.name || 'Unknown'}</strong> <span className="muted">{person.email}</span>
          </div>
          <time className="muted" dateTime={person.date}>
            {formatDetailDate(person.date)}
          </time>
        </div>
      </div>
    </div>
  );
}

function samePerson(left: RepositoryHistoryPerson, right: RepositoryHistoryPerson): boolean {
  return left.name === right.name && left.email === right.email && left.date === right.date;
}

function changeKey(change: RepositoryCommitChange): string {
  return `change:${encodeURIComponent(change.previousPath ?? '')}:${encodeURIComponent(change.path)}`;
}

function changeEntriesAvailable(
  changes: readonly RepositoryCommitChange[],
  filter: string,
  selected: string | undefined,
): boolean {
  const needle = filter.trim().toLocaleLowerCase();
  return (
    changes.some((change) => !needle || change.path.toLocaleLowerCase().includes(needle)) &&
    !changes.some(
      (change) =>
        changeKey(change) === selected && (!needle || change.path.toLocaleLowerCase().includes(needle)),
    )
  );
}

/** The one-line commit summary above the Changes and File Tree views. */
function CommitSummary({ commit }: { readonly commit: RepositoryHistoryCommit }) {
  return (
    <div className="details-summary" title={commit.subject}>
      <span
        className={`avatar avatar-${avatarColor(commit.author.email || commit.author.name)}`}
        aria-hidden="true"
      >
        {initials(commit.author.name, commit.author.email)}
      </span>
      <span className="details-summary-author">{commit.author.name || commit.author.email}</span>
      <code className="details-summary-sha">{shortHash(commit.id)}</code>
      <time className="details-summary-date" dateTime={commit.author.date}>
        {formatListDate(commit.author.date)}
      </time>
      <span className="details-summary-subject">{commit.subject || '(no subject)'}</span>
    </div>
  );
}

interface ChangeFactsProps {
  readonly positionKey: string;
  readonly change: RepositoryCommitChange;
  readonly diff: ReturnType<typeof useRepositoryDiff>;
  readonly mode: DiffDisplayMode;
  readonly onModeChange: (mode: DiffDisplayMode) => void;
  readonly whitespace: RepositoryDiffWhitespace;
  readonly onWhitespaceChange: (whitespace: RepositoryDiffWhitespace) => void;
  readonly showWhitespace: boolean;
  readonly onShowWhitespaceChange: (show: boolean) => void;
  readonly lfs: ReturnType<typeof useRepositoryLfs>;
}

function lfsSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB (${bytes.toLocaleString()} B)`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString()} B)`;
  return `${bytes.toLocaleString()} B`;
}

interface LfsPayloadCardProps {
  readonly path: string;
  readonly lfs: ReturnType<typeof useRepositoryLfs>;
}

function LfsPayloadCard({ path, lfs }: LfsPayloadCardProps) {
  const file = lfs.lfs;
  const history = file?.history.kind === 'lfs' ? file.history : undefined;
  const operation = lfs.saveOperation;
  const running = operation?.status === 'running';
  const canSave = history?.payloadState === 'available' && !running;
  const saveLabel = running
    ? operation?.progress
      ? `${operation.progress.phase}${
          operation.progress.percent === null ? '' : ` ${operation.progress.percent}%`
        }`
      : 'Retrieving…'
    : operation?.status === 'succeeded'
      ? operation.message
      : operation?.status === 'failed'
        ? operation.message
        : undefined;

  return (
    <div className="lfs-preview" data-testid="lfs-file-card" aria-live="polite">
      <div className="preview-header">
        <span className="lfs-badge">LFS</span>
        <span className="preview-path" title={path}>
          {path}
        </span>
      </div>
      {lfs.loading ? (
        <p className="preview-note">Inspecting Git LFS metadata…</p>
      ) : lfs.error ? (
        <p className="preview-note" role="alert">
          {lfs.error}
        </p>
      ) : history ? (
        <div className="lfs-card-body">
          <span className="lfs-card-state">created</span>
          <FileIcon size={34} />
          <strong>{lfsSizeLabel(history.pointer.size)}</strong>
          <MenuButton
            className="pane-icon-button"
            aria-label="LFS payload options"
            title="LFS payload options"
            menuLabel="LFS payload options"
            items={[
              {
                id: 'save-as',
                label: 'Save As…',
                disabled: !canSave,
                disabledReason:
                  history.payloadState === 'missing'
                    ? 'The payload is not available in the local LFS cache.'
                    : history.payloadState === 'invalid'
                      ? 'The local payload does not match the pointer size.'
                      : running
                        ? 'The payload is already being retrieved.'
                        : undefined,
                run: () => void lfs.saveAs(),
              },
            ]}
          >
            <span className="lfs-size-menu-mark" aria-hidden="true">
              ⋮
            </span>
          </MenuButton>
          {saveLabel && <span className="lfs-card-status">{saveLabel}</span>}
          {lfs.saveError && (
            <span className="lfs-card-status error" role="alert">
              {lfs.saveError}
            </span>
          )}
          {history.payloadState !== 'available' && !saveLabel && (
            <span className="lfs-card-status">
              {history.payloadState === 'missing'
                ? 'Payload not available locally; network retrieval is not enabled here.'
                : 'Local payload size does not match the pointer.'}
            </span>
          )}
          {file?.worktree.state === 'pointer' && (
            <span className="lfs-card-status">Working tree remains a pointer.</span>
          )}
        </div>
      ) : (
        <p className="preview-note">This historical file is not a Git LFS pointer.</p>
      )}
    </div>
  );
}

function ChangeFacts({
  positionKey,
  change,
  diff,
  mode,
  onModeChange,
  whitespace,
  onWhitespaceChange,
  showWhitespace,
  onShowWhitespaceChange,
  lfs,
}: ChangeFactsProps) {
  const badge = statusBadge(change.status);
  const detail = changeDetail(change);
  return (
    <div className="file-preview" data-testid="commit-change-preview">
      <div className="preview-header">
        <StatusBadge status={change.status} />
        <span className="preview-path" title={`${badge.label}: ${change.path}`}>
          {change.path}
        </span>
        {detail && <span className="preview-detail">{detail}</span>}
      </div>
      <div className="preview-body diff-preview-body">
        {lfs.loading || lfs.error || lfs.lfs?.history.kind === 'lfs' ? (
          <LfsPayloadCard path={change.path} lfs={lfs} />
        ) : (
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
            label="Committed change diff"
            controls={diff.controls}
            positionKey={positionKey}
          />
        )}
      </div>
    </div>
  );
}

function RetryAlert({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="inline-alert" role="alert">
      <span>{message}</span>
      <button type="button" className="button button-small" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

interface RevisionTreeProps {
  readonly inspection: RevisionInspection;
  readonly expanded: ReadonlySet<string>;
  readonly activeKey: string | undefined;
  readonly onActiveChange: (key: string) => void;
  readonly onExpandedChange: (next: ReadonlySet<string>) => void;
  readonly onContextMenu: (path: string, event: ReactMouseEvent<HTMLElement>) => void;
}

function RevisionTree({
  inspection,
  expanded,
  activeKey,
  onActiveChange,
  onExpandedChange,
  onContextMenu,
}: RevisionTreeProps) {
  const { directories, loadDirectory, loadBlob, blobPath, blobLoading } = inspection;
  const { items, entries } = useMemo(() => {
    const rows: TreeItem[] = [];
    const byKey = new Map<string, { readonly path: string; readonly type: string }>();
    const visit = (path: string, level: number, parentKey: string | null) => {
      const directory = directories.get(path);
      if (directory?.status !== 'loaded') return;
      // Folders are listed before files, each group by name.
      const sorted = [...directory.tree.entries].sort(
        (left, right) =>
          Number(right.type === 'tree') - Number(left.type === 'tree') || left.name.localeCompare(right.name),
      );
      for (const entry of sorted) {
        const key = `tree:${encodeURIComponent(entry.path)}`;
        const folder = entry.type === 'tree';
        const open = folder && expanded.has(entry.path);
        const child = folder ? directories.get(entry.path) : undefined;
        byKey.set(key, entry);
        rows.push({
          key,
          level,
          label: entry.name,
          icon: folder ? <FolderIcon size={14} /> : <FileIcon size={14} />,
          meta:
            child?.status === 'loading'
              ? 'Loading…'
              : child?.status === 'error'
                ? 'Unavailable'
                : child?.status === 'loaded' && child.tree.truncated
                  ? 'Truncated'
                  : entry.type === 'commit'
                    ? 'Submodule'
                    : undefined,
          expandable: folder,
          expanded: open,
          parentKey,
          className: folder ? 'revision-folder' : 'revision-file',
          title: child?.status === 'error' ? child.message : entry.path,
          unavailable: entry.type === 'commit' || entry.type === 'unknown',
          testId: 'revision-tree-entry',
        });
        if (open) visit(entry.path, level + 1, key);
      }
    };
    visit('', 1, null);
    return { items: rows, entries: byKey };
  }, [directories, expanded]);

  useEffect(() => {
    const entry = activeKey ? entries.get(activeKey) : undefined;
    if (entry?.type === 'blob' && blobPath !== entry.path && !blobLoading) void loadBlob(entry.path);
  }, [activeKey, blobLoading, blobPath, entries, loadBlob]);

  const root = directories.get('');
  if (!root || root.status === 'loading') return <p className="details-empty">Reading the revision tree…</p>;
  if (root.status === 'error')
    return <RetryAlert message={root.message} onRetry={() => void loadDirectory('')} />;
  if (root.tree.entries.length === 0) return <p className="details-empty">This revision has no files.</p>;

  return (
    <TreeView
      className="revision-file-tree"
      items={items}
      label="Files at revision"
      idPrefix="revision-tree"
      activeKey={activeKey}
      onActiveChange={(key) => {
        onActiveChange(key);
        const entry = entries.get(key);
        if (entry?.type === 'blob') void loadBlob(entry.path);
      }}
      onToggle={(item, expand) => {
        const entry = entries.get(item.key);
        if (!entry || entry.type !== 'tree') return;
        const next = new Set(expanded);
        if (expand) {
          next.add(entry.path);
          const state = directories.get(entry.path);
          if (!state || state.status === 'error') void loadDirectory(entry.path);
        } else {
          next.delete(entry.path);
        }
        onExpandedChange(next);
      }}
      onContextMenu={(item, event) => {
        const entry = entries.get(item.key);
        if (entry?.type === 'blob') onContextMenu(entry.path, event);
      }}
    >
      {root.tree.truncated && (
        <p className="sidebar-note">This folder contains more entries than can be displayed.</p>
      )}
    </TreeView>
  );
}

export function CommitDetails({
  repositoryId,
  commit,
  lane,
  referencesByName,
  loadedCommitIds,
  onSelectCommit,
  collapsed = false,
  onCollapsedChange,
  standalone = false,
  initialTab,
  initialPath,
  searchQuery = '',
}: CommitDetailsProps) {
  const savedPresentation = detailPresentations.get(repositoryId ?? '');
  const externalTools = useExternalTools();
  const showContextMenu = useContextMenu();
  const [activeTab, setActiveTab] = useState<DetailTab>(
    initialTab ?? savedPresentation?.activeTab ?? 'commit',
  );
  const [popOutError, setPopOutError] = useState<string>();
  const [fileInspectorError, setFileInspectorError] = useState<string>();
  const [openingPopOut, setOpeningPopOut] = useState(false);
  const [fileListMode, setFileListMode] = usePersistentState<FileListMode>(
    'details.fileListMode',
    'tree',
    isOneOf(fileListModes),
  );
  const [fileListWidth, setFileListWidth] = usePersistentState(
    'details.fileListWidth',
    340,
    isNumberBetween(160, 1600),
  );
  const [fileFilter, setFileFilter] = useState(savedPresentation?.fileFilter ?? '');
  const [selectedChangeKey, setSelectedChangeKey] = useState<string>();
  const [diffMode, setDiffMode] = usePersistentState<DiffDisplayMode>(
    'details.diff.mode',
    'unified',
    isOneOf(diffDisplayModes),
  );
  const [diffWhitespace, setDiffWhitespace] = usePersistentState<RepositoryDiffWhitespace>(
    'details.diff.whitespace',
    'normal',
    isOneOf(diffWhitespaceModes),
  );
  const [showWhitespace, setShowWhitespace] = usePersistentState(
    'details.diff.showWhitespace',
    false,
    (candidate): candidate is boolean => typeof candidate === 'boolean',
  );
  const [treeActiveKey, setTreeActiveKey] = useState<string>();
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const inspection = useRevisionInspection(repositoryId, commit?.id);
  const { changes, changesLoading, changesError, loadChanges, directories, loadDirectory } = inspection;
  const chips = commit ? referenceChips(commit.decorations, referencesByName) : [];
  const presentation = useRef<DetailPresentation | undefined>(undefined);

  const openFileContextMenu = useCallback(
    (path: string, event: ReactMouseEvent<HTMLElement>) => {
      if (standalone || !repositoryId || !commit) return;
      event.preventDefault();
      showContextMenu({
        anchor: contextMenuAnchor(event, event.currentTarget),
        label: `File ${path}`,
        items: compactMenu([
          ...externalTools.items(repositoryId, { kind: 'revision', path, commitId: commit.id, line: 1 }),
          {
            id: 'file-history',
            label: 'History…',
            run: () => {
              const theme = document.documentElement.dataset.theme;
              void window.desktop?.repository
                .openFileHistory({
                  id: repositoryId,
                  commitId: commit.id,
                  path,
                  theme: theme === 'dark' || theme === 'light' ? theme : 'system',
                })
                .then(unwrapResult)
                .catch((reason: unknown) =>
                  setFileInspectorError(
                    reason instanceof Error ? reason.message : 'File history could not be opened.',
                  ),
                );
            },
          },
          {
            id: 'file-blame',
            label: 'Blame / Timeline',
            run: () => {
              const theme = document.documentElement.dataset.theme;
              void window.desktop?.repository
                .openBlame({
                  id: repositoryId,
                  commitId: commit.id,
                  path,
                  theme: theme === 'dark' || theme === 'light' ? theme : 'system',
                })
                .then(unwrapResult)
                .catch((reason: unknown) =>
                  setFileInspectorError(
                    reason instanceof Error ? reason.message : 'Blame could not be opened.',
                  ),
                );
            },
          },
          menuSeparator,
          { id: 'copy-file-path', label: 'Copy Path', run: () => copyText(path) },
        ]),
      });
    },
    [commit, repositoryId, showContextMenu, standalone, externalTools],
  );

  useEffect(() => {
    if (commit)
      presentation.current = {
        activeTab,
        commitId: commit.id,
        selectedChangeKey,
        fileFilter,
        treeActiveKey,
        expandedFolders,
      };
  }, [activeTab, commit, expandedFolders, fileFilter, selectedChangeKey, treeActiveKey]);

  useEffect(
    () => () => {
      if (repositoryId && presentation.current) detailPresentations.set(repositoryId, presentation.current);
    },
    [repositoryId],
  );

  useEffect(() => {
    const saved = detailPresentations.get(repositoryId ?? '');
    const restore = saved?.commitId === commit?.id ? saved : undefined;
    setSelectedChangeKey(restore?.selectedChangeKey);
    setTreeActiveKey(
      restore?.treeActiveKey ?? (initialPath ? `tree:${encodeURIComponent(initialPath)}` : undefined),
    );
    const parents = initialPath?.split('/').slice(0, -1) ?? [];
    setExpandedFolders(
      restore?.expandedFolders ??
        new Set(parents.map((_part, index) => parents.slice(0, index + 1).join('/'))),
    );
  }, [commit?.id, repositoryId, initialPath]);

  useEffect(() => {
    if (!commit || activeTab === 'tree' || changes || changesLoading || changesError) return;
    const timer = window.setTimeout(() => void loadChanges(), changesDelayMs);
    return () => window.clearTimeout(timer);
  }, [activeTab, changes, changesError, changesLoading, commit, loadChanges]);

  useEffect(() => {
    if (activeTab === 'tree' && commit && !directories.has('')) void loadDirectory('');
    if (activeTab === 'tree' && commit) {
      for (const path of expandedFolders) if (!directories.has(path)) void loadDirectory(path);
    }
  }, [activeTab, commit, directories, expandedFolders, loadDirectory]);

  useEffect(() => {
    if (
      activeTab === 'changes' &&
      changes &&
      changeEntriesAvailable(changes.changes, fileFilter, selectedChangeKey)
    ) {
      const first =
        changes.changes.find((change) => initialPath && change.path === initialPath) ??
        changes.changes.find(
          (change) =>
            !fileFilter.trim() ||
            change.path.toLocaleLowerCase().includes(fileFilter.trim().toLocaleLowerCase()),
        );
      if (first) setSelectedChangeKey(changeKey(first));
    }
  }, [activeTab, changes, fileFilter, selectedChangeKey, initialPath]);

  const changeEntries = useMemo<FileChangeEntry[]>(() => {
    const filter = fileFilter.trim().toLocaleLowerCase();
    return (changes?.changes ?? [])
      .filter((change) => !filter || change.path.toLocaleLowerCase().includes(filter))
      .map((change) => ({
        key: changeKey(change),
        status: change.status,
        path: change.path,
        previousPath: change.previousPath,
        detail: change.previousPath ? `from ${change.previousPath}` : undefined,
      }));
  }, [changes, fileFilter]);
  const selectedChange = changes?.changes.find((change) => changeKey(change) === selectedChangeKey);
  const changeLfs = useRepositoryLfs(repositoryId, commit?.id, selectedChange?.path);
  const treeLfs = useRepositoryLfs(repositoryId, commit?.id, inspection.blobPath);
  const diffTarget = useMemo<RepositoryDiffTarget | undefined>(
    () =>
      commit && selectedChange
        ? {
            kind: 'commit',
            commitId: commit.id,
            path: selectedChange.path,
            previousPath: selectedChange.previousPath,
          }
        : undefined,
    [commit, selectedChange],
  );
  const diff = useRepositoryDiff(repositoryId, diffTarget, diffWhitespace);

  const renderChangesStatus = () => {
    if (changesError) return <RetryAlert message={changesError} onRetry={() => void loadChanges()} />;
    if (!changes) return <p className="details-empty">Reading changed files…</p>;
    return null;
  };

  const renderCommit = () =>
    !commit ? (
      <p className="details-empty">Select a commit to inspect its metadata and message.</p>
    ) : (
      <div className="details-content">
        <div className="details-people">
          <Person caption="Author" person={commit.author} />
          {!samePerson(commit.author, commit.committer) && (
            <Person caption="Committer" person={commit.committer} />
          )}
        </div>
        <dl className="details-fields">
          {chips.length > 0 && (
            <>
              <dt>Refs</dt>
              <dd>
                <ReferenceChipList chips={chips} lane={lane ?? 0} />
              </dd>
            </>
          )}
          <dt>SHA</dt>
          <dd>
            <code className="history-full-hash">{commit.id}</code>
          </dd>
          <dt>GPG</dt>
          <dd>
            {repositoryId && (
              <SignatureCheck
                key={`${repositoryId}:${commit.id}`}
                repositoryId={repositoryId}
                objectId={commit.id}
                kind="commit"
              />
            )}
          </dd>
          <dt>Parents</dt>
          <dd className="details-parents">
            {commit.parents.length === 0
              ? 'None (root commit)'
              : commit.parents.map((parent) => {
                  const loaded = loadedCommitIds.has(parent);
                  return (
                    <button
                      key={parent}
                      type="button"
                      className="link-button"
                      title={loaded ? parent : `Load and select parent ${parent}`}
                      onClick={() => onSelectCommit(parent)}
                    >
                      {shortHash(parent)}
                    </button>
                  );
                })}
          </dd>
        </dl>
        <div className="details-message">
          <IssueLinks repositoryId={repositoryId} message={`${commit.subject}\n${commit.body}`} />
          <h2>
            <SearchMatch text={commit.subject || '(no subject)'} query={searchQuery} />
          </h2>
          {commit.body && (
            <p className="details-message-body">
              <SearchMatch text={commit.body} query={searchQuery} />
            </p>
          )}
        </div>
        <div className="details-files">
          {renderChangesStatus()}
          {changes && changes.changes.length === 0 && (
            <p className="details-empty">No files changed in this commit.</p>
          )}
          {changes && changes.changes.length > 0 && (
            <ul className="details-file-list" aria-label={countLabel(changes.changes.length, 'changed file')}>
              {changes.changes.map((change) => (
                <li
                  key={changeKey(change)}
                  className="details-file"
                  data-testid="commit-file"
                  onContextMenu={(event) => openFileContextMenu(change.path, event)}
                >
                  <StatusBadge status={change.status} />
                  <FileIcon size={14} />
                  <button
                    type="button"
                    className="details-file-path"
                    title="Show in Changes"
                    onClick={() => {
                      setSelectedChangeKey(changeKey(change));
                      setActiveTab('changes');
                    }}
                  >
                    {change.previousPath && <span className="muted">{change.previousPath} → </span>}
                    {change.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {changes?.truncated && <p className="details-empty">The changed file list is truncated.</p>}
        </div>
      </div>
    );

  const splitStyle = { '--file-list-width': `${fileListWidth}px` } as CSSProperties;
  const splitter = (
    <Splitter
      orientation="vertical"
      label="Resize file list"
      value={fileListWidth}
      minimum={160}
      maximum={1600}
      onChange={setFileListWidth}
    />
  );

  const renderChanges = () =>
    commit && (
      <>
        <CommitSummary commit={commit} />
        <div className="details-split" style={splitStyle}>
          <div className="file-pane">
            <div className="pane-strip">
              <label className="pane-filter">
                <SearchIcon size={12} />
                <input
                  type="search"
                  value={fileFilter}
                  placeholder="Filter"
                  aria-label="Filter changed files"
                  spellCheck={false}
                  onChange={(event) => setFileFilter(event.target.value)}
                />
              </label>
              <MenuButton
                className="pane-icon-button"
                aria-label="File list options"
                title="File list options"
                menuLabel="File list options"
                items={[
                  {
                    id: 'view-tree',
                    label: 'View as Tree',
                    checkable: 'radio',
                    checked: fileListMode === 'tree',
                    run: () => setFileListMode('tree'),
                  },
                  {
                    id: 'view-list',
                    label: 'View as List',
                    checkable: 'radio',
                    checked: fileListMode === 'list',
                    run: () => setFileListMode('list'),
                  },
                ]}
              >
                <ListOptionsIcon size={14} />
              </MenuButton>
            </div>
            <div className="file-pane-body" data-testid="commit-changes">
              {renderChangesStatus()}
              {changes && changes.changes.length === 0 && (
                <p className="details-empty">No files changed in this commit.</p>
              )}
              {changes && changes.changes.length > 0 && (
                <FileChangeList
                  entries={changeEntries}
                  mode={fileListMode}
                  label="Changed files"
                  idPrefix="commit-change"
                  selectedKey={selectedChangeKey}
                  onSelect={(entry) => setSelectedChangeKey(entry.key)}
                  onContextMenu={(entry, event) => openFileContextMenu(entry.path, event)}
                  rowTestId="commit-change"
                >
                  {changeEntries.length === 0 && (
                    <p className="sidebar-note">No changed files match “{fileFilter.trim()}”.</p>
                  )}
                  {changes.truncated && <p className="sidebar-note">The changed file list is truncated.</p>}
                </FileChangeList>
              )}
            </div>
          </div>
          {splitter}
          <div className="preview-pane">
            {selectedChange ? (
              <ChangeFacts
                positionKey={`commit:${repositoryId}:${commit.id}:${selectedChange.path}`}
                change={selectedChange}
                diff={diff}
                mode={diffMode}
                onModeChange={setDiffMode}
                whitespace={diffWhitespace}
                onWhitespaceChange={setDiffWhitespace}
                showWhitespace={showWhitespace}
                onShowWhitespaceChange={setShowWhitespace}
                lfs={changeLfs}
              />
            ) : (
              <p className="preview-empty">Select a file to see how it changed.</p>
            )}
          </div>
        </div>
      </>
    );

  const renderTree = () => {
    if (!commit) return null;
    const { blob, blobPath, blobLoading, blobError, loadBlob } = inspection;
    const isLfs = treeLfs.lfs?.history.kind === 'lfs' || treeLfs.loading || Boolean(treeLfs.error);
    return (
      <>
        <CommitSummary commit={commit} />
        <div className="details-split" style={splitStyle}>
          <div className="file-pane">
            <div className="file-pane-body">
              <RevisionTree
                inspection={inspection}
                expanded={expandedFolders}
                activeKey={treeActiveKey}
                onActiveChange={setTreeActiveKey}
                onExpandedChange={setExpandedFolders}
                onContextMenu={openFileContextMenu}
              />
            </div>
          </div>
          {splitter}
          <div className="preview-pane">
            {!blobPath ? (
              <p className="preview-empty">Select a file to show its contents at this commit.</p>
            ) : (
              <div className="file-preview" aria-live="polite">
                <div className="preview-header">
                  <FileIcon size={14} />
                  <span className="preview-path" title={blobPath}>
                    {blobPath}
                  </span>
                  {blob && <span className="preview-size">{countLabel(blob.byteLength, 'byte')}</span>}
                </div>
                {isLfs ? (
                  <LfsPayloadCard path={blobPath} lfs={treeLfs} />
                ) : blobLoading ? (
                  <p className="preview-note">Reading file…</p>
                ) : blobError ? (
                  <RetryAlert message={blobError} onRetry={() => void loadBlob(blobPath)} />
                ) : blob?.state === 'binary' ? (
                  <p className="preview-note">This file is binary and has no text preview.</p>
                ) : blob?.state === 'too-large' ? (
                  <p className="preview-note">This file is too large for an inline preview.</p>
                ) : blob ? (
                  <CodePreview content={blob.content} testId="revision-blob" />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </>
    );
  };

  const tabs: readonly { readonly id: DetailTab; readonly label: string }[] = [
    { id: 'commit', label: 'Commit' },
    { id: 'changes', label: 'Changes' },
    { id: 'tree', label: 'File Tree' },
  ];
  const panel =
    activeTab === 'commit' ? renderCommit() : activeTab === 'changes' ? renderChanges() : renderTree();

  return (
    <section
      className={collapsed ? 'commit-details details-collapsed' : 'commit-details'}
      aria-label="Commit details"
    >
      <div className="details-header">
        <div className="details-tabs" role="tablist" aria-label="Commit detail views">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`commit-detail-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`commit-detail-panel-${tab.id}`}
              className={activeTab === tab.id ? 'details-tab active' : 'details-tab'}
              disabled={!commit && tab.id !== 'commit'}
              onClick={() => {
                setActiveTab(tab.id);
                if (collapsed) onCollapsedChange?.(false);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {!standalone && (
          <div className="details-controls">
            <button
              type="button"
              className="pane-icon-button"
              aria-label="Pop out commit details"
              title="Pop out commit details"
              disabled={!repositoryId || !commit || openingPopOut}
              onClick={() => {
                if (!repositoryId || !commit || !window.desktop) return;
                setOpeningPopOut(true);
                setPopOutError(undefined);
                const theme = document.documentElement.dataset.theme;
                void window.desktop.repository
                  .openCommitDetails({
                    id: repositoryId,
                    commitId: commit.id,
                    tab: activeTab,
                    path:
                      activeTab === 'changes'
                        ? selectedChange?.path
                        : activeTab === 'tree'
                          ? inspection.blobPath
                          : undefined,
                    theme: theme === 'dark' || theme === 'light' ? theme : 'system',
                  })
                  .then(unwrapResult)
                  .catch((reason: unknown) =>
                    setPopOutError(
                      reason instanceof Error ? reason.message : 'Commit details could not be opened.',
                    ),
                  )
                  .finally(() => setOpeningPopOut(false));
              }}
            >
              <PopOutIcon size={14} />
            </button>
            {onCollapsedChange && (
              <button
                type="button"
                className="pane-icon-button"
                aria-label={collapsed ? 'Show commit details' : 'Hide commit details'}
                title={
                  collapsed ? 'Show commit details (Ctrl+Shift+D)' : 'Hide commit details (Ctrl+Shift+D)'
                }
                aria-expanded={!collapsed}
                onClick={() => onCollapsedChange(!collapsed)}
              >
                <DetailsPanelIcon size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      {popOutError && (
        <div className="inline-alert" role="alert">
          {popOutError}
        </div>
      )}
      {fileInspectorError && (
        <div className="inline-alert" role="alert">
          <span>{fileInspectorError}</span>
          <button
            type="button"
            className="button button-small"
            onClick={() => setFileInspectorError(undefined)}
          >
            Dismiss
          </button>
        </div>
      )}
      <div
        id={`commit-detail-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`commit-detail-tab-${activeTab}`}
        className={`details-panel ${activeTab}`}
        hidden={collapsed}
      >
        {panel}
      </div>
    </section>
  );
}
