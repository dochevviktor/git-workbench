import { describe, expect, it } from 'vitest';
import { BackgroundFetchScheduler } from '../../src/backend/operations/background-fetch-scheduler';
import type { BackgroundFetchTarget } from '../../src/backend/operations/background-fetch-scheduler';
import type { RepositoryOperation } from '../../src/common/ipc/contracts';

const repositoryId = `repo-${'a'.repeat(64)}`;

function operation(
  target: BackgroundFetchTarget,
  id: string,
  status: RepositoryOperation['status'] = 'running',
) {
  return {
    id: `op-${id.padStart(32, '0')}`,
    repositoryId: target.repositoryId,
    kind: 'fetch' as const,
    source: 'background' as const,
    title: `Fetch '${target.remote}'`,
    status,
    revision: status === 'running' ? 0 : 1,
    startedAt: '2026-09-19T10:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-09-19T10:00:01.000Z',
    progress: null,
    command: `git fetch -- ${target.remote}`,
    output: '',
    message: status === 'running' ? 'Running…' : 'Fetched new changes.',
    failureReason: null,
    canForceWithLease: false,
  } satisfies RepositoryOperation;
}

describe('background fetch scheduler', () => {
  it('visits enabled remotes in order and never overlaps a repository', async () => {
    const started: BackgroundFetchTarget[] = [];
    const scheduler = new BackgroundFetchScheduler({
      intervalMs: 1_000,
      start: async (target) => {
        started.push(target);
        return operation(target, String(started.length));
      },
    });
    scheduler.configure(1, repositoryId, ['origin', 'upstream', 'origin']);

    const first = await scheduler.runNow(1, repositoryId);
    expect(first).toBe(`op-${'1'.padStart(32, '0')}`);
    expect(await scheduler.runNow(1, repositoryId)).toBeUndefined();
    expect(started.map((target) => target.remote)).toEqual(['origin']);

    scheduler.operationChanged(1, operation(started[0]!, '1', 'succeeded'));
    await scheduler.runNow(1, repositoryId);
    expect(started.map((target) => target.remote)).toEqual(['origin', 'upstream']);
    scheduler.dispose();
  });

  it('cancels a late accepted operation when its repository is removed while starting', async () => {
    let release!: (operation: RepositoryOperation) => void;
    const cancelled: string[] = [];
    const scheduler = new BackgroundFetchScheduler({
      intervalMs: 1_000,
      start: (target) =>
        new Promise((resolve) => {
          release = resolve;
          void target;
        }),
      cancel: (_target, operationId) => cancelled.push(operationId),
    });
    scheduler.configure(1, repositoryId, ['origin']);
    const target: BackgroundFetchTarget = { ownerId: 1, repositoryId, remote: 'origin' };
    const running = scheduler.runNow(1, repositoryId);
    expect(scheduler.remove(1, repositoryId)).toEqual([]);
    release(operation(target, '2'));
    await running;
    expect(cancelled).toEqual([`op-${'2'.padStart(32, '0')}`]);
    scheduler.dispose();
  });

  it('releases an in-flight operation when its automatic-fetch preference is removed', async () => {
    const scheduler = new BackgroundFetchScheduler({
      intervalMs: 1_000,
      start: async (target) => operation(target, '3'),
    });
    scheduler.configure(1, repositoryId, ['origin']);
    await scheduler.runNow(1, repositoryId);
    expect(scheduler.configure(1, repositoryId, [])).toEqual([`op-${'3'.padStart(32, '0')}`]);
    scheduler.dispose();
  });
});
