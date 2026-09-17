import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RepositoryDiff, RepositoryDiffWhitespace } from '../../../common/ipc/contracts';
import { parseUnifiedDiff } from '../lib/diff';
import type { ParsedDiffLine, ParsedUnifiedDiff } from '../lib/diff';
import { ListOptionsIcon } from './Icons';
import { MenuButton } from './menu/MenuButton';
import { menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

export type DiffDisplayMode = 'unified' | 'split';

interface DiffViewerProps {
  readonly value: RepositoryDiff | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly onRetry: () => void;
  readonly mode: DiffDisplayMode;
  readonly onModeChange: (mode: DiffDisplayMode) => void;
  readonly whitespace: RepositoryDiffWhitespace;
  readonly onWhitespaceChange: (whitespace: RepositoryDiffWhitespace) => void;
  readonly showWhitespace: boolean;
  readonly onShowWhitespaceChange: (show: boolean) => void;
  readonly label?: string | undefined;
}

interface InlineRange {
  readonly start: number;
  readonly end: number;
}

interface MatchCursor {
  next: number;
}

interface DiffCellProps {
  readonly line: ParsedDiffLine | undefined;
  readonly side: 'old' | 'new' | 'unified';
  readonly inlineRange: InlineRange | undefined;
  readonly query: string;
  readonly showWhitespace: boolean;
  readonly cursor: MatchCursor;
  readonly activeMatch: number;
}

const whitespaceLabels: Record<RepositoryDiffWhitespace, string> = {
  normal: 'Show all whitespace',
  'ignore-all': 'Ignore all whitespace',
  'ignore-space-change': 'Ignore whitespace changes',
  'ignore-space-at-eol': 'Ignore whitespace at line endings',
};

function searchRanges(text: string, query: string): InlineRange[] {
  if (!query) return [];
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const ranges: InlineRange[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, cursor);
    if (start < 0) break;
    ranges.push({ start, end: start + needle.length });
    cursor = start + Math.max(1, needle.length);
  }
  return ranges;
}

function changedRange(left: string, right: string): InlineRange | undefined {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const end = left.length - suffix;
  return prefix < end ? { start: prefix, end } : undefined;
}

function inlineRanges(document: ParsedUnifiedDiff): ReadonlyMap<string, InlineRange> {
  const ranges = new Map<string, InlineRange>();
  for (const hunk of document.hunks) {
    let cursor = 0;
    while (cursor < hunk.lines.length) {
      const line = hunk.lines[cursor]!;
      if (line.kind !== 'remove') {
        cursor += 1;
        continue;
      }
      const removed: ParsedDiffLine[] = [];
      while (cursor < hunk.lines.length && hunk.lines[cursor]!.kind === 'remove') {
        removed.push(hunk.lines[cursor]!);
        cursor += 1;
      }
      const added: ParsedDiffLine[] = [];
      while (cursor < hunk.lines.length && hunk.lines[cursor]!.kind === 'add') {
        added.push(hunk.lines[cursor]!);
        cursor += 1;
      }
      const pairCount = Math.max(removed.length, added.length);
      for (let index = 0; index < pairCount; index += 1) {
        const oldLine = removed[index];
        const newLine = added[index];
        if (oldLine && newLine) {
          const oldRange = changedRange(oldLine.text, newLine.text);
          const newRange = changedRange(newLine.text, oldLine.text);
          if (oldRange) ranges.set(oldLine.key, oldRange);
          if (newRange) ranges.set(newLine.key, newRange);
        } else if (oldLine) {
          ranges.set(oldLine.key, { start: 0, end: oldLine.text.length });
        } else if (newLine) {
          ranges.set(newLine.key, { start: 0, end: newLine.text.length });
        }
      }
    }
  }
  return ranges;
}

function displayWhitespace(text: string, showWhitespace: boolean): string {
  if (!showWhitespace) return text;
  return [...text]
    .map((character) => {
      if (character === ' ') return '·';
      if (character === '\t') return '→\t';
      if (character === '\r') return '␍';
      return character;
    })
    .join('');
}

function highlightedText(
  text: string,
  query: string,
  inlineRange: InlineRange | undefined,
  showWhitespace: boolean,
  cursor: MatchCursor,
  activeMatch: number,
): ReactNode {
  const matches = searchRanges(text, query).map((range) => ({ ...range, index: cursor.next++ }));
  const boundaries = new Set<number>([0, text.length]);
  if (inlineRange) {
    boundaries.add(inlineRange.start);
    boundaries.add(inlineRange.end);
  }
  for (const match of matches) {
    boundaries.add(match.start);
    boundaries.add(match.end);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  if (ordered.length <= 1) return displayWhitespace(text, showWhitespace);

  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1]!;
    if (start === end) return null;
    const changed = inlineRange ? start < inlineRange.end && end > inlineRange.start : false;
    const match = matches.find((candidate) => start < candidate.end && end > candidate.start);
    const className = ['diff-text-segment'];
    if (changed) className.push('inline-change');
    if (match) className.push('search-match');
    return (
      <mark
        key={`${start}-${end}`}
        className={className.join(' ')}
        data-diff-match={match?.index}
        data-diff-match-active={match?.index === activeMatch ? 'true' : undefined}
      >
        {displayWhitespace(text.slice(start, end), showWhitespace)}
      </mark>
    );
  });
}

function DiffCell({ line, side, inlineRange, query, showWhitespace, cursor, activeMatch }: DiffCellProps) {
  if (!line) return <div className={`diff-cell ${side} empty`} aria-hidden="true" />;
  const sign = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
  return (
    <div className={`diff-cell ${side} ${line.kind}`} data-testid="diff-line">
      <span className="diff-line-number">{side === 'old' ? (line.oldLine ?? '') : (line.newLine ?? '')}</span>
      <span className="diff-line-sign" aria-hidden="true">
        {sign}
      </span>
      <code className="diff-line-text">
        {line.kind === 'note'
          ? displayWhitespace(line.text, showWhitespace)
          : highlightedText(line.text, query, inlineRange, showWhitespace, cursor, activeMatch)}
      </code>
    </div>
  );
}

function splitRows(
  lines: readonly ParsedDiffLine[],
): readonly [ParsedDiffLine | undefined, ParsedDiffLine | undefined][] {
  const rows: [ParsedDiffLine | undefined, ParsedDiffLine | undefined][] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.kind === 'context') {
      rows.push([line, line]);
      cursor += 1;
      continue;
    }
    if (line.kind === 'note') {
      rows.push([line, undefined]);
      cursor += 1;
      continue;
    }
    const removed: ParsedDiffLine[] = [];
    while (cursor < lines.length && lines[cursor]!.kind === 'remove') {
      removed.push(lines[cursor]!);
      cursor += 1;
    }
    const added: ParsedDiffLine[] = [];
    while (cursor < lines.length && lines[cursor]!.kind === 'add') {
      added.push(lines[cursor]!);
      cursor += 1;
    }
    for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
      rows.push([removed[index], added[index]]);
    }
  }
  return rows;
}

function DiffToolbar({
  mode,
  onModeChange,
  whitespace,
  onWhitespaceChange,
  showWhitespace,
  onShowWhitespaceChange,
  query,
  onQueryChange,
  matchCount,
  activeMatch,
  onMoveMatch,
}: Pick<
  DiffViewerProps,
  'mode' | 'onModeChange' | 'whitespace' | 'onWhitespaceChange' | 'showWhitespace' | 'onShowWhitespaceChange'
> & {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly matchCount: number;
  readonly activeMatch: number;
  readonly onMoveMatch: (direction: 1 | -1) => void;
}) {
  const options: MenuEntry[] = [
    ...(['normal', 'ignore-all', 'ignore-space-change', 'ignore-space-at-eol'] as const).map((value) => ({
      id: `whitespace-${value}`,
      label: whitespaceLabels[value],
      checkable: 'radio' as const,
      checked: whitespace === value,
      run: () => onWhitespaceChange(value),
    })),
    menuSeparator,
    {
      id: 'show-whitespace',
      label: 'Show hidden characters',
      checkable: 'checkbox',
      checked: showWhitespace,
      run: () => onShowWhitespaceChange(!showWhitespace),
    },
  ];
  return (
    <div className="diff-toolbar">
      <label className="diff-search">
        <span className="diff-search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          value={query}
          placeholder="Search diff"
          aria-label="Search diff"
          spellCheck={false}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matchCount > 0) {
              event.preventDefault();
              onMoveMatch(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape' && query) {
              event.preventDefault();
              onQueryChange('');
            }
          }}
        />
        {query && (
          <span className="diff-match-count">
            {matchCount === 0 ? 'No matches' : `${activeMatch + 1} / ${matchCount}`}
          </span>
        )}
        <button
          type="button"
          className="diff-nav-button"
          aria-label="Previous diff match"
          disabled={matchCount === 0}
          onClick={() => onMoveMatch(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="diff-nav-button"
          aria-label="Next diff match"
          disabled={matchCount === 0}
          onClick={() => onMoveMatch(1)}
        >
          ↓
        </button>
      </label>
      <div className="diff-mode-toggle" role="group" aria-label="Diff view">
        <button
          type="button"
          className={mode === 'unified' ? 'active' : undefined}
          aria-pressed={mode === 'unified'}
          onClick={() => onModeChange('unified')}
        >
          Unified
        </button>
        <button
          type="button"
          className={mode === 'split' ? 'active' : undefined}
          aria-pressed={mode === 'split'}
          onClick={() => onModeChange('split')}
        >
          Split
        </button>
      </div>
      <MenuButton
        className="pane-icon-button diff-options"
        aria-label="Diff options"
        title="Diff options"
        menuLabel="Diff options"
        items={options}
      >
        <ListOptionsIcon size={14} />
      </MenuButton>
    </div>
  );
}

function diffMessage(value: RepositoryDiff): string | undefined {
  if (value.state === 'binary') return value.message ?? 'Binary changes do not have an inline text diff.';
  if (value.state === 'too-large') return value.message ?? 'This diff is too large to display inline.';
  if (value.state === 'unavailable') return value.message ?? 'This diff is not available.';
  return undefined;
}

/** Renders bounded Git patch text in unified or split form with literal search and inline highlights. */
export function DiffViewer({
  value,
  loading,
  error,
  onRetry,
  mode,
  onModeChange,
  whitespace,
  onWhitespaceChange,
  showWhitespace,
  onShowWhitespaceChange,
  label,
}: DiffViewerProps) {
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const document = useMemo(
    () => (value?.state === 'text' ? parseUnifiedDiff(value.content) : undefined),
    [value],
  );
  const inline = useMemo(() => (document ? inlineRanges(document) : new Map()), [document]);
  const matchCount = useMemo(
    () =>
      document
        ? document.hunks.reduce(
            (count, hunk) =>
              count +
              hunk.lines.reduce((lineCount, line) => lineCount + searchRanges(line.text, query).length, 0),
            0,
          )
        : 0,
    [document, query],
  );

  useEffect(() => {
    setActiveMatch((current) => (matchCount === 0 ? 0 : Math.min(current, matchCount - 1)));
  }, [matchCount, query]);

  useEffect(() => {
    if (!query || matchCount === 0) return;
    const frame = window.requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector(`[data-diff-match="${activeMatch}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeMatch, matchCount, query, value]);

  const moveMatch = (direction: 1 | -1) => {
    if (matchCount === 0) return;
    setActiveMatch((current) => (current + direction + matchCount) % matchCount);
  };

  const toolbar = (
    <DiffToolbar
      mode={mode}
      onModeChange={onModeChange}
      whitespace={whitespace}
      onWhitespaceChange={onWhitespaceChange}
      showWhitespace={showWhitespace}
      onShowWhitespaceChange={onShowWhitespaceChange}
      query={query}
      onQueryChange={setQuery}
      matchCount={matchCount}
      activeMatch={activeMatch}
      onMoveMatch={moveMatch}
    />
  );

  if (loading) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        <p className="diff-status">Reading diff…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        <div className="diff-status diff-error" role="alert">
          <span>{error}</span>
          <button type="button" className="button button-small" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        <p className="diff-status">Select a file to see its diff.</p>
      </div>
    );
  }
  const message = diffMessage(value);
  if (message) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        <p className="diff-status">{message}</p>
      </div>
    );
  }
  if (!document || !document.hasChanges) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        <p className="diff-status">No textual changes for this file.</p>
      </div>
    );
  }

  const cursor: MatchCursor = { next: 0 };
  return (
    <div className="diff-viewer" data-testid="diff-viewer" aria-label={label}>
      {toolbar}
      <div className={`diff-body ${mode}`} ref={bodyRef} data-testid="diff-content">
        {document.hunks.map((hunk) => (
          <section key={hunk.key} className="diff-hunk" aria-label={hunk.header}>
            <div className="diff-hunk-header">{hunk.header}</div>
            {mode === 'unified'
              ? hunk.lines.map((line) => (
                  <DiffCell
                    key={line.key}
                    line={line}
                    side="unified"
                    inlineRange={inline.get(line.key)}
                    query={query}
                    showWhitespace={showWhitespace}
                    cursor={cursor}
                    activeMatch={activeMatch}
                  />
                ))
              : splitRows(hunk.lines).map(([oldLine, newLine], index) => {
                  const key = `${hunk.key}-split-${index}`;
                  return (
                    <div className="diff-split-row" key={key}>
                      <DiffCell
                        line={oldLine}
                        side="old"
                        inlineRange={oldLine ? inline.get(oldLine.key) : undefined}
                        query={query}
                        showWhitespace={showWhitespace}
                        cursor={cursor}
                        activeMatch={activeMatch}
                      />
                      <DiffCell
                        line={newLine}
                        side="new"
                        inlineRange={newLine ? inline.get(newLine.key) : undefined}
                        query={query}
                        showWhitespace={showWhitespace}
                        cursor={cursor}
                        activeMatch={activeMatch}
                      />
                    </div>
                  );
                })}
          </section>
        ))}
      </div>
    </div>
  );
}
