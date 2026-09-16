import type { ReferenceChip } from '../lib/references';
import { laneColorClass } from '../lib/graph-geometry';
import { CheckIcon, RemoteIcon, StashItemIcon, TagIcon } from './Icons';

function chipIcon(chip: ReferenceChip) {
  if (chip.kind === 'remote' || chip.tracksRemote) return <RemoteIcon size={12} />;
  if (chip.kind === 'tag') return <TagIcon size={11} />;
  if (chip.kind === 'stash') return <StashItemIcon size={11} />;
  return null;
}

/** Reference labels take the color of the commit's graph lane, like the line they sit beside. */
export function ReferenceChipList({
  chips,
  lane,
}: {
  readonly chips: readonly ReferenceChip[];
  readonly lane: number;
}) {
  return (
    <span className="ref-chips">
      {chips.map((chip) => {
        const icon = chipIcon(chip);
        const classes = ['ref-chip', chip.kind, laneColorClass(lane)];
        if (chip.current) classes.push('current');
        return (
          <span key={chip.key} className={classes.join(' ')} title={chip.title}>
            {icon && (
              <span className="ref-chip-icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <span className="ref-chip-label">
              {chip.current && chip.kind === 'branch' && <CheckIcon size={11} strokeWidth={2.25} />}
              {chip.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}
