/** Only the exact application document may invoke privileged handlers. */
export function isTrustedDocument(actualUrl: string, expectedUrl: string): boolean {
  try {
    const actual = new URL(actualUrl);
    const expected = new URL(expectedUrl);
    actual.hash = '';
    expected.hash = '';
    return actual.href === expected.href;
  } catch {
    return false;
  }
}
