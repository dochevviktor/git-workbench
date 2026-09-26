import { Fragment, useMemo } from 'react';
import { useContextMenu } from './menu/context-menu';

interface CodePreviewProps {
  readonly content: string;
  readonly testId?: string | undefined;
  readonly highlightedLines?: readonly number[] | undefined;
  readonly onHistoryForSelection?: ((start: number, end: number) => void) | undefined;
}

/** Inert text with a line-number gutter; repository content is never interpreted as markup. */
export function CodePreview({ content, testId, highlightedLines, onHistoryForSelection }: CodePreviewProps) {
  const showContextMenu = useContextMenu();
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
      <pre
        className="code-content"
        data-testid={testId}
        onContextMenu={(event) => {
          if (!onHistoryForSelection) return;
          event.preventDefault();
          event.stopPropagation();
          const selection = window.getSelection();
          const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : undefined;
          let start = 0;
          let end = 0;
          if (range && event.currentTarget.contains(range.commonAncestorContainer)) {
            const prefix = document.createRange();
            prefix.selectNodeContents(event.currentTarget);
            prefix.setEnd(range.startContainer, range.startOffset);
            start = prefix.toString().split('\n').length;
            end = start + range.toString().replace(/\n$/u, '').split('\n').length - 1;
          }
          showContextMenu({
            label: 'File content',
            anchor: { type: 'point', x: event.clientX, y: event.clientY },
            items: [
              {
                id: 'code-history',
                label: 'History for Selected Lines…',
                disabled: !start,
                disabledReason: start ? undefined : 'Select the source lines to investigate.',
                run: () => onHistoryForSelection(start, end),
              },
              {
                id: 'code-copy',
                label: 'Copy',
                run: () => {
                  void window.desktop?.edit.command({ action: 'copy' });
                },
              },
            ],
          });
        }}
      >
        {highlightedContent}
      </pre>
    </div>
  );
}
