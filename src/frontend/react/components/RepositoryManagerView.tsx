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
} from '../../../common/ipc/contracts';
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
  readonly onOpenPath: (path: string) => void;
  readonly onSwitchTo: (id: string) => void;
  readonly onOpenExisting: () => void;
  readonly onInitialize: () => void;
  readonly onAddSource: () => void;
  readonly onRescanSource: (id: string) => void;
  readonly onRemoveSource: (id: string) => void;
  readonly onRemoveRecent: (id: string) => void;
  readonly onOpenInFileManager: (location: RepositoryLocation) => void;
}

type Selection =
  | { readonly type: 'recent'; readonly repository: RecentRepository }
  | { readonly type: 'managed'; readonly repository: RepositoryManagerRepository }
  | { readonly type: 'source'; readonly source: RepositoryManagerSourceDirectory }
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

  const { items, selections } = useMemo(() => {
    const result: TreeItem[] = [];
    const byKey = new Map<string, Selection>();
    const open = (key: string) => !collapsed.has(key);

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
      expandable: sources.length > 0,
      expanded: sources.length > 0 && open('section:repositories'),
      parentKey: null,
      className: 'section',
      toggleOnClick: true,
    });
    if (manager && open('section:repositories')) {
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
          meta: source.status === 'available' ? String(source.repositoryCount) : statusLabel(source.status),
          expandable: hasChildren,
          expanded,
          parentKey: 'section:repositories',
          className: source.status === 'available' ? 'source' : 'source missing',
          title: source.path,
        });
        if (expanded) addChildren(source.id, null, key, 3);
      }
    }
    return { items: result, selections: byKey };
  }, [collapsed, manager, recent]);

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
        ];
      case 'source':
        return [
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
          <button
            type="button"
            className="button"
            aria-disabled="true"
            title="Remote cloning is not available yet (planned for P05)."
          >
            Clone…
          </button>
          <button type="button" className="button" disabled={busy} onClick={props.onAddSource}>
            Add Source Directory…
          </button>
        </div>
      </header>
      <div className="manager-body">
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
        <div className="manager-details">
          {selection ? (
            <ManagerDetails
              selection={selection}
              manager={manager}
              busy={busy}
              onOpen={() => openSelection(selection)}
              onRescan={props.onRescanSource}
              onRemoveSource={props.onRemoveSource}
              onRemoveRecent={props.onRemoveRecent}
              onOpenInFileManager={props.onOpenInFileManager}
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
        {gitInfo?.status === 'available'
          ? `Git ${gitInfo.version ?? ''} · ${gitInfo.executable ?? ''}`
          : gitInfo?.status === 'missing'
            ? 'Git is not installed or not on PATH'
            : gitInfo?.status === 'error'
              ? 'Git could not be checked'
              : 'Checking Git…'}
      </footer>
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
  readonly onOpenInFileManager: (location: RepositoryLocation) => void;
}

function ManagerDetails({
  selection,
  manager,
  busy,
  onOpen,
  onRescan,
  onRemoveSource,
  onRemoveRecent,
  onOpenInFileManager,
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
          <dl className="manager-facts">
            <dt>Status</dt>
            <dd>{statusLabel(repository.status)}</dd>
            <dt>Last opened</dt>
            <dd>{formatRelativeDate(repository.lastOpenedAt)}</dd>
            <dt>Tab</dt>
            <dd>{repository.open ? 'Open in this window' : 'Not open'}</dd>
          </dl>
          <div className="manager-detail-actions">
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
      const source = manager?.sourceDirectories.find(
        (candidate) => candidate.id === repository.sourceDirectoryId,
      );
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
          <dl className="manager-facts">
            <dt>Type</dt>
            <dd>{repository.kind === 'bare' ? 'Bare repository' : 'Working tree'}</dd>
            <dt>Source</dt>
            <dd>{source?.name ?? 'Unknown'}</dd>
            <dt>Location</dt>
            <dd>{repository.relativePath || 'Source directory root'}</dd>
          </dl>
          <div className="manager-detail-actions">
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
  }
}
