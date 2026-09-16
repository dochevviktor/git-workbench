import type { RepositoryHistoryCommit } from './ipc/contracts';

/**
 * One drawing instruction inside a commit row. Lanes are zero-based graph columns; a row is drawn
 * from its top edge to its bottom edge with the commit marker centered vertically.
 */
export type HistoryGraphSegment =
  /** A line that crosses the whole row without touching this commit. */
  | { readonly kind: 'pass'; readonly lane: number }
  /** The commit's own lane arriving from the row above. */
  | { readonly kind: 'top'; readonly lane: number }
  /** The commit's own lane continuing toward its first parent. */
  | { readonly kind: 'bottom'; readonly lane: number }
  /** Another lane ending at this commit: it enters at the top of `from` and turns into `to`. */
  | { readonly kind: 'join'; readonly from: number; readonly to: number }
  /** A further parent edge: it leaves the commit on `from` and turns down into `to`. */
  | { readonly kind: 'branch'; readonly from: number; readonly to: number };

export interface HistoryGraphRow {
  readonly commitId: string;
  /** Column that holds the commit marker. */
  readonly lane: number;
  /** Number of columns this row needs to draw every segment. */
  readonly width: number;
  /** Column that carries each (deduplicated) parent below this row, in parent order. */
  readonly parentLanes: readonly number[];
  readonly merge: boolean;
  readonly root: boolean;
  readonly segments: readonly HistoryGraphSegment[];
}

type GraphCommit = Pick<RepositoryHistoryCommit, 'id' | 'parents'>;

const noReleasedColumns: ReadonlySet<number> = new Set();

/**
 * Assigns graph columns while walking an already topologically ordered commit stream.
 *
 * Each column remembers the commit its line is heading toward. Lines never move sideways: a
 * branch keeps its column until it reaches its parent, where it turns into that commit. Merge
 * parents that are not yet tracked open a column to the right of the merge. Columns released in a
 * row are not reused by that row, so an ending line and a new line never share one elbow.
 *
 * Every row depends only on the rows before it. Re-running the function with concatenated pages
 * therefore yields the same leading rows and preserves edges across page boundaries.
 */
export function buildHistoryGraph(commits: readonly GraphCommit[]): HistoryGraphRow[] {
  const columns: (string | null)[] = [];
  const rows: HistoryGraphRow[] = [];

  for (const commit of commits) {
    const expecting: number[] = [];
    columns.forEach((expected, column) => {
      if (expected === commit.id) expecting.push(column);
    });
    const lane = expecting[0] ?? firstFreeColumn(columns, 0, noReleasedColumns);
    const segments: HistoryGraphSegment[] = [];
    const released = new Set<number>();

    columns.forEach((expected, column) => {
      if (expected !== null && expected !== commit.id) segments.push({ kind: 'pass', lane: column });
    });
    if (expecting.length > 0) segments.push({ kind: 'top', lane });
    for (const column of expecting.slice(1)) {
      segments.push({ kind: 'join', from: column, to: lane });
      columns[column] = null;
      released.add(column);
    }

    const parents = [...new Set(commit.parents)];
    const parentLanes: number[] = [];
    const firstParent = parents[0];
    setColumn(columns, lane, firstParent ?? null);
    if (firstParent !== undefined) {
      segments.push({ kind: 'bottom', lane });
      parentLanes.push(lane);
    }
    for (const parent of parents.slice(1)) {
      const existing = columns.indexOf(parent);
      const target = existing >= 0 ? existing : firstFreeColumn(columns, lane + 1, released);
      if (existing < 0) setColumn(columns, target, parent);
      segments.push({ kind: 'branch', from: lane, to: target });
      parentLanes.push(target);
    }
    while (columns.length > 0 && columns[columns.length - 1] === null) columns.pop();

    rows.push({
      commitId: commit.id,
      lane,
      width: rowWidth(lane, segments),
      parentLanes,
      merge: parents.length > 1,
      root: parents.length === 0,
      segments,
    });
  }

  return rows;
}

/**
 * Returns the commits reachable from `start` by following parents. A topological order lists every
 * child before its parents, so one forward pass is exact for the commits that have been loaded.
 */
export function findReachableCommits(
  commits: readonly GraphCommit[],
  start: string | null | undefined,
): ReadonlySet<string> {
  const reachable = new Set<string>();
  if (!start) return reachable;
  reachable.add(start);
  for (const commit of commits) {
    if (!reachable.has(commit.id)) continue;
    for (const parent of commit.parents) reachable.add(parent);
  }
  return reachable;
}

function firstFreeColumn(
  columns: readonly (string | null)[],
  start: number,
  released: ReadonlySet<number>,
): number {
  for (let column = start; column < columns.length; column += 1) {
    if (columns[column] === null && !released.has(column)) return column;
  }
  return Math.max(start, columns.length);
}

function setColumn(columns: (string | null)[], column: number, value: string | null): void {
  while (columns.length <= column) columns.push(null);
  columns[column] = value;
}

function rowWidth(lane: number, segments: readonly HistoryGraphSegment[]): number {
  let widest = lane;
  for (const segment of segments) {
    widest = Math.max(widest, 'lane' in segment ? segment.lane : Math.max(segment.from, segment.to));
  }
  return widest + 1;
}
