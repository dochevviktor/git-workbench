import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  statisticsFixture,
  statisticsUnusualPath,
  populateLargeStatisticsFixture,
} from '../statistics-fixture';
import { StatisticsService, parseStatisticsLog } from '../../src/backend/repositories/statistics-service';
import { statisticsRequestSchema } from '../../src/common/ipc/statistics';
import { GitCancelledError } from '../../src/backend/git/runner';
import { createDesktopApi } from '../../src/backend/preload/create-desktop-api';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture() {
  const f = await statisticsFixture();
  cleanups.push(f.cleanup);
  return f;
}
const request = () => ({
  id: `repo-${'a'.repeat(64)}`,
  readId: randomUUID(),
  from: null,
  to: null,
  refresh: false,
});
const signal = () => new AbortController().signal;

describe('F35 independently defined statistics', () => {
  it('enforces window ownership and aborts active reads on cancel, tab close and window disposal', async () => {
    const f = await fixture();
    await f.populate();
    const service = new RepositoryService({ storagePath: join(f.root, 'recent.json') });
    const opened = await service.open(1, f.cwd);
    await service.setTrust(1, opened.id, true);
    const req = { ...request(), id: opened.id };
    await expect(service.getStatistics(2, req)).rejects.toMatchObject({ code: 'REPOSITORY_NOT_OPEN' });
    const read = vi
      .spyOn(StatisticsService.prototype, 'read')
      .mockImplementation(async (_runner, _cwd, _request, activeSignal) => {
        await new Promise<void>((_resolve, reject) => {
          activeSignal.addEventListener('abort', () => reject(new GitCancelledError()), { once: true });
        });
        throw new Error('Unreachable');
      });
    try {
      const cancelled = expect(service.getStatistics(1, req)).rejects.toMatchObject({
        code: 'OPERATION_FAILED',
      });
      await service.cancelStatistics(2, req); // Another window cannot cancel this read.
      expect(read.mock.calls[0]![3].aborted).toBe(false);
      await service.cancelStatistics(1, req);
      await cancelled;
      const closed = expect(service.getStatistics(1, req)).rejects.toMatchObject({
        code: 'OPERATION_FAILED',
      });
      await service.close(1, req.id);
      await closed;
      await service.open(1, f.cwd);
      const disposed = expect(service.getStatistics(1, req)).rejects.toMatchObject({
        code: 'OPERATION_FAILED',
      });
      service.disposeWindow(1);
      await disposed;
    } finally {
      read.mockRestore();
      service.dispose();
    }
  });
  it('counts UTC author dates, exact identities, empty commits and Unicode/newline paths; preserves Git state', async () => {
    const f = await fixture();
    await f.populate();
    const before = await f.run('show-ref');
    const service = new StatisticsService();
    const data = await service.read(f.git, f.cwd, request(), signal());
    expect(data.commits).toHaveLength(3);
    expect(data.months).toEqual([
      { month: '2025-02', count: 1 },
      { month: '2025-03', count: 2 },
    ]);
    expect(data.authors).toEqual([
      { author: 'Alice <alice@example.test>', count: 2 },
      { author: 'Bob <bob@example.test>', count: 1 },
    ]);
    expect(data.files.map((file) => [file.path, file.commits.length])).toEqual([
      ['README.md', 2],
      [statisticsUnusualPath, 1],
    ]);
    const filtered = await service.read(
      f.git,
      f.cwd,
      { ...request(), from: '2025-03-03', to: '2025-03-03' },
      signal(),
    );
    expect(filtered.commits.map((commit) => commit.subject)).toEqual(['Update README']);
    expect(await f.run('show-ref')).toBe(before);
    expect(await f.run('status', '--porcelain')).toBe('');
  });
  it('handles unborn, deleted paths, renames, first-parent merge changes and HEAD cache invalidation', async () => {
    const f = await fixture();
    const service = new StatisticsService();
    expect((await service.read(f.git, f.cwd, request(), signal())).commits).toEqual([]);
    await f.populate();
    await service.read(f.git, f.cwd, request(), signal());
    await f.run('mv', 'README.md', 'renamed.md');
    await f.commit('Rename', '2025-04-01T00:00:00Z');
    await f.run('checkout', '-qb', 'topic');
    await writeFile(join(f.cwd, 'topic.txt'), 'topic');
    await f.commit('Topic', '2025-04-02T00:00:00Z');
    await f.run('checkout', 'main');
    await f.run('merge', '--no-ff', '--no-gpg-sign', '-m', 'Merge topic', 'topic');
    const data = await service.read(f.git, f.cwd, request(), signal());
    expect(data.commits).toHaveLength(Number(await f.run('rev-list', '--count', 'HEAD')));
    expect(data.files.find((file) => file.path === 'README.md')?.commits).toHaveLength(3);
    expect(data.files.find((file) => file.path === 'renamed.md')?.commits).toHaveLength(1);
    expect(data.files.find((file) => file.path === 'topic.txt')?.commits).toHaveLength(2);
    const run = vi.fn(f.git.run);
    await service.read({ run }, f.cwd, request(), signal());
    expect(run.mock.calls.some(([args]) => args.includes('log'))).toBe(false);
    await service.read({ run }, f.cwd, { ...request(), refresh: true }, signal());
    expect(run.mock.calls.some(([args]) => args.includes('log'))).toBe(true);
  });
  it('rejects invalid ranges, unauthorized inspector access and malformed responses', async () => {
    expect(statisticsRequestSchema.safeParse({ ...request(), from: '2025-02-30' }).success).toBe(false);
    expect(
      statisticsRequestSchema.safeParse({ ...request(), from: '2025-03-01', to: '2025-02-01' }).success,
    ).toBe(false);
    const invoke = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const api = createDesktopApi({ invoke, on: vi.fn(), removeListener: vi.fn() });
    expect(await api.repository.getStatistics(request())).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(await api.repository.getStatistics({ ...request(), readId: 'bad' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(canInvokeInspector('commit-details', 'repository:get-statistics', request())).toBe(false);
  });
  it('keeps aliases distinct despite mailmap and supports detached and shallow history', async () => {
    const f = await fixture();
    await f.populate();
    await writeFile(
      join(f.root, 'mailmap'),
      'Canonical <canonical@example.test> Alice <alice@example.test>\n',
    );
    await f.run('config', 'mailmap.file', join(f.root, 'mailmap'));
    await f.commit('Alias', '2025-03-05T00:00:00Z', 'Alice <alias@example.test>');
    await f.run('checkout', '--detach');
    const service = new StatisticsService();
    const data = await service.read(f.git, f.cwd, request(), signal());
    expect(data.authors.map((author) => author.author)).toEqual(
      expect.arrayContaining(['Alice <alice@example.test>', 'Alice <alias@example.test>']),
    );
    expect(data.authors.some((author) => author.author.includes('Canonical'))).toBe(false);
    const shallow = join(f.root, 'shallow');
    await f.run('clone', '--depth=1', `file://${f.cwd}`, shallow);
    const partial = await service.read(f.git, shallow, request(), signal());
    expect(partial.shallow).toBe(true);
    expect(partial.commits).toHaveLength(1);
    const bare = join(f.root, 'bare.git');
    await f.run('clone', '--bare', f.cwd, bare);
    expect((await service.read(f.git, bare, request(), signal())).commits).toHaveLength(4);
  });
  it('honors cancellation and rejects over-limit logs instead of publishing partial totals', async () => {
    const f = await fixture();
    await f.populate();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new StatisticsService().read(f.git, f.cwd, request(), controller.signal),
    ).rejects.toBeInstanceOf(GitCancelledError);
    const record = ['', 'a'.repeat(40), 'A', 'a@test', '1738547200', 'subject', ''].join('\0');
    await expect(parseStatisticsLog(record.repeat(10001), signal())).rejects.toThrow('10,000 commit limit');
    expect(await parseStatisticsLog(record.repeat(10001), signal(), 2)).toHaveLength(10001);
  });
  it('filters author dates before limits and diff reads, including old dates beyond the former scan cap', async () => {
    const f = await fixture();
    await populateLargeStatisticsFixture(f);
    const service = new StatisticsService();
    const run = vi.fn(f.git.run);
    await expect(service.read({ run }, f.cwd, request(), signal())).rejects.toThrow('10,000 commit limit');
    expect(run.mock.calls.some(([args]) => args.includes('--name-only'))).toBe(false);
    run.mockClear();
    const selected = await service.read(
      { run },
      f.cwd,
      { ...request(), from: '2025-01-01', to: '2025-01-01' },
      signal(),
    );
    expect(selected.commits.map((commit) => commit.subject).sort()).toEqual(['Commit 0', 'Commit 10004']);
    const diff = run.mock.calls.find(([args]) => args.includes('--name-only'))!;
    expect(String(diff[1].stdin).trim().split('\n')).toHaveLength(2);
    expect(run.mock.calls.some(([args]) => args.includes('--format=%H%x00%at'))).toBe(false);
    expect(
      (await service.read(f.git, f.cwd, { ...request(), from: '2027-01-01', to: '2027-01-02' }, signal()))
        .commits,
    ).toHaveLength(0);
    expect(
      (await service.read(f.git, f.cwd, { ...request(), limitScale: 2 }, signal())).commits,
    ).toHaveLength(10005);
    // A raised-limit cache cannot let a later standard request bypass its limit.
    await expect(service.read(f.git, f.cwd, request(), signal())).rejects.toThrow('10,000 commit limit');
    expect(statisticsRequestSchema.safeParse({ ...request(), limitScale: 1000 }).success).toBe(false);
  });
});
