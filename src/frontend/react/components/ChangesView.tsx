import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { RepositorySummary, RepositoryWorkingChange } from '../../../common/ipc/contracts';
import { useRepositoryWorkingChanges } from '../hooks/use-repository-working-changes';
import { isOneOf, usePersistentState } from '../hooks/use-persistent-state';
import { countLabel } from '../lib/format';
import { ChangesIcon, FolderIcon } from './Icons';
import { TreeView } from './TreeView';
import type { TreeItem } from './TreeView';

const displayModes = ['tree', 'list'] as const;
type DisplayMode = (typeof displayModes)[number];

interface ChangeSection {
  readonly id: 'staged' | 'unstaged' | 'untracked' | 'ignored';
  readonly title: string;
  readonly changes: readonly RepositoryWorkingChange[];
  readonly count: number;
}

interface ChangeTreeNode {
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly change: RepositoryWorkingChange | undefined;
  readonly children: ChangeTreeNode[];
}

const statusLabels: Record<RepositoryWorkingChange['status'], string> = {
  added: 'Added',
  copied: 'Copied',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  'type-changed': 'Type changed',
  unmerged: 'Conflict',
  untracked: 'Untracked',
  ignored: 'Ignored',
  unknown: 'Changed',
};

function encodedKey(sectionId: string, kind: 'file' | 'folder', path: string): string {
  return `${sectionId}:${kind}:${encodeURIComponent(path)}`;
}

function buildChangeTree(sectionId: string, changes: readonly RepositoryWorkingChange[]): ChangeTreeNode[] {
  const root: ChangeTreeNode = {
    key: `${sectionId}:root`,
    name: '',
    path: '',
    change: undefined,
    children: [],
  };

  for (const change of changes) {
    const parts = change.path.split('/');
    let parent = root;
    let path = '';
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      path = path ? `${path}/${part}` : part;
      const isFile = index === parts.length - 1;
      const key = encodedKey(sectionId, isFile ? 'file' : 'folder', path);
      let node = parent.children.find((candidate) => candidate.key === key);
      if (!node) {
        node = {
          key,
          name: part,
          path,
          change: isFile ? change : undefined,
          children: [],
        };
        parent.children.push(node);
      }
      parent = node;
    }
  }

  const sort = (nodes: ChangeTreeNode[]) => {
    nodes.sort((left, right) => {
      const leftFolder = left.children.length > 0;
      const rightFolder = right.children.length > 0;
      if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const node of nodes) sort(node.children);
  };
  sort(root.children);
  return root.children;
}

function statusMeta(change: RepositoryWorkingChange): ReactNode {
  const modeChanged = change.oldMode !== null && change.newMode !== null && change.oldMode !== change.newMode;
  return (
    <span className="working-change-meta">
      <span className={`working-change-status ${change.status}`}>{statusLabels[change.status]}</span>
      {modeChanged && <span title={`${change.oldMode} → ${change.newMode}`}>Mode</span>}
      {change.previousPath && (
        <span title={`Previous path: ${change.previousPath}`}>From {change.previousPath}</span>
      )}
    </span>
  );
}

function changeItems(changes: readonly RepositoryWorkingChange[], sectionId: string): TreeItem[] {
  return changes.map((change) => ({
    key: encodedKey(sectionId, 'file', change.path),
    level: 1,
    label: change.path,
    icon: <ChangesIcon size={14} />,
    meta: statusMeta(change),
    expandable: false,
    expanded: false,
    parentKey: null,
    className: `working-change-row ${change.status}`,
    title: change.path,
    testId: 'working-change',
  }));
}

function treeItems(nodes: readonly ChangeTreeNode[], collapsed: ReadonlySet<string>): TreeItem[] {
  const items: TreeItem[] = [];
  const append = (children: readonly ChangeTreeNode[], level: number, parentKey: string | null) => {
    for (const node of children) {
      const expandable = node.children.length > 0;
      const expanded = expandable && !collapsed.has(node.key);
      items.push({
        key: node.key,
        level,
        label: node.name,
        icon: expandable ? <FolderIcon size={14} /> : <ChangesIcon size={14} />,
        meta: node.change ? statusMeta(node.change) : undefined,
        expandable,
        expanded,
        parentKey,
        className: node.change ? `working-change-row ${node.change.status}` : 'working-change-folder',
        title: node.change?.path ?? `${node.path}/`,
        toggleOnClick: expandable,
        testId: node.change ? 'working-change' : 'working-change-folder',
      });
      if (expanded) append(node.children, level + 1, node.key);
    }
  };
  append(nodes, 1, null);
  return items;
}

function ChangeFileTree({ section }: { readonly section: ChangeSection }) {
  const [activeKey, setActiveKey] = useState<string>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const nodes = useMemo(() => buildChangeTree(section.id, section.changes), [section.changes, section.id]);
  const items = useMemo(() => treeItems(nodes, collapsed), [collapsed, nodes]);

  return (
    <TreeView
      className="changes-tree"
      items={items}
      label={`${section.title} files`}
      idPrefix={`working-${section.id}`}
      activeKey={activeKey}
      onActiveChange={setActiveKey}
      onToggle={(item, expand) => {
        if (!item.expandable) return;
        setCollapsed((current) => {
          const next = new Set(current);
          if (expand) next.delete(item.key);
          else next.add(item.key);
          return next;
        });
      }}
    />
  );
}

function ChangeFileList({ section }: { readonly section: ChangeSection }) {
  const [activeKey, setActiveKey] = useState<string>();
  const items = useMemo(() => changeItems(section.changes, section.id), [section.changes, section.id]);
  return (
    <TreeView
      className="changes-tree"
      items={items}
      label={`${section.title} files`}
      idPrefix={`working-${section.id}`}
      activeKey={activeKey}
      onActiveChange={setActiveKey}
      onToggle={() => undefined}
    />
  );
}

function ChangeSectionView({
  section,
  mode,
}: {
  readonly section: ChangeSection;
  readonly mode: DisplayMode;
}) {
  return (
    <section className="changes-section" data-testid={`working-changes-${section.id}`}>
      <header className="changes-section-header">
        <h2>{section.title}</h2>
        <span className="changes-section-count">{section.count}</span>
      </header>
      {section.changes.length === 0 ? (
        <p className="changes-empty">No {section.title.toLocaleLowerCase()}.</p>
      ) : mode === 'tree' ? (
        <ChangeFileTree section={section} />
      ) : (
        <ChangeFileList section={section} />
      )}
    </section>
  );
}

export function ChangesView({ repository }: { readonly repository: RepositorySummary }) {
  const [mode, setMode] = usePersistentState<DisplayMode>(
    `repository.${repository.id}.changes.mode`,
    'tree',
    isOneOf(displayModes),
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
  const { value, loading, error, refresh } = useRepositoryWorkingChanges(
    repository.id,
    includeUntracked,
    includeIgnored,
  );

  const sections = useMemo<ChangeSection[]>(() => {
    if (!value) return [];
    const result: ChangeSection[] = [
      { id: 'staged', title: 'Staged Changes', changes: value.staged, count: value.counts.staged },
      { id: 'unstaged', title: 'Unstaged Changes', changes: value.unstaged, count: value.counts.unstaged },
      {
        id: 'untracked',
        title: 'Untracked Files',
        changes: value.untracked,
        count: value.counts.untracked,
      },
    ];
    if (includeIgnored) {
      result.push({
        id: 'ignored',
        title: 'Ignored Files',
        changes: value.ignored,
        count: value.counts.ignored,
      });
    }
    return result;
  }, [includeIgnored, value]);
  const visibleChanges = sections.some((section) => section.changes.length > 0);
  const visibleCount = value
    ? value.counts.staged +
      value.counts.unstaged +
      value.counts.untracked +
      (includeIgnored ? value.counts.ignored : 0)
    : 0;

  return (
    <section className="changes-view" aria-labelledby="changes-heading" data-testid="working-changes">
      <header className="changes-header">
        <div className="changes-heading-copy">
          <h1 id="changes-heading">Local Changes</h1>
          <p>
            {value
              ? visibleChanges
                ? `${countLabel(
                    visibleCount,
                    'visible entry',
                  )}${value.counts.conflicted ? `, ${countLabel(value.counts.conflicted, 'conflict')}` : ''}.`
                : 'No visible local changes.'
              : repository.workingTree.state === 'unknown'
                ? 'The working-tree status could not be read.'
                : 'Reading the working tree…'}
          </p>
        </div>
        <div className="changes-toolbar" aria-label="Local changes controls">
          <div className="changes-segmented" role="group" aria-label="Change display mode">
            <button
              type="button"
              className={mode === 'tree' ? 'button button-small active' : 'button button-small'}
              aria-pressed={mode === 'tree'}
              onClick={() => setMode('tree')}
            >
              Tree view
            </button>
            <button
              type="button"
              className={mode === 'list' ? 'button button-small active' : 'button button-small'}
              aria-pressed={mode === 'list'}
              onClick={() => setMode('list')}
            >
              List view
            </button>
          </div>
          <label className="changes-toggle">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(event) => setIncludeUntracked(event.target.checked)}
            />
            Show untracked
          </label>
          <label className="changes-toggle">
            <input
              type="checkbox"
              checked={includeIgnored}
              onChange={(event) => setIncludeIgnored(event.target.checked)}
            />
            Show ignored
          </label>
          <button type="button" className="button button-small" onClick={refresh} disabled={loading}>
            {'Refresh'}
          </button>
        </div>
      </header>
      {error && (
        <div className="inline-alert changes-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="button button-small" onClick={refresh}>
            Retry
          </button>
        </div>
      )}
      {loading && !value && <p className="changes-loading">Reading working-tree status…</p>}
      {value && (
        <div className="changes-body">
          {value.truncated && (
            <p className="changes-truncated" role="status">
              This list is truncated at 10,000 entries in a section.
            </p>
          )}
          <div className="changes-sections">
            {sections.map((section) => (
              <ChangeSectionView key={section.id} section={section} mode={mode} />
            ))}
          </div>
          {!visibleChanges && (
            <p className="changes-no-results">
              No files are currently shown. Enable untracked or ignored visibility if those files are
              expected.
            </p>
          )}
          <p className="changes-future-note">Diff preview and staging actions are planned for F09/F10.</p>
        </div>
      )}
    </section>
  );
}
