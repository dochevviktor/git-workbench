import { useMemo } from 'react';

interface CodePreviewProps {
  readonly content: string;
  readonly testId?: string | undefined;
}

/** Inert text with a line-number gutter; repository content is never interpreted as markup. */
export function CodePreview({ content, testId }: CodePreviewProps) {
  const lineNumbers = useMemo(() => {
    const lines = content.length === 0 ? 1 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    return Array.from({ length: Math.max(1, lines) }, (_, index) => index + 1).join('\n');
  }, [content]);

  return (
    <div className="code-preview">
      <div className="code-gutter" aria-hidden="true">
        {lineNumbers}
      </div>
      <pre className="code-content" data-testid={testId}>
        {content}
      </pre>
    </div>
  );
}
