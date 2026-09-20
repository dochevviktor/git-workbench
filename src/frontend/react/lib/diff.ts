export interface ParsedDiffLine {
  readonly key: string;
  readonly kind: 'context' | 'add' | 'remove' | 'note';
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface ParsedDiffHunk {
  readonly key: string;
  readonly header: string;
  readonly lines: readonly ParsedDiffLine[];
}

export interface ParsedUnifiedDiff {
  readonly hunks: readonly ParsedDiffHunk[];
  readonly hasChanges: boolean;
}

/** Parses Git's unified patch text into safe, line-oriented renderer data. */
export function parseUnifiedDiff(content: string): ParsedUnifiedDiff {
  const sourceLines = content.split('\n');
  if (sourceLines[sourceLines.length - 1] === '') sourceLines.pop();
  const hunks: ParsedDiffHunk[] = [];
  let current: { header: string; oldLine: number; newLine: number; lines: ParsedDiffLine[] } | undefined;
  let hunkNumber = 0;
  let lineNumber = 0;

  for (const sourceLine of sourceLines) {
    const header = parseHunkHeader(sourceLine);
    if (header) {
      if (current) {
        hunks.push({ key: `hunk-${hunkNumber}`, header: current.header, lines: current.lines });
      }
      hunkNumber += 1;
      current = { header: sourceLine, oldLine: header.oldStart, newLine: header.newStart, lines: [] };
      continue;
    }
    if (!current) continue;

    const key = `line-${hunkNumber}-${lineNumber++}`;
    if (sourceLine === '\\ No newline at end of file') {
      current.lines.push({ key, kind: 'note', text: sourceLine, oldLine: null, newLine: null });
    } else if (sourceLine.startsWith('+')) {
      current.lines.push({
        key,
        kind: 'add',
        text: sourceLine.slice(1),
        oldLine: null,
        newLine: current.newLine,
      });
      current.newLine += 1;
    } else if (sourceLine.startsWith('-')) {
      current.lines.push({
        key,
        kind: 'remove',
        text: sourceLine.slice(1),
        oldLine: current.oldLine,
        newLine: null,
      });
      current.oldLine += 1;
    } else if (sourceLine.startsWith(' ')) {
      current.lines.push({
        key,
        kind: 'context',
        text: sourceLine.slice(1),
        oldLine: current.oldLine,
        newLine: current.newLine,
      });
      current.oldLine += 1;
      current.newLine += 1;
    } else {
      current.lines.push({ key, kind: 'note', text: sourceLine, oldLine: null, newLine: null });
    }
  }
  if (current) {
    hunks.push({ key: `hunk-${hunkNumber}`, header: current.header, lines: current.lines });
  }
  return {
    hunks,
    hasChanges: hunks.some((hunk) =>
      hunk.lines.some((line) => line.kind === 'add' || line.kind === 'remove'),
    ),
  };
}

function parseHunkHeader(line: string): { readonly oldStart: number; readonly newStart: number } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  return { oldStart: Number(match[1]), newStart: Number(match[2]) };
}
/** A hover region is presentation around changed rows, independent of the @@ range line. */
export interface DiffHighlightRegion {
  readonly firstRow: number;
  readonly endRow: number;
  readonly changedLineIndexes: readonly number[];
}

export function diffHighlightRegions(
  lines: readonly ParsedDiffLine[],
  rowLineIndexes: readonly (readonly number[])[],
  entireFile: boolean,
): DiffHighlightRegion[] {
  const lineRows = new Map<number, number>();
  rowLineIndexes.forEach((indexes, row) => indexes.forEach((index) => lineRows.set(index, row)));
  const groups: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const kind = lines[index]!.kind;
    if (kind === 'add' || kind === 'remove') current.push(index);
    else if (kind === 'context' && current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  const regions = (entireFile ? groups : groups.length ? [groups.flat()] : []).map((indexes) => ({
    firstRow: Math.max(0, (lineRows.get(indexes[0]!) ?? 0) - 2),
    endRow: Math.min(rowLineIndexes.length, (lineRows.get(indexes.at(-1)!) ?? 0) + 3),
    changedLineIndexes: indexes,
  }));
  // Neighbouring regions share the available context without nesting or highlighting rows twice.
  for (let index = 1; index < regions.length; index += 1) {
    const previous = regions[index - 1]!;
    const next = regions[index]!;
    if (previous.endRow > next.firstRow) {
      const boundary = Math.floor((previous.endRow + next.firstRow) / 2);
      previous.endRow = boundary;
      next.firstRow = boundary;
    }
  }
  return regions;
}
