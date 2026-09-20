import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { ChangeStatus } from '../lib/change-status';
import { buildPathTree, flattenPathTree, splitPath } from '../lib/file-tree';
import type { SelectionModifiers } from '../lib/list-selection';
import { FileIcon, FolderIcon } from './Icons';
import { StatusBadge } from './StatusBadge';
import { TreeView } from './TreeView';
import type { TreeItem } from './TreeView';

export type FileListMode = 'tree' | 'list';

export interface FileChangeEntry {
  readonly key: string;
  readonly status: ChangeStatus;
  readonly path: string;
  readonly previousPath: string | null;
  /** Extra detail after the name, such as a rename source. */
  readonly detail?: string | undefined;
}

interface FileChangeListProps<Entry extends FileChangeEntry> {
  readonly entries: readonly Entry[];
  readonly mode: FileListMode;
  readonly label: string;
  readonly idPrefix: string;
  /** The entry whose detail is shown. */
  readonly selectedKey: string | undefined;
  /** All selected entries when the list allows selecting several; omit for single selection. */
  readonly selectedKeys?: ReadonlySet<string> | undefined;
  readonly onSelect: (entry: Entry, modifiers: SelectionModifiers) => void;
  readonly onContextMenu?: ((entry: Entry, event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  readonly rowTestId?: string | undefined;
  readonly children?: ReactNode;
}

function fileIcon(entry: FileChangeEntry) {
  return (
    <>
      <StatusBadge status={entry.status} />
      <FileIcon size={14} />
    </>
  );
}

function entryTitle(entry: FileChangeEntry): string {
  return entry.previousPath ? `${entry.previousPath} → ${entry.path}` : entry.path;
}

/** Changed files as a folder tree or as Name/Location rows, each with a status badge. */
export function FileChangeList<Entry extends FileChangeEntry>({
  entries,
  mode,
  label,
  idPrefix,
  selectedKey,
  selectedKeys,
  onSelect,
  onContextMenu,
  rowTestId,
  children,
}: FileChangeListProps<Entry>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // The keyboard cursor can rest on folders; only files become the selection.
  const [activeKey, setActiveKey] = useState(selectedKey);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  useEffect(() => {
    setActiveKey(selectedKey);
  }, [selectedKey]);

  const items = useMemo<TreeItem[]>(() => {
    if (mode === 'list') {
      return entries.map((entry) => {
        const { name, location } = splitPath(entry.path);
        return {
          key: entry.key,
          level: 1,
          label: name,
          icon: fileIcon(entry),
          meta: <span className="file-change-location">{location}</span>,
          expandable: false,
          expanded: false,
          parentKey: null,
          className: 'file-change',
          title: entryTitle(entry),
          testId: rowTestId,
        };
      });
    }
    const tree = buildPathTree(
      entries,
      (entry) => entry.path,
      (entry) => entry.key,
    );
    return flattenPathTree(tree, collapsed).map(({ node, level, parentKey, expanded }): TreeItem => {
      const entry = node.item;
      return entry
        ? {
            key: node.key,
            level,
            label: node.name,
            icon: fileIcon(entry),
            meta: entry.detail,
            expandable: false,
            expanded: false,
            parentKey,
            className: 'file-change',
            title: entryTitle(entry),
            testId: rowTestId,
          }
        : {
            key: node.key,
            level,
            label: node.name,
            icon: <FolderIcon size={14} />,
            expandable: true,
            expanded,
            parentKey,
            className: 'file-change-folder',
            title: `${node.path}/`,
            toggleOnClick: true,
          };
    });
  }, [collapsed, entries, mode, rowTestId]);

  return (
    <div
      className={`file-change-list ${mode}`}
      onKeyDownCapture={(event) => {
        if (
          event.key.toLocaleLowerCase() !== 'a' ||
          !(event.ctrlKey || event.metaKey) ||
          !selectedKeys ||
          entries.length === 0
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(entries[0]!, { toggle: false, range: false });
        if (entries.length > 1) onSelect(entries[entries.length - 1]!, { toggle: false, range: true });
      }}
    >
      {mode === 'list' && (
        <div className="file-change-columns" aria-hidden="true">
          <span>Name</span>
          <span>Location</span>
        </div>
      )}
      <TreeView
        className="file-change-tree"
        items={items}
        label={label}
        idPrefix={idPrefix}
        activeKey={activeKey}
        selectedKeys={selectedKeys}
        onActiveChange={(key, modifiers) => {
          setActiveKey(key);
          const entry = byKey.get(key);
          if (entry) onSelect(entry, modifiers);
        }}
        onToggle={(item, expand) => {
          if (!item.expandable) return;
          setCollapsed((current) => {
            const next = new Set(current);
            if (expand) next.delete(item.key);
            else next.add(item.key);
            return next;
          });
        }}
        onContextMenu={(item, event) => {
          const entry = byKey.get(item.key);
          if (entry) onContextMenu?.(entry, event);
        }}
      >
        {children}
      </TreeView>
    </div>
  );
}
