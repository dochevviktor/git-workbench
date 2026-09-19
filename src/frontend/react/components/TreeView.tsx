import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import type { SelectionModifiers } from '../lib/list-selection';
import { ChevronDownIcon, ChevronRightIcon } from './Icons';

const noModifiers: SelectionModifiers = { toggle: false, range: false };

function selectionModifiers(event: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): SelectionModifiers {
  return { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey };
}

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
  readonly draggable?: boolean | undefined;
}

interface TreeViewProps {
  readonly items: readonly TreeItem[];
  readonly label: string;
  readonly activeKey: string | undefined;
  readonly idPrefix: string;
  readonly className?: string | undefined;
  /** Rows shown as selected when the list supports selecting several at once. */
  readonly selectedKeys?: ReadonlySet<string> | undefined;
  readonly onActiveChange: (key: string, modifiers: SelectionModifiers) => void;
  readonly onToggle: (item: TreeItem, expand: boolean) => void;
  /** Enter or double click. */
  readonly onActivate?: ((item: TreeItem) => void) | undefined;
  /** Single click or keyboard movement. */
  readonly onSelect?: ((item: TreeItem) => void) | undefined;
  readonly onContextMenu?: ((item: TreeItem, event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  readonly onDragStart?: ((item: TreeItem, event: ReactDragEvent<HTMLElement>) => void) | undefined;
  readonly onDrop?: ((item: TreeItem, event: ReactDragEvent<HTMLElement>) => void) | undefined;
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
  selectedKeys,
  onActiveChange,
  onToggle,
  onActivate,
  onSelect,
  onContextMenu,
  onDragStart,
  onDrop,
  children,
}: TreeViewProps) {
  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const rowId = (item: TreeItem) => `${idPrefix}-${item.key}`;

  const moveTo = (index: number, extend = false) => {
    const item = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!item) return;
    onActiveChange(item.key, { toggle: false, range: extend });
    onSelect?.(item);
    document.getElementById(rowId(item))?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const item = items[activeIndex];
    const extend = event.shiftKey;
    switch (event.key) {
      case 'ArrowDown':
        moveTo(activeIndex + 1, extend);
        break;
      case 'ArrowUp':
        moveTo(activeIndex < 0 ? items.length - 1 : activeIndex - 1, extend);
        break;
      case 'Home':
        moveTo(0, extend);
        break;
      case 'End':
        moveTo(items.length - 1, extend);
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
      aria-multiselectable={selectedKeys ? true : undefined}
      tabIndex={0}
      aria-activedescendant={activeIndex >= 0 ? rowId(items[activeIndex]!) : undefined}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget && activeIndex < 0 && items[0])
          onActiveChange(items[0].key, noModifiers);
      }}
    >
      {items.map((item) => {
        const selected = selectedKeys ? selectedKeys.has(item.key) : item.key === activeKey;
        const classes = ['tree-row'];
        if (item.className) classes.push(item.className);
        if (selected) classes.push('active');
        if (selectedKeys && item.key === activeKey) classes.push('focused');
        if (item.unavailable) classes.push('unavailable');
        return (
          <div
            key={item.key}
            id={rowId(item)}
            role="treeitem"
            className={classes.join(' ')}
            aria-level={item.level}
            aria-expanded={item.expandable ? item.expanded : undefined}
            aria-selected={selected}
            aria-disabled={item.unavailable ? true : undefined}
            draggable={item.draggable}
            title={item.title}
            data-testid={item.testId}
            style={{ paddingLeft: 4 + (item.level - 1) * 16 }}
            onMouseDown={(event) => {
              if (event.button !== 0 && event.button !== 2) return;
              // A right click keeps an existing multi-selection the menu is about to act on.
              const keepSelection = event.button === 2 && selected;
              if (!keepSelection) onActiveChange(item.key, selectionModifiers(event));
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
              onContextMenu(item, event);
            }}
            onDragStart={(event) => onDragStart?.(item, event)}
            onDragOver={(event) => {
              if (onDrop && item.draggable) event.preventDefault();
            }}
            onDrop={(event) => onDrop?.(item, event)}
          >
            <span
              className="tree-disclosure"
              aria-hidden="true"
              onMouseDown={(event) => {
                if (!item.expandable || event.button !== 0) return;
                event.stopPropagation();
                onActiveChange(item.key, noModifiers);
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
