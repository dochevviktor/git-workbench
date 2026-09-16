import type { HistoryGraphRow } from '../../../common/history-graph';

export const graphRowHeight = 24;
export const graphLaneWidth = 14;
export const graphPaddingLeft = 6;
const graphPaddingRight = 6;
const graphPaletteSize = 10;
/** Wide histories are clipped so the subject column keeps a readable width. */
const maximumGraphLanes = 24;

export function graphWidth(row: Pick<HistoryGraphRow, 'width'>): number {
  return graphPaddingLeft + Math.min(row.width, maximumGraphLanes) * graphLaneWidth + graphPaddingRight;
}

export function laneColorClass(lane: number): string {
  return `lane-${lane % graphPaletteSize}`;
}

export function laneX(lane: number): number {
  return graphPaddingLeft + lane * graphLaneWidth + graphLaneWidth / 2;
}
