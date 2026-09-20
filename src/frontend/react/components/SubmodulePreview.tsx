import type { RepositorySubmodule } from '../../../common/ipc/contracts';
import { shortHash } from '../lib/format';
import { SubmoduleIcon, WarningIcon } from './Icons';

interface SubmodulePreviewProps {
  readonly submodule: RepositorySubmodule;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onUpdate: () => void;
}

function revision(value: string | null): string {
  return value ? shortHash(value) : 'Not available';
}

function stateLabel(submodule: RepositorySubmodule): string {
  switch (submodule.state) {
    case 'dirty':
      return `${submodule.dirtyFileCount ?? 0} uncommitted ${submodule.dirtyFileCount === 1 ? 'file' : 'files'}`;
    case 'changed':
      return 'Child revision changed';
    case 'detached':
      return 'Detached HEAD';
    case 'uninitialized':
      return 'Not initialized';
    case 'missing':
      return 'Working tree missing';
    case 'missing-commit':
      return 'Recorded commit is missing';
    case 'conflicted':
      return 'Conflict';
    case 'unknown':
      return 'Status unavailable';
    case 'clean':
      return 'Clean';
  }
}

/** A gitlink comparison card; submodules deliberately do not use a text diff viewer. */
export function SubmodulePreview({ submodule, busy, onOpen, onUpdate }: SubmodulePreviewProps) {
  const newRevision = submodule.revisions.working ?? submodule.revisions.index;
  const canUpdate = !busy && submodule.state !== 'dirty' && submodule.state !== 'conflicted';
  return (
    <div className="submodule-preview" data-testid="submodule-preview">
      <header className="submodule-preview-header">
        <SubmoduleIcon size={16} />
        <strong>Submodule &apos;{submodule.name}&apos;</strong>
        <span className={submodule.state === 'dirty' ? 'submodule-state dirty' : 'submodule-state'}>
          {stateLabel(submodule)}
        </span>
      </header>
      {submodule.state === 'dirty' && (
        <p className="submodule-warning" role="status">
          <WarningIcon size={14} />
          The child repository has local changes. The parent index still records{' '}
          {revision(submodule.revisions.index)}.
        </p>
      )}
      <div className="submodule-revisions" aria-label="Submodule revisions">
        <div className="submodule-revision-card">
          <span className="submodule-revision-label">Parent baseline</span>
          <code>{revision(submodule.revisions.head)}</code>
        </div>
        <span className="submodule-revision-arrow" aria-hidden="true">
          →
        </span>
        <div className="submodule-revision-card current">
          <span className="submodule-revision-label">
            {submodule.revisions.working && submodule.workingChanged ? 'Child checkout' : 'Parent index'}
          </span>
          <code>{revision(newRevision)}</code>
        </div>
      </div>
      {submodule.detached && <p className="submodule-detail">The child is checked out at a detached HEAD.</p>}
      {submodule.dirtyPaths.length > 0 && (
        <p className="submodule-detail">
          {submodule.dirtyPaths.length === 1
            ? `Changed child path: ${submodule.dirtyPaths[0]}`
            : `${submodule.dirtyPaths.length} changed child paths`}
        </p>
      )}
      <div className="submodule-actions">
        <button
          type="button"
          className="button button-small"
          disabled={busy || !submodule.initialized}
          title={
            submodule.initialized
              ? 'Open the child repository in a new tab.'
              : 'Initialize the submodule first.'
          }
          onClick={onOpen}
        >
          Open Submodule
        </button>
        <button
          type="button"
          className="button button-small"
          disabled={!canUpdate}
          title={
            submodule.state === 'dirty'
              ? 'Save or commit child changes before updating.'
              : submodule.state === 'conflicted'
                ? 'Resolve the submodule conflict first.'
                : 'Initialize or update this submodule.'
          }
          onClick={onUpdate}
        >
          {submodule.initialized ? 'Update' : 'Initialize'}
        </button>
      </div>
    </div>
  );
}
