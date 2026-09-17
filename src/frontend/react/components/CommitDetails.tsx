import { useEffect, useState } from 'react';
import type {
  RepositoryHistoryCommit,
  RepositoryHistoryPerson,
  RepositoryHistoryReference,
} from '../../../common/ipc/contracts';
import { useRevisionInspection } from '../hooks/use-revision-inspection';
import { avatarColor, countLabel, formatDetailDate, initials, shortHash } from '../lib/format';
import { referenceChips } from '../lib/references';
import { ChangesIcon, FolderIcon } from './Icons';
import { ReferenceChipList } from './ReferenceChipList';

type DetailTab = 'commit' | 'changes' | 'tree';

interface CommitDetailsProps {
  readonly repositoryId: string | undefined;
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

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function renderPath(path: string, className = '') {
  return <code className={className}>{path}</code>;
}

export function CommitDetails({
  repositoryId,
  commit,
  lane,
  referencesByName,
  loadedCommitIds,
  onSelectCommit,
}: CommitDetailsProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('commit');
  const inspection = useRevisionInspection(repositoryId, commit?.id);
  const chips = commit ? referenceChips(commit.decorations, referencesByName) : [];

  useEffect(() => {
    setActiveTab('commit');
  }, [commit?.id, repositoryId]);

  useEffect(() => {
    if (activeTab === 'changes' && commit && !inspection.changes && !inspection.changesLoading) {
      if (!inspection.changesError) void inspection.loadChanges();
    }
    if (activeTab === 'tree' && commit && !inspection.tree && !inspection.treeLoading) {
      if (!inspection.treeError) void inspection.loadTree(inspection.treePath);
    }
  }, [activeTab, commit, inspection]);

  const renderCommit = () => (
    <div className="details-content">
      {!commit ? (
        <p className="details-empty">Select a commit to inspect its metadata and message.</p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );

  const renderChanges = () => {
    if (inspection.changesLoading) return <p className="details-empty">Reading changed files…</p>;
    if (inspection.changesError) {
      return (
        <div className="details-content">
          <div className="inline-alert" role="alert">
            <span>{inspection.changesError}</span>
            <button type="button" className="button" onClick={() => void inspection.loadChanges()}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    if (!inspection.changes)
      return <p className="details-empty">Select a commit to inspect changed files.</p>;
    return (
      <div className="details-content revision-changes" data-testid="commit-changes">
        <div className="revision-summary">
          {inspection.changes.changes.length === 0
            ? 'No files changed in this commit.'
            : countLabel(inspection.changes.changes.length, 'changed file')}
          {inspection.changes.truncated && <span className="muted"> (list truncated)</span>}
        </div>
        {inspection.changes.changes.length > 0 && (
          <ul className="revision-change-list">
            {inspection.changes.changes.map((change) => (
              <li
                key={`${change.previousPath ?? ''}\0${change.path}`}
                className="revision-change-row"
                data-testid="commit-change"
              >
                <span className={`revision-change-status ${change.status}`}>{change.status}</span>
                <span className="revision-change-paths">
                  {change.previousPath && (
                    <>
                      {renderPath(change.previousPath, 'revision-previous-path')}
                      <span className="revision-path-arrow" aria-hidden="true">
                        →
                      </span>
                    </>
                  )}
                  {renderPath(change.path)}
                </span>
                {change.similarity !== null && <span className="muted">{change.similarity}%</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderTree = () => {
    const treePathParts = inspection.treePath ? inspection.treePath.split('/') : [];
    if (inspection.treeLoading) return <p className="details-empty">Reading the revision tree…</p>;
    if (inspection.treeError) {
      return (
        <div className="details-content">
          <div className="inline-alert" role="alert">
            <span>{inspection.treeError}</span>
            <button
              type="button"
              className="button"
              onClick={() => void inspection.loadTree(inspection.treePath)}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    if (!inspection.tree) return <p className="details-empty">Select a commit to browse its file tree.</p>;

    return (
      <div className="details-content revision-tree">
        <div className="revision-tree-toolbar">
          <button
            type="button"
            className="button button-small"
            disabled={inspection.treePath.length === 0}
            onClick={() => void inspection.loadTree(parentPath(inspection.treePath))}
          >
            Up
          </button>
          <nav className="revision-tree-breadcrumbs" aria-label="Revision path">
            <button
              type="button"
              className={inspection.treePath.length === 0 ? 'active' : ''}
              onClick={() => void inspection.loadTree('')}
            >
              Root
            </button>
            {treePathParts.map((part, index) => {
              const path = treePathParts.slice(0, index + 1).join('/');
              return (
                <span key={`${path}-${index}`}>
                  <span className="revision-path-arrow" aria-hidden="true">
                    /
                  </span>
                  <button
                    type="button"
                    className={path === inspection.treePath ? 'active' : ''}
                    onClick={() => void inspection.loadTree(path)}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </nav>
        </div>
        {inspection.tree.entries.length === 0 ? (
          <p className="revision-empty">This folder is empty.</p>
        ) : (
          <ul className="revision-tree-list" role="tree" aria-label="Files at revision">
            {inspection.tree.entries.map((entry) => {
              const folder = entry.type === 'tree';
              const submodule = entry.type === 'commit';
              return (
                <li key={entry.path} role="treeitem" className="revision-tree-row">
                  <button
                    type="button"
                    className="revision-tree-entry"
                    data-testid="revision-tree-entry"
                    disabled={submodule}
                    title={submodule ? 'Submodule contents are not available in this revision.' : entry.path}
                    onClick={() => {
                      if (folder) void inspection.loadTree(entry.path);
                      else if (!submodule) void inspection.loadBlob(entry.path);
                    }}
                  >
                    {folder ? <FolderIcon size={15} /> : <ChangesIcon size={15} />}
                    <span className="revision-tree-name">{entry.name}</span>
                    <span className="revision-tree-kind">
                      {submodule ? 'submodule' : folder ? 'folder' : 'file'}
                    </span>
                    {!folder && entry.size !== null && (
                      <span className="revision-tree-size">{entry.size.toLocaleString()} B</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {inspection.tree.truncated && (
          <p className="revision-tree-note">This folder contains more entries than can be displayed.</p>
        )}
        {inspection.blobPath && (
          <div className="revision-blob-preview" aria-live="polite">
            <div className="revision-blob-heading">
              <strong>{renderPath(inspection.blobPath)}</strong>
            </div>
            {inspection.blobLoading ? (
              <p className="revision-empty">Reading file…</p>
            ) : inspection.blobError ? (
              <div className="inline-alert" role="alert">
                <span>{inspection.blobError}</span>
                <button
                  type="button"
                  className="button"
                  onClick={() => void inspection.loadBlob(inspection.blobPath!)}
                >
                  Retry
                </button>
              </div>
            ) : inspection.blob?.state === 'binary' ? (
              <p className="revision-empty">This file is binary and has no text preview.</p>
            ) : inspection.blob?.state === 'too-large' ? (
              <p className="revision-empty">This file is too large for an inline preview.</p>
            ) : inspection.blob ? (
              <pre className="revision-blob-content" data-testid="revision-blob">
                {inspection.blob.content}
              </pre>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  const tabs: readonly { readonly id: DetailTab; readonly label: string }[] = [
    { id: 'commit', label: 'Commit' },
    { id: 'changes', label: 'Changes' },
    { id: 'tree', label: 'File Tree' },
  ];
  const panel =
    activeTab === 'commit' ? renderCommit() : activeTab === 'changes' ? renderChanges() : renderTree();

  return (
    <section className="commit-details" aria-label="Commit details">
      <div className="details-tabs" role="tablist" aria-label="Commit detail views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`commit-detail-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`commit-detail-panel-${tab.id}`}
            className={activeTab === tab.id ? 'details-tab active' : 'details-tab'}
            disabled={!commit && tab.id !== 'commit'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`commit-detail-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`commit-detail-tab-${activeTab}`}
        aria-label={tabs.find((tab) => tab.id === activeTab)?.label}
        className="details-panel"
      >
        {panel}
      </div>
    </section>
  );
}
