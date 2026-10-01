import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { GitCancelledError, GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { StatisticsService } from '../../src/backend/repositories/statistics-service';

async function nativeWatches() {
  const files = await readdir('/proc/self/fdinfo');
  const contents = await Promise.all(
    files.map((file) => readFile(`/proc/self/fdinfo/${file}`, 'utf8').catch(() => '')),
  );
  return contents.reduce((sum, content) => sum + (content.match(/^inotify wd:/gmu)?.length ?? 0), 0);
}

// This resource-budget fixture reads Linux inotify/file-descriptor counters from /proc.
it.runIf(process.env.P14_BENCHMARK === '1' && process.platform === 'linux')(
  'P14 monorepo, watcher storm, concurrent worktrees, statistics and cancellation budgets',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-p14-scale-'));
    const cwd = join(root, 'monorepo');
    const git = new GitRunner();
    const run = async (...args: string[]) => (await git.run(args, { cwd, timeoutMs: 120_000 })).stdout.trim();
    const services: RepositoryService[] = [];
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    const times: Record<string, number> = {};
    const measure = async <T>(name: string, action: () => Promise<T>) => {
      const start = performance.now();
      const result = await action();
      times[name] = performance.now() - start;
      return result;
    };
    const descriptorsBefore = (await readdir('/proc/self/fd')).length;
    const watchesBefore = await nativeWatches();
    try {
      await mkdir(cwd);
      await run('init', '-q', '-b', 'main');
      await run('config', 'user.name', 'Scale Author');
      await run('config', 'user.email', 'scale@example.test');
      const source = [
        'commit refs/heads/main\ncommitter Scale Author <scale@example.test> 1700000000 +0000\ndata 5\nFirst\n',
      ];
      for (let i = 0; i < 10_000; i++) {
        const path = `packages/pkg-${Math.floor(i / 10)}/file-${i}.txt`;
        source.push(`M 100644 inline ${path}\ndata 5\nbase\n\n`);
      }
      source.push('M 100644 inline huge.txt\ndata 5\nbase\n\n\n');
      await git.run(['fast-import', '--quiet'], { cwd, stdin: source.join(''), timeoutMs: 120_000 });
      source.length = 0;
      await run('reset', '--hard', 'HEAD');
      const head = await run('rev-parse', 'HEAD');
      const linked = join(root, 'linked');
      await run('worktree', 'add', '-q', '-b', 'linked', linked);
      const service = new RepositoryService({ storagePath: join(root, 'recent.json') });
      services.push(service);
      const repo = await service.open(1, cwd);
      await service.setTrust(1, repo.id, true);
      const worktree = await service.open(1, linked);
      for (let owner = 2; owner <= 8; owner++) await service.open(owner, cwd);
      const events: number[] = [];
      service.subscribeInvalidations((owner) => events.push(owner));
      const memoryBefore = process.memoryUsage().rss;
      eventLoop.enable();
      await measure('concurrentReadsMs', () =>
        Promise.all(Array.from({ length: 8 }, (_, index) => service.getHistory(index + 1, repo.id, 0, 100))),
      );
      await measure('watcherStormWritesMs', async () => {
        for (let offset = 0; offset < 2_000; offset += 32) {
          await Promise.all(
            Array.from({ length: Math.min(32, 2_000 - offset) }, (_, j) => {
              const i = offset + j;
              return writeFile(
                join(cwd, `packages/pkg-${Math.floor(i / 10)}/file-${i}.txt`),
                `changed ${i}\n`,
              );
            }),
          );
        }
      });
      await expect.poll(() => events.length, { timeout: 3000 }).toBeGreaterThan(0);
      const changes = await measure('statusMs', () => service.getWorkingChanges(1, repo.id, true, false));
      expect(changes.unstaged).toHaveLength(2_000);
      expect(changes.truncated).toBe(false);
      const cleanLinked = await service.getWorkingChanges(1, worktree.id, true, false);
      expect(cleanLinked.unstaged).toHaveLength(0);
      await writeFile(
        join(cwd, 'huge.txt'),
        Array.from({ length: 60_000 }, (_, i) => `new line ${i}\n`).join(''),
      );
      const target = {
        kind: 'working' as const,
        area: 'unstaged' as const,
        path: 'huge.txt',
        previousPath: null,
      };
      expect((await service.getDiff(1, repo.id, target, 'normal')).state).toBe('too-large');
      const diff = await measure('largeDiffMs', () =>
        service.getDiff(1, repo.id, target, 'normal', { loadLarge: true }),
      );
      expect(diff.state).toBe('text');
      expect(diff.content).toContain('+new line 59999');
      const marker = join(root, 'cancel-pid');
      const controller = new AbortController();
      const pending = new GitRunner({ executable: process.execPath }).run(
        [resolve('tests/fixtures/operation-process.ts'), 'tree', marker],
        { cwd, signal: controller.signal },
      );
      const stopped = expect(pending).rejects.toBeInstanceOf(GitCancelledError);
      await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).not.toBe('');
      const child = Number(await readFile(marker, 'utf8'));
      await measure('cancelProcessTreeMs', async () => {
        controller.abort();
        await stopped;
      });
      await expect
        .poll(
          async () => (await readFile(`/proc/${child}/stat`, 'utf8').catch(() => '')).split(' ')[2] ?? 'gone',
        )
        .toMatch(/^(Z|gone)$/);
      eventLoop.disable();
      expect(await run('rev-parse', 'HEAD')).toBe(head);
      expect(await run('diff', '--cached', '--name-only')).toBe('');
      const report = {
        hardware: {
          cpu: cpus()[0]?.model,
          cpus: cpus().length,
          memoryGiB: totalmem() / 1024 ** 3,
          kernel: release(),
          git: await git.version(),
        },
        files: 10_001,
        changedFiles: 2_001,
        directories: 1_002,
        owners: 8,
        worktrees: 2,
        diffLines: 60_000,
        times,
        watcherNotifications: events.length,
        eventLoopMaxMs: eventLoop.max / 1e6,
        rssGrowthMiB: (process.memoryUsage().rss - memoryBefore) / 1024 ** 2,
        descriptorsBefore,
        descriptorsOpen: (await readdir('/proc/self/fd')).length,
        watchesBefore,
        watchesOpen: await nativeWatches(),
      };
      service.dispose();
      await service.settled();
      await mkdir('release/p14', { recursive: true });
      await writeFile(
        'release/p14/backend-scale.json',
        JSON.stringify(
          {
            ...report,
            descriptorsAfter: (await readdir('/proc/self/fd')).length,
            watchesAfter: await nativeWatches(),
          },
          null,
          2,
        ),
      );
      expect(times.concurrentReadsMs).toBeLessThan(3_000);
      expect(times.statusMs).toBeLessThan(3_000);
      expect(times.largeDiffMs).toBeLessThan(3_000);
      expect(times.cancelProcessTreeMs).toBeLessThan(2_000);
      expect(report.eventLoopMaxMs).toBeLessThan(250);
      expect(report.watcherNotifications).toBeLessThan(8 * 20);
      expect(report.rssGrowthMiB).toBeLessThan(512);
      expect((await readdir('/proc/self/fd')).length).toBeLessThanOrEqual(descriptorsBefore + 4);
      expect(report.watchesOpen - watchesBefore).toBeLessThanOrEqual(2 * 1024);
      expect(await nativeWatches()).toBe(watchesBefore);
    } finally {
      eventLoop.disable();
      for (const service of services) service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);

it.runIf(process.env.P14_BENCHMARK === '1')(
  'P14 statistics cold/warm budgets on 100k commits',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-p14-statistics-'));
    const git = new GitRunner();
    try {
      await git.run(['init', '-q', '-b', 'main'], { cwd: root });
      const source: string[] = [];
      for (let i = 0; i < 100_000; i++) {
        const message = `Revision ${i}`;
        source.push(
          `commit refs/heads/main\ncommitter Scale Author <scale@example.test> ${1700000000 + i} +0000\ndata ${message.length}\n${message}\n\n`,
        );
      }
      await git.run(['fast-import', '--quiet'], { cwd: root, stdin: source.join(''), timeoutMs: 120_000 });
      source.length = 0;
      const statistics = new StatisticsService();
      const request = {
        id: `repo-${'a'.repeat(64)}`,
        readId: randomUUID(),
        from: null,
        to: null,
        refresh: false,
        limitScale: 10 as const,
      };
      const start = performance.now();
      const cold = await statistics.read(git, root, request, new AbortController().signal);
      const coldMs = performance.now() - start;
      const warmStart = performance.now();
      const warm = await statistics.read(git, root, request, new AbortController().signal);
      const warmMs = performance.now() - warmStart;
      await mkdir('release/p14', { recursive: true });
      await writeFile(
        'release/p14/statistics-scale.json',
        JSON.stringify({ commits: cold.commits.length, coldMs, warmMs, files: 0, limitScale: 10 }, null, 2),
      );
      expect(cold.commits).toHaveLength(100_000);
      expect(warm.commits).toEqual(cold.commits);
      expect(coldMs).toBeLessThan(15_000);
      expect(warmMs).toBeLessThan(3_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
