/** Git's merge, diff3 and zdiff3 markers. Keep line endings and empty alternatives byte-for-byte. */
export interface ConflictTextRegion {
  readonly id: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly ours: string;
  readonly theirs: string;
  readonly base: string | null;
}

export function conflictTextRegions(content: string): ConflictTextRegion[] {
  const lines = content.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1]! + line.length);
  const regions: ConflictTextRegion[] = [];
  const value = (index: number) => (lines[index] ?? '').replace(/\r?\n$/u, '');
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const start = /^(<{7,})(?: .*)?$/u.exec(value(cursor));
    if (!start) continue;
    const width = start[1]!.length;
    const marker = (index: number, char: string) => {
      const line = value(index);
      return line === char.repeat(width) || line.startsWith(`${char.repeat(width)} `);
    };
    const first = cursor;
    const oursStart = ++cursor;
    while (cursor < lines.length && !marker(cursor, '|') && !marker(cursor, '=')) cursor += 1;
    const ours = lines.slice(oursStart, cursor).join('');
    let base: string | null = null;
    if (marker(cursor, '|')) {
      const baseStart = ++cursor;
      while (cursor < lines.length && !marker(cursor, '=')) cursor += 1;
      base = lines.slice(baseStart, cursor).join('');
    }
    if (!marker(cursor, '=')) break;
    const theirsStart = ++cursor;
    while (cursor < lines.length && !marker(cursor, '>')) cursor += 1;
    if (!marker(cursor, '>')) break;
    regions.push({
      id: regions.length,
      startLine: first,
      endLine: cursor + 1,
      startOffset: offsets[first]!,
      endOffset: offsets[cursor + 1]!,
      ours,
      theirs: lines.slice(theirsStart, cursor).join(''),
      base,
    });
  }
  return regions;
}

export function hasConflictMarkers(content: string): boolean {
  return /^(?:<{7,}|\|{7,}|={7,}|>{7,})/mu.test(content);
}

export function chooseConflictRegion(
  content: string,
  region: ConflictTextRegion,
  choice: 'ours' | 'theirs' | 'both',
): string {
  // "Both" follows the displayed incoming/current order. Empty sides contribute no blank line.
  const replacement = choice === 'both' ? region.theirs + region.ours : region[choice];
  return content.slice(0, region.startOffset) + replacement + content.slice(region.endOffset);
}
