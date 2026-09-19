import { useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { RepositoryHistoryReference, RepositorySummary } from '../../../common/ipc/contracts';
import type { HistoryRevealRequest } from '../hooks/use-repository-history';
import { referenceSections } from '../lib/references';
import type { ReferenceTreeNode } from '../lib/references';
import {
  BranchIcon,
  ChangesIcon,
  CheckIcon,
  CommitsIcon,
  FolderIcon,
  RemoteIcon,
  SearchIcon,
  SettingsIcon,
  StashItemIcon,
  TagIcon,
} from './Icons';
import { CommitSearchPanel } from './CommitSearchPanel';
import { TreeView } from './TreeView';
import type { TreeItem } from './TreeView';

export type RepositoryView = 'history' | 'changes';

interface RepositorySidebarProps {
  readonly repository: RepositorySummary;
  readonly view: RepositoryView;
  readonly references: readonly RepositoryHistoryReference[];
  readonly referencesLoading: boolean;
  readonly onViewChange: (view: RepositoryView) => void;
  readonly reveal: HistoryRevealRequest | undefined;
  readonly historyFiltered: boolean;
  readonly onRevealCommit: (commitId: string) => void;
  readonly onReferenceSelect: (reference: RepositoryHistoryReference) => void;
  readonly onReferenceContextMenu: (
    reference: RepositoryHistoryReference,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
}

const collapsedByDefault = new Set(['section:tags', 'section:stashes']);

function trackingText(reference: RepositoryHistoryReference): ReactNode {
  if (reference.upstreamGone) {
    return (
      <span className="reference-gone" title={`The upstream branch ${reference.upstream} no longer exists.`}>
        gone
      </span>
    );
  }
  if (reference.ahead === null || reference.behind === null) return null;
  const parts = [];
  if (reference.ahead > 0) parts.push(`${reference.ahead}↑`);
  if (reference.behind > 0) parts.push(`${reference.behind}↓`);
  return parts.join(' ') || null;
}

function referenceIcon(reference: RepositoryHistoryReference): ReactNode {
  if (reference.isHead && reference.kind === 'branch') return <CheckIcon size={14} />;
  if (reference.kind === 'tag') return <TagIcon size={14} />;
  if (reference.kind === 'stash') return <StashItemIcon size={14} />;
  return <BranchIcon size={14} />;
}

/** Remote names and sections start expanded; nested reference folders start collapsed. */
function expandedByDefault(key: string, level: number): boolean {
  if (key.startsWith('section:')) return !collapsedByDefault.has(key);
  return key.startsWith('remotes/') && level === 2;
}

export function RepositorySidebar({
  repository,
  view,
  references,
  referencesLoading,
  onViewChange,
  reveal,
  historyFiltered,
  onRevealCommit,
  onReferenceSelect,
  onReferenceContextMenu,
}: RepositorySidebarProps) {
  const [mode, setMode] = useState<'references' | 'search'>('references');
  const [filter, setFilter] = useState('');
  // Keys whose expansion differs from their default state.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [activeKey, setActiveKey] = useState<string>();
  const filtering = filter.trim().length > 0;
  const sections = useMemo(() => referenceSections(references, filter), [references, filter]);

  const { items, referencesByKey } = useMemo(() => {
    const result: TreeItem[] = [];
    const byKey = new Map<string, RepositoryHistoryReference>();
    const expanded = (key: string, level: number) =>
      filtering || expandedByDefault(key, level) !== toggled.has(key);

    const addNodes = (
      nodes: readonly ReferenceTreeNode[],
      level: number,
      parentKey: string,
      section: string,
    ) => {
      for (const node of nodes) {
        if (node.type === 'reference') {
          byKey.set(node.key, node.reference);
          result.push({
            key: node.key,
            level,
            label: node.name,
            icon: referenceIcon(node.reference),
            meta: trackingText(node.reference),
            expandable: false,
            expanded: false,
            parentKey,
            className: node.reference.isHead ? 'reference current' : 'reference',
            title: node.reference.fullName,
          });
          continue;
        }
        const open = expanded(node.key, level);
        result.push({
          key: node.key,
          level,
          label: node.name,
          icon: section === 'remotes' && level === 2 ? <RemoteIcon size={14} /> : <FolderIcon size={14} />,
          expandable: true,
          expanded: open,
          parentKey,
          className: 'folder',
        });
        if (open) addNodes(node.children, level + 1, node.key, section);
      }
    };

    const addSection = (
      id: string,
      label: string,
      nodes: readonly ReferenceTreeNode[],
      unavailable?: string,
    ) => {
      const key = `section:${id}`;
      const open = nodes.length > 0 && expanded(key, 1);
      result.push({
        key,
        level: 1,
        label,
        expandable: nodes.length > 0,
        expanded: open,
        parentKey: null,
        className: 'section',
        toggleOnClick: true,
        unavailable: unavailable !== undefined,
        title: unavailable,
      });
      if (open) addNodes(nodes, 2, key, id);
    };

    addSection('branches', 'Branches', sections.branches);
    addSection('remotes', 'Remotes', sections.remotes);
    addSection('tags', 'Tags', sections.tags);
    addSection('stashes', 'Stashes', sections.stashes);
    if (!filtering) {
      addSection(
        'submodules',
        'Submodules',
        [],
        'Submodule inspection is not available yet (planned for P09).',
      );
    }
    return { items: result, referencesByKey: byKey };
  }, [filtering, sections, toggled]);

  const toggle = (item: TreeItem, expand: boolean) => {
    if (filtering || expand === item.expanded) return;
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  };

  const changedFiles = repository.workingTree.changedFileCount;
  const noMatches = filtering && Object.values(sections.counts).every((count) => count === 0);

  return (
    <aside className="sidebar" aria-label={`${repository.name} navigation`}>
      <div className="sidebar-header">
        <strong title={repository.path}>{repository.name}</strong>
        <button
          type="button"
          className="icon-button"
          aria-disabled="true"
          aria-label="Repository settings"
          title="Repository settings are not available yet (planned for P12)."
        >
          <SettingsIcon size={14} />
        </button>
      </div>
      <nav className="sidebar-views" aria-label="Repository views">
        <button
          type="button"
          className={view === 'changes' ? 'sidebar-view active' : 'sidebar-view'}
          aria-current={view === 'changes' ? 'page' : undefined}
          disabled={repository.bare}
          title={repository.bare ? 'A bare repository has no working tree.' : undefined}
          onClick={() => onViewChange('changes')}
        >
          <ChangesIcon size={16} />
          <span>Local Changes{!repository.bare && changedFiles !== null ? ` (${changedFiles})` : ''}</span>
        </button>
        <button
          type="button"
          className={view === 'history' ? 'sidebar-view active' : 'sidebar-view'}
          aria-current={view === 'history' ? 'page' : undefined}
          onClick={() => onViewChange('history')}
        >
          <CommitsIcon size={16} />
          <span>All Commits</span>
        </button>
      </nav>
      <div className="sidebar-modes" role="group" aria-label="Sidebar content">
        <button
          type="button"
          className={mode === 'references' ? 'sidebar-mode active' : 'sidebar-mode'}
          aria-pressed={mode === 'references'}
          aria-label="Branches"
          title="Branches"
          onClick={() => setMode('references')}
        >
          <BranchIcon size={16} />
        </button>
        <button
          type="button"
          className={mode === 'search' ? 'sidebar-mode active' : 'sidebar-mode'}
          aria-pressed={mode === 'search'}
          aria-label="Search"
          title="Search commits"
          onClick={() => setMode('search')}
        >
          <SearchIcon size={16} />
        </button>
      </div>
      {mode === 'search' ? (
        <CommitSearchPanel
          repositoryId={repository.id}
          reveal={reveal}
          historyFiltered={historyFiltered}
          onRevealCommit={onRevealCommit}
        />
      ) : (
        <>
          <label className="sidebar-filter">
            <SearchIcon size={13} />
            <input
              type="search"
              value={filter}
              placeholder="Filter"
              aria-label="Filter references"
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
          <TreeView
            className="sidebar-tree"
            items={items}
            label="References"
            idPrefix="sidebar"
            activeKey={activeKey}
            onActiveChange={setActiveKey}
            onToggle={toggle}
            onSelect={(item) => {
              const reference = referencesByKey.get(item.key);
              if (reference) onReferenceSelect(reference);
            }}
            onActivate={(item) => {
              const reference = referencesByKey.get(item.key);
              if (reference) onReferenceSelect(reference);
            }}
            onContextMenu={(item, event) => {
              const reference = referencesByKey.get(item.key);
              if (reference) onReferenceContextMenu(reference, event);
            }}
          >
            {referencesLoading && references.length === 0 && (
              <p className="sidebar-note">Loading references…</p>
            )}
            {noMatches && <p className="sidebar-note">No references match “{filter.trim()}”.</p>}
          </TreeView>
        </>
      )}
    </aside>
  );
}
