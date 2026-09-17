import type { ReferenceChip } from '../lib/references';
import { laneColorClass } from '../lib/graph-geometry';
import { CheckIcon, RemoteIcon, StashItemIcon, TagIcon } from './Icons';

/**
 * Branch labels take the color of the commit's graph lane, like the line they sit beside, and a branch
 * with a remote gets its own remote marker box. Tags and stashes keep a fixed color with the icon inside.
 */
export function ReferenceChipList({
  chips,
  lane,
}: {
  readonly chips: readonly ReferenceChip[];
  readonly lane: number;
}) {
  const laneClass = laneColorClass(lane);
  return (
    <span className="ref-chips">
      {chips.map((chip) => {
        if (chip.kind === 'tag' || chip.kind === 'stash' || chip.kind === 'other') {
          return (
            <span key={chip.key} className={`ref-chip ${chip.kind}`} title={chip.title}>
              {chip.kind !== 'other' && (
                <span className="ref-chip-icon" aria-hidden="true">
                  {chip.kind === 'tag' ? <TagIcon size={11} /> : <StashItemIcon size={11} />}
                </span>
              )}
              <span className="ref-chip-label">{chip.label}</span>
            </span>
          );
        }
        const classes = ['ref-chip', chip.kind, laneClass];
        if (chip.current) classes.push('current');
        return (
          <span key={chip.key} className="ref-chip-group" title={chip.title}>
            {(chip.kind === 'remote' || chip.tracksRemote) && (
              <span className={`ref-chip ref-chip-remote ${laneClass}`} aria-hidden="true">
                <RemoteIcon size={12} />
              </span>
            )}
            <span className={classes.join(' ')}>
              <span className="ref-chip-label">
                {chip.current && chip.kind === 'branch' && <CheckIcon size={11} strokeWidth={2.25} />}
                {chip.label}
              </span>
            </span>
          </span>
        );
      })}
    </span>
  );
}
