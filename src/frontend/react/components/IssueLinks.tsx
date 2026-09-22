import { useEffect, useState } from 'react';
import type { IssueRule } from '../../../common/ipc/settings';
import { unwrapResult } from '../../../common/ipc/result';

export function IssueLinks({ repositoryId, message }: { repositoryId: string | undefined; message: string }) {
  const [rule, setRule] = useState<{ id: string; value: IssueRule | null }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const load = () => {
      if (!repositoryId) return;
      void window.desktop?.settings.getGit({ id: repositoryId }).then((result) => {
        if (current) setRule({ id: repositoryId, value: result.ok ? result.value.issueRule : null });
      });
    };
    load();
    const release = window.desktop?.settings.onChanged(load);
    return () => {
      current = false;
      release?.();
    };
  }, [repositoryId]);
  if (!repositoryId || rule?.id !== repositoryId || !rule.value) return null;
  const prefix = rule.value.prefix;
  const numbers = [
    ...new Set(
      message
        .split(prefix)
        .slice(1)
        .map((part) => /^(\d{1,12})(?!\d)/u.exec(part)?.[1])
        .filter((value): value is string => Boolean(value)),
    ),
  ].slice(0, 30);
  return (
    <div className="settings-links" aria-label="Issue links">
      {numbers.map((number) => (
        <button
          type="button"
          className="link-button"
          key={number}
          title={rule.value!.url.replace('{id}', number)}
          onClick={() => {
            void window.desktop?.settings
              .openIssue({ id: repositoryId, number })
              .then(unwrapResult)
              .catch(() => setError('The issue link could not be opened.'));
          }}
        >
          {prefix}
          {number} ↗
        </button>
      ))}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
