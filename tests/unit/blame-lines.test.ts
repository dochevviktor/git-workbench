import { expect, it } from 'vitest';
import { blameDisplayLines } from '../../src/frontend/react/lib/blame-lines';

it('keeps complete attribution and aligns replacements and zero-context trailing deletions', () => {
  const source = ['one', 'new', 'three'].map((content, index) => ({
    line: index + 1,
    content,
    commitId: 'a'.repeat(40),
    originalPath: 'old.txt',
    originalLine: index + 1,
  }));
  const result = blameDisplayLines(
    source,
    '@@ -2 +2 @@\n-old\n+new\n@@ -4 +3,0 @@\n-trailing\n',
    'b'.repeat(40),
    'new.txt',
  );
  expect(result.map((line) => [line.content, line.change])).toEqual([
    ['one', 'context'],
    ['old', 'remove'],
    ['new', 'add'],
    ['three', 'context'],
    ['trailing', 'remove'],
  ]);
  expect(result[2]?.originalPath).toBe('old.txt');
  expect(result[1]?.commitId).toBe('b'.repeat(40));
});
