import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from './Icons';

export interface TreeItem {
  readonly key: string;
  readonly level: number;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly meta?: ReactNode;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly parentKey: string | null;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  readonly unavailable?: boolean | undefined;
  /** Section headings expand and collapse with a single click. */
  readonly toggleOnClick?: boolean | undefined;
  readonly testId?: string | undefined;
}

interface TreeViewProps {
  readonly items: readonly TreeItem[];
  readonly label: string;
  readonly activeKey: string | undefined;
  readonly idPrefix: string;
  readonly className?: string | undefined;
  readonly onActiveChange: (key: string) => void;
  readonly onToggle: (item: TreeItem, expand: boolean) => void;
  /** Enter or double click. */
  readonly onActivate?: ((item: TreeItem) => void) | undefined;
  /** Single click or keyboard movement. */
  readonly onSelect?: ((item: TreeItem) => void) | undefined;
  readonly onContextMenu?: ((item: TreeItem, event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  readonly children?: ReactNode;
}

function fromDisclosure(event: ReactMouseEvent<HTMLElement>): boolean {
  return event.target instanceof Element && event.target.closest('.tree-disclosure') !== null;
}

export function TreeView({
  items,
  label,
  activeKey,
  idPrefix,
  className,
  onActiveChange,
  onToggle,
  onActivate,
  onSelect,
  onContextMenu,
  children,
}: TreeViewProps) {
  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const rowId = (item: TreeItem) => `${idPrefix}-${item.key}`;

  const moveTo = (index: number) => {
    const item = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!item) return;
    onActiveChange(item.key);
    onSelect?.(item);
    document.getElementById(rowId(item))?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const item = items[activeIndex];
    switch (event.key) {
      case 'ArrowDown':
        moveTo(activeIndex + 1);
        break;
      case 'ArrowUp':
        moveTo(activeIndex < 0 ? items.length - 1 : activeIndex - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(items.length - 1);
        break;
      case 'ArrowRight':
        if (item?.expandable && !item.expanded) onToggle(item, true);
        else if (item?.expandable) moveTo(activeIndex + 1);
        break;
      case 'ArrowLeft':
        if (item?.expandable && item.expanded) onToggle(item, false);
        else if (item?.parentKey) moveTo(items.findIndex((candidate) => candidate.key === item.parentKey));
        break;
      case 'Enter':
        if (!item) return;
        if (onActivate && !item.expandable) onActivate(item);
        else if (item.expandable) onToggle(item, !item.expanded);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      className={className ? `tree ${className}` : 'tree'}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={activeIndex >= 0 ? rowId(items[activeIndex]!) : undefined}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget && activeIndex < 0 && items[0]) onActiveChange(items[0].key);
      }}
    >
      {items.map((item) => {
        const classes = ['tree-row'];
        if (item.className) classes.push(item.className);
        if (item.key === activeKey) classes.push('active');
        if (item.unavailable) classes.push('unavailable');
        return (
          <div
            key={item.key}
            id={rowId(item)}
            role="treeitem"
            className={classes.join(' ')}
            aria-level={item.level}
            aria-expanded={item.expandable ? item.expanded : undefined}
            aria-selected={item.key === activeKey}
            aria-disabled={item.unavailable ? true : undefined}
            title={item.title}
            data-testid={item.testId}
            style={{ paddingLeft: 4 + (item.level - 1) * 16 }}
            onMouseDown={(event) => {
              if (event.button !== 0 && event.button !== 2) return;
              onActiveChange(item.key);
              if (event.button === 0) onSelect?.(item);
            }}
            onClick={(event) => {
              if (fromDisclosure(event)) return;
              if (item.expandable && item.toggleOnClick) onToggle(item, !item.expanded);
            }}
            onDoubleClick={(event) => {
              if (fromDisclosure(event)) return;
              if (item.expandable && !item.toggleOnClick) onToggle(item, !item.expanded);
              else if (!item.expandable) onActivate?.(item);
            }}
            onContextMenu={(event) => {
              if (!onContextMenu) return;
              event.preventDefault();
              onActiveChange(item.key);
              onContextMenu(item, event);
            }}
          >
            <span
              className="tree-disclosure"
              aria-hidden="true"
              onMouseDown={(event) => {
                if (!item.expandable || event.button !== 0) return;
                event.stopPropagation();
                onActiveChange(item.key);
                onToggle(item, !item.expanded);
              }}
            >
              {item.expandable ? (
                item.expanded ? (
                  <ChevronDownIcon size={11} />
                ) : (
                  <ChevronRightIcon size={11} />
                )
              ) : null}
            </span>
            {item.icon && (
              <span className="tree-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="tree-label">{item.label}</span>
            {item.meta && <span className="tree-meta">{item.meta}</span>}
          </div>
        );
      })}
      {children}
    </div>
  );
}
