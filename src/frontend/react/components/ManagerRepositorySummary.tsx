import { useEffect, useState } from 'react';
import type { RepositoryManagerLocation, RepositoryManagerOverview } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { formatRelativeDate } from '../lib/format';
import { BranchIcon, TagIcon } from './Icons';

export function ManagerRepositorySummary({ location }: { readonly location: RepositoryManagerLocation }) {
  const [value, setValue] = useState<RepositoryManagerOverview>();
  const [error, setError] = useState<string>();
  const { kind, id } = location;
  useEffect(() => {
    let disposed = false;
    setValue(undefined);
    setError(undefined);
    void window.desktop?.repository
      .getManagerOverview({ kind, id } as RepositoryManagerLocation)
      .then((result) => {
        if (!disposed) setValue(unwrapResult(result));
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : 'Repository summary could not be loaded.');
      });
    return () => {
      disposed = true;
    };
  }, [kind, id]);
  if (error)
    return (
      <p role="status" className="manager-warning">
        {error}
      </p>
    );
  if (!value)
    return (
      <p role="status" className="sidebar-note">
        Reading repository…
      </p>
    );
  return (
    <div className="manager-summary" data-testid="manager-summary">
      <div className="manager-summary-top">
        <dl className="manager-facts">
          <dt>Uncommitted Files:</dt>
          <dd className={value.workingTree.state === 'dirty' ? 'manager-dirty-count' : ''}>
            {value.workingTree.changedFileCount ??
              (value.workingTree.state === 'unavailable' ? 'Bare repository' : 'Requires repository trust')}
          </dd>
          <dt>Commits:</dt>
          <dd>{value.commitCount?.toLocaleString() ?? '—'}</dd>
          <dt>Initial Commit:</dt>
          <dd>{value.firstCommitAt ? formatRelativeDate(value.firstCommitAt) : '—'}</dd>
          <dt>Last Commit:</dt>
          <dd>{value.lastCommitAt ? formatRelativeDate(value.lastCommitAt) : '—'}</dd>
        </dl>
        <div className="manager-remotes">
          <span>Remotes:</span>
          {value.remotes.length ? (
            value.remotes.map((remote) => (
              <p key={remote.name} title={remote.url}>
                <BranchIcon size={14} />
                <strong>{remote.name}</strong>
                <span>{remote.url}</span>
              </p>
            ))
          ) : (
            <p className="muted">No remotes</p>
          )}
        </div>
      </div>
      <div className="manager-summary-label">Summary</div>
      {(['branches', 'tags'] as const).map((kind) => (
        <section className="manager-reference-section" key={kind}>
          <h3>{kind === 'branches' ? 'Branches' : 'Tags'}</h3>
          {value[kind].length ? (
            <table aria-label={kind === 'branches' ? 'Repository branches' : 'Repository tags'}>
              <tbody>
                {value[kind].map((reference) => (
                  <tr key={reference.name}>
                    <td title={reference.name}>
                      {kind === 'branches' ? <BranchIcon size={14} /> : <TagIcon size={14} />}
                      {reference.name}
                    </td>
                    <td title={reference.subject}>{reference.subject}</td>
                    <td>{reference.author}</td>
                    <td>{reference.date ? formatRelativeDate(reference.date) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{kind === 'branches' ? 'No branches yet' : 'No tags'}</p>
          )}
        </section>
      ))}
    </div>
  );
}
