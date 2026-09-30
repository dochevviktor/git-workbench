import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HostingNotificationSnapshot } from '../../../common/ipc/hosting';
import { unwrapResult } from '../../../common/ipc/result';
import { CloseIcon } from './Icons';

/** Independently drawn bell and text cards; no downloaded avatars or provider artwork. */
export function HostingNotifications() {
  const [snapshot, setSnapshot] = useState<HostingNotificationSnapshot>({ revision: 0, accounts: [] });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const account = snapshot.accounts.find((entry) => entry.account.id === selected) ?? snapshot.accounts[0];
  const unread = snapshot.accounts.reduce(
    (sum, entry) => sum + entry.items.filter((item) => item.unread).length,
    0,
  );

  useEffect(() => {
    if (!window.desktop) return;
    let current = true;
    alive.current = true;
    const load = () => {
      void window
        .desktop!.hosting.getNotifications()
        .then(unwrapResult)
        .then((value) => {
          if (current) setSnapshot((previous) => (value.revision >= previous.revision ? value : previous));
        })
        .catch((reason: unknown) => {
          if (current)
            setError(reason instanceof Error ? reason.message : 'Notifications could not be loaded.');
        });
    };
    const release = window.desktop?.hosting.onNotificationsChanged(load);
    load();
    return () => {
      current = false;
      alive.current = false;
      release?.();
    };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const node = panel.current;
      if (!node) return;
      const bounds = anchor.current!.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(bounds.right - node.offsetWidth, window.innerWidth - node.offsetWidth - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - node.offsetHeight - 8))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, snapshot]);
  useEffect(() => {
    if (!open) return;
    const returnFocus = anchor.current;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const pointer = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !anchor.current?.contains(event.target)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      if (event.key === 'Tab' && panel.current) {
        const nodes = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), select')];
        const edge = event.shiftKey ? nodes[0] : nodes.at(-1);
        if (document.activeElement === edge) {
          event.preventDefault();
          (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
        }
      }
    };
    window.addEventListener('mousedown', pointer, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', pointer, true);
      window.removeEventListener('keydown', key, true);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'The request failed.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="hosting-notification-anchor">
      <button
        ref={anchor}
        className="toolbar-button"
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={unread ? `Notifications: ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="toolbar-button-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            aria-hidden="true"
          >
            <path d="M4 12V7a5 5 0 0 1 10 0v5l1 2H3l1-2M7 16h4" />
          </svg>
        </span>
        <span className="toolbar-button-label">
          {unread ? `${unread}${snapshot.accounts.some((entry) => entry.hasMore) ? '+' : ''}` : ''}
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          className="hosting-notifications-popover"
          role="dialog"
          aria-label="Notifications"
          aria-busy={busy}
        >
          <header>
            <h2>Notifications</h2>
            <button
              className="link-button"
              type="button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              <CloseIcon />
            </button>
          </header>
          {snapshot.accounts.length > 1 && (
            <select
              aria-label="Notification account"
              value={account?.account.id ?? ''}
              onChange={(event) => {
                setSelected(event.target.value);
                setError('');
              }}
            >
              {snapshot.accounts.map((entry) => (
                <option key={entry.account.id} value={entry.account.id}>
                  {entry.account.login} · {entry.account.serverUrl}
                </option>
              ))}
            </select>
          )}
          {!account && <p>Connect a GitHub account in Preferences → Accounts to view notifications.</p>}
          {account && !account.account.notificationsEnabled && (
            <p>Enable Notifications in Preferences → Accounts to check this inbox automatically.</p>
          )}
          {account?.account.notificationsEnabled && (
            <>
              <div className="hosting-notification-refresh">
                <span className="muted">
                  {account.checkedAt
                    ? `Checked ${new Date(account.checkedAt).toLocaleTimeString()}`
                    : 'Checking inbox…'}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      unwrapResult(
                        await window.desktop!.hosting.refreshNotifications({ accountId: account.account.id }),
                      ),
                    )
                  }
                >
                  Refresh
                </button>
              </div>
              {!account.items.length && account.checkedAt && !account.error && (
                <p>No unread notifications.</p>
              )}
              <ul className="hosting-notification-cards">
                {account.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          unwrapResult(
                            await window.desktop!.hosting.openNotification({
                              accountId: account.account.id,
                              itemId: item.id,
                            }),
                          ),
                        )
                      }
                    >
                      <span className="hosting-notification-card-header">
                        <strong>{item.repository}</strong>
                        <time dateTime={item.updatedAt}>
                          {item.number ? `#${item.number} · ` : ''}
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </time>
                      </span>
                      <span className="hosting-notification-title">
                        <span aria-label={item.kind} className="hosting-notification-kind">
                          {item.kind === 'pull-request' ? '⑂' : 'ⓘ'}
                        </span>
                        <span>{item.title}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {account.hasMore && (
                <p className="muted">
                  Showing the first 100 unread items. Open Accounts → Notifications to browse further pages.
                </p>
              )}
              {account.error && <p role="alert">{account.error}</p>}
            </>
          )}
          {snapshot.preferencesError && <p role="alert">{snapshot.preferencesError}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
