import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { RepositorySummary, RepositoryTabOrientation } from '../../../common/ipc/contracts';
import { tabStatusLabel } from '../lib/repository-labels';
import { CloseIcon, PlusIcon, RepositoryIcon } from './Icons';

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: 'repository' | 'manager';
  readonly title: string;
  readonly repository?: RepositorySummary | undefined;
}

interface RepositoryTabsProps {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeId: string | undefined;
  readonly orientation: RepositoryTabOrientation;
  readonly closeDisabled: boolean;
  readonly onSelect: (tab: WorkspaceTab) => void;
  readonly onClose: (tab: WorkspaceTab) => void;
  readonly onNewTab: () => void;
  readonly onContextMenu: (tab: WorkspaceTab, event: ReactMouseEvent<HTMLElement>) => void;
  readonly onReorder?: ((sourceId: string, targetId: string) => void) | undefined;
}

function tabLabel(tab: WorkspaceTab): string {
  return tab.repository ? `${tab.title}, ${tabStatusLabel(tab.repository)}` : tab.title;
}

export function RepositoryTabs({
  tabs,
  activeId,
  orientation,
  closeDisabled,
  onSelect,
  onClose,
  onNewTab,
  onContextMenu,
  onReorder,
}: RepositoryTabsProps) {
  const closable = (tab: WorkspaceTab) => tab.kind === 'repository' || tabs.length > 1;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const previous = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (event.altKey && event.shiftKey && (event.key === previous || event.key === next)) {
      const target = tabs[index + (event.key === previous ? -1 : 1)];
      if (target && target.kind === 'repository' && tabs[index]?.kind === 'repository') {
        event.preventDefault();
        onReorder?.(tabs[index]!.id, target.id);
      }
      return;
    }
    let target: WorkspaceTab | undefined;
    if (event.key === previous) target = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === next) target = tabs[(index + 1) % tabs.length];
    else if (event.key === 'Home') target = tabs[0];
    else if (event.key === 'End') target = tabs[tabs.length - 1];
    else if (event.key === 'Delete' && closable(tabs[index]!) && !closeDisabled) {
      event.preventDefault();
      onClose(tabs[index]!);
      return;
    } else return;
    event.preventDefault();
    if (!target) return;
    onSelect(target);
    window.requestAnimationFrame(() =>
      document.getElementById(`workspace-${orientation}-${target.id}`)?.focus(),
    );
  };

  return (
    <div className={`workspace-tabs ${orientation}`}>
      {orientation === 'vertical' && <div className="repository-list-heading">Workspace</div>}
      <div
        className="workspace-tab-list"
        role={orientation === 'horizontal' ? 'tablist' : 'listbox'}
        aria-label={orientation === 'horizontal' ? 'Repository tabs' : 'Repository list'}
        aria-orientation={orientation}
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          const dirty = tab.repository?.workingTree.state === 'dirty';
          return (
            <div
              key={tab.id}
              id={`workspace-${orientation}-${tab.id}`}
              role={orientation === 'horizontal' ? 'tab' : 'option'}
              className={selected ? 'workspace-tab active' : 'workspace-tab'}
              aria-selected={selected}
              aria-label={tabLabel(tab)}
              tabIndex={selected ? 0 : -1}
              title={tab.repository?.path ?? tab.title}
              data-kind={tab.kind}
              draggable={tab.kind === 'repository' && !closeDisabled}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-git-workbench-tab', tab.id);
              }}
              onDragOver={(event) => {
                if (
                  tab.kind === 'repository' &&
                  event.dataTransfer.types.includes('application/x-git-workbench-tab')
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                const sourceId = event.dataTransfer.getData('application/x-git-workbench-tab');
                if (sourceId && tab.kind === 'repository' && !closeDisabled) {
                  event.preventDefault();
                  onReorder?.(sourceId, tab.id);
                }
              }}
              onMouseDown={(event) => {
                if (event.button === 0) onSelect(tab);
                // Middle click closes a tab; do not start Chromium's autoscroll.
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button === 1 && closable(tab) && !closeDisabled) onClose(tab);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(tab, event);
              }}
            >
              {orientation === 'vertical' && (
                <span className="workspace-tab-icon" aria-hidden="true">
                  <RepositoryIcon size={14} />
                </span>
              )}
              {dirty && (
                <span
                  className="workspace-tab-dirty"
                  data-testid="tab-dirty-indicator"
                  title="Uncommitted changes"
                  aria-hidden="true"
                />
              )}
              <span className="workspace-tab-title">{tab.title}</span>
              {closable(tab) && (
                <button
                  type="button"
                  className="workspace-tab-close"
                  aria-label={`Close ${tab.title}`}
                  title={`Close ${tab.title}`}
                  tabIndex={-1}
                  disabled={closeDisabled}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => onClose(tab)}
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="workspace-tab-new"
        aria-label="New tab"
        title="New Tab"
        onClick={onNewTab}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
