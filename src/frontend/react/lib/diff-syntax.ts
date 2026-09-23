import type { ParsedUnifiedDiff } from './diff';

export interface SyntaxRange {
  readonly start: number;
  readonly end: number;
  readonly kind: 'keyword' | 'string' | 'number' | 'comment';
}

interface Language {
  readonly keywords: ReadonlySet<string>;
  readonly comments: readonly string[];
  readonly block?: readonly [string, string];
  readonly multiline?: readonly string[];
  readonly insensitive?: boolean;
}

const words = (text: string) => new Set(text.split(' '));
const languages: Readonly<Record<string, Language>> = {
  code: {
    keywords: words(
      'abstract as async await bool boolean break case catch char class const continue default defer delete do double else enum export extends false final finally float fn for from func function go if implements import in instanceof int interface let long match namespace native new nil null object of override package private protected public readonly return select self short static string struct super switch synchronized this throw throws trait true try type typeof undefined union unsafe unsigned use using val var virtual void volatile when where while with yield',
    ),
    comments: ['//'],
    block: ['/*', '*/'],
    multiline: ['`'],
  },
  python: {
    keywords: words(
      'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
    ),
    comments: ['#'],
    multiline: ['"""', "'''"],
  },
  json: { keywords: words('true false null'), comments: [] },
  css: { keywords: words('important inherit initial unset auto none'), comments: [], block: ['/*', '*/'] },
  shell: {
    keywords: words('if then else elif fi for while until do done in case esac function return export local'),
    comments: ['#'],
  },
  yaml: { keywords: words('true false null yes no on off'), comments: ['#'] },
  sql: {
    keywords: words(
      'select from where as and or not null true false insert into values update set delete create table index alter drop join left right inner outer on group by order asc desc having limit offset union all distinct primary key references default begin end case when then else commit rollback',
    ),
    comments: ['--'],
    block: ['/*', '*/'],
    insensitive: true,
  },
};

const extensions: Readonly<Record<string, string>> = {
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  tsx: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  hpp: 'code',
  cc: 'code',
  cs: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  go: 'code',
  rs: 'code',
  swift: 'code',
  py: 'python',
  pyi: 'python',
  json: 'json',
  jsonc: 'code',
  css: 'css',
  scss: 'css',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
};

interface LexState {
  end?: string | undefined;
  kind?: SyntaxRange['kind'] | undefined;
}

/** Linear, inert lexical coloring. State is independent for the two sides of each hunk. */
function lex(text: string, language: Language, state: LexState): SyntaxRange[] {
  const ranges: SyntaxRange[] = [];
  let position = 0;
  const push = (start: number, end: number, kind: SyntaxRange['kind']) => {
    ranges.push({ start, end, kind });
    position = end;
  };
  while (position < text.length) {
    const start = position;
    if (state.end) {
      const end = text.indexOf(state.end, position);
      if (end < 0) {
        push(start, text.length, state.kind!);
        break;
      }
      push(start, end + state.end.length, state.kind!);
      state.end = undefined;
      continue;
    }
    if (language.comments.some((marker) => text.startsWith(marker, position))) {
      push(start, text.length, 'comment');
      break;
    }
    const block = language.block;
    const multiline = language.multiline?.find((marker) => text.startsWith(marker, position));
    if ((block && text.startsWith(block[0], position)) || multiline) {
      const marker = multiline ?? block![0];
      state.end = multiline ?? block![1];
      state.kind = multiline ? 'string' : 'comment';
      const end = text.indexOf(state.end, start + marker.length);
      if (end < 0) {
        push(start, text.length, state.kind);
        break;
      }
      push(start, end + state.end.length, state.kind);
      state.end = undefined;
      continue;
    }
    const char = text[position]!;
    if (char === '"' || char === "'") {
      position += 1;
      while (position < text.length) {
        if (text[position] === '\\') position = Math.min(text.length, position + 2);
        else if (text[position++] === char) break;
      }
      push(start, position, 'string');
      continue;
    }
    if (/[0-9]/u.test(char)) {
      position += 1;
      while (position < text.length && /[\w.]/u.test(text[position]!)) position += 1;
      push(start, position, 'number');
      continue;
    }
    if (/[\p{L}_$]/u.test(char)) {
      position += 1;
      while (position < text.length && /[\p{L}\p{N}_$]/u.test(text[position]!)) position += 1;
      const word = text.slice(start, position);
      if (language.keywords.has(language.insensitive ? word.toLowerCase() : word))
        push(start, position, 'keyword');
      continue;
    }
    position += 1;
  }
  return ranges;
}

/** No HTML, dynamic grammar loading or evaluation; unknown and oversized text stays plain. */
export function highlightDiff(
  document: ParsedUnifiedDiff,
  path: string,
): ReadonlyMap<string, readonly SyntaxRange[]> {
  const language = languages[extensions[path.split('.').pop()?.toLowerCase() ?? ''] ?? ''];
  const result = new Map<string, readonly SyntaxRange[]>();
  if (!language) return result;
  let characters = 0;
  let tokens = 0;
  for (const hunk of document.hunks) {
    const old: LexState = {};
    const next: LexState = {};
    for (const line of hunk.lines) {
      characters += line.text.length;
      if (characters > 1_000_000 || tokens > 100_000) return new Map();
      if (line.kind === 'note') continue;
      // A very long logical line stays plain, with state reset at the next line.
      if (line.text.length > 16_384) {
        old.end = next.end = undefined;
        continue;
      }
      for (const [side, state] of [
        ['old', old],
        ['new', next],
      ] as const) {
        if ((side === 'old' && line.kind === 'add') || (side === 'new' && line.kind === 'remove')) continue;
        const ranges = lex(line.text, language, state);
        tokens += ranges.length;
        result.set(`${side}:${line.key}`, ranges);
      }
    }
  }
  return result;
}
