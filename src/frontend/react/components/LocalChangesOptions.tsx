import { useId } from 'react';
import type {
  RepositoryLocalChangesPolicy,
  RepositoryLocalChangesPreview,
} from '../../../common/ipc/contracts';

export function LocalChangesOptions({
  value,
  preview,
  onChange,
}: {
  readonly value: RepositoryLocalChangesPolicy;
  readonly preview: RepositoryLocalChangesPreview | undefined;
  readonly onChange: (value: RepositoryLocalChangesPolicy) => void;
}) {
  const name = useId();
  return (
    <>
      <dt>Local changes:</dt>
      <dd>
        <fieldset className="local-changes-options" aria-label="Local changes">
          {(
            [
              ['stash', 'Stash and reapply'],
              ['keep', "Don't change"],
              ['discard', 'Discard'],
            ] as const
          ).map(([policy, label]) => (
            <label className="reference-checkbox" key={policy}>
              <input
                type="radio"
                name={name}
                value={policy}
                checked={value === policy}
                disabled={policy !== 'keep' && !preview}
                onChange={() => onChange(policy)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {value === 'discard' && preview && (
          <div className="local-changes-preview" data-testid="discard-preview">
            <p>Remove these changes from the working tree. A recovery copy will be kept.</p>
            <ul>
              {preview.paths.map((path) => (
                <li key={`tracked:${path}`}>{path}</li>
              ))}
              {preview.untrackedPaths.map((path) => (
                <li key={`untracked:${path}`}>{path} (untracked)</li>
              ))}
            </ul>
          </div>
        )}
      </dd>
    </>
  );
}
