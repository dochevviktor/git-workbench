import type { ReactNode } from 'react';
import './history-catalogue.css';

/** Literal text fragments stay React text; repository strings never become markup. */
export function SearchMatch({ text, query }: { readonly text: string; readonly query: string }) {
  if (!query) return <>{text}</>;
  const normalized = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const fragments: ReactNode[] = [];
  let cursor = 0;
  let found = normalized.indexOf(needle);
  while (found >= 0) {
    fragments.push(text.slice(cursor, found));
    fragments.push(
      <mark key={found} className="history-search-match">
        {text.slice(found, found + query.length)}
      </mark>,
    );
    cursor = found + query.length;
    found = normalized.indexOf(needle, cursor);
  }
  fragments.push(text.slice(cursor));
  return <>{fragments}</>;
}
