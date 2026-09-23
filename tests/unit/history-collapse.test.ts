import { describe, expect, it } from 'vitest';
import { buildCollapsedHistory, getMergeCommitIds } from '../../src/common/history-collapse';
import { buildHistoryGraph } from '../../src/common/history-graph';

interface TestCommit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly decorations?: readonly unknown[];
}

const id = (index: number) => `${index}`.padStart(40, '0');

function commit(index: number, ...parents: number[]): TestCommit {
  return { id: id(index), parents: parents.map(id) };
}

describe('collapsed history projection', () => {
  it('retains the selected secondary commit and its ancestry across paging and collapse', () => {
    const commits = [
      commit(7, 6, 5),
      commit(6, 2),
      commit(5, 4),
      commit(4, 3),
      commit(3, 2),
      commit(2, 1),
      commit(1),
    ];
    for (const count of [3, 5, 7]) {
      const projection = buildCollapsedHistory(commits.slice(0, count), new Set([id(7)]), new Set([id(5)]));
      expect(projection.commits.some((entry) => entry.id === id(5))).toBe(true);
      expect(projection.hiddenCommitIds.has(id(5))).toBe(false);
      if (count === 7) {
        expect(projection.graphCommits.find((entry) => entry.id === id(5))?.parents).toEqual([id(2)]);
        expect(projection.hiddenCommitIds).toEqual(new Set([id(4), id(3)]));
      }
      expect(
        buildHistoryGraph(projection.graphCommits).find((row) => row.commitId === id(7))?.parentLanes,
      ).toHaveLength(2);
    }
  });
  it('hides unique secondary-parent commits and reconnects the branch at its merge base', () => {
    const commits = [commit(6, 5), commit(5, 4, 3), commit(4, 2), commit(3, 2), commit(2, 1), commit(1)];
    const projection = buildCollapsedHistory(commits, new Set([id(5)]));

    expect(projection.commits.map((candidate) => candidate.id)).toEqual([id(6), id(5), id(4), id(2), id(1)]);
    expect(projection.hiddenCommitIds).toEqual(new Set([id(3)]));
    expect(projection.hiddenByMerge.get(id(3))).toEqual([id(5)]);
    expect(projection.hiddenCounts.get(id(5))).toBe(1);
    expect(projection.graphCommits[1]).toMatchObject({
      id: id(5),
      parents: [id(4), id(2)],
      merge: true,
      collapsed: true,
      collapsedParentCount: 1,
    });
    expect(buildHistoryGraph(projection.graphCommits)[1]).toMatchObject({
      merge: true,
      collapsed: true,
      parentLanes: [0, 1],
    });
  });

  it('keeps merge tips and referenced branch tips available as expansion handles', () => {
    const commits: TestCommit[] = [
      commit(8, 7, 6),
      commit(7, 5),
      commit(6, 5, 4),
      commit(5, 3),
      { ...commit(4, 3), decorations: [{}] },
      commit(3),
    ];
    const projection = buildCollapsedHistory(commits, new Set([id(8), id(6)]));

    expect(projection.commits.map((candidate) => candidate.id)).toEqual([
      id(8),
      id(7),
      id(6),
      id(5),
      id(4),
      id(3),
    ]);
    expect(projection.hiddenCommitIds.size).toBe(0);
    expect(projection.graphCommits.find((candidate) => candidate.id === id(8))).toMatchObject({
      merge: true,
      collapsed: true,
    });
  });

  it('does not hide a branch commit when another merge is expanded', () => {
    const commits = [commit(8, 7, 6), commit(7, 5), commit(6, 5, 4), commit(5, 3), commit(4, 3), commit(3)];
    const projection = buildCollapsedHistory(commits, new Set([id(8)]));

    expect(projection.commits.map((candidate) => candidate.id)).toEqual([
      id(8),
      id(7),
      id(6),
      id(5),
      id(4),
      id(3),
    ]);
    expect(projection.hiddenCommitIds).toEqual(new Set());
  });

  it('filters stale collapse IDs and leaves an expanded projection unchanged', () => {
    const commits = [commit(4, 3, 2), commit(3, 1), commit(2, 1), commit(1)];
    const projection = buildCollapsedHistory(commits, new Set([id(1), 'not-a-commit']));

    expect(getMergeCommitIds(commits)).toEqual([id(4)]);
    expect(projection.collapsedMergeIds).toEqual(new Set());
    expect(projection.commits).toEqual(commits);
    expect(projection.graphCommits.map((candidate) => candidate.parents)).toEqual(
      commits.map((candidate) => candidate.parents),
    );
  });

  it('keeps the leading graph rows stable when a later page supplies the merge base', () => {
    const commits: TestCommit[] = [
      commit(6, 5),
      commit(5, 4, 3),
      commit(4, 2),
      { ...commit(3, 2), decorations: [{}] },
      commit(2, 1),
      commit(1),
    ];
    const collapsed = new Set([id(5)]);
    const prefix = buildCollapsedHistory(commits.slice(0, 4), collapsed);
    const complete = buildCollapsedHistory(commits, collapsed);

    expect(buildHistoryGraph(prefix.graphCommits)).toEqual(
      buildHistoryGraph(complete.graphCommits).slice(0, prefix.commits.length),
    );
  });
});
