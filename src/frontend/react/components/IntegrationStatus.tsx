import type { RepositoryIntegrationPreview } from '../../../common/ipc/contracts';
import { CheckIcon, WarningIcon } from './Icons';

export function IntegrationStatus({ value }: { readonly value: RepositoryIntegrationPreview | undefined }) {
  return (
    <span className={`integration-status ${value?.state ?? 'pending'}`} role="status">
      {value?.state === 'clean' ? (
        <CheckIcon size={14} />
      ) : value?.state === 'conflicts' ? (
        <WarningIcon size={14} />
      ) : null}
      {value?.message ?? 'Checking for conflicts…'}
    </span>
  );
}
