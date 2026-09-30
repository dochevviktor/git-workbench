import { useEffect, useRef, useState } from 'react';
import type { HostingActivityPage, HostingActivityRequest } from '../../../common/ipc/hosting';
import { hostingActivityRequestSchema } from '../../../common/ipc/hosting';
import { unwrapResult } from '../../../common/ipc/result';

export function HostingActivity({
  initial,
  repositoryName,
  searches,
}: {
  readonly initial: HostingActivityRequest;
  readonly repositoryName: string | undefined;
  readonly searches: Map<string, string[]>;
}) {
  const [request, setRequest] = useState(initial);
  const [page, setPage] = useState<HostingActivityPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchKey = `${initial.accountId}/${initial.kind}/${initial.kind === 'notifications' ? '' : initial.repositoryId}`;
  const [recent, setRecent] = useState<string[]>(() => searches.get(searchKey) ?? []);
  const generation = useRef(0);
  const alive = useRef(true);
  const load = async (query: HostingActivityRequest) => {
    const id = ++generation.current;
    setPage(undefined);
    setError('');
    if (!hostingActivityRequestSchema.safeParse(query).success) {
      setError(
        'Use GitHub logins for author and assignee, and a title phrase without quotes or backslashes (up to 200 characters).',
      );
      return;
    }
    setBusy(true);
    try {
      const result = unwrapResult(await window.desktop!.hosting.listActivity(query));
      if (!alive.current || generation.current !== id) return;
      setPage(result);
      setRequest(query);
      if (result.recentSearches) {
        searches.set(searchKey, result.recentSearches);
        setRecent(result.recentSearches);
      }
      if (!result.recentSearches && query.kind !== 'notifications' && query.text.trim()) {
        const next = [query.text.trim(), ...recent.filter((value) => value !== query.text.trim())].slice(
          0,
          10,
        );
        if (searches.size >= 40 && !searches.has(searchKey)) searches.delete(searches.keys().next().value!);
        searches.set(searchKey, next);
        setRecent(next);
      }
    } catch (reason) {
      if (alive.current && generation.current === id)
        setError(reason instanceof Error ? reason.message : 'Could not load GitHub activity.');
    } finally {
      if (alive.current && generation.current === id) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load(initial);
    return () => {
      alive.current = false;
      // This is a request generation, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
    // The parent keys this view by account/repository/kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const edit = (query: HostingActivityRequest) => {
    setRequest(query);
    setPage(undefined);
    setError('');
  };
  return (
    <section aria-label="GitHub activity" aria-busy={busy}>
      {repositoryName && (
        <p>
          <strong>{repositoryName}</strong>
        </p>
      )}
      <h3>
        {request.kind === 'notifications'
          ? 'Notifications'
          : request.kind === 'issues'
            ? 'Issues'
            : 'Pull requests'}
      </h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load({ ...request, page: 1 });
        }}
      >
        <fieldset disabled={busy} className="hosting-activity-filters">
          {request.kind === 'notifications' ? (
            <>
              <label>
                Show{' '}
                <select
                  aria-label="Notification state"
                  value={request.all ? 'all' : 'unread'}
                  onChange={(event) => edit({ ...request, all: event.target.value === 'all' })}
                >
                  <option value="unread">Unread</option>
                  <option value="all">All</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={request.participating}
                  onChange={(event) => edit({ ...request, participating: event.target.checked })}
                />{' '}
                Participating only
              </label>
            </>
          ) : (
            <>
              <label>
                State{' '}
                <select
                  aria-label="Item state"
                  value={request.state}
                  onChange={(event) =>
                    edit({ ...request, state: event.target.value as 'open' | 'closed' | 'all' })
                  }
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="all">All</option>
                </select>
              </label>
              <label>
                Author{' '}
                <input
                  aria-label="Author"
                  value={request.author}
                  maxLength={100}
                  onChange={(event) => edit({ ...request, author: event.target.value })}
                />
              </label>
              <label>
                Assignee{' '}
                <input
                  aria-label="Assignee"
                  value={request.assignee}
                  maxLength={100}
                  onChange={(event) => edit({ ...request, assignee: event.target.value })}
                />
              </label>
              <label>
                Title{' '}
                <input
                  aria-label="Title phrase"
                  list="hosting-recent-searches"
                  value={request.text}
                  maxLength={200}
                  onChange={(event) => edit({ ...request, text: event.target.value })}
                />
              </label>
              <datalist id="hosting-recent-searches">
                {recent.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          )}
          <button className="button" type="submit">
            Apply filters
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void load({ ...request, page: page?.page ?? 1 })}
          >
            Refresh
          </button>
        </fieldset>
      </form>
      {request.kind === 'notifications' && (
        <p className="muted">
          Refresh to check for notifications. Opening an item does not mark it read here. Notifications
          require a classic token with notifications or repo scope; fine-grained tokens are not supported by
          this GitHub endpoint.
        </p>
      )}
      {busy && (
        <p role="status">
          Loading GitHub activity…{' '}
          <button
            className="link-button"
            type="button"
            onClick={() => {
              generation.current++;
              void window.desktop!.hosting.cancel();
              setBusy(false);
              setPage(undefined);
              setError('Request cancelled. Reopen Repositories before loading repository items again.');
            }}
          >
            Cancel request
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="hosting-error">
          {error}
        </p>
      )}
      {page?.preferencesError && (
        <p role="alert" className="hosting-error">
          {page.preferencesError} The current results are still available.
        </p>
      )}
      {page?.limited && (
        <p role="status">
          GitHub returned incomplete results or more than 1,000 matches. Narrow the filters.
        </p>
      )}
      {page && !page.items.length && <p>No matching items.</p>}
      <ul className="hosting-repositories hosting-activity-items">
        {page?.items.map((item) => (
          <li key={item.id}>
            <div className="hosting-actions">
              <strong>{item.repository}</strong>
              <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
            </div>
            <button
              className="link-button"
              type="button"
              onClick={() => {
                void window
                  .desktop!.hosting.openActivity({ accountId: request.accountId, itemId: item.id })
                  .then(unwrapResult)
                  .catch((reason: unknown) => {
                    if (alive.current)
                      setError(reason instanceof Error ? reason.message : 'Could not open item.');
                  });
              }}
            >
              {item.number ? `#${item.number} ` : ''}
              {item.title}
            </button>
            <span className="muted">
              {item.kind}
              {item.state ? ` · ${item.state}` : ''}
              {item.unread ? ' · Unread' : ''}
              {item.reason ? ` · ${item.reason}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {page && (
        <div className="hosting-actions">
          <button
            className="button"
            disabled={busy || page.page === 1}
            onClick={() => void load({ ...request, page: page.page - 1 })}
          >
            Previous
          </button>
          <span>Page {page.page}</span>
          <button
            className="button"
            disabled={busy || !page.nextPage}
            onClick={() => void load({ ...request, page: page.nextPage! })}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
