import { useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type {
  GitInfo,
  RecentRepository,
  RepositoryLocation,
  RepositoryManagerFolder,
  RepositoryManagerRepository,
  RepositoryManagerSnapshot,
  RepositoryManagerSourceDirectory,
  RepositoryGroup,
  RepositoryManagerAction,
  RepositoryManagerScan,
  WorkspaceRecovery as Recovery,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { ManagerRepositorySummary } from './ManagerRepositorySummary';
import { WorkspaceRecovery } from './WorkspaceRecovery';
import { RepositoryManagerEditor } from './RepositoryManagerEditor';
import type { ManagerEditor } from './RepositoryManagerEditor';
import './repository-manager.css';
import { copyText } from '../lib/clipboard';
import { countLabel, formatRelativeDate } from '../lib/format';
import { FolderIcon, RepositoryIcon, WarningIcon } from './Icons';
import { TreeView } from './TreeView';
import type { TreeItem } from './TreeView';
import { useContextMenu } from './menu/context-menu';
import { contextMenuAnchor, menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

interface RepositoryManagerViewProps {
  readonly recent: readonly RecentRepository[];
  readonly manager: RepositoryManagerSnapshot | undefined;
  readonly gitInfo: GitInfo | undefined;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly scan: RepositoryManagerScan | undefined;
  readonly recovery: Recovery;
  readonly onChanged: () => void;
  readonly onOpenPath: (path: string) => void;
  readonly onSwitchTo: (id: string) => void;
  readonly onOpenExisting: () => void;
  readonly onInitialize: () => void;
  readonly onClone: () => void;
  readonly onAddSource: () => void;
  readonly onRescanSource: (id: string) => void;
  readonly onRemoveSource: (id: string) => void;
  readonly onRemoveRecent: (id: string) => void;
  readonly onLocateRecent: (id: string) => void;
  readonly onOpenInFileManager: (location: RepositoryLocation) => void;
}

type Selection =
  | { readonly type: 'recent'; readonly repository: RecentRepository }
  | { readonly type: 'managed'; readonly repository: RepositoryManagerRepository }
  | { readonly type: 'source'; readonly source: RepositoryManagerSourceDirectory }
  | { readonly type: 'group'; readonly group: RepositoryGroup }
  | { readonly type: 'folder'; readonly folder: RepositoryManagerFolder };

function statusLabel(
  status: RecentRepository['status'] | RepositoryManagerSourceDirectory['status'],
): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'missing':
      return 'Missing';
    case 'not-directory':
      return 'Not a directory';
    case 'unreadable':
      return 'Unreadable';
  }
}

export function RepositoryManagerView(props: RepositoryManagerViewProps) {
  const { recent, manager, gitInfo, loading, busy } = props;
  const showContextMenu = useContextMenu();
  const [activeKey, setActiveKey] = useState<string>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<ManagerEditor>();
  const [error, setError] = useState<string>();
  const edit = async (action: RepositoryManagerAction) => {
    if (!window.desktop) return;
    try {
      unwrapResult(await window.desktop.repository.editManager(action));
      props.onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The manager could not be updated.');
    }
  };

  const { items, selections } = useMemo(() => {
    const result: TreeItem[] = [];
    const byKey = new Map<string, Selection>();
    const open = (key: string) => Boolean(query.trim()) || !collapsed.has(key);

    result.push({
      key: 'section:recent',
      level: 1,
      label: 'Recent',
      expandable: recent.length > 0,
      expanded: recent.length > 0 && open('section:recent'),
      parentKey: null,
      className: 'section',
      toggleOnClick: true,
    });
    if (open('section:recent')) {
      for (const repository of recent) {
        const key = `recent:${repository.id}`;
        byKey.set(key, { type: 'recent', repository });
        result.push({
          key,
          level: 2,
          label: repository.name,
          icon: <RepositoryIcon size={15} />,
          meta: repository.open ? 'open' : undefined,
          expandable: false,
          expanded: false,
          parentKey: 'section:recent',
          className: repository.status === 'available' ? 'repository' : 'repository missing',
          title: repository.path,
        });
      }
    }

    const sources = manager?.sourceDirectories ?? [];
    result.push({
      key: 'section:repositories',
      level: 1,
      label: 'Repositories',
      expandable: Boolean(sources.length || manager?.groups.length || manager?.repositories.length),
      expanded: open('section:repositories'),
      parentKey: null,
      className: 'section',
      toggleOnClick: true,
    });
    if (manager && open('section:repositories')) {
      const addRepository = (repository: RepositoryManagerRepository, parentKey: string, level: number) => {
        const key = `managed:${repository.id}`;
        byKey.set(key, { type: 'managed', repository });
        result.push({
          key,
          level,
          label: repository.name,
          icon: <RepositoryIcon size={15} />,
          meta: repository.sessionId ? 'open' : undefined,
          expandable: false,
          expanded: false,
          parentKey,
          className:
            repository.status && repository.status !== 'available' ? 'repository missing' : 'repository',
          title: repository.path,
          testId: 'manager-repository',
        });
      };
      const addGroups = (parentId: string | null, parentKey: string, level: number) => {
        for (const group of manager.groups.filter((group) => group.parentId === parentId)) {
          const key = `group:${group.id}`;
          byKey.set(key, { type: 'group', group });
          result.push({
            key,
            level,
            label: group.name,
            icon: <FolderIcon size={15} />,
            expandable: true,
            expanded: open(key),
            parentKey,
            className: 'folder',
          });
          if (open(key)) {
            addGroups(group.id, key, level + 1);
            for (const repository of manager.repositories.filter((entry) => entry.groupId === group.id))
              addRepository(repository, key, level + 1);
          }
        }
      };
      addGroups(null, 'section:repositories', 2);
      const addChildren = (sourceId: string, parentId: string | null, parentKey: string, level: number) => {
        for (const folder of manager.folders) {
          if (folder.sourceDirectoryId !== sourceId || folder.parentId !== parentId) continue;
          const key = `folder:${folder.id}`;
          byKey.set(key, { type: 'folder', folder });
          const expanded = open(key);
          result.push({
            key,
            level,
            label: folder.name,
            icon: <FolderIcon size={15} />,
            expandable: true,
            expanded,
            parentKey,
            className: 'folder',
            title: folder.relativePath,
          });
          if (expanded) addChildren(sourceId, folder.id, key, level + 1);
        }
        for (const repository of manager.repositories) {
          if (repository.groupId) continue;
          if (repository.sourceDirectoryId !== sourceId || repository.folderId !== parentId) continue;
          const key = `managed:${repository.id}`;
          byKey.set(key, { type: 'managed', repository });
          result.push({
            key,
            level,
            label: repository.name,
            icon: <RepositoryIcon size={15} />,
            meta: repository.sessionId ? 'open' : undefined,
            expandable: false,
            expanded: false,
            parentKey,
            className: 'repository',
            title: repository.path,
            testId: 'manager-repository',
          });
        }
      };
      for (const source of manager.sourceDirectories) {
        const key = `source:${source.id}`;
        byKey.set(key, { type: 'source', source });
        const hasChildren = source.status === 'available' && source.repositoryCount > 0;
        const expanded = hasChildren && open(key);
        result.push({
          key,
          level: 2,
          label: source.name,
          icon: source.status === 'available' ? <FolderIcon size={15} /> : <WarningIcon size={15} />,
          meta:
            source.status === 'available'
              ? manager.defaultSourceId === source.id
                ? 'default'
                : String(source.repositoryCount)
              : statusLabel(source.status),
          expandable: hasChildren,
          expanded,
          parentKey: 'section:repositories',
          className: source.status === 'available' ? 'source' : 'source missing',
          title: source.path,
        });
        if (expanded) addChildren(source.id, null, key, 3);
      }
      for (const repository of manager.repositories.filter(
        (entry) => !entry.sourceDirectoryId && !entry.groupId,
      ))
        addRepository(repository, 'section:repositories', 2);
    }
    const filter = query.trim().toLocaleLowerCase();
    if (!filter) return { items: result, selections: byKey };
    const keep = new Set<string>();
    const rows = new Map(result.map((item) => [item.key, item]));
    for (const row of result)
      if (`${row.label} ${row.title ?? ''}`.toLocaleLowerCase().includes(filter)) {
        let current: TreeItem | undefined = row;
        while (current) {
          keep.add(current.key);
          current = current.parentKey ? rows.get(current.parentKey) : undefined;
        }
      }
    return { items: result.filter((item) => keep.has(item.key)), selections: byKey };
  }, [collapsed, manager, recent, query]);

  const selection = activeKey ? selections.get(activeKey) : undefined;

  const toggle = (item: TreeItem, expand: boolean) => {
    if (expand === item.expanded) return;
    setCollapsed((current) => {
      const next = new Set(current);
      if (expand) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  };

  const openSelection = (target: Selection | undefined) => {
    if (!target || busy) return;
    if (target.type === 'recent') {
      if (target.repository.status === 'available') props.onOpenPath(target.repository.path);
    } else if (target.type === 'managed') {
      if (target.repository.status && target.repository.status !== 'available') return;
      if (target.repository.sessionId) props.onSwitchTo(target.repository.sessionId);
      else props.onOpenPath(target.repository.path);
    }
  };

  const recentSession = (repository: RecentRepository) => (repository.open ? repository.id : null);

  const menuFor = (target: Selection): MenuEntry[] => {
    switch (target.type) {
      case 'recent': {
        const session = recentSession(target.repository);
        return [
          {
            id: 'open',
            label: session ? 'Switch to Tab' : 'Open',
            disabled: busy || target.repository.status !== 'available',
            run: () => (session ? props.onSwitchTo(session) : props.onOpenPath(target.repository.path)),
          },
          menuSeparator,
          {
            id: 'show',
            label: 'Open in File Manager',
            disabled: target.repository.status !== 'available',
            run: () => props.onOpenInFileManager({ kind: 'recent', id: target.repository.id }),
          },
          { id: 'copy-path', label: 'Copy Path', run: () => copyText(target.repository.path) },
          {
            id: 'organize',
            label: 'Organize Repository…',
            run: () =>
              setEditor({
                kind: 'edit-repository',
                location: { kind: 'recent', id: target.repository.id },
                name: target.repository.name,
                groupId:
                  manager?.repositories.find((entry) => entry.path === target.repository.path)?.groupId ??
                  null,
              }),
          },
          menuSeparator,
          {
            id: 'remove',
            label: 'Remove from Recent',
            disabled: busy,
            run: () => props.onRemoveRecent(target.repository.id),
          },
        ];
      }
      case 'managed':
        return [
          {
            id: 'open',
            label: target.repository.sessionId ? 'Switch to Tab' : 'Open',
            disabled: busy,
            run: () => openSelection(target),
          },
          menuSeparator,
          {
            id: 'show',
            label: 'Open in File Manager',
            run: () => props.onOpenInFileManager({ kind: 'manager-repository', id: target.repository.id }),
          },
          { id: 'copy-path', label: 'Copy Path', run: () => copyText(target.repository.path) },
          {
            id: 'organize',
            label: 'Organize Repository…',
            run: () =>
              setEditor({
                kind: 'edit-repository',
                location: { kind: 'manager-repository', id: target.repository.id },
                name: target.repository.name,
                groupId: target.repository.groupId ?? null,
              }),
          },
        ];
      case 'source':
        return [
          {
            id: 'default-source',
            label: 'Use as Default Source Directory',
            disabled: manager?.defaultSourceId === target.source.id,
            run: () => void edit({ kind: 'set-default-source', id: target.source.id }),
          },
          {
            id: 'rescan',
            label: 'Rescan',
            disabled: busy,
            run: () => props.onRescanSource(target.source.id),
          },
          menuSeparator,
          {
            id: 'show',
            label: 'Open in File Manager',
            disabled: target.source.status !== 'available',
            run: () => props.onOpenInFileManager({ kind: 'source-directory', id: target.source.id }),
          },
          { id: 'copy-path', label: 'Copy Path', run: () => copyText(target.source.path) },
          menuSeparator,
          {
            id: 'remove',
            label: 'Remove Source Directory',
            disabled: busy,
            run: () => props.onRemoveSource(target.source.id),
          },
        ];
      case 'folder':
        return [];
      case 'group':
        return [
          {
            id: 'new-folder',
            label: 'New Folder…',
            run: () => setEditor({ kind: 'add-group', parentId: target.group.id }),
          },
          {
            id: 'rename-folder',
            label: 'Rename Folder…',
            run: () => setEditor({ kind: 'rename-group', group: target.group }),
          },
          {
            id: 'move-folder',
            label: 'Move Folder…',
            run: () => setEditor({ kind: 'move-group', group: target.group }),
          },
          menuSeparator,
          {
            id: 'remove-folder',
            label: 'Remove Folder',
            run: () => void edit({ kind: 'remove-group', id: target.group.id }),
          },
        ];
    }
  };

  const onContextMenu = (item: TreeItem, event: ReactMouseEvent<HTMLElement>) => {
    const target = selections.get(item.key);
    const menu = target ? menuFor(target) : [];
    if (menu.length === 0) return;
    showContextMenu({
      anchor: contextMenuAnchor(event, event.currentTarget),
      items: menu,
      label: item.label,
    });
  };

  return (
    <section className="manager-view" aria-labelledby="manager-title">
      <header className="manager-header">
        <h1 id="manager-title">Repository Manager</h1>
        <div className="manager-actions">
          <button type="button" className="button" disabled={busy} onClick={props.onOpenExisting}>
            Open Repository…
          </button>
          <button type="button" className="button" disabled={busy} onClick={props.onInitialize}>
            Initialize Repository…
          </button>
          <button type="button" className="button" disabled={busy} onClick={props.onClone}>
            Clone…
          </button>
          <button type="button" className="button" disabled={busy} onClick={props.onAddSource}>
            Add Source Directory…
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setEditor({ kind: 'add-group', parentId: null })}
          >
            New Folder…
          </button>
        </div>
      </header>
      <div className="manager-body">
        <div className="manager-navigation">
          <input
            className="manager-search"
            aria-label="Filter repositories"
            placeholder="Filter repositories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <TreeView
            className="manager-tree"
            items={items}
            label="Repositories"
            idPrefix="manager"
            activeKey={activeKey}
            onActiveChange={setActiveKey}
            onToggle={toggle}
            onActivate={(item) => openSelection(selections.get(item.key))}
            onContextMenu={onContextMenu}
          >
            {loading && !manager && <p className="sidebar-note">Scanning source directories…</p>}
          </TreeView>
        </div>
        <div className="manager-details">
          <WorkspaceRecovery recovery={props.recovery} onChanged={props.onChanged} />
          {error && <p role="alert">{error}</p>}
          {selection ? (
            <ManagerDetails
              selection={selection}
              manager={manager}
              busy={busy}
              onOpen={() => openSelection(selection)}
              onRescan={props.onRescanSource}
              onRemoveSource={props.onRemoveSource}
              onRemoveRecent={props.onRemoveRecent}
              onLocateRecent={props.onLocateRecent}
              onOpenInFileManager={props.onOpenInFileManager}
              onOrganize={() => {
                if (selection.type === 'managed' || selection.type === 'recent')
                  setEditor({
                    kind: 'edit-repository',
                    location: {
                      kind: selection.type === 'managed' ? 'manager-repository' : 'recent',
                      id: selection.repository.id,
                    },
                    name: selection.repository.name,
                    groupId:
                      selection.type === 'managed'
                        ? (selection.repository.groupId ?? null)
                        : (manager?.repositories.find((entry) => entry.path === selection.repository.path)
                            ?.groupId ?? null),
                  });
              }}
            />
          ) : (
            <div className="manager-empty">
              <RepositoryIcon size={40} />
              <h2>Open a repository to start</h2>
              <p>
                Choose a recent repository, add a source directory to discover repositories in its folders, or
                open or initialize a directory.
              </p>
            </div>
          )}
          {manager && manager.warnings.length > 0 && (
            <p className="manager-warning" role="status" title={manager.warnings[0]?.path}>
              <WarningIcon size={13} />
              {manager.warnings[0]?.message}
              {manager.warnings.length > 1 ? ` (+${manager.warnings.length - 1} more)` : ''}
            </p>
          )}
        </div>
      </div>
      <footer className="manager-footer" role="status">
        <span>
          {gitInfo?.status === 'available'
            ? `Git ${gitInfo.version ?? ''} · ${gitInfo.executable ?? ''}`
            : gitInfo?.status === 'missing'
              ? 'Git is not installed or not on PATH'
              : gitInfo?.status === 'unsupported'
                ? `Git ${gitInfo.version ?? ''} is unsupported. Git ${gitInfo.minimumVersion ?? ''} or newer is required; choose an instance in Preferences.`
                : gitInfo?.status === 'error'
                  ? 'Git could not be checked'
                  : 'Checking Git…'}
        </span>
        {props.scan?.state === 'scanning' && (
          <span>
            Scanning source directories…{' '}
            <button
              className="button button-small"
              onClick={() => void window.desktop?.repository.cancelManagerScan()}
            >
              Cancel Scan
            </button>
          </span>
        )}
        {props.scan?.state === 'cancelled' && (
          <span>
            Scan cancelled{' '}
            <button className="button button-small" onClick={props.onChanged}>
              Rescan
            </button>
          </span>
        )}
      </footer>
      {editor && (
        <RepositoryManagerEditor
          editor={editor}
          groups={manager?.groups ?? []}
          onClose={() => setEditor(undefined)}
          onSaved={props.onChanged}
        />
      )}
    </section>
  );
}

interface ManagerDetailsProps {
  readonly selection: Selection;
  readonly manager: RepositoryManagerSnapshot | undefined;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onRescan: (id: string) => void;
  readonly onRemoveSource: (id: string) => void;
  readonly onRemoveRecent: (id: string) => void;
  readonly onLocateRecent: (id: string) => void;
  readonly onOpenInFileManager: (location: RepositoryLocation) => void;
  readonly onOrganize: () => void;
}

function ManagerDetails({
  selection,
  manager,
  busy,
  onOpen,
  onRescan,
  onRemoveSource,
  onRemoveRecent,
  onLocateRecent,
  onOpenInFileManager,
  onOrganize,
}: ManagerDetailsProps) {
  switch (selection.type) {
    case 'recent': {
      const { repository } = selection;
      const available = repository.status === 'available';
      return (
        <div className="manager-detail">
          <div className="manager-detail-heading">
            <div>
              <h2>{repository.name}</h2>
              <p className="manager-path">{repository.path}</p>
            </div>
            <button type="button" className="button primary" disabled={busy || !available} onClick={onOpen}>
              {repository.open ? 'Switch to Tab' : 'Open'}
            </button>
          </div>
          {available && (
            <ManagerRepositorySummary key={repository.id} location={{ kind: 'recent', id: repository.id }} />
          )}
          {!available && (
            <dl className="manager-facts">
              <dt>Status</dt>
              <dd>{statusLabel(repository.status)}</dd>
              <dt>Last opened</dt>
              <dd>{formatRelativeDate(repository.lastOpenedAt)}</dd>
              <dt>Tab</dt>
              <dd>{repository.open ? 'Open in this window' : 'Not open'}</dd>
            </dl>
          )}
          <div className="manager-detail-actions">
            {!available && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => onLocateRecent(repository.id)}
              >
                Locate…
              </button>
            )}
            <button type="button" className="button" disabled={busy} onClick={onOrganize}>
              Organize Repository…
            </button>
            <button
              type="button"
              className="button"
              disabled={!available}
              onClick={() => onOpenInFileManager({ kind: 'recent', id: repository.id })}
            >
              Open in File Manager
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => onRemoveRecent(repository.id)}
            >
              Remove from Recent
            </button>
          </div>
        </div>
      );
    }
    case 'managed': {
      const { repository } = selection;
      return (
        <div className="manager-detail">
          <div className="manager-detail-heading">
            <div>
              <h2>{repository.name}</h2>
              <p className="manager-path">{repository.path}</p>
            </div>
            <button type="button" className="button primary" disabled={busy} onClick={onOpen}>
              {repository.sessionId ? 'Switch to Tab' : 'Open'}
            </button>
          </div>
          <ManagerRepositorySummary
            key={repository.id}
            location={{ kind: 'manager-repository', id: repository.id }}
          />
          <div className="manager-detail-actions">
            <button type="button" className="button" disabled={busy} onClick={onOrganize}>
              Organize Repository…
            </button>
            <button
              type="button"
              className="button"
              onClick={() => onOpenInFileManager({ kind: 'manager-repository', id: repository.id })}
            >
              Open in File Manager
            </button>
          </div>
        </div>
      );
    }
    case 'source': {
      const { source } = selection;
      return (
        <div className="manager-detail">
          <div className="manager-detail-heading">
            <div>
              <h2>{source.name}</h2>
              <p className="manager-path">{source.path}</p>
            </div>
            <button type="button" className="button" disabled={busy} onClick={() => onRescan(source.id)}>
              Rescan
            </button>
          </div>
          <dl className="manager-facts">
            <dt>Status</dt>
            <dd>{statusLabel(source.status)}</dd>
            <dt>Repositories</dt>
            <dd>{countLabel(source.repositoryCount, 'repository', 'repositories')}</dd>
            <dt>Last scanned</dt>
            <dd>{source.lastScannedAt ? formatRelativeDate(source.lastScannedAt) : 'Never'}</dd>
          </dl>
          {source.truncated && (
            <p className="manager-warning">
              <WarningIcon size={13} />
              Scan limits were reached; rescan after narrowing this folder.
            </p>
          )}
          <div className="manager-detail-actions">
            <button
              type="button"
              className="button"
              disabled={source.status !== 'available'}
              onClick={() => onOpenInFileManager({ kind: 'source-directory', id: source.id })}
            >
              Open in File Manager
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => onRemoveSource(source.id)}
            >
              Remove Source Directory
            </button>
          </div>
        </div>
      );
    }
    case 'folder': {
      const { folder } = selection;
      const prefix = `${folder.relativePath}/`;
      const count =
        manager?.repositories.filter(
          (repository) =>
            repository.sourceDirectoryId === folder.sourceDirectoryId &&
            repository.relativePath.startsWith(prefix),
        ).length ?? 0;
      return (
        <div className="manager-detail">
          <div className="manager-detail-heading">
            <div>
              <h2>{folder.name}</h2>
              <p className="manager-path">{folder.relativePath}</p>
            </div>
          </div>
          <dl className="manager-facts">
            <dt>Repositories</dt>
            <dd>{countLabel(count, 'repository', 'repositories')}</dd>
          </dl>
        </div>
      );
    }
    case 'group':
      return (
        <div className="manager-detail">
          <h2>{selection.group.name}</h2>
          <p className="muted">
            Use Organize Repository to place repositories here. Right-click this folder to rename, move, or
            remove it.
          </p>
        </div>
      );
  }
}
