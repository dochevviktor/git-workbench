import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** A reviewed destructive scope expires when files change, even if Git's path count is unchanged. */
export async function topologyPathFingerprint(cwd: string, paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  const queue = [...new Set(paths)].sort();
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index]!;
    if (visited.has(path)) continue;
    if (visited.size >= 10_000) throw new Error('The worktree is too large to review safely for removal.');
    visited.add(path);
    const target = join(cwd, path);
    const local = relative(cwd, target);
    if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
      throw new Error('Invalid worktree path.');
    try {
      const info = await lstat(target, { bigint: true });
      hash.update(
        `${path}\0${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}\0`,
      );
      if (info.isDirectory()) {
        const entries = await readdir(target);
        if (entries.length + visited.size > 10_000)
          throw new Error('The worktree is too large to review safely for removal.');
        queue.push(
          ...entries
            .filter((name) => name !== '.git')
            .sort()
            .map((name) => join(path, name)),
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update(`${path}\0missing\0`);
    }
  }
  return hash.digest('hex');
}

/** Refuse deletion of independently initialized repositories hidden inside a reviewed child. */
export async function hasUnrelatedRepository(
  root: string,
  allowedChildren: readonly string[] = [],
): Promise<boolean> {
  const allowed = new Set(allowedChildren);
  const queue = [root];
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const directory = queue[index]!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (++visited > 20_000) return true;
      if (entry.name === '.git') {
        if (directory !== root && !allowed.has(directory)) return true;
      } else if (entry.isDirectory()) queue.push(join(directory, entry.name));
    }
  }
  return false;
}
