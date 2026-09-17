import type {
  RepositoryCommitChangeStatus,
  RepositoryWorkingChangeStatus,
} from '../../../common/ipc/contracts';

export type ChangeStatus = RepositoryCommitChangeStatus | RepositoryWorkingChangeStatus;

export interface StatusBadge {
  /** A short glyph drawn inside the colored badge. */
  readonly symbol: string;
  readonly tone: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict' | 'neutral';
  /** Spoken and shown as a tooltip, so color and glyph are never the only cue. */
  readonly label: string;
}

const badges: Record<ChangeStatus, StatusBadge> = {
  modified: { symbol: 'M', tone: 'modified', label: 'Modified' },
  'type-changed': { symbol: 'T', tone: 'modified', label: 'Type changed' },
  added: { symbol: '+', tone: 'added', label: 'Added' },
  untracked: { symbol: '+', tone: 'added', label: 'Untracked' },
  deleted: { symbol: '−', tone: 'deleted', label: 'Deleted' },
  renamed: { symbol: '→', tone: 'renamed', label: 'Renamed' },
  copied: { symbol: 'C', tone: 'renamed', label: 'Copied' },
  unmerged: { symbol: '!', tone: 'conflict', label: 'Conflict' },
  ignored: { symbol: 'I', tone: 'neutral', label: 'Ignored' },
  unknown: { symbol: '?', tone: 'neutral', label: 'Changed' },
};

export function statusBadge(status: ChangeStatus): StatusBadge {
  return badges[status];
}
