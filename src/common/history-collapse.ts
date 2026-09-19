import type { GraphCommit } from './history-graph';

/** The part of a history commit needed to decide whether a branch can be elided. */
export interface CollapsibleHistoryCommit {
  readonly id: string;
  readonly parents: readonly string[];
  /** Reference decorations are retained as visible tips when a branch is collapsed. */
  readonly decorations?: readonly unknown[] | undefined;
}

export interface CollapsedHistoryProjection<Commit extends CollapsibleHistoryCommit> {
  /** Commits that remain in their original topological order. */
  readonly commits: readonly Commit[];
  /** Parent edges for the graph pass after hidden commits have been skipped. */
  readonly graphCommits: readonly GraphCommit[];
  /** Loaded commit IDs omitted from `commits`. */
  readonly hiddenCommitIds: ReadonlySet<string>;
  /** Active merge IDs that caused a loaded commit to be hidden. */
  readonly hiddenByMerge: ReadonlyMap<string, readonly string[]>;
  /** Active merge IDs, filtered to actual merge commits in the supplied history. */
  readonly collapsedMergeIds: ReadonlySet<string>;
  /** Number of loaded commits hidden by each active merge. */
  readonly hiddenCounts: ReadonlyMap<string, number>;
}

interface HistoryRecord {
  readonly id: string;
  readonly parents: readonly string[];
}

/** Returns merge IDs in the stable order in which their rows occur in the history. */
export function getMergeCommitIds(commits: readonly CollapsibleHistoryCommit[]): string[] {
  return commits.filter((commit) => uniqueParents(commit).length > 1).map((commit) => commit.id);
}

/**
 * Projects a loaded history with selected merge branches collapsed.
 *
 * A collapsed branch is the ancestry reachable from a merge's non-first parent but not from its
 * first parent. This keeps the first-parent line and the merge tips visible, so a nested merge can
 * still be expanded. Reference-decorated tips are also retained. If a hidden edge eventually
 * reaches a visible commit, the graph points directly at that boundary; otherwise it remains a
 * dangling edge until a later page supplies a visible boundary.
 */
export function buildCollapsedHistory<Commit extends CollapsibleHistoryCommit>(
  commits: readonly Commit[],
  requestedCollapsedMergeIds: ReadonlySet<string>,
): CollapsedHistoryProjection<Commit> {
  const records = new Map(commits.map((commit): [string, HistoryRecord] => [commit.id, commit]));
  const mergeIds = new Set(getMergeCommitIds(commits));
  const collapsedMergeIds = new Set([...requestedCollapsedMergeIds].filter((id) => mergeIds.has(id)));
  if (collapsedMergeIds.size === 0) {
    return {
      commits,
      graphCommits: commits.map((commit) => ({
        id: commit.id,
        parents: uniqueParents(commit),
        merge: mergeIds.has(commit.id),
        collapsed: false,
        collapsedParentCount: 0,
      })),
      hiddenCommitIds: new Set(),
      hiddenByMerge: new Map(),
      collapsedMergeIds,
      hiddenCounts: new Map(),
    };
  }
  const expandedBranchCommits = new Set<string>();
  const hiddenOwners = new Map<string, Set<string>>();
  const positions = new Map(commits.map((commit, index) => [commit.id, index]));

  for (const merge of commits) {
    const parents = uniqueParents(merge);
    if (parents.length < 2) continue;
    const branchCommits = secondaryBranchCommits(parents, records, positions);
    if (collapsedMergeIds.has(merge.id)) {
      for (const commitId of branchCommits) {
        let owners = hiddenOwners.get(commitId);
        if (!owners) {
          owners = new Set<string>();
          hiddenOwners.set(commitId, owners);
        }
        owners.add(merge.id);
      }
    } else {
      for (const commitId of branchCommits) expandedBranchCommits.add(commitId);
    }
  }

  const hiddenCommitIds = new Set<string>();
  const hiddenByMerge = new Map<string, readonly string[]>();
  const hiddenCounts = new Map<string, number>();
  const decorated = new Set(
    commits.filter((commit) => (commit.decorations?.length ?? 0) > 0).map((commit) => commit.id),
  );

  for (const commit of commits) {
    const owners = hiddenOwners.get(commit.id);
    // Merge tips remain as expansion handles. A ref-decorated commit remains visible so collapsing
    // a merged branch does not make a branch/tag disappear from the graph entirely.
    if (
      !owners ||
      mergeIds.has(commit.id) ||
      decorated.has(commit.id) ||
      expandedBranchCommits.has(commit.id)
    ) {
      continue;
    }
    const activeOwners = [...owners].filter((owner) => collapsedMergeIds.has(owner));
    if (activeOwners.length === 0) continue;
    hiddenCommitIds.add(commit.id);
    hiddenByMerge.set(commit.id, activeOwners);
    for (const owner of activeOwners) hiddenCounts.set(owner, (hiddenCounts.get(owner) ?? 0) + 1);
  }

  const visibleCommitIds = new Set(
    commits.map((commit) => commit.id).filter((id) => !hiddenCommitIds.has(id)),
  );
  const visibleCommits = commits.filter((commit) => visibleCommitIds.has(commit.id));
  const graphCommits = visibleCommits.map((commit): GraphCommit => {
    const originalParents = uniqueParents(commit);
    const graphParents: string[] = [];
    for (const parent of originalParents) {
      const boundaries = visibleCommitIds.has(parent)
        ? [parent]
        : nearestVisibleAncestors(parent, visibleCommitIds, records);
      for (const boundary of boundaries) {
        if (!graphParents.includes(boundary)) graphParents.push(boundary);
      }
    }
    return {
      id: commit.id,
      parents: graphParents,
      merge: mergeIds.has(commit.id),
      collapsed: collapsedMergeIds.has(commit.id),
      collapsedParentCount: originalParents.filter((parent) => hiddenCommitIds.has(parent)).length,
    };
  });

  return {
    commits: visibleCommits,
    graphCommits,
    hiddenCommitIds,
    hiddenByMerge,
    collapsedMergeIds,
    hiddenCounts,
  };
}

function uniqueParents(commit: Pick<CollapsibleHistoryCommit, 'parents'>): string[] {
  return [...new Set(commit.parents)];
}

function secondaryBranchCommits(
  parents: readonly string[],
  records: ReadonlyMap<string, HistoryRecord>,
  positions: ReadonlyMap<string, number>,
): ReadonlySet<string> {
  const secondary = new Set<string>();
  const pending = parents.slice(1);
  while (pending.length > 0) {
    const commitId = pending.pop();
    if (!commitId || secondary.has(commitId) || reachableBefore(parents[0], commitId, records, positions))
      continue;
    secondary.add(commitId);
    pending.push(...(records.get(commitId)?.parents ?? []));
  }
  return secondary;
}

/** A topological stream lets an ancestry query stop before scanning history older than its target. */
function reachableBefore(
  start: string | undefined,
  target: string,
  records: ReadonlyMap<string, HistoryRecord>,
  positions: ReadonlyMap<string, number>,
): boolean {
  const limit = positions.get(target) ?? Infinity;
  const pending = start ? [start] : [];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === target) return true;
    if (visited.has(id) || (positions.get(id) ?? Infinity) > limit) continue;
    visited.add(id);
    pending.push(...(records.get(id)?.parents ?? []));
  }
  return false;
}

function nearestVisibleAncestors(
  start: string,
  visibleCommitIds: ReadonlySet<string>,
  records: ReadonlyMap<string, HistoryRecord>,
): string[] {
  const pending = [start];
  const visited = new Set<string>();
  const boundaries: string[] = [];
  while (pending.length > 0) {
    const commitId = pending.shift();
    if (!commitId || visited.has(commitId)) continue;
    visited.add(commitId);
    if (visibleCommitIds.has(commitId)) {
      boundaries.push(commitId);
      continue;
    }
    const record = records.get(commitId);
    if (!record) continue;
    pending.push(...uniqueParents(record));
  }
  // Keep an elided parent as a graph token when its boundary is outside the loaded history. The
  // graph still draws the branch edge, and a later page can replace the token with its boundary.
  return boundaries.length > 0 ? boundaries : [start];
}
