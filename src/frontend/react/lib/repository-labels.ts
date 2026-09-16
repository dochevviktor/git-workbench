import type { RepositoryHead, RepositorySummary } from '../../../common/ipc/contracts';

export function headLabel(head: RepositoryHead): string {
  switch (head.state) {
    case 'branch':
      return head.name ?? 'unknown branch';
    case 'detached':
      return 'Detached HEAD';
    case 'unborn':
      return `${head.name ?? 'HEAD'} (no commits)`;
    case 'unknown':
      return 'HEAD unavailable';
  }
}

export function tabStatusLabel(repository: RepositorySummary): string {
  switch (repository.workingTree.state) {
    case 'clean':
      return 'Clean working tree';
    case 'dirty':
      return `Uncommitted changes${
        repository.workingTree.changedFileCount === null
          ? ''
          : ` · ${repository.workingTree.changedFileCount} ${
              repository.workingTree.changedFileCount === 1 ? 'file' : 'files'
            }`
      }`;
    case 'unavailable':
      return 'No working tree';
    case 'unknown':
      return 'Working-tree status unavailable';
  }
}
