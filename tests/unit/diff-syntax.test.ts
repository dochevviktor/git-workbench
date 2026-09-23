import { describe, expect, it } from 'vitest';
import { highlightDiff } from '../../src/frontend/react/lib/diff-syntax';
import { parseUnifiedDiff } from '../../src/frontend/react/lib/diff';

describe('inert diff syntax', () => {
  it('colors Python tokens while preserving Unicode, tabs and CRLF offsets', () => {
    const document = parseUnifiedDiff('@@ -1 +1 @@\n-value = 12\n+return "café 漢字"\t# comment\r\n');
    const line = document.hunks[0]!.lines[1]!;
    const ranges = highlightDiff(document, 'src/demo.py').get(`new:${line.key}`)!;
    expect(ranges.map((token) => [token.kind, line.text.slice(token.start, token.end)])).toEqual([
      ['keyword', 'return'],
      ['string', '"café 漢字"'],
      ['comment', '# comment\r'],
    ]);
  });

  it('keeps old and new multiline comment/string state separate and resets at omitted context', () => {
    const document = parseUnifiedDiff(
      '@@ -1,3 +1,3 @@\n-/* old comment\n+const value = `template\n continued 42\n-*/\n+`;\n@@ -20 +20 @@\n-return 1;\n+return 2;\n',
    );
    const ranges = highlightDiff(document, 'main.ts');
    const context = document.hunks[0]!.lines[2]!;
    expect(ranges.get(`old:${context.key}`)?.[0]?.kind).toBe('comment');
    expect(ranges.get(`new:${context.key}`)?.[0]?.kind).toBe('string');
    const next = document.hunks[1]!.lines[1]!;
    expect(ranges.get(`new:${next.key}`)?.map((token) => token.kind)).toEqual(['keyword', 'number']);
  });

  it('treats unsupported formats and excessive input as plain text without changing content', () => {
    const payload = '<img src=x onerror=alert(1)> & <script>alert(2)</script>';
    const document = parseUnifiedDiff(`@@ -0,0 +1 @@\n+${payload}\n`);
    expect(highlightDiff(document, 'file.html').size).toBe(0);
    expect(document.hunks[0]!.lines[0]!.text).toBe(payload);
    expect(
      highlightDiff(parseUnifiedDiff(`@@ -0,0 +1 @@\n+${'x'.repeat(1_000_001)}\n`), 'file.ts').size,
    ).toBe(0);
  });
});
