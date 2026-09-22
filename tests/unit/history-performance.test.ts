import { mkdtemp, rm } from 'node:fs/promises';
import { cpus, platform, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { buildHistoryGraph } from '../../src/common/history-graph';
import { buildCollapsedHistory, getMergeCommitIds } from '../../src/common/history-collapse';

/** Explicit benchmark: HISTORY_BENCHMARK=1 npx vitest run tests/unit/history-performance.test.ts */
it.runIf(process.env.HISTORY_BENCHMARK === '1')(
  'records cold/warm history and graph budgets for 100k commits and 1k refs',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-workbench-history-scale-'));
    const git = new GitRunner();
    const initialRss = process.memoryUsage().rss;
    let service: RepositoryService | undefined;
    let memorySampler: ReturnType<typeof setInterval> | undefined;
    try {
      await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: directory });
      const commands: string[] = [];
      for (let index = 1; index <= 100_000; index += 1) {
        const branch = index % 100 === 99 ? 'topic' : 'main';
        const message = `Commit ${index}`;
        commands.push(
          `commit refs/heads/${branch}\nmark :${index}\ncommitter Scale Author <scale@test.invalid> ${1_700_000_000 + index} +0000\ndata ${message.length}\n${message}\n`,
        );
        if (branch === 'topic') commands.push(`from :${index - 1}\n`);
        if (index % 100 === 0) commands.push(`merge :${index - 1}\n`);
        commands.push('\n');
        if (index % 100 === 0) commands.push(`reset refs/heads/milestone/${index}\nfrom :${index}\n\n`);
      }
      await git.run(['fast-import', '--quiet'], {
        cwd: directory,
        stdin: commands.join(''),
        timeoutMs: 120_000,
      });
      // The fixture source is not application history state. Drop its references before measuring
      // read-only operations, and report its RSS cost separately instead of hiding it in that budget.
      commands.length = 0;
      const fixtureRss = process.memoryUsage().rss;
      service = new RepositoryService({ storagePath: join(directory, 'recent.json'), runner: git });
      const repository = await service.open(91, directory);
      await service.setTrust(91, repository.id, true);
      const operationBaseline = process.memoryUsage();
      let sampledOperationPeakRss = operationBaseline.rss;
      const memoryStages: { stage: string; rssMiB: number; heapUsedMiB: number; externalMiB: number }[] = [];
      const sampleMemory = (stage: string) => {
        const usage = process.memoryUsage();
        sampledOperationPeakRss = Math.max(sampledOperationPeakRss, usage.rss);
        memoryStages.push({
          stage,
          rssMiB: usage.rss / 1024 ** 2,
          heapUsedMiB: usage.heapUsed / 1024 ** 2,
          externalMiB: usage.external / 1024 ** 2,
        });
      };
      sampleMemory('before-reads');
      // RSS sampling catches transport-buffer peaks between completed stages. This remains Node
      // process memory, including Vitest overhead; it is neither browser memory nor a forced-GC test.
      memorySampler = setInterval(() => {
        sampledOperationPeakRss = Math.max(sampledOperationPeakRss, process.memoryUsage.rss());
      }, 5);
      const coldStart = performance.now();
      const cold = await service.getHistory(91, repository.id, 0, 100);
      const coldMs = performance.now() - coldStart;
      sampleMemory('first-page');
      const warmStart = performance.now();
      const warm = await service.getHistory(91, repository.id, 0, 100);
      const warmMs = performance.now() - warmStart;
      sampleMemory('warm-page');
      const raw = await git.run(['rev-list', '--all', '--topo-order', '--parents'], {
        cwd: directory,
        maxOutputBytes: 16 * 1024 * 1024,
      });
      const commits = raw.stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [id, ...parents] = line.split(' ');
          return { id: id!, parents };
        });
      sampleMemory('full-ancestry');
      const graphStart = performance.now();
      const graph = buildHistoryGraph(commits);
      const graphMs = performance.now() - graphStart;
      sampleMemory('full-graph');
      const distant = commits[90_000]!;
      const anchorStart = performance.now();
      const anchored = await service.getHistory(91, repository.id, 0, 100, undefined, {
        kind: 'commit',
        commitId: distant.id,
      });
      const anchorMs = performance.now() - anchorStart;
      sampleMemory('distant-anchor');
      const oldest = await service.getHistory(91, repository.id, 0, 100, undefined, { kind: 'oldest' });
      sampleMemory('oldest-page');
      const collapseStart = performance.now();
      const collapsed = buildCollapsedHistory(commits, new Set(getMergeCommitIds(commits)));
      const collapseMs = performance.now() - collapseStart;
      sampleMemory('collapsed-projection');
      const rssDeltaMiB = (process.memoryUsage().rss - initialRss) / 1024 / 1024;
      const readOnlyPeakRssDeltaMiB = (sampledOperationPeakRss - operationBaseline.rss) / 1024 ** 2;
      // Emit diagnostics before every assertion, including failing memory/performance budgets.
      console.info(
        JSON.stringify({
          platform: platform(),
          cpu: cpus()[0]?.model,
          totalMemoryGiB: totalmem() / 1024 ** 3,
          commits: commits.length,
          refs: cold.references.length,
          coldMs,
          warmMs,
          graphMs,
          anchorMs,
          collapseMs,
          fixtureRssDeltaMiB: (fixtureRss - initialRss) / 1024 ** 2,
          fixtureIncludedFinalRssDeltaMiB: rssDeltaMiB,
          readOnlyPeakRssDeltaMiB,
          memoryStages,
        }),
      );
      expect(commits).toHaveLength(100_000);
      expect(cold.references.length).toBeGreaterThanOrEqual(1_000);
      expect(cold.commits.map((entry) => entry.id)).toEqual(warm.commits.map((entry) => entry.id));
      expect(graph).toHaveLength(100_000);
      expect(anchored.offset).toBe(89_950);
      expect(anchored.commits.map((entry) => entry.id)).toContain(distant.id);
      expect(oldest.offset).toBe(99_900);
      expect(oldest.commits.at(-1)?.id).toBe(commits.at(-1)?.id);
      expect(oldest.hasMore).toBe(false);
      expect(collapsed.hiddenCommitIds.size).toBe(1_000);
      // Budgets apply to this opt-in service/pure-projection harness, not browser paint or page navigation.
      expect(coldMs).toBeLessThan(2_000);
      expect(warmMs).toBeLessThan(1_500);
      expect(graphMs).toBeLessThan(1_000);
      expect(collapseMs).toBeLessThan(2_000);
      expect(anchorMs).toBeLessThan(2_000);
      // Retain the original fixture-inclusive ceiling as well as the more diagnostic sampled budget.
      expect(rssDeltaMiB).toBeLessThan(512);
      expect(readOnlyPeakRssDeltaMiB).toBeLessThan(512);
    } finally {
      if (memorySampler) clearInterval(memorySampler);
      service?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
