import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { HistoryGraphRow, HistoryGraphSegment } from '../../../common/history-graph';
import { graphLaneWidth, graphRowHeight, graphWidth, laneColorClass, laneX } from '../lib/graph-geometry';

const cornerRadius = Math.min(graphLaneWidth, graphRowHeight / 2);

/**
 * Builds one SVG path per segment. Vertical lines overshoot the row by a pixel so fractional
 * display scaling never leaves a seam between rows. Elbows are quarter circles: a lane that ends
 * turns into its parent at the parent's row, and an extra merge parent leaves the commit
 * horizontally before turning down into its lane.
 */
function segmentPath(segment: HistoryGraphSegment): string {
  const middle = graphRowHeight / 2;
  const bottom = graphRowHeight + 1;
  switch (segment.kind) {
    case 'pass':
      return `M${laneX(segment.lane)} -1V${bottom}`;
    case 'top':
      return `M${laneX(segment.lane)} -1V${middle}`;
    case 'bottom':
      return `M${laneX(segment.lane)} ${middle}V${bottom}`;
    case 'join': {
      const from = laneX(segment.from);
      const to = laneX(segment.to);
      const direction = Math.sign(to - from);
      const radius = Math.min(cornerRadius, Math.abs(to - from));
      const sweep = direction < 0 ? 1 : 0;
      return `M${from} -1V${middle - radius}A${radius} ${radius} 0 0 ${sweep} ${from + direction * radius} ${middle}H${to}`;
    }
    case 'branch': {
      const from = laneX(segment.from);
      const to = laneX(segment.to);
      const direction = Math.sign(to - from);
      const radius = Math.min(cornerRadius, Math.abs(to - from));
      const sweep = direction > 0 ? 1 : 0;
      return `M${from} ${middle}H${to - direction * radius}A${radius} ${radius} 0 0 ${sweep} ${to} ${middle + radius}V${bottom}`;
    }
  }
}

function segmentLane(segment: HistoryGraphSegment): number {
  switch (segment.kind) {
    case 'pass':
    case 'top':
    case 'bottom':
      return segment.lane;
    // An elbow belongs to the lane whose vertical part it draws.
    case 'join':
      return segment.from;
    case 'branch':
      return segment.to;
  }
}

function segmentKey(segment: HistoryGraphSegment): string {
  return 'lane' in segment
    ? `${segment.kind}-${segment.lane}`
    : `${segment.kind}-${segment.from}-${segment.to}`;
}

interface CommitGraphProps {
  readonly row: HistoryGraphRow;
  readonly onToggle?: (() => void) | undefined;
  readonly onSelect?: (() => void) | undefined;
}

export const CommitGraph = memo(function CommitGraph({ row, onToggle, onSelect }: CommitGraphProps) {
  const width = graphWidth(row);
  const straight = row.segments.filter((segment) => 'lane' in segment);
  const elbows = row.segments.filter((segment) => !('lane' in segment));
  const nodeX = laneX(row.lane);
  const nodeY = graphRowHeight / 2;

  const svg = (
    <svg
      className="commit-graph"
      width={width}
      height={graphRowHeight}
      viewBox={`0 0 ${width} ${graphRowHeight}`}
      aria-hidden="true"
      focusable="false"
      data-graph-width={row.width}
    >
      {[...straight, ...elbows].map((segment) => (
        <path
          key={segmentKey(segment)}
          className={`graph-line graph-${segment.kind} ${laneColorClass(segmentLane(segment))}`}
          d={segmentPath(segment)}
        />
      ))}
      {row.merge ? (
        <>
          <circle className={`graph-node merge ${laneColorClass(row.lane)}`} cx={nodeX} cy={nodeY} r={5.5} />
          {/* A merge ring holds a chevron: pointing down while its branch is shown, right when collapsed. */}
          <path
            className={`graph-toggle-symbol ${laneColorClass(row.lane)}`}
            d={
              row.collapsed
                ? `M${nodeX - 1.25} ${nodeY - 2.5}L${nodeX + 1.25} ${nodeY}L${nodeX - 1.25} ${nodeY + 2.5}`
                : `M${nodeX - 2.5} ${nodeY - 1.25}L${nodeX} ${nodeY + 1.25}L${nodeX + 2.5} ${nodeY - 1.25}`
            }
          />
        </>
      ) : (
        <circle className={`graph-node commit ${laneColorClass(row.lane)}`} cx={nodeX} cy={nodeY} r={3} />
      )}
    </svg>
  );

  if (!row.merge || !onToggle) return svg;
  const action = row.collapsed ? 'Expand' : 'Collapse';
  const hiddenParentText =
    row.collapsedParentCount > 0
      ? `; ${row.collapsedParentCount} parent ${row.collapsedParentCount === 1 ? 'edge' : 'edges'} hidden`
      : '';
  return (
    <button
      type="button"
      className={`graph-toggle${row.collapsed ? ' collapsed' : ''}`}
      aria-label={`${action} merged branch`}
      aria-expanded={!row.collapsed}
      title={`${action} merged branch${hiddenParentText}`}
      data-testid="graph-toggle"
      data-commit-id={row.commitId}
      style={{ width } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.();
        onToggle();
      }}
    >
      {svg}
    </button>
  );
});
