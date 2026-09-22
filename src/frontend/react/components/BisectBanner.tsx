import type { RepositoryBisectActionRequest, RepositoryBisectContext } from '../../../common/ipc/contracts';

export function BisectBanner({
  context,
  busy,
  error,
  onAction,
  onReveal,
}: {
  readonly context: RepositoryBisectContext;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onAction: (action: RepositoryBisectActionRequest['action']) => void;
  readonly onReveal: (id: string) => void;
}) {
  const finished = Boolean(context.firstBad || context.candidates.length);
  const disabled = busy || Boolean(context.blockedReason);
  const commit = (id: string) => (
    <button type="button" className="link-button" onClick={() => onReveal(id)} title={id}>
      {id.slice(0, 7)}
    </button>
  );
  return (
    <section className="bisect-banner" aria-label="Bisect">
      <div className="bisect-summary" role="status">
        <span>
          {context.firstBad ? (
            <>First bad commit: {commit(context.firstBad)}.</>
          ) : context.candidates.length ? (
            <>
              No unique first bad commit; skipped candidates:{' '}
              {context.candidates.map((id) => (
                <span key={id}>{commit(id)} </span>
              ))}
            </>
          ) : (
            <>
              Bisecting, started from ‘{context.original}’. Is {context.head && commit(context.head)} good or
              bad?
            </>
          )}
        </span>
        <span className="bisect-actions">
          <button
            className="button button-small"
            type="button"
            disabled={disabled || finished}
            onClick={() => onAction('bad')}
          >
            Bad
          </button>
          <button
            className="button button-small"
            type="button"
            disabled={disabled || finished || !context.bad || context.head === context.bad}
            onClick={() => onAction('good')}
          >
            Good
          </button>
          {context.bad && context.good.length > 0 && (
            <button
              className="button button-small"
              type="button"
              disabled={disabled || finished}
              onClick={() => onAction('skip')}
            >
              Skip
            </button>
          )}
          <button
            className="button button-small"
            type="button"
            disabled={disabled}
            onClick={() => onAction('reset')}
          >
            Abort
          </button>
        </span>
      </div>
      <div className="bisect-range">
        Bad: {context.bad ? commit(context.bad) : 'not marked'} · Good:{' '}
        {context.good.length
          ? context.good.map((id) => <span key={id}>{commit(id)} </span>)
          : 'check out a known good commit after marking Bad'}
        {context.skipped.length > 0 && (
          <>
            {' '}
            · Skipped:{' '}
            {context.skipped.map((id) => (
              <span key={id}>{commit(id)} </span>
            ))}
          </>
        )}
      </div>
      {(error || context.blockedReason) && <div role="alert">{error || context.blockedReason}</div>}
    </section>
  );
}
