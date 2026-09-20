import { describe, expect, it } from 'vitest';
import { diffHighlightRegions, parseUnifiedDiff } from '../../src/frontend/react/lib/diff';

describe('unified diff projection', () => {
  it('keeps hover regions around changes separate from range text and trims distant context', () => {
    const parsed = parseUnifiedDiff(
      '@@ -1,9 +1,9 @@ a very long function name\n one\n two\n three\n-old\n+new\n five\n six\n seven\n eight\n nine\n',
    );
    const lines = parsed.hunks[0]!.lines;
    expect(
      diffHighlightRegions(
        lines,
        lines.map((_line, index) => [index]),
        false,
      ),
    ).toEqual([{ firstRow: 1, endRow: 7, changedLineIndexes: [3, 4] }]);
    // Split presentation pairs removed/added lines while actions still name original patch indexes.
    expect(diffHighlightRegions(lines, [[0], [1], [2], [3, 4], [5], [6], [7], [8], [9]], false)).toEqual([
      { firstRow: 1, endRow: 6, changedLineIndexes: [3, 4] },
    ]);
  });

  it('gives full-file changed blocks their own non-overlapping hover regions and exact selections', () => {
    const parsed = parseUnifiedDiff(
      '@@ -1,8 +1,8 @@\n-a\n+A\n gap1\n gap2\n gap3\n-b\n+B\n end1\n end2\n end3\n',
    );
    const lines = parsed.hunks[0]!.lines;
    const regions = diffHighlightRegions(
      lines,
      lines.map((_line, index) => [index]),
      true,
    );
    expect(regions).toHaveLength(2);
    expect(regions[0]!.changedLineIndexes).toEqual([0, 1]);
    expect(regions[1]!.changedLineIndexes).toEqual([5, 6]);
    expect(regions[0]!.endRow).toBeLessThanOrEqual(regions[1]!.firstRow);
  });

  it('keeps hunk headers, line numbers, signs, and no-newline notes as inert text', () => {
    const parsed = parseUnifiedDiff(
      [
        'diff --git a/file.txt b/file.txt',
        '--- a/file.txt',
        '+++ b/file.txt',
        '@@ -2,3 +2,3 @@ function example',
        ' kept',
        '-old message',
        '+new message',
        ' tail',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    );

    expect(parsed.hasChanges).toBe(true);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]).toMatchObject({ header: '@@ -2,3 +2,3 @@ function example' });
    expect(parsed.hunks[0]?.lines).toEqual([
      expect.objectContaining({ kind: 'context', text: 'kept', oldLine: 2, newLine: 2 }),
      expect.objectContaining({ kind: 'remove', text: 'old message', oldLine: 3, newLine: null }),
      expect.objectContaining({ kind: 'add', text: 'new message', oldLine: null, newLine: 3 }),
      expect.objectContaining({ kind: 'context', text: 'tail', oldLine: 4, newLine: 4 }),
      expect.objectContaining({ kind: 'note', text: '\\ No newline at end of file' }),
    ]);
  });

  it('returns an empty projection for metadata-only or empty diffs', () => {
    expect(parseUnifiedDiff('diff --git a/file.txt b/file.txt\n').hasChanges).toBe(false);
    expect(parseUnifiedDiff('').hunks).toEqual([]);
  });
});
