import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../../src/frontend/react/lib/diff';

describe('unified diff projection', () => {
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
