import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { formatListDate } from '../lib/format';
import { CheckIcon, CloseIcon, WarningIcon } from './Icons';

interface ActivityPanelProps {
  readonly operations: readonly RepositoryOperation[];
  readonly onCancel: (operationId: string) => void;
  readonly onClose: () => void;
}

type ActivityScope = 'all' | 'user' | 'background';

const activityScopes: readonly { readonly id: ActivityScope; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'background', label: 'Background' },
];

function statusLabel(operation: RepositoryOperation): string {
  if (operation.status === 'running' && operation.cancelRequested) return 'Cancelling…';
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
  const [scope, setScope] = useState<ActivityScope>('all');
  const panelRef = useRef<HTMLDivElement>(null);
  const visibleOperations = operations.filter((operation) => scope === 'all' || operation.source === scope);
  const selected = visibleOperations.find((operation) => operation.id === selectedId) ?? visibleOperations[0];

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const anchor = panel.parentElement?.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      panel.style.left = `${Math.max(16, Math.min((anchor?.left ?? window.innerWidth / 2) + (anchor?.width ?? 0) / 2 - width / 2, window.innerWidth - width - 16))}px`;
      panel.style.top = `${Math.max(8, Math.min((anchor?.bottom ?? 70) + 2, window.innerHeight - panel.offsetHeight - 8))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    (
      panelRef.current?.querySelector<HTMLElement>('[role="option"]') ??
      panelRef.current?.querySelector<HTMLElement>('[role="tab"]')
    )?.focus();
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
      <div className="activity-sidebar">
        <div className="activity-tabs" role="tablist" aria-label="Activity scope">
          {activityScopes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              tabIndex={scope === item.id ? 0 : -1}
              aria-selected={scope === item.id}
              onKeyDown={(event) => {
                const index = activityScopes.findIndex((candidate) => candidate.id === item.id);
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % 3
                    : event.key === 'ArrowLeft'
                      ? (index + 2) % 3
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                setScope(activityScopes[next]!.id);
                panelRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
              }}
              className={scope === item.id ? 'activity-tab active' : 'activity-tab'}
              data-testid={`activity-tab-${item.id}`}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="activity-list" role="listbox" aria-label={`${scope} operations`}>
          {visibleOperations.length === 0 && (
            <p className="activity-empty muted">
              {scope === 'background' ? 'No automatic fetches have run yet.' : 'Nothing has run yet.'}
            </p>
          )}
          {visibleOperations.map((operation) => (
            <div
              key={operation.id}
              role="option"
              aria-selected={operation.id === selected?.id}
              tabIndex={operation.id === selected?.id ? 0 : -1}
              onFocus={() => setSelectedId(operation.id)}
              onKeyDown={(event) => {
                const index = visibleOperations.indexOf(operation);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? visibleOperations.length - 1
                      : event.key === 'ArrowDown'
                        ? Math.min(index + 1, visibleOperations.length - 1)
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
              <time
                className="activity-time"
                dateTime={operation.startedAt}
                title={formatListDate(operation.startedAt)}
              >
                {new Date(operation.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
              {operation.status === 'running' ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Cancel ${operation.title}`}
                  title="Cancel"
                  disabled={operation.cancelRequested}
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
      </div>
      <div className="activity-detail">
        {selected ? (
          <>
            <div className="activity-detail-header">
              <strong>{selected.title}</strong>
              <span className="muted">
                {selected.status === 'running'
                  ? selected.cancelRequested
                    ? 'cancelling…'
                    : 'running…'
                  : `${selected.status} ${selected.finishedAt ? formatListDate(selected.finishedAt) : ''}`}
              </span>
            </div>
            <div className="activity-log" tabIndex={0} aria-label="Command and output">
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
              {selected.output && selected.status !== 'running' && (
                <p className="muted" role="status">
                  {selected.message}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Fetch, pull, and push activity appears here.</p>
        )}
      </div>
    </div>
  );
}
