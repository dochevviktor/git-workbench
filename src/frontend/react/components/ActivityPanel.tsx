import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { formatListDate } from '../lib/format';
import { CheckIcon, CloseIcon, WarningIcon } from './Icons';

interface ActivityPanelProps {
  readonly operations: readonly RepositoryOperation[];
  readonly onCancel: (operationId: string) => void;
  readonly onClose: () => void;
}

function statusLabel(operation: RepositoryOperation): string {
  switch (operation.status) {
    case 'running':
      return operation.progress
        ? `${operation.progress.phase}${operation.progress.percent === null ? '' : ` ${operation.progress.percent}%`}`
        : operation.message;
    case 'succeeded':
      return operation.message;
    case 'failed':
      return operation.message;
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Fork's activity list: what ran, how it ended, and the command and output behind it. */
export function ActivityPanel({ operations, onCancel, onClose }: ActivityPanelProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = operations.find((operation) => operation.id === selectedId) ?? operations[0];

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const anchor = panel.parentElement?.getBoundingClientRect();
      const width = Math.min(720, window.innerWidth - 16);
      panel.style.left = `${Math.max(8, Math.min(anchor?.left ?? 8, window.innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min((anchor?.bottom ?? 70) + 6, window.innerHeight - panel.offsetHeight - 8))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panelRef.current?.contains(target)) return;
      // The button that opened the panel toggles it itself; closing here too would reopen it.
      if (target instanceof Element && target.closest('[data-testid="toolbar-activity"]')) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    // Pointer events are captured so a click on the toolbar button below also closes the panel.
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="activity-panel" ref={panelRef} role="dialog" aria-label="Activity" data-testid="activity">
      <div className="activity-list" role="listbox" aria-label="Operations">
        {operations.length === 0 && <p className="activity-empty muted">Nothing has run yet.</p>}
        {operations.map((operation) => (
          <div
            key={operation.id}
            role="option"
            aria-selected={operation.id === selected?.id}
            tabIndex={operation.id === selected?.id ? 0 : -1}
            onFocus={() => setSelectedId(operation.id)}
            onKeyDown={(event) => {
              const index = operations.indexOf(operation);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? operations.length - 1
                    : event.key === 'ArrowDown'
                      ? Math.min(index + 1, operations.length - 1)
                      : event.key === 'ArrowUp'
                        ? Math.max(0, index - 1)
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
            }}
            className={`activity-row ${operation.status}${operation.id === selected?.id ? ' selected' : ''}`}
            data-testid="activity-row"
            onMouseDown={() => setSelectedId(operation.id)}
          >
            <div className="activity-row-copy">
              <span className="activity-title">{operation.title}</span>
              <span className="activity-status">{statusLabel(operation)}</span>
            </div>
            {operation.status === 'running' ? (
              <button
                type="button"
                className="icon-button"
                aria-label={`Cancel ${operation.title}`}
                title="Cancel"
                onClick={() => onCancel(operation.id)}
              >
                <CloseIcon size={12} />
              </button>
            ) : (
              <span className={`activity-mark ${operation.status}`} aria-hidden="true">
                {operation.status === 'succeeded' ? <CheckIcon size={13} /> : <WarningIcon size={13} />}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="activity-detail">
        {selected ? (
          <>
            <div className="activity-detail-header">
              <strong>{selected.title}</strong>
              <span className="muted">
                {selected.status === 'running'
                  ? 'running'
                  : `${selected.status} ${selected.finishedAt ? formatListDate(selected.finishedAt) : ''}`}
              </span>
            </div>
            <pre className="activity-command">
              {selected.command ? `$ ${selected.command}` : 'Preparing operation…'}
            </pre>
            {selected.progress && (
              <div
                className="activity-progress"
                role="progressbar"
                aria-valuenow={selected.progress.percent ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={selected.progress.phase}
              >
                <span
                  className="activity-progress-bar"
                  style={{ width: `${selected.progress.percent ?? 0}%` }}
                />
              </div>
            )}
            <pre className="activity-output" data-testid="activity-output">
              {selected.output || selected.message}
            </pre>
          </>
        ) : (
          <p className="muted">Fetch, pull, and push activity appears here.</p>
        )}
      </div>
    </div>
  );
}
