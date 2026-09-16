import type {
  RepositoryHistoryCommit,
  RepositoryHistoryPerson,
  RepositoryHistoryReference,
} from '../../../common/ipc/contracts';
import { avatarColor, formatDetailDate, initials, shortHash } from '../lib/format';
import { referenceChips } from '../lib/references';
import { ReferenceChipList } from './ReferenceChipList';

interface CommitDetailsProps {
  readonly commit: RepositoryHistoryCommit | undefined;
  readonly lane: number | undefined;
  readonly referencesByName: ReadonlyMap<string, RepositoryHistoryReference>;
  readonly loadedCommitIds: ReadonlySet<string>;
  readonly onSelectCommit: (id: string) => void;
}

function Person({ caption, person }: { readonly caption: string; readonly person: RepositoryHistoryPerson }) {
  return (
    <div className="details-person">
      <span className="details-caption">{caption}</span>
      <div className="details-person-body">
        <span
          className={`avatar large avatar-${avatarColor(person.email || person.name)}`}
          aria-hidden="true"
        >
          {initials(person.name, person.email)}
        </span>
        <div className="details-person-copy">
          <div>
            <strong>{person.name || 'Unknown'}</strong> <span className="muted">{person.email}</span>
          </div>
          <time className="muted" dateTime={person.date}>
            {formatDetailDate(person.date)}
          </time>
        </div>
      </div>
    </div>
  );
}

function samePerson(left: RepositoryHistoryPerson, right: RepositoryHistoryPerson): boolean {
  return left.name === right.name && left.email === right.email && left.date === right.date;
}

export function CommitDetails({
  commit,
  lane,
  referencesByName,
  loadedCommitIds,
  onSelectCommit,
}: CommitDetailsProps) {
  const chips = commit ? referenceChips(commit.decorations, referencesByName) : [];

  return (
    <section className="commit-details" aria-label="Commit details">
      <div className="details-tabs" role="tablist" aria-label="Commit detail views">
        <button type="button" role="tab" aria-selected="true" className="details-tab active">
          Commit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          aria-disabled="true"
          className="details-tab"
          title="Changed files are not available yet (planned for P03)."
        >
          Changes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          aria-disabled="true"
          className="details-tab"
          title="The revision file tree is not available yet (planned for P03)."
        >
          File Tree
        </button>
      </div>
      <div className="details-panel" role="tabpanel" aria-label="Commit">
        {!commit ? (
          <p className="details-empty">Select a commit to inspect its metadata and message.</p>
        ) : (
          <div className="details-content">
            <div className="details-people">
              <Person caption="Author" person={commit.author} />
              {!samePerson(commit.author, commit.committer) && (
                <Person caption="Committer" person={commit.committer} />
              )}
            </div>
            <dl className="details-fields">
              {chips.length > 0 && (
                <>
                  <dt>Refs</dt>
                  <dd>
                    <ReferenceChipList chips={chips} lane={lane ?? 0} />
                  </dd>
                </>
              )}
              <dt>SHA</dt>
              <dd>
                <code className="history-full-hash">{commit.id}</code>
              </dd>
              <dt>Parents</dt>
              <dd className="details-parents">
                {commit.parents.length === 0
                  ? 'None (root commit)'
                  : commit.parents.map((parent) => {
                      const loaded = loadedCommitIds.has(parent);
                      return (
                        <button
                          key={parent}
                          type="button"
                          className="link-button"
                          aria-disabled={loaded ? undefined : true}
                          title={loaded ? parent : `${parent} is not loaded in the commit list yet.`}
                          onClick={() => {
                            if (loaded) onSelectCommit(parent);
                          }}
                        >
                          {shortHash(parent)}
                        </button>
                      );
                    })}
              </dd>
            </dl>
            <div className="details-message">
              <h2>{commit.subject || '(no subject)'}</h2>
              {commit.body && <p className="details-message-body">{commit.body}</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
