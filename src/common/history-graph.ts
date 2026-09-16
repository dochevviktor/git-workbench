import type { RepositoryHistoryCommit } from './ipc/contracts';

export interface HistoryGraphRow {
  readonly commitId: string;
  readonly lane: number;
  readonly parentLanes: readonly number[];
  readonly laneCount: number;
  readonly merge: boolean;
  readonly root: boolean;
}

/**
 * Assigns stable visual lanes while walking the already ordered commit stream.
 *
 * A lane stores the next commit expected on that line. Parents already present in
 * another lane keep that lane; new parents are inserted beside the selected commit.
 * Re-running this function with the concatenated pages therefore preserves edges at
 * page boundaries without persisting renderer-specific graph state.
 */
export function buildHistoryGraph(commits: readonly RepositoryHistoryCommit[]): HistoryGraphRow[] {
  const lanes: string[] = [];
  const rows: HistoryGraphRow[] = [];

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.id);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(commit.id);
    }
    const laneCountBefore = lanes.length;
    lanes.splice(lane, 1);

    let insertion = lane;
    for (const parent of commit.parents) {
      if (lanes.includes(parent)) continue;
      lanes.splice(insertion, 0, parent);
      insertion += 1;
    }

    const parentLanes = commit.parents.map((parent) => lanes.indexOf(parent));
    const laneCount = Math.max(
      laneCountBefore,
      lanes.length,
      lane + 1,
      ...parentLanes.map((parentLane) => parentLane + 1),
    );
    rows.push({
      commitId: commit.id,
      lane,
      parentLanes,
      laneCount,
      merge: commit.parents.length > 1,
      root: commit.parents.length === 0,
    });
  }

  return rows;
}
