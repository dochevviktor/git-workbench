import type { RepositoryBlameLine } from '../../../common/ipc/contracts';
import { parseUnifiedDiff } from './diff';

export interface BlameDisplayLine extends RepositoryBlameLine {
  readonly change: 'context' | 'add' | 'remove';
}

/** Keep every attributed source line, inserting this revision's removed lines at their old/new boundary. */
export function blameDisplayLines(
  lines: readonly RepositoryBlameLine[],
  patch: string,
  commitId: string,
  path: string,
): BlameDisplayLine[] {
  const added = new Set<number>();
  const removed = new Map<number, BlameDisplayLine[]>();
  for (const hunk of parseUnifiedDiff(patch).hunks) {
    const header = /\+(\d+)(?:,(\d+))? @@/u.exec(hunk.header);
    let nextLine = Number(header?.[1] ?? 1);
    if (header?.[2] === '0') nextLine++;
    for (const line of hunk.lines) {
      if (line.kind === 'remove') {
        const group = removed.get(nextLine) ?? [];
        group.push({
          line: line.oldLine ?? 1,
          commitId,
          originalPath: path,
          originalLine: line.oldLine ?? 1,
          content: line.text.replace(/\r$/u, ''),
          change: 'remove',
        });
        removed.set(nextLine, group);
      } else if (line.newLine !== null) {
        if (line.kind === 'add') added.add(line.newLine);
        nextLine = line.newLine + 1;
      }
    }
  }
  const result: BlameDisplayLine[] = [];
  for (const line of lines) {
    result.push(...(removed.get(line.line) ?? []));
    result.push({ ...line, change: added.has(line.line) ? 'add' : 'context' });
  }
  result.push(...(removed.get((lines.at(-1)?.line ?? 0) + 1) ?? []));
  return result;
}
