import { setImmediate } from 'node:timers/promises';
import { statisticsSchema, statisticsLimits } from '../../common/ipc/statistics';
import type { Statistics, StatisticsRequest, StatisticsLimitScale } from '../../common/ipc/statistics';
import { ExpectedBackendError } from '../errors';
import { GitCancelledError, GitCommandError } from '../git/runner';
import type { CommitRunner } from './commit-service';

interface Entry {
  oid: string;
  author: string;
  date: string;
  subject: string;
  paths: string[];
}
const limit = (kind: string, maximum: number) =>
  new ExpectedBackendError(
    'UNAVAILABLE',
    `Statistics exceed the ${maximum.toLocaleString('en-US')} ${kind} limit for this date range. Narrow the range or increase the Computation limit.`,
  );

/** NUL-delimited headers and paths; remove only Git's one separator LF, never filename whitespace. */
export async function parseStatisticsLog(
  output: string,
  signal: AbortSignal,
  scale: StatisticsLimitScale = 1,
): Promise<Entry[]> {
  const limits = statisticsLimits(scale);
  const tokens = output.split('\0');
  const entries: Entry[] = [];
  let i = 0;
  let touches = 0;
  while (i < tokens.length - 1) {
    if (tokens[i++] !== '') throw new Error('Invalid statistics header');
    const oid = tokens[i++]!;
    const name = tokens[i++]!;
    const email = tokens[i++]!;
    const timestamp = Number(tokens[i++]);
    const subject = tokens[i++]!;
    if (!/^[a-f0-9]{40,64}$/u.test(oid) || !Number.isFinite(timestamp))
      throw new Error('Invalid statistics commit');
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const paths: string[] = [];
    if (tokens[i]?.startsWith('\n')) {
      tokens[i] = tokens[i]!.slice(1);
      while (i < tokens.length && tokens[i] !== '') paths.push(tokens[i++]!);
    }
    touches += paths.length;
    entries.push({ oid, author: `${name} <${email}>`, date, subject, paths });
    if (entries.length > limits.commits) throw limit('commit', limits.commits);
    if (touches > limits.changes) throw limit('file-change', limits.changes);
    if (entries.length % 128 === 0) await setImmediate();
    if (signal.aborted) throw new GitCancelledError();
  }
  return entries;
}

export class StatisticsService {
  private readonly metadata = new Map<string, { time: number; entries: { oid: string; date: string }[] }>();
  private readonly cache = new Map<string, { time: number; entries: Entry[] }>();

  clear() {
    this.cache.clear();
    this.metadata.clear();
  }

  async read(
    runner: CommitRunner,
    cwd: string,
    request: StatisticsRequest,
    signal: AbortSignal,
  ): Promise<Statistics> {
    const limits = statisticsLimits(request.limitScale);
    const options = { cwd, signal, timeoutMs: 2000, maxOutputBytes: 1024 * 1024 };
    let head: string | null = null;
    try {
      head = (
        await runner.run(['--no-replace-objects', 'rev-parse', '--verify', 'HEAD^{commit}'], options)
      ).stdout.trim();
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      // Only an unborn symbolic HEAD is empty; missing/corrupt objects remain errors.
      const ref = (await runner.run(['symbolic-ref', '-q', 'HEAD'], options)).stdout.trim();
      try {
        await runner.run(['show-ref', '--verify', '--quiet', ref], options);
        throw error;
      } catch (missing) {
        if (!(missing instanceof GitCommandError) || missing.exitCode !== 1) throw missing;
      }
    }
    const shallow =
      (await runner.run(['rev-parse', '--is-shallow-repository'], options)).stdout.trim() === 'true';
    const historyKey = `${cwd}\0${head}\0${shallow}`;
    const key = `${historyKey}\0${request.from}\0${request.to}\0${request.limitScale ?? 1}`;
    const cached = this.cache.get(key);
    let entries: Entry[] = [];
    if (head) {
      if (!request.refresh && cached && Date.now() - cached.time < 60000) entries = cached.entries;
      else {
        if (request.refresh) {
          this.cache.clear();
          this.metadata.delete(historyKey);
        }
        let metadata = this.metadata.get(historyKey);
        if (!metadata || Date.now() - metadata.time >= 60000) {
          // Author dates can be out of order and differ from committer dates. Git --since
          // would prune valid commits, so scan compact metadata without reading any diffs.
          const result = await runner.run(
            [
              '--no-replace-objects',
              '-c',
              'log.showSignature=false',
              'log',
              '--no-notes',
              '--no-color',
              '--format=%H%x00%at',
              '--no-patch',
              '-z',
              '--max-count=500001',
              head,
              '--',
            ],
            { ...options, timeoutMs: 10000, maxOutputBytes: 40 * 1024 * 1024 },
          );
          const tokens = result.stdout.split('\0');
          const dates: { oid: string; date: string }[] = [];
          for (let i = 0; i < tokens.length - 1; i += 2) {
            const oid = tokens[i]!;
            if (!/^[a-f0-9]{40,64}$/u.test(oid)) throw new Error('Invalid statistics commit');
            dates.push({ oid, date: new Date(Number(tokens[i + 1]) * 1000).toISOString().slice(0, 10) });
            if (dates.length > 500000)
              throw new ExpectedBackendError(
                'UNAVAILABLE',
                'Statistics metadata scan exceeds the 500,000-commit safety limit. This limit applies before date filtering.',
              );
            if (i % 256 === 0) await setImmediate();
            if (signal.aborted) throw new GitCancelledError();
          }
          metadata = { time: Date.now(), entries: dates };
          if (this.metadata.size >= 2) this.metadata.delete(this.metadata.keys().next().value!);
          this.metadata.set(historyKey, metadata);
        }
        const matching = metadata.entries.filter(
          (entry) =>
            (!request.from || entry.date >= request.from) && (!request.to || entry.date <= request.to),
        );
        if (matching.length > limits.commits) throw limit('commit', limits.commits);
        if (matching.length) {
          const result = await runner.run(
            [
              '--no-replace-objects',
              '-c',
              'log.showSignature=false',
              'log',
              '--no-use-mailmap',
              '--no-notes',
              '--no-color',
              '--encoding=UTF-8',
              '--format=%x00%H%x00%an%x00%ae%x00%at%x00%s',
              '--name-only',
              '-z',
              '--no-renames',
              '--no-ext-diff',
              '--no-textconv',
              '--diff-merges=first-parent',
              '--no-walk=unsorted',
              '--stdin',
              '--',
            ],
            {
              ...options,
              timeoutMs: 8000 * (request.limitScale ?? 1),
              maxOutputBytes: limits.outputBytes,
              stdin: matching.map((entry) => entry.oid).join('\n') + '\n',
            },
          );
          entries = await parseStatisticsLog(result.stdout, signal, request.limitScale);
          if (entries.length !== matching.length) throw new Error('Incomplete statistics history');
          // Keep only small range snapshots; increasing a limit must not pin large results in memory.
          if (Buffer.byteLength(result.stdout) <= 8 * 1024 * 1024) {
            if (this.cache.size >= 2) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(key, { time: Date.now(), entries });
          }
        }
      }
    }
    const selected = entries.filter(
      (entry) => (!request.from || entry.date >= request.from) && (!request.to || entry.date <= request.to),
    );
    const authors = new Map<string, number>();
    const months = new Map<string, number>();
    const files = new Map<string, number[]>();
    for (const [index, entry] of selected.entries()) {
      authors.set(entry.author, (authors.get(entry.author) ?? 0) + 1);
      const month = entry.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + 1);
      for (const path of new Set(entry.paths)) {
        const commits = files.get(path) ?? [];
        commits.push(index);
        files.set(path, commits);
      }
      if (files.size > limits.paths) throw limit('path', limits.paths);
      if (index % 128 === 0) await setImmediate();
      if (signal.aborted) throw new GitCancelledError();
    }
    const dates = selected.map((entry) => entry.date).sort();
    const from = request.from ?? dates[0] ?? null;
    const to = request.to ?? dates.at(-1) ?? null;
    const buckets: Statistics['months'] = [];
    if (from && to) {
      let year = Number(from.slice(0, 4));
      let month = Number(from.slice(5, 7));
      while (`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` <= to.slice(0, 7)) {
        const label = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
        buckets.push({ month: label, count: months.get(label) ?? 0 });
        if (buckets.length > 12000)
          throw new ExpectedBackendError(
            'UNAVAILABLE',
            'The date range exceeds the 12,000-month safety limit. Narrow the date range.',
          );
        if (++month === 13) {
          month = 1;
          year++;
        }
      }
    }
    return statisticsSchema.parse({
      head,
      shallow,
      from,
      to,
      commits: selected.map(({ oid, author, date, subject }) => ({ oid, author, date, subject })),
      months: buckets,
      authors: [...authors]
        .map(([author, count]) => ({ author, count }))
        .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author)),
      files: [...files]
        .map(([path, commits]) => ({ path, commits }))
        .sort((a, b) => b.commits.length - a.commits.length || a.path.localeCompare(b.path)),
    });
  }
}
