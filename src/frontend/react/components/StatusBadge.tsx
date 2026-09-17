import type { ChangeStatus } from '../lib/change-status';
import { statusBadge } from '../lib/change-status';

/** A colored square with a status glyph, labelled for assistive technology. */
export function StatusBadge({ status }: { readonly status: ChangeStatus }) {
  const badge = statusBadge(status);
  return (
    <span className={`status-badge ${badge.tone}`} role="img" aria-label={badge.label} title={badge.label}>
      {badge.symbol}
    </span>
  );
}
