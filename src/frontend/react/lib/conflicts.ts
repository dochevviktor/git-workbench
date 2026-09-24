import type { DesktopApi } from '../../../common/ipc/api';
import type { RepositoryResolveConflictRequest } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from './operations';

export async function stageConflictResolution(api: DesktopApi, request: RepositoryResolveConflictRequest) {
  const operation = await waitForOperation(
    api,
    unwrapResult(await api.repository.startConflictResolution(request)),
  );
  if (operation.status !== 'succeeded') throw new Error(operation.message);
  return unwrapResult(await api.repository.getConflicts({ id: request.id }));
}
