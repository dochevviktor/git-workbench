import type { RepositoryRevisionTree } from '../../../common/ipc/contracts';

/** Reuses bounded committed-tree reads. Cancellation stops scheduling after the in-flight read. */
export async function collectLaunchFiles(
  readTree: (path: string) => Promise<RepositoryRevisionTree>,
  signal: AbortSignal,
): Promise<{ paths: string[]; truncated: boolean }> {
  const pending = [''];
  const paths: string[] = [];
  let truncated = false;
  let directories = 0;
  const deadline = Date.now() + 10_000;
  while (
    pending.length &&
    directories < 200 &&
    paths.length < 5000 &&
    !signal.aborted &&
    Date.now() < deadline
  ) {
    const tree = await readTree(pending.shift()!);
    if (signal.aborted) return { paths: [], truncated: false };
    directories += 1;
    truncated ||= tree.truncated;
    for (const entry of tree.entries) {
      if (entry.type === 'tree') {
        if (pending.length < 200) pending.push(entry.path);
        else truncated = true;
      } else if (entry.type === 'blob') {
        if (paths.length >= 5000) {
          truncated = true;
          break;
        }
        paths.push(entry.path);
      }
    }
  }
  return { paths: signal.aborted ? [] : paths, truncated: truncated || pending.length > 0 };
}
