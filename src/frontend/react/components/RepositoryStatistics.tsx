import { useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon, FolderIcon } from './Icons';
import type { Statistics, StatisticsLimitScale } from '../../../common/ipc/statistics';
import { statisticsLimits, statisticsLimitScaleSchema } from '../../../common/ipc/statistics';
import { unwrapResult } from '../../../common/ipc/result';
import './statistics.css';

const colors = ['#ef9b35', '#518ed2', '#65aa79', '#af7fc4', '#d77079', '#5cacb8'];

export function RepositoryStatistics({
  repositoryId,
  name,
  initialView,
  onClose,
}: {
  readonly repositoryId: string;
  readonly name: string;
  readonly initialView: 'statistics' | 'treemap';
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const currentRead = useRef<string | null>(null);
  const [view, setView] = useState(initialView);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limitScale, setLimitScale] = useState<StatisticsLimitScale>(1);
  const limits = statisticsLimits(limitScale);
  const [query, setQuery] = useState({ from: '', to: '', refresh: false, revision: 0, limitScale });
  const [data, setData] = useState<Statistics>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const api = window.desktop;
    if (!api) return;
    const readId = crypto.randomUUID();
    currentRead.current = readId;
    let disposed = false;
    void api.repository
      .getStatistics({
        id: repositoryId,
        readId,
        from: query.from || null,
        to: query.to || null,
        refresh: query.refresh,
        limitScale: query.limitScale,
      })
      .then(unwrapResult)
      .then((result) => {
        if (!disposed) setData(result);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Statistics unavailable.');
      })
      .finally(() => {
        if (!disposed) {
          setBusy(false);
          currentRead.current = null;
        }
      });
    return () => {
      disposed = true;
      void api.repository.cancelStatistics({ id: repositoryId, readId });
    };
  }, [repositoryId, query]);
  const load = (refresh: boolean) => {
    setBusy(true);
    setError('');
    setData(undefined);
    setQuery({ from, to, refresh, revision: query.revision + 1, limitScale });
  };
  return (
    <dialog
      ref={dialog}
      className="dialog statistics-dialog"
      aria-label="Repository Statistics"
      data-view={view}
      onKeyDown={(event) => event.stopPropagation()}
      onClose={onClose}
    >
      <header>
        <h2>
          {view === 'statistics' ? 'Statistics' : 'Repository Treemap'} <small>{name}</small>
        </h2>
        <nav aria-label="Statistics views">
          <button type="button" aria-pressed={view === 'statistics'} onClick={() => setView('statistics')}>
            Statistics
          </button>
          <button type="button" aria-pressed={view === 'treemap'} onClick={() => setView('treemap')}>
            Treemap
          </button>
        </nav>
      </header>
      <form
        className="statistics-range"
        onSubmit={(event) => {
          event.preventDefault();
          load(false);
        }}
      >
        <label>
          From{' '}
          <input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <details className="statistics-options">
          <summary>Calculation options</summary>
          <label>
            Computation limit{' '}
            <select
              aria-label="Computation limit"
              value={limitScale}
              disabled={busy}
              onChange={(event) =>
                setLimitScale(statisticsLimitScaleSchema.parse(Number(event.target.value)))
              }
            >
              <option value={1}>Standard (10,000 commits)</option>
              <option value={2}>2× (20,000 commits)</option>
              <option value={5}>5× (50,000 commits)</option>
              <option value={10}>10× (100,000 commits)</option>
            </select>
          </label>
          <p className="statistics-policy" role={limitScale > 1 ? 'status' : undefined}>
            Range limits: {limits.commits.toLocaleString()} commits, {limits.paths.toLocaleString()} paths,{' '}
            {limits.changes.toLocaleString()} file changes. Higher limits increase CPU and memory use, can
            slow the interface, and may take up to {Math.ceil(limits.timeoutMs / 1000)} seconds. Apply range
            or Refresh to use the selected limit.
          </p>
          <p className="statistics-policy">
            HEAD history · UTC author dates · exact name/email (no mailmap) · merges counted once; file
            changes versus first parent · renames counted as delete/add.
          </p>
        </details>
        <button type="submit" disabled={busy || Boolean(from && to && from > to)}>
          Apply range
        </button>
        <button type="button" disabled={busy || Boolean(from && to && from > to)} onClick={() => load(true)}>
          Refresh
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => {
              if (currentRead.current)
                void window.desktop?.repository.cancelStatistics({
                  id: repositoryId,
                  readId: currentRead.current,
                });
            }}
          >
            Cancel calculation
          </button>
        )}
      </form>
      <main className="statistics-content" aria-busy={busy}>
        {busy && <p role="status">Calculating repository activity…</p>}
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <p className="statistics-summary">
              {data.commits.length} commits · {data.authors.length} contributors · {data.files.length} paths ·{' '}
              {data.from ?? 'No history'}
              {data.to && ` – ${data.to}`}{' '}
              {data.head && <span title={data.head}>· HEAD {data.head.slice(0, 7)}</span>}
            </p>
            {data.shallow && (
              <p role="status">Shallow repository: only locally available history is included.</p>
            )}
            {data.commits.length === 0 ? (
              <p>No commits in this date range.</p>
            ) : view === 'statistics' ? (
              <StatisticsCharts data={data} />
            ) : (
              <ActivityTreemap key={`${data.head}:${data.from}:${data.to}`} data={data} />
            )}
          </>
        )}
      </main>
      <footer>
        <span>Local, read-only snapshot. Refresh to include new history.</span>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  );
}

function StatisticsCharts({ data }: { readonly data: Statistics }) {
  const maximum = Math.ceil(Math.max(1, ...data.months.map((month) => month.count)) / 3) * 3;
  const point = (index: number, count: number) =>
    `${40 + (index * 920) / Math.max(1, data.months.length - 1)},${210 - (count * 180) / maximum}`;
  let accumulated = 0;
  const slices = data.authors.slice(0, 5).map((author) => ({ ...author }));
  const remainder = data.authors.slice(5).reduce((sum, item) => sum + item.count, 0);
  if (remainder) slices.push({ author: 'Other contributors', count: remainder });
  const gradient = slices
    .map((slice, index) => {
      const start = accumulated;
      accumulated += (slice.count * 100) / data.commits.length;
      return `${colors[index]} ${start}% ${accumulated}%`;
    })
    .join(',');
  return (
    <>
      <h3>Commits per month</h3>
      <svg
        className="statistics-chart"
        viewBox="0 0 1000 250"
        role="img"
        aria-label={`Commits per month, maximum ${maximum}`}
      >
        {[0, 1, 2, 3].map((line) => (
          <g key={line}>
            <line x1="40" x2="960" y1={30 + line * 60} y2={30 + line * 60} />
            <text x="3" y={35 + line * 60}>
              {Math.round((maximum * (3 - line)) / 3)}
            </text>
          </g>
        ))}
        <polyline points={data.months.map((month, index) => point(index, month.count)).join(' ')} />
        {data.months.map((month, index) => (
          <g key={month.month}>
            <circle
              cx={point(index, month.count).split(',')[0]}
              cy={point(index, month.count).split(',')[1]}
              r="3"
            >
              <title>
                {month.month}: {month.count} commits
              </title>
            </circle>
            {(index % Math.max(1, Math.ceil(data.months.length / 12)) === 0 ||
              index === data.months.length - 1) && (
              <text x={40 + (index * 920) / Math.max(1, data.months.length - 1)} y="240" textAnchor="middle">
                {month.month}
              </text>
            )}
          </g>
        ))}
      </svg>
      <details>
        <summary>Monthly counts</summary>
        <table>
          <tbody>
            {data.months.map((month) => (
              <tr key={month.month}>
                <th>{month.month}</th>
                <td>{month.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="statistics-contributors">
        <section>
          <h3>All contributors</h3>
          <table aria-label="All contributors">
            <thead>
              <tr>
                <th>Author</th>
                <th>Commits</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {data.authors.map((author) => (
                <tr key={author.author}>
                  <td>{author.author}</td>
                  <td>{author.count}</td>
                  <td>{((author.count * 100) / data.commits.length).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Top contributors</h3>
          <div
            className="statistics-donut"
            role="img"
            aria-label="Contributor shares; exact values in contributor table"
            style={{ background: `conic-gradient(${gradient})` }}
          >
            <span>
              {data.commits.length}
              <small>commits</small>
            </span>
          </div>
          <ul className="statistics-legend">
            {slices.map((slice, index) => (
              <li key={slice.author}>
                <i style={{ background: colors[index] }} />
                {slice.author} · {((slice.count * 100) / data.commits.length).toFixed(1)}%
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

interface Tile {
  name: string;
  path: string;
  weight: number;
  folder: boolean;
  children?: Tile[];
}
function TileLayout({
  tiles,
  onSelect,
  selected,
  depth = 0,
}: {
  readonly tiles: Tile[];
  readonly onSelect: (tile: Tile) => void;
  readonly selected: string;
  readonly depth?: number;
}) {
  if (!tiles.length) return null;
  if (tiles.length === 1) {
    const tile = tiles[0]!;
    if (tile.children?.length)
      return (
        <div className="statistics-folder">
          <button
            type="button"
            className="statistics-folder-heading"
            title={`Expand ${tile.path}`}
            onClick={() => onSelect(tile)}
          >
            <FolderIcon />
            {tile.name} <small>{tile.weight}</small>
          </button>
          <div className="statistics-folder-content">
            <TileLayout tiles={tile.children} onSelect={onSelect} selected={selected} depth={depth + 1} />
          </div>
        </div>
      );
    return (
      <button
        type="button"
        className="statistics-tile"
        aria-pressed={!tile.folder && tile.path === selected}
        title={`${tile.path}: ${tile.weight} file changes`}
        onClick={() => onSelect(tile)}
      >
        <span>
          {tile.folder ? '▸ ' : ''}
          {tile.name}
        </span>
        <strong>
          {tile.folder ? <FolderIcon /> : <FileIcon />}
          {tile.weight}
        </strong>
      </button>
    );
  }
  const total = tiles.reduce((sum, tile) => sum + tile.weight, 0);
  let sum = 0;
  let split = 0;
  do {
    sum += tiles[split++]!.weight;
  } while (split < tiles.length - 1 && sum < total / 2);
  return (
    <div className="statistics-tile-split" style={{ flexDirection: depth % 2 ? 'column' : 'row' }}>
      <div style={{ flex: sum }}>
        <TileLayout tiles={tiles.slice(0, split)} onSelect={onSelect} selected={selected} depth={depth + 1} />
      </div>
      <div style={{ flex: total - sum }}>
        <TileLayout tiles={tiles.slice(split)} onSelect={onSelect} selected={selected} depth={depth + 1} />
      </div>
    </div>
  );
}

function ActivityTreemap({ data }: { readonly data: Statistics }) {
  const [directory, setDirectory] = useState('');
  const [selected, setSelected] = useState(data.files[0]?.path ?? '');
  const [tab, setTab] = useState<'commits' | 'authors'>('commits');
  const [filter, setFilter] = useState('');
  const [detailPage, setDetailPage] = useState(0);
  const [pathPage, setPathPage] = useState(0);
  const matching = useMemo(
    () =>
      data.files
        .filter(
          (file) =>
            file.path.startsWith(directory) &&
            file.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
        )
        .sort((a, b) => b.commits.length - a.commits.length || a.path.localeCompare(b.path)),
    [data.files, directory, filter],
  );
  const tiles = useMemo(() => {
    const group = (files: Statistics['files'], prefix: string, depth: number): Tile[] => {
      const entries = new Map<string, { tile: Tile; files: Statistics['files'] }>();
      for (const file of files) {
        const relative = file.path.slice(prefix.length);
        const slash = relative.indexOf('/');
        const folder = slash >= 0;
        const name = folder ? relative.slice(0, slash) : relative;
        const path = `${prefix}${name}${folder ? '/' : ''}`;
        const entry = entries.get(path) ?? { tile: { name, path, weight: 0, folder }, files: [] };
        entry.tile.weight += file.commits.length;
        entry.files.push(file);
        entries.set(path, entry);
      }
      return [...entries.values()]
        .map(({ tile, files }) => ({
          ...tile,
          ...(tile.folder && depth < 3 ? { children: group(files, tile.path, depth + 1) } : {}),
        }))
        .sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
    };
    return group(matching.slice(0, 300), directory, 0);
  }, [matching, directory]);
  const commits = (data.files.find((file) => file.path === selected)?.commits ?? []).map(
    (index) => data.commits[index]!,
  );
  const authors = new Map<string, number>();
  for (const commit of commits) authors.set(commit.author, (authors.get(commit.author) ?? 0) + 1);
  const select = (tile: Tile) => {
    if (tile.folder) {
      setDirectory(tile.path);
      setPathPage(0);
    } else {
      setSelected(tile.path);
      setDetailPage(0);
    }
  };
  return (
    <>
      <div className="statistics-range">
        <button
          type="button"
          onClick={() => {
            setDirectory('');
            setPathPage(0);
          }}
        >
          Repository root
        </button>
        <button
          type="button"
          disabled={!directory}
          onClick={() => {
            const parent = directory.slice(0, -1).split('/').slice(0, -1).join('/');
            setDirectory(parent ? `${parent}/` : '');
            setPathPage(0);
          }}
        >
          Up
        </button>
        <span>{directory || '/'}</span>
        <input
          aria-label="Filter activity paths"
          placeholder="Filter paths"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPathPage(0);
          }}
        />
      </div>
      <p className="statistics-policy">
        Tile area = commit touches per path (including deleted paths). Select a folder to expand.
        {matching.length > 300 &&
          ' Showing the 300 busiest matching paths. Filter or use the path list to find others.'}
      </p>
      <div className="statistics-treemap">
        <section aria-label="File activity treemap">
          <TileLayout tiles={tiles} onSelect={select} selected={selected} />
          {!tiles.length && <p>No matching paths.</p>}
        </section>
        <aside>
          <h3>
            <FileIcon />
            {selected.split('/').at(-1) || 'Select a file'}
          </h3>
          <p className="statistics-policy">
            {selected.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '/'}
          </p>
          <nav aria-label="File activity details">
            <button
              type="button"
              aria-pressed={tab === 'commits'}
              onClick={() => {
                setTab('commits');
                setDetailPage(0);
              }}
            >
              Commits
            </button>
            <button
              type="button"
              aria-pressed={tab === 'authors'}
              onClick={() => {
                setTab('authors');
                setDetailPage(0);
              }}
            >
              Authors
            </button>
          </nav>
          {tab === 'commits' ? (
            <ul>
              {commits.slice(detailPage * 100, (detailPage + 1) * 100).map((commit) => (
                <li key={commit.oid} title={`${commit.author}\n${commit.oid}`}>
                  <span>{commit.subject || '(no subject)'}</span>
                  <small>{commit.date}</small>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {[...authors]
                .sort((a, b) => b[1] - a[1])
                .slice(detailPage * 100, (detailPage + 1) * 100)
                .map(([author, count]) => (
                  <li key={author} className="statistics-author-activity">
                    <span>{author}</span>
                    <strong>{count}</strong>
                    <progress max={commits.length} value={count} aria-label={`${author}: ${count} commits`} />
                  </li>
                ))}
            </ul>
          )}
          <StatisticsPager
            page={detailPage}
            count={tab === 'commits' ? commits.length : authors.size}
            onChange={setDetailPage}
          />
        </aside>
      </div>
      <details>
        <summary>All activity paths (accessible list)</summary>
        <ul>
          {matching.slice(pathPage * 100, (pathPage + 1) * 100).map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => {
                  setSelected(file.path);
                  setDetailPage(0);
                }}
              >
                {file.path} · {file.commits.length}
              </button>
            </li>
          ))}
        </ul>
        <StatisticsPager page={pathPage} count={matching.length} onChange={setPathPage} />
      </details>
    </>
  );
}

function StatisticsPager({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange(page: number): void;
}) {
  if (count <= 100 && page === 0) return null;
  return (
    <div className="statistics-range">
      <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        {Math.min(count, page * 100 + 1)}–{Math.min(count, (page + 1) * 100)} of {count}
      </span>
      <button type="button" disabled={(page + 1) * 100 >= count} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
