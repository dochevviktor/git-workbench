import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { repositorySessionMap } from '../lib/repository-session';
import type { CSSProperties, ReactNode } from 'react';
import type {
  RepositoryDiff,
  RepositoryDiffWhitespace,
  RepositoryWorkingChangeAction,
  RepositoryWorkingChangeSelection,
} from '../../../common/ipc/contracts';
import { diffHighlightRegions, parseUnifiedDiff } from '../lib/diff';
import type { ParsedDiffLine, ParsedUnifiedDiff } from '../lib/diff';
import { highlightDiff } from '../lib/diff-syntax';
import type { SyntaxRange } from '../lib/diff-syntax';
import { ListOptionsIcon } from './Icons';
import { ImageDiffViewer } from './ImageDiffViewer';
import { MenuButton } from './menu/MenuButton';
import { useContextMenu } from './menu/context-menu';
import { menuSeparator } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';
import type { DiffControls } from '../hooks/use-repository-diff';
import './diff-workflow.css';

export type DiffDisplayMode = 'unified' | 'split';

export interface DiffWorkingAction {
  readonly action: RepositoryWorkingChangeAction | 'stash';
  readonly onApply: (selection: RepositoryWorkingChangeSelection) => Promise<boolean>;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
}

interface DiffViewerProps {
  readonly onHistoryForSelection?: ((start: number, end: number, side: 'old' | 'new') => void) | undefined;
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
  /** Working-tree actions are omitted for committed diffs. */
  readonly workingActions?: readonly DiffWorkingAction[] | undefined;
  readonly label?: string | undefined;
  readonly controls?: DiffControls | undefined;
  readonly positionKey?: string | undefined;
}

const positions = repositorySessionMap<{
  top: number;
  left: number;
  line: string | undefined;
  offset: number;
}>();

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
  readonly lineIndex?: number | undefined;
  readonly lineSelected?: boolean | undefined;
  readonly onToggleLine?: (() => void) | undefined;
  readonly syntax: readonly SyntaxRange[] | undefined;
  readonly hunkIndex: number;
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
  syntax: readonly SyntaxRange[] = [],
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
  for (const token of syntax) {
    boundaries.add(token.start);
    boundaries.add(token.end);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  if (ordered.length <= 1) return displayWhitespace(text, showWhitespace);
  let tokenIndex = 0;
  let matchIndex = 0;
  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1]!;
    if (start === end) return null;
    const changed = inlineRange ? start < inlineRange.end && end > inlineRange.start : false;
    while (matches[matchIndex] && matches[matchIndex]!.end <= start) matchIndex += 1;
    while (syntax[tokenIndex] && syntax[tokenIndex]!.end <= start) tokenIndex += 1;
    const match = matches[matchIndex] && matches[matchIndex]!.start < end ? matches[matchIndex] : undefined;
    const token = syntax[tokenIndex] && syntax[tokenIndex]!.start < end ? syntax[tokenIndex] : undefined;
    const className = ['diff-text-segment'];
    if (token) className.push(`syntax-${token.kind}`);
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

function DiffCell({
  line,
  side,
  inlineRange,
  query,
  showWhitespace,
  cursor,
  activeMatch,
  lineIndex,
  lineSelected,
  onToggleLine,
  syntax,
  hunkIndex,
}: DiffCellProps) {
  if (!line) return <div className={`diff-cell ${side} empty`} aria-hidden="true" />;
  const sign = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
  const selectable =
    lineIndex !== undefined && onToggleLine !== undefined && (line.kind === 'add' || line.kind === 'remove');
  return (
    <div
      className={`diff-cell ${side} ${line.kind}`}
      data-testid="diff-line"
      data-line-anchor={line.newLine ?? line.oldLine ?? undefined}
      data-old-line={line.oldLine ?? undefined}
      data-new-line={line.newLine ?? undefined}
      data-hunk-index={hunkIndex}
      data-change-index={selectable ? lineIndex : undefined}
    >
      <span className="diff-line-select">
        {selectable ? (
          <input
            type="checkbox"
            checked={lineSelected ?? false}
            aria-label={`Select ${line.kind === 'add' ? 'added' : 'removed'} line ${line.newLine ?? line.oldLine ?? ''}`}
            data-testid="diff-line-select"
            onChange={onToggleLine}
          />
        ) : null}
      </span>
      <span className={`diff-line-number${side === 'unified' ? ' paired' : ''}`}>
        {side === 'unified' ? (
          <>
            <span>{line.oldLine ?? ''}</span>
            <span>{line.newLine ?? ''}</span>
          </>
        ) : side === 'old' ? (
          (line.oldLine ?? '')
        ) : (
          (line.newLine ?? '')
        )}
      </span>
      <span className="diff-line-sign" aria-hidden="true">
        {sign}
      </span>
      <code className="diff-line-text">
        {line.kind === 'note'
          ? displayWhitespace(line.text, showWhitespace)
          : highlightedText(line.text, query, inlineRange, showWhitespace, cursor, activeMatch, syntax)}
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
  selectedLineCount,
  workingActions,
  actionsDisabledReason,
  applyingAction,
  onApplySelection,
  onClearSelection,
  controls,
  wrap,
  onWrapChange,
  large,
}: Pick<
  DiffViewerProps,
  'mode' | 'onModeChange' | 'whitespace' | 'onWhitespaceChange' | 'showWhitespace' | 'onShowWhitespaceChange'
> & {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly matchCount: number;
  readonly activeMatch: number;
  readonly onMoveMatch: (direction: 1 | -1) => void;
  readonly selectedLineCount: number;
  readonly workingActions: readonly DiffWorkingAction[];
  readonly actionsDisabledReason: string | undefined;
  readonly applyingAction: DiffWorkingAction['action'] | undefined;
  readonly onApplySelection: (action: DiffWorkingAction) => void;
  readonly onClearSelection: () => void;
  readonly controls: DiffControls | undefined;
  readonly wrap: boolean;
  readonly onWrapChange: (value: boolean) => void;
  readonly large: boolean;
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
    {
      id: 'word-wrap',
      label: 'Word Wrap',
      checkable: 'checkbox',
      checked: wrap,
      disabled: mode === 'split' || large,
      disabledReason:
        mode === 'split'
          ? 'Word wrap is available in unified view.'
          : large
            ? 'Large diffs use fixed-height rows to keep scrolling responsive.'
            : undefined,
      run: () => onWrapChange(!wrap),
    },
    ...(controls
      ? [
          {
            id: 'entire-file',
            label: 'Show Entire File',
            checkable: 'checkbox' as const,
            checked: controls.entireFile,
            run: () => controls.setEntireFile(!controls.entireFile),
          },
        ]
      : []),
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
      {controls && (
        <div className="diff-context-controls" role="group" aria-label="Diff context">
          <button
            type="button"
            aria-label="Decrease diff context"
            title="Decrease context"
            disabled={controls.entireFile || controls.contextLines === 0}
            onClick={() => controls.setContextLines(controls.contextLines - 1)}
          >
            −
          </button>
          <span title="Context lines">{controls.entireFile ? 'All' : controls.contextLines}</span>
          <button
            type="button"
            aria-label="Increase diff context"
            title="Increase context"
            disabled={controls.entireFile || controls.contextLines >= 100}
            onClick={() => controls.setContextLines(controls.contextLines + 1)}
          >
            +
          </button>
        </div>
      )}
      <MenuButton
        className="pane-icon-button diff-options"
        aria-label="Diff options"
        title="Diff options"
        menuLabel="Diff options"
        items={options}
      >
        <ListOptionsIcon size={14} />
      </MenuButton>
      {selectedLineCount > 0 && (
        <div className="diff-selection-actions" role="group" aria-label="Selected diff lines">
          <span>{selectedLineCount} lines</span>
          {workingActions.map((workingAction) => (
            <button
              key={workingAction.action}
              type="button"
              className="button button-small"
              disabled={
                actionsDisabledReason !== undefined ||
                workingAction.disabled === true ||
                applyingAction !== undefined
              }
              title={workingAction.disabledReason ?? actionsDisabledReason}
              data-testid={`diff-selection-${workingAction.action}`}
              onClick={() => onApplySelection(workingAction)}
            >
              {actionLabel(workingAction.action, 'lines')}
            </button>
          ))}
          <button type="button" className="button button-small" onClick={onClearSelection}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function actionLabel(action: DiffWorkingAction['action'], selection: 'hunk' | 'lines'): string {
  const verb = action[0]!.toLocaleUpperCase() + action.slice(1);
  return `${verb} ${selection === 'hunk' ? 'hunk' : 'selected lines'}`;
}

function diffMessage(value: RepositoryDiff): string | undefined {
  if (value.state === 'binary') return value.message ?? 'Binary changes do not have an inline text diff.';
  if (value.state === 'too-large') return value.message ?? 'This diff is too large to display inline.';
  if (value.state === 'unavailable') return value.message ?? 'This diff is not available.';
  return undefined;
}

/** Renders bounded Git patch text in unified or split form with literal search and inline highlights. */
import { isNumberBetween, usePersistentState } from '../hooks/use-persistent-state';

export function DiffViewer({
  onHistoryForSelection,
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
  workingActions = [],
  label,
  controls,
  positionKey,
}: DiffViewerProps) {
  const showContextMenu = useContextMenu();
  const [copyStatus, setCopyStatus] = useState<string>();
  const [fontSize] = usePersistentState('diff.fontSize', 12, isNumberBetween(10, 20));
  const [showMarks] = usePersistentState(
    'diff.showMarks',
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [selectedLines, setSelectedLines] = useState<{ hunk: number; indexes: ReadonlySet<number> }>();
  const [applyingAction, setApplyingAction] = useState<DiffWorkingAction['action']>();
  const [wrap, setWrap] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const storageKey =
    positionKey ?? (value ? `${value.repositoryId}:${JSON.stringify(value.target)}` : undefined);
  const document = useMemo(
    () => (value?.state === 'text' ? parseUnifiedDiff(value.content) : undefined),
    [value],
  );
  const inline = useMemo(() => (document ? inlineRanges(document) : new Map()), [document]);
  const syntax = useMemo(
    () => (document ? highlightDiff(document, value?.target.path ?? '') : new Map()),
    [document, value?.target.path],
  );
  const longestLine = useMemo(
    () =>
      document?.hunks.reduce(
        (max, hunk) => hunk.lines.reduce((length, line) => Math.max(length, line.text.length), max),
        0,
      ) ?? 0,
    [document],
  );
  const indexes = useMemo(
    () =>
      new Map(
        document?.hunks.flatMap((hunk) => hunk.lines.map((line, index) => [line.key, index] as const)) ?? [],
      ),
    [document],
  );
  const split = useMemo(() => document?.hunks.map((hunk) => splitRows(hunk.lines)) ?? [], [document]);
  const highlightRegions = useMemo(
    () =>
      document?.hunks.map((hunk, hunkIndex) =>
        diffHighlightRegions(
          hunk.lines,
          mode === 'unified'
            ? hunk.lines.map((_line, index) => [index])
            : split[hunkIndex]!.map(([left, right]) =>
                [left, right].filter((line) => line !== undefined).map((line) => indexes.get(line.key)!),
              ),
          controls?.entireFile ?? false,
        ),
      ) ?? [],
    [document, mode, split, indexes, controls?.entireFile],
  );
  const rowHeight = fontSize + (mode === 'split' ? 7 : 6);
  const large = Boolean(
    document?.hunks.some(
      (hunk, index) => (mode === 'split' ? split[index]!.length : hunk.lines.length) > 2000,
    ),
  );
  const hunkOffsets = useMemo(() => {
    let offset = 0;
    return (
      document?.hunks.map((hunk, index) => {
        const top = offset + (index > 0 ? 6 : 0) + fontSize + 6;
        offset = top + (mode === 'split' ? split[index]!.length : hunk.lines.length) * rowHeight;
        return top;
      }) ?? []
    );
  }, [document, mode, split, rowHeight, fontSize]);
  const searchRows = useMemo(() => {
    let total = 0;
    const hunks =
      document?.hunks.map((hunk, index) => {
        const rows =
          mode === 'split'
            ? split[index]!.map(([left, right]) => [left, right])
            : hunk.lines.map((line) => [line]);
        return rows.map((lines) => {
          const start = total;
          total += lines.reduce(
            (count, line) => count + (line ? searchRanges(line.text, query).length : 0),
            0,
          );
          return { start, end: total };
        });
      }) ?? [];
    return { hunks, total };
  }, [document, mode, query, split]);
  const matchCount = searchRows.total;

  const actionsDisabledReason = loading
    ? 'Wait for this diff to finish loading.'
    : whitespace !== 'normal'
      ? 'Set whitespace comparison to Show all whitespace before selecting a hunk or line.'
      : value?.snapshot === null || value?.snapshot === undefined
        ? 'This diff cannot be changed.'
        : undefined;

  useEffect(() => {
    setSelectedLines(undefined);
  }, [value]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !storageKey) return;
    const saved = positions.get(storageKey);
    if (saved) {
      const line = saved.line ? body.querySelector<HTMLElement>(`[data-line-anchor="${saved.line}"]`) : null;
      body.scrollTop = line
        ? body.scrollTop + line.getBoundingClientRect().top - body.getBoundingClientRect().top - saved.offset
        : saved.top;
      body.scrollLeft = saved.left;
      setScrollTop(body.scrollTop);
      setScrollLeft(body.scrollLeft);
    }
    const remember = () => {
      const top = body.getBoundingClientRect().top;
      const first = Array.from(body.querySelectorAll<HTMLElement>('[data-line-anchor]')).find(
        (line) => line.getBoundingClientRect().bottom > top,
      );
      positions.set(storageKey, {
        top: body.scrollTop,
        left: body.scrollLeft,
        line: first?.dataset.lineAnchor,
        offset: first ? first.getBoundingClientRect().top - top : 0,
      });
      if (positions.size > 500) positions.delete(positions.keys().next().value!);
    };
    body.addEventListener('scroll', remember, { passive: true });
    remember();
    return () => {
      body.removeEventListener('scroll', remember);
    };
  }, [storageKey, document, mode, wrap]);

  useEffect(() => {
    setActiveMatch((current) => (matchCount === 0 ? 0 : Math.min(current, matchCount - 1)));
  }, [matchCount, query]);

  useEffect(() => {
    if (!query || matchCount === 0) return;
    const hunkIndex = searchRows.hunks.findIndex((rows) =>
      rows.some((row) => activeMatch >= row.start && activeMatch < row.end),
    );
    const rowIndex =
      searchRows.hunks[hunkIndex]?.findIndex((row) => activeMatch >= row.start && activeMatch < row.end) ??
      -1;
    if (bodyRef.current && rowIndex >= 0 && searchRows.hunks[hunkIndex]!.length > 2000) {
      bodyRef.current.scrollTop = hunkOffsets[hunkIndex]! + rowIndex * rowHeight;
      setScrollTop(bodyRef.current.scrollTop);
    }
    const frame = window.requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector(`[data-diff-match="${activeMatch}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeMatch, matchCount, query, value, searchRows, hunkOffsets, rowHeight]);

  const moveMatch = (direction: 1 | -1) => {
    if (matchCount === 0) return;
    setActiveMatch((current) => (current + direction + matchCount) % matchCount);
  };

  const toggleLine = (hunk: number, index: number) => {
    setSelectedLines((current) => {
      const indexes = current?.hunk === hunk ? new Set(current.indexes) : new Set<number>();
      if (indexes.has(index)) indexes.delete(index);
      else indexes.add(index);
      return indexes.size === 0 ? undefined : { hunk, indexes };
    });
  };

  const selectTextLines = () => {
    const selection = window.getSelection();
    const body = bodyRef.current;
    if (!body || !selection || selection.isCollapsed || !selection.rangeCount || workingActions.length === 0)
      return;
    const range = selection.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return;
    const selected = [...body.querySelectorAll<HTMLElement>('[data-change-index]')].filter((line) => {
      const text = line.querySelector('code');
      if (!text || !range.intersectsNode(text)) return false;
      const content = window.document.createRange();
      content.selectNodeContents(text);
      const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, content) < 0;
      const endsAfter = range.compareBoundaryPoints(Range.END_TO_END, content) > 0;
      // A DOM range can intersect an element while ending at its first text character.
      // Only actual selected text (or a fully crossed empty line) selects a changed line.
      const overlap = range.cloneRange();
      if (startsBefore) overlap.setStart(content.startContainer, content.startOffset);
      if (endsAfter) overlap.setEnd(content.endContainer, content.endOffset);
      return overlap.toString().length > 0 || (!text.textContent && startsBefore && endsAfter);
    });
    const hunk = selected[0]?.dataset.hunkIndex;
    if (!hunk || selected.some((line) => line.dataset.hunkIndex !== hunk)) {
      setSelectedLines(undefined);
      return;
    }
    setSelectedLines({
      hunk: Number(hunk),
      indexes: new Set(selected.map((line) => Number(line.dataset.changeIndex))),
    });
  };

  const applySelection = async (
    workingAction: DiffWorkingAction,
    selection: RepositoryWorkingChangeSelection,
  ) => {
    if (
      actionsDisabledReason !== undefined ||
      workingAction.disabled === true ||
      applyingAction !== undefined
    )
      return;
    setApplyingAction(workingAction.action);
    try {
      if (
        await workingAction.onApply(
          selection.kind === 'file'
            ? selection
            : {
                ...selection,
                contextLines: controls?.contextLines ?? 3,
                entireFile: controls?.entireFile ?? false,
              },
        )
      ) {
        setSelectedLines(undefined);
        window.getSelection()?.removeAllRanges();
      }
    } finally {
      setApplyingAction(undefined);
    }
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
      selectedLineCount={selectedLines?.indexes.size ?? 0}
      workingActions={workingActions}
      actionsDisabledReason={actionsDisabledReason}
      applyingAction={applyingAction}
      onApplySelection={(workingAction) => {
        if (!selectedLines) return;
        void applySelection(workingAction, {
          kind: 'lines',
          hunk: selectedLines.hunk,
          lineIndexes: [...selectedLines.indexes],
        });
      }}
      onClearSelection={() => setSelectedLines(undefined)}
      controls={controls}
      wrap={wrap}
      onWrapChange={setWrap}
      large={large}
    />
  );

  if (loading && !value) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        <p className="diff-status">
          Reading diff…{' '}
          {controls && (
            <button type="button" className="button button-small" onClick={controls.cancel}>
              Cancel
            </button>
          )}
        </p>
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
  if (value.state === 'binary' && value.images) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        <ImageDiffViewer key={`${value.repositoryId}:${JSON.stringify(value.target)}`} value={value} />
      </div>
    );
  }
  if (message) {
    return (
      <div className="diff-viewer" data-testid="diff-viewer">
        {toolbar}
        {value.state === 'binary' && (
          <div className="binary-diff-cards">
            <section>
              <strong>Before</strong>
              <span>{value.target.previousPath ?? value.target.path}</span>
              <span>
                {value.binaryMetadata?.beforeBytes == null
                  ? 'Binary content'
                  : `${value.binaryMetadata.beforeBytes.toLocaleString()} bytes`}
              </span>
            </section>
            <section>
              <strong>After</strong>
              <span>{value.target.path}</span>
              <span>
                {value.binaryMetadata?.afterBytes == null
                  ? 'Binary content'
                  : `${value.binaryMetadata.afterBytes.toLocaleString()} bytes`}
              </span>
            </section>
          </div>
        )}
        <div className="diff-status">
          <p>{message}</p>
          {value.state === 'too-large' && controls && (
            <>
              <button type="button" className="button" disabled={loading} onClick={controls.loadLarge}>
                {loading ? 'Loading…' : 'Load Diff'}
              </button>
              <span className="muted">Up to 8 MiB; larger diffs remain unavailable.</span>
              {loading && (
                <button type="button" className="button" onClick={controls.cancel}>
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
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

  return (
    <div
      className="diff-viewer"
      data-testid="diff-viewer"
      data-show-marks={showMarks}
      aria-label={label}
      onContextMenu={(event) => {
        if ((event.target as Element).closest('input, textarea, button')) return;
        event.preventDefault();
        event.stopPropagation();
        const text = value?.state === 'text' ? value.content : '';
        const available =
          !loading && !error && !!text && text.length <= 1_048_576 && !text.includes('\uFFFD');
        // Copy the immutable patch displayed when the menu opens. A same-target refresh does not
        // invalidate those bytes; unloaded/different targets are already excluded by the diff hook.
        const canCopyPatch = !error && !!text && text.length <= 1_048_576 && !text.includes('\uFFFD');
        const selection = window.getSelection();
        const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : undefined;
        const selected =
          range && bodyRef.current?.contains(range.commonAncestorContainer)
            ? [...bodyRef.current.querySelectorAll<HTMLElement>('.diff-cell')].filter((cell) => {
                const code = cell.querySelector('code');
                return code && range.intersectsNode(code);
              })
            : [];
        const side = selected.some(
          (line) => line.classList.contains('remove') || line.classList.contains('old'),
        )
          ? 'old'
          : 'new';
        const numbers = selected.map((line) =>
          Number(side === 'old' ? line.dataset.oldLine : line.dataset.newLine),
        );
        const canHistory =
          available && numbers.length > 0 && numbers.every((line) => Number.isInteger(line) && line > 0);
        showContextMenu({
          label: 'Diff',
          anchor: { type: 'point', x: event.clientX, y: event.clientY },
          items: [
            ...(onHistoryForSelection
              ? [
                  {
                    id: 'selected-code-history',
                    label: 'History for Selected Lines…',
                    disabled: !canHistory,
                    disabledReason: canHistory
                      ? undefined
                      : 'Select source lines on one side of the committed diff.',
                    run: () => onHistoryForSelection(Math.min(...numbers), Math.max(...numbers), side),
                  },
                ]
              : []),
            {
              id: 'copy-diff-selection',
              label: 'Copy',
              run: () => {
                void window.desktop?.edit.command({ action: 'copy' });
              },
            },
            {
              id: 'copy-as-patch',
              label: 'Copy as Patch',
              disabled: !canCopyPatch,
              disabledReason: canCopyPatch
                ? undefined
                : 'Load a text diff up to 1 MiB without decoding errors to copy it.',
              run: () => {
                void window.desktop?.clipboard
                  .writeText({ text })
                  .then((result) =>
                    setCopyStatus(result.ok ? 'Patch copied to clipboard.' : result.error.message),
                  );
              },
            },
          ],
        });
      }}
    >
      {toolbar}
      {copyStatus && (
        <p className="diff-status" role="status">
          {copyStatus}
        </p>
      )}
      <div
        className={`diff-body ${mode}${wrap && mode === 'unified' && !large ? ' wrap' : ''}`}
        tabIndex={0}
        ref={bodyRef}
        data-testid="diff-content"
        aria-busy={loading}
        onMouseUp={selectTextLines}
        onKeyUp={(event) => {
          if (event.key === 'Shift' || event.shiftKey) selectTextLines();
        }}
        style={
          {
            fontSize: `${fontSize}px`,
            lineHeight: `${fontSize + 6}px`,
            '--diff-row-height': `${fontSize + 6}px`,
            '--diff-horizontal-offset': `${-scrollLeft}px`,
            '--diff-wide-line': `${Math.min(longestLine, 100000) * (fontSize / 12) * 7.25}px`,
          } as CSSProperties
        }
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setScrollLeft(event.currentTarget.scrollLeft);
        }}
      >
        <div className="diff-document">
          {document.hunks.map((hunk, hunkIndex) => {
            const rows = mode === 'split' ? split[hunkIndex]! : hunk.lines;
            const virtual = rows.length > 2000;
            const start = virtual
              ? Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    Math.floor((scrollTop - hunkOffsets[hunkIndex]!) / rowHeight) - 80,
                  ),
                )
              : 0;
            const end = virtual ? Math.min(rows.length, start + 600) : rows.length;
            const cursor: MatchCursor = { next: searchRows.hunks[hunkIndex]?.[start]?.start ?? 0 };
            const renderCell = (line: ParsedDiffLine | undefined, side: DiffCellProps['side']) => (
              <DiffCell
                key={`${side}:${line?.key ?? 'empty'}`}
                line={line}
                side={side}
                inlineRange={line ? inline.get(line.key) : undefined}
                query={query}
                showWhitespace={showWhitespace}
                cursor={cursor}
                activeMatch={activeMatch}
                hunkIndex={hunkIndex}
                syntax={
                  line
                    ? syntax.get(`${side === 'old' || line.kind === 'remove' ? 'old' : 'new'}:${line.key}`)
                    : undefined
                }
                lineIndex={workingActions.length > 0 && line ? indexes.get(line.key) : undefined}
                lineSelected={Boolean(
                  line &&
                  selectedLines?.hunk === hunkIndex &&
                  selectedLines.indexes.has(indexes.get(line.key)!),
                )}
                onToggleLine={
                  workingActions.length > 0 && line
                    ? () => toggleLine(hunkIndex, indexes.get(line.key)!)
                    : undefined
                }
              />
            );
            const renderRows = (first: number, last: number) => {
              const result: ReactNode[] = [];
              for (let index = first; index < last; index += 1) {
                if (mode === 'unified') result.push(renderCell(hunk.lines[index], 'unified'));
                else {
                  const [oldLine, newLine] = split[hunkIndex]![index]!;
                  result.push(
                    <div key={`${hunk.key}-split-${index}`} className="diff-split-row">
                      {renderCell(oldLine, 'old')}
                      {renderCell(newLine, 'new')}
                    </div>,
                  );
                }
              }
              return result;
            };
            const content: ReactNode[] = [];
            let nextRow = start;
            const regions = highlightRegions[hunkIndex] ?? [];
            for (const [regionIndex, region] of regions.entries()) {
              if (region.endRow <= start) continue;
              if (region.firstRow >= end) break;
              const first = Math.max(start, region.firstRow);
              const last = Math.min(end, region.endRow);
              content.push(...renderRows(nextRow, first));
              const hasLineSelection =
                selectedLines?.hunk === hunkIndex &&
                region.changedLineIndexes.some((index) => selectedLines.indexes.has(index));
              const selection: RepositoryWorkingChangeSelection = hasLineSelection
                ? { kind: 'lines', hunk: hunkIndex, lineIndexes: [...selectedLines.indexes] }
                : !controls?.entireFile || regions.length === 1
                  ? { kind: 'hunk', hunk: hunkIndex }
                  : { kind: 'lines', hunk: hunkIndex, lineIndexes: [...region.changedLineIndexes] };
              content.push(
                <div
                  key={`${hunk.key}-region-${regionIndex}`}
                  className={`diff-change-region${hasLineSelection ? ' has-selection' : ''}`}
                  tabIndex={workingActions.length > 0 ? 0 : undefined}
                  role={workingActions.length > 0 ? 'group' : undefined}
                  aria-label={
                    workingActions.length > 0
                      ? `Changed block ${hunkIndex + 1}.${regionIndex + 1}`
                      : undefined
                  }
                  data-testid="diff-change-region"
                >
                  {renderRows(first, last)}
                  {workingActions.length > 0 && (
                    <div className="diff-highlight-track">
                      <div className="diff-hunk-highlight" data-testid="diff-hunk-highlight">
                        <span className="diff-hunk-actions">
                          {workingActions.map((action) => (
                            <button
                              key={action.action}
                              type="button"
                              className="button button-small"
                              data-testid={`diff-hunk-${action.action}`}
                              disabled={
                                Boolean(actionsDisabledReason) ||
                                action.disabled ||
                                applyingAction !== undefined
                              }
                              title={action.disabledReason ?? actionsDisabledReason}
                              onClick={() => void applySelection(action, selection)}
                            >
                              {actionLabel(action.action, hasLineSelection ? 'lines' : 'hunk')}
                            </button>
                          ))}
                        </span>
                      </div>
                    </div>
                  )}
                </div>,
              );
              nextRow = last;
            }
            content.push(...renderRows(nextRow, end));
            return (
              <section key={hunk.key} className="diff-hunk" aria-label={hunk.header}>
                <div className="diff-range-line" data-testid="diff-range-line">
                  <span className="diff-range-gutter" aria-hidden="true" />
                  <span className="diff-range-text">{hunk.header}</span>
                </div>
                {start > 0 && <div style={{ height: start * rowHeight }} aria-hidden="true" />}
                {content}
                {end < rows.length && (
                  <div style={{ height: (rows.length - end) * rowHeight }} aria-hidden="true" />
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
