import type { RepositoryFileHistoryRevision } from '../../../common/ipc/contracts';

/** A bounded revision scrubber; dates are displayed in the user's locale. */
export function HistoryTimeline({
  revisions,
  selected,
  onSelect,
}: {
  readonly revisions: readonly RepositoryFileHistoryRevision[];
  readonly selected: number;
  readonly onSelect: (index: number) => void;
}) {
  if (!revisions.length) return null;
  const month = (date: string) =>
    new Date(date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return (
    <div className="history-timeline">
      <input
        type="range"
        aria-label="History timeline"
        min={0}
        max={Math.max(0, revisions.length - 1)}
        value={revisions.length - 1 - selected}
        aria-valuetext={revisions[selected]?.commit.subject}
        onChange={(event) => onSelect(revisions.length - 1 - Number(event.target.value))}
      />
      <div>
        <span>{month(revisions.at(-1)!.commit.author.date)}</span>
        <span>{month(revisions[0]!.commit.author.date)}</span>
      </div>
    </div>
  );
}
