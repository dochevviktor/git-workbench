import { Fragment, useMemo } from 'react';

interface CodePreviewProps {
  readonly content: string;
  readonly testId?: string | undefined;
  readonly highlightedLines?: readonly number[] | undefined;
}

/** Inert text with a line-number gutter; repository content is never interpreted as markup. */
export function CodePreview({ content, testId, highlightedLines }: CodePreviewProps) {
  const lineNumbers = useMemo(() => {
    const lines = content.length === 0 ? 1 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    return Array.from({ length: Math.max(1, lines) }, (_, index) => index + 1).join('\n');
  }, [content]);

  const highlightedContent = useMemo(() => {
    if (!highlightedLines?.length) return content;
    const marked = new Set(highlightedLines.slice(0, 5_000));
    const pieces = [];
    let plain = '';
    const lines = content.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
    for (const [index, line] of lines.entries()) {
      if (!marked.has(index + 1)) {
        plain += line;
        continue;
      }
      if (plain) {
        pieces.push(plain);
        plain = '';
      }
      pieces.push(
        <Fragment key={index}>
          <span className="code-line-highlight">{line.replace(/\r?\n$/u, '')}</span>
          {line.endsWith('\n') ? '\n' : ''}
        </Fragment>,
      );
    }
    if (plain) pieces.push(plain);
    return pieces;
  }, [content, highlightedLines]);
  return (
    <div className="code-preview">
      <div className="code-gutter" aria-hidden="true">
        {lineNumbers}
      </div>
      <pre className="code-content" data-testid={testId}>
        {highlightedContent}
      </pre>
    </div>
  );
}
