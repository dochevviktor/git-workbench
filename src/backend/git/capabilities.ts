/** Conservative supported baseline, exercised with the P01 disposable-repository matrix. */
export const minimumGitVersion = '2.43.0';

export function gitCapabilities(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[.-].*)?$/u.exec(version);
  const parts = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
  const atLeast = (major: number, minor: number) =>
    parts.length === 3 && (parts[0]! > major || (parts[0] === major && parts[1]! >= minor));
  return {
    supported: atLeast(2, 43),
    porcelainV2: atLeast(2, 11),
    pathspecFromFile: atLeast(2, 25),
    rebaseUpdateRefs: atLeast(2, 38),
  };
}
