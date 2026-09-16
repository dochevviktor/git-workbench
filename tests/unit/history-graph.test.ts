import { describe, expect, it } from 'vitest';
import type { HistoryGraphRow, HistoryGraphSegment } from '../../src/common/history-graph';
import { buildHistoryGraph, findReachableCommits } from '../../src/common/history-graph';

interface TestCommit {
  readonly id: string;
  readonly parents: string[];
}

const id = (index: number) => `${index}`.padStart(40, '0');

function commit(index: number, ...parents: number[]): TestCommit {
  return { id: id(index), parents: parents.map(id) };
}

function kinds(row: HistoryGraphRow | undefined, kind: HistoryGraphSegment['kind']) {
  return (row?.segments ?? []).filter((segment) => segment.kind === kind);
}

function occupiedAtBottom(row: HistoryGraphRow, column: number): boolean {
  return row.segments.some(
    (segment) =>
      (segment.kind === 'pass' && segment.lane === column) ||
      (segment.kind === 'bottom' && segment.lane === column) ||
      (segment.kind === 'branch' && segment.to === column),
  );
}

function occupiedAtTop(row: HistoryGraphRow, column: number): boolean {
  return row.segments.some(
    (segment) =>
      (segment.kind === 'pass' && segment.lane === column) ||
      (segment.kind === 'top' && segment.lane === column) ||
      (segment.kind === 'join' && segment.from === column),
  );
}

/** Follows a line leaving `rowIndex` in `column` and returns the commit it reaches, if loaded. */
function arrival(rows: readonly HistoryGraphRow[], rowIndex: number, column: number): string | undefined {
  for (let index = rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.segments.some((segment) => segment.kind === 'pass' && segment.lane === column)) continue;
    const arrives = row.segments.some(
      (segment) =>
        (segment.kind === 'top' && segment.lane === column) ||
        (segment.kind === 'join' && segment.from === column),
    );
    if (!arrives) throw new Error(`The line in column ${column} disappears at row ${index}.`);
    return row.commitId;
  }
  return undefined;
}

/** Checks continuity and parent connectivity using only the rendered segments. */
function expectDrawableAncestry(commits: readonly TestCommit[], rows: readonly HistoryGraphRow[]) {
  expect(rows.map((row) => row.commitId)).toEqual(commits.map((candidate) => candidate.id));
  const loaded = new Set(commits.map((candidate) => candidate.id));

  rows.forEach((row, index) => {
    const widest = Math.max(
      row.lane,
      ...row.segments.map((segment) =>
        'lane' in segment ? segment.lane : Math.max(segment.from, segment.to),
      ),
    );
    expect(row.width).toBe(widest + 1);

    const next = rows[index + 1];
    if (next) {
      for (let column = 0; column <= Math.max(row.width, next.width); column += 1) {
        expect(occupiedAtBottom(row, column), `row ${index}, column ${column}`).toBe(
          occupiedAtTop(next, column),
        );
      }
    }
    if (index === 0) {
      expect(row.segments.filter((segment) => ['pass', 'top', 'join'].includes(segment.kind))).toEqual([]);
    }

    const joins = kinds(row, 'join').map((segment) => (segment.kind === 'join' ? segment.from : -1));
    const branches = kinds(row, 'branch').map((segment) => (segment.kind === 'branch' ? segment.to : -1));
    expect(joins.filter((column) => branches.includes(column))).toEqual([]);

    const parents = [...new Set(commits[index]!.parents)];
    const leaving = [
      ...kinds(row, 'bottom').map((segment) => laneOf(segment)),
      ...kinds(row, 'branch').map((segment) => (segment.kind === 'branch' ? segment.to : -1)),
    ];
    expect(leaving).toHaveLength(parents.length);
    expect(row.parentLanes).toEqual(leaving);
    const reached = leaving.map((column) => arrival(rows, index, column));
    parents.forEach((parent, parentIndex) => {
      if (loaded.has(parent)) expect(reached[parentIndex]).toBe(parent);
      else expect(reached[parentIndex]).toBeUndefined();
    });
  });
}

function laneOf(segment: HistoryGraphSegment): number {
  return 'lane' in segment ? segment.lane : segment.from;
}

/** Deterministic pseudo-random topological histories: parents are created before children. */
function randomHistory(seed: number, size: number): TestCommit[] {
  let state = seed;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const created: TestCommit[] = [];
  for (let index = 0; index < size; index += 1) {
    const parents: number[] = [];
    if (index > 0 && random() > 0.08) {
      const window = Math.min(index, 12);
      parents.push(index - 1 - Math.floor(random() * Math.min(window, 3)));
      if (random() < 0.3) parents.push(index - 1 - Math.floor(random() * window));
      if (random() < 0.05) parents.push(index - 1 - Math.floor(random() * window));
    }
    created.push(commit(index, ...parents));
  }
  return created.reverse();
}

describe('history graph layout', () => {
  it('keeps a linear history in one straight lane', () => {
    const rows = buildHistoryGraph([commit(3, 2), commit(2, 1), commit(1)]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.segments)).toEqual([
      [{ kind: 'bottom', lane: 0 }],
      [
        { kind: 'top', lane: 0 },
        { kind: 'bottom', lane: 0 },
      ],
      [{ kind: 'top', lane: 0 }],
    ]);
    expect(rows[2]).toMatchObject({ root: true, width: 1 });
  });

  it('opens a merged branch to the right and joins it back into the fork point', () => {
    const commits = [commit(4, 3, 2), commit(3, 1), commit(2, 1), commit(1)];
    const rows = buildHistoryGraph(commits);

    expect(rows[0]).toMatchObject({ lane: 0, merge: true, width: 2, parentLanes: [0, 1] });
    expect(kinds(rows[0], 'branch')).toEqual([{ kind: 'branch', from: 0, to: 1 }]);
    expect(rows[1]).toMatchObject({ lane: 0 });
    expect(kinds(rows[1], 'pass')).toEqual([{ kind: 'pass', lane: 1 }]);
    expect(rows[2]).toMatchObject({ lane: 1 });
    expect(kinds(rows[3], 'join')).toEqual([{ kind: 'join', from: 1, to: 0 }]);
    expectDrawableAncestry(commits, rows);
  });

  it('never shifts surviving lanes sideways when a lane to their left ends', () => {
    const commits = [commit(10, 9, 8), commit(9, 7, 6), commit(8, 7), commit(7, 5), commit(6, 5), commit(5)];
    const rows = buildHistoryGraph(commits);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 0, 2, 0]);
    // Column one ends at commit 7 while the column-two line keeps its place beside it.
    expect(kinds(rows[3], 'join')).toEqual([{ kind: 'join', from: 1, to: 0 }]);
    expect(kinds(rows[3], 'pass')).toEqual([{ kind: 'pass', lane: 2 }]);
    expect(kinds(rows[4], 'pass')).toEqual([{ kind: 'pass', lane: 0 }]);
    expect(kinds(rows[5], 'join')).toEqual([{ kind: 'join', from: 2, to: 0 }]);
    expectDrawableAncestry(commits, rows);
  });

  it('turns a merge edge into a lane that already carries the parent', () => {
    const commits = [commit(5, 3), commit(4, 2, 3), commit(3, 1), commit(2, 1), commit(1)];
    const rows = buildHistoryGraph(commits);

    expect(rows[1]).toMatchObject({ lane: 1, parentLanes: [1, 0] });
    expect(kinds(rows[1], 'branch')).toEqual([{ kind: 'branch', from: 1, to: 0 }]);
    expect(kinds(rows[1], 'pass')).toEqual([{ kind: 'pass', lane: 0 }]);
    expectDrawableAncestry(commits, rows);
  });

  it('draws every octopus parent in its own new lane', () => {
    const commits = [commit(5, 4, 3, 2), commit(4, 1), commit(3, 1), commit(2, 1), commit(1)];
    const rows = buildHistoryGraph(commits);

    expect(rows[0]).toMatchObject({ merge: true, parentLanes: [0, 1, 2], width: 3 });
    expect(kinds(rows[4], 'join')).toHaveLength(2);
    expectDrawableAncestry(commits, rows);
  });

  it('does not reuse a column released by a join in the same row', () => {
    // Commit 3 receives a join from column one and immediately merges another new parent.
    const commits = [commit(6, 3), commit(5, 3), commit(3, 2, 1), commit(2), commit(1)];
    const rows = buildHistoryGraph(commits);

    expect(kinds(rows[2], 'join')).toEqual([{ kind: 'join', from: 1, to: 0 }]);
    expect(kinds(rows[2], 'branch')).toEqual([{ kind: 'branch', from: 0, to: 2 }]);
    expectDrawableAncestry(commits, rows);
  });

  it('places a new branch tip in the lowest free column', () => {
    const commits = [commit(9, 8), commit(8), commit(7, 6), commit(6)];
    const rows = buildHistoryGraph(commits);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0, 0]);
    expect(kinds(rows[2], 'top')).toEqual([]);
    expectDrawableAncestry(commits, rows);
  });

  it('keeps drawing a line to a parent that is not loaded yet', () => {
    const commits = [commit(3, 2, 1)];
    const rows = buildHistoryGraph(commits);

    expect(rows[0]!.segments).toEqual([
      { kind: 'bottom', lane: 0 },
      { kind: 'branch', from: 0, to: 1 },
    ]);
    expectDrawableAncestry(commits, rows);
  });

  it('produces the same leading rows when more pages are appended', () => {
    const commits = randomHistory(42, 160);
    const allRows = buildHistoryGraph(commits);

    for (const pageEnd of [1, 17, 50, 100, 159]) {
      expect(buildHistoryGraph(commits.slice(0, pageEnd))).toEqual(allRows.slice(0, pageEnd));
    }
  });

  it.each([1, 7, 1234, 98_765])('keeps every generated history connected (seed %i)', (seed) => {
    const commits = randomHistory(seed, 220);
    expectDrawableAncestry(commits, buildHistoryGraph(commits));
  });

  it('ignores duplicated parent IDs', () => {
    const commits = [commit(2, 1, 1), commit(1)];
    const rows = buildHistoryGraph(commits);

    expect(rows[0]).toMatchObject({ merge: false, parentLanes: [0] });
    expectDrawableAncestry(commits, rows);
  });
});

describe('history reachability', () => {
  it('follows every parent of the starting commit through loaded history', () => {
    const commits = [commit(6, 5), commit(5, 3, 4), commit(7, 2), commit(4, 2), commit(3, 1), commit(2, 1)];

    expect([...findReachableCommits(commits, id(5))].sort()).toEqual(
      [id(1), id(2), id(3), id(4), id(5)].sort(),
    );
    expect(findReachableCommits(commits, id(5)).has(id(6))).toBe(false);
    expect(findReachableCommits(commits, id(5)).has(id(7))).toBe(false);
    expect(findReachableCommits(commits, null).size).toBe(0);
  });
});
