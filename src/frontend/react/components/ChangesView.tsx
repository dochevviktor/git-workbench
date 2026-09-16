import type { RepositorySummary } from '../../../common/ipc/contracts';
import { countLabel } from '../lib/format';
import { ChangesIcon } from './Icons';

function workingTreeSummary(repository: RepositorySummary): string {
  switch (repository.workingTree.state) {
    case 'clean':
      return 'The working tree is clean.';
    case 'dirty':
      return repository.workingTree.changedFileCount === null
        ? 'The working tree has uncommitted changes.'
        : `${countLabel(repository.workingTree.changedFileCount, 'changed file')} detected.`;
    case 'unavailable':
      return 'This repository has no working tree.';
    case 'unknown':
      return 'The working-tree status could not be read.';
  }
}

/** Local changes currently report status only; staging, diffs, and commits arrive with P04. */
export function ChangesView({ repository }: { readonly repository: RepositorySummary }) {
  return (
    <section className="changes-view" aria-labelledby="changes-heading">
      <div className="changes-placeholder">
        <ChangesIcon size={40} />
        <h2 id="changes-heading">Local Changes</h2>
        <p>{workingTreeSummary(repository)}</p>
        <p className="muted">
          Unstaged and staged file lists, diffs, and the commit composer are not available yet (planned for
          P04).
        </p>
      </div>
    </section>
  );
}
