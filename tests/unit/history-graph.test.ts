import { describe, expect, it } from 'vitest';
import type { RepositoryHistoryCommit } from '../../src/common/ipc/contracts';
import { buildHistoryGraph } from '../../src/common/history-graph';

const ids = Array.from({ length: 8 }, (_, index) => `${index + 1}`.padStart(40, '0'));

function commit(id: string, parents: readonly string[] = []): RepositoryHistoryCommit {
  return {
    id,
    parents: [...parents],
    author: { name: 'Author', email: 'author@example.test', date: '2026-01-01T00:00:00+00:00' },
    committer: { name: 'Committer', email: 'committer@example.test', date: '2026-01-01T00:00:00+00:00' },
    subject: id,
    body: '',
    decorations: [],
  };
}

describe('history graph lane assignment', () => {
  it('keeps a linear ancestry in one lane', () => {
    const graph = buildHistoryGraph([
      commit(ids[2]!, [ids[1]!]),
      commit(ids[1]!, [ids[0]!]),
      commit(ids[0]!),
    ]);

    expect(graph.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(graph.map((row) => row.parentLanes)).toEqual([[0], [0], []]);
    expect(graph.every((row) => !row.merge)).toBe(true);
  });

  it('gives merge parents distinct, connected lanes', () => {
    const graph = buildHistoryGraph([
      commit(ids[3]!, [ids[2]!, ids[1]!]),
      commit(ids[2]!, [ids[0]!]),
      commit(ids[1]!, [ids[0]!]),
      commit(ids[0]!),
    ]);

    expect(graph[0]).toMatchObject({ lane: 0, parentLanes: [0, 1], laneCount: 2, merge: true });
    expect(graph[1]).toMatchObject({ lane: 0, parentLanes: [0] });
    expect(graph[2]).toMatchObject({ lane: 1, parentLanes: [0] });
    expect(graph[3]).toMatchObject({ lane: 0, root: true });
  });

  it('retains a live lane when a page ends before its parent', () => {
    const firstPage = buildHistoryGraph([commit(ids[3]!, [ids[2]!, ids[1]!])]);
    const allRows = buildHistoryGraph([
      commit(ids[3]!, [ids[2]!, ids[1]!]),
      commit(ids[2]!, [ids[0]!]),
      commit(ids[1]!, [ids[0]!]),
      commit(ids[0]!),
    ]);

    expect(firstPage[0]).toMatchObject({ lane: 0, parentLanes: [0, 1], laneCount: 2 });
    expect(allRows[1]).toMatchObject({ lane: 0, parentLanes: [0] });
    expect(allRows[2]).toMatchObject({ lane: 1, parentLanes: [0] });
  });

  it('reuses lanes for disconnected roots instead of inventing ancestry', () => {
    const graph = buildHistoryGraph([commit(ids[5]!), commit(ids[4]!), commit(ids[6]!, [ids[7]!])]);

    expect(graph.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(graph.map((row) => row.parentLanes)).toEqual([[], [], [0]]);
  });
});
