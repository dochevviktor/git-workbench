import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  RepositoryCommitChange,
  RepositoryHistoryCommit,
  RepositoryHistoryPerson,
  RepositoryHistoryReference,
} from '../../../common/ipc/contracts';
import { isNumberBetween, isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import { useRevisionInspection } from '../hooks/use-revision-inspection';
import type { RevisionInspection } from '../hooks/use-revision-inspection';
import { statusBadge } from '../lib/change-status';
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
import { FileChangeList } from './FileChangeList';
import type { FileChangeEntry, FileListMode } from './FileChangeList';
import { FileIcon, FolderIcon, ListOptionsIcon, SearchIcon } from './Icons';
import { ReferenceChipList } from './ReferenceChipList';
import { Splitter } from './Splitter';
import { StatusBadge } from './StatusBadge';
import { TreeView } from './TreeView';
import type { TreeItem } from './TreeView';
import { MenuButton } from './menu/MenuButton';

type DetailTab = 'commit' | 'changes' | 'tree';

const fileListModes = ['tree', 'list'] as const;
/** Changed files load shortly after selection so moving through the list does not request every commit. */
const changesDelayMs = 120;

interface CommitDetailsProps {
  readonly repositoryId: string | undefined;
  readonly commit: RepositoryHistoryCommit | undefined;
  readonly lane: number | undefined;
  readonly referencesByName: ReadonlyMap<string, RepositoryHistoryReference>;
  readonly loadedCommitIds: ReadonlySet<string>;
  readonly onSelectCommit: (id: string) => void;
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

function ChangeFacts({ change }: { readonly change: RepositoryCommitChange }) {
  const badge = statusBadge(change.status);
  const modeChanged = change.oldMode !== null && change.newMode !== null && change.oldMode !== change.newMode;
  return (
    <div className="file-preview" data-testid="commit-change-preview">
      <div className="preview-header">
        <StatusBadge status={change.status} />
        <span className="preview-path" title={change.path}>
          {change.path}
        </span>
      </div>
      <div className="preview-body">
        <dl className="preview-facts">
          <dt>Status</dt>
          <dd>
            {badge.label}
            {change.similarity !== null ? ` (${change.similarity}% similar)` : ''}
          </dd>
          {change.previousPath && (
            <>
              <dt>Previous path</dt>
              <dd>
                <code>{change.previousPath}</code>
              </dd>
            </>
          )}
          {modeChanged && (
            <>
              <dt>Mode</dt>
              <dd>
                <code>{change.oldMode}</code> → <code>{change.newMode}</code>
              </dd>
            </>
          )}
          {(change.oldObjectId || change.newObjectId) && (
            <>
              <dt>Blob</dt>
              <dd>
                <code>{change.oldObjectId ? shortHash(change.oldObjectId) : 'none'}</code> →{' '}
                <code>{change.newObjectId ? shortHash(change.newObjectId) : 'none'}</code>
              </dd>
            </>
          )}
        </dl>
        <p className="preview-note">Diff rendering is not available yet (planned for P04).</p>
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
}

function RevisionTree({
  inspection,
  expanded,
  activeKey,
  onActiveChange,
  onExpandedChange,
}: RevisionTreeProps) {
  const { directories, loadDirectory, loadBlob } = inspection;
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
}: CommitDetailsProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('commit');
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
  const [fileFilter, setFileFilter] = useState('');
  const [selectedChangeKey, setSelectedChangeKey] = useState<string>();
  const [treeActiveKey, setTreeActiveKey] = useState<string>();
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const inspection = useRevisionInspection(repositoryId, commit?.id);
  const { changes, changesLoading, changesError, loadChanges, directories, loadDirectory } = inspection;
  const chips = commit ? referenceChips(commit.decorations, referencesByName) : [];

  useEffect(() => {
    setSelectedChangeKey(undefined);
    setTreeActiveKey(undefined);
    setExpandedFolders(new Set());
  }, [commit?.id, repositoryId]);

  useEffect(() => {
    if (!commit || activeTab === 'tree' || changes || changesLoading || changesError) return;
    const timer = window.setTimeout(() => void loadChanges(), changesDelayMs);
    return () => window.clearTimeout(timer);
  }, [activeTab, changes, changesError, changesLoading, commit, loadChanges]);

  useEffect(() => {
    if (activeTab === 'tree' && commit && !directories.has('')) void loadDirectory('');
  }, [activeTab, commit, directories, loadDirectory]);

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
                      aria-disabled={loaded ? undefined : true}
                      title={loaded ? parent : `${parent} is not loaded in the commit list yet.`}
                      onClick={() => {
                        if (loaded) onSelectCommit(parent);
                      }}
                    >
                      {shortHash(parent)}
                    </button>
                  );
                })}
          </dd>
        </dl>
        <div className="details-message">
          <h2>{commit.subject || '(no subject)'}</h2>
          {commit.body && <p className="details-message-body">{commit.body}</p>}
        </div>
        <div className="details-files">
          {renderChangesStatus()}
          {changes && changes.changes.length === 0 && (
            <p className="details-empty">No files changed in this commit.</p>
          )}
          {changes && changes.changes.length > 0 && (
            <ul className="details-file-list" aria-label={countLabel(changes.changes.length, 'changed file')}>
              {changes.changes.map((change) => (
                <li key={changeKey(change)} className="details-file" data-testid="commit-file">
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
              <ChangeFacts change={selectedChange} />
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
                {blobLoading ? (
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
    <section className="commit-details" aria-label="Commit details">
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
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`commit-detail-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`commit-detail-tab-${activeTab}`}
        className={`details-panel ${activeTab}`}
      >
        {panel}
      </div>
    </section>
  );
}
