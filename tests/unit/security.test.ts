import { describe, expect, it } from 'vitest';
import { isTrustedDocument } from '../../src/backend/electron/security';

describe('renderer document allowlist', () => {
  it('allows only the exact document, with an optional navigation fragment', () => {
    expect(isTrustedDocument('file:///app/index.html#history', 'file:///app/index.html')).toBe(true);
    expect(isTrustedDocument('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/')).toBe(true);
  });

  it.each([
    'file:///app/other.html',
    'file:///app/index.html?untrusted=true',
    'file:///app/index.html.evil',
    'https://example.com/index.html',
    'data:text/html,test',
    'not a URL',
  ])('rejects an unexpected document: %s', (url) => {
    expect(isTrustedDocument(url, 'file:///app/index.html')).toBe(false);
  });

  it('does not authorize another development origin or path', () => {
    const expected = 'http://127.0.0.1:5173/';
    expect(isTrustedDocument('http://127.0.0.1:5174/', expected)).toBe(false);
    expect(isTrustedDocument('http://127.0.0.1:5173/other', expected)).toBe(false);
    expect(isTrustedDocument('http://127.0.0.1:5173.evil.test/', expected)).toBe(false);
  });
});
