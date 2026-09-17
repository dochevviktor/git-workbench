import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RepositoryWorkingChange, RepositoryWorkingChangeTarget } from '../../common/ipc/contracts';

interface FileSnapshot {
  readonly path: string;
  readonly kind: 'missing' | 'file' | 'symlink' | 'directory' | 'other';
  readonly mode: string | null;
  readonly size: number | null;
  readonly content: string | null;
}

/**
 * Creates a compare-and-swap token for one working-tree change.
 *
 * Git status gives us the HEAD and index object IDs, but not the worktree blob ID. Hashing the
 * selected filesystem entries here makes binary files, symlinks, mode changes, and text changes
 * participate in the token without putting filesystem access in the renderer.
 */
export async function createWorkingSnapshot(
  cwd: string,
  target: RepositoryWorkingChangeTarget,
  change: RepositoryWorkingChange,
): Promise<string> {
  const paths = [
    ...new Set([target.previousPath, target.path].filter((path): path is string => path !== null)),
  ];
  const files = await Promise.all(paths.map((path) => snapshotFile(cwd, path)));
  const state = {
    target: { area: target.area, path: target.path, previousPath: target.previousPath },
    change: {
      status: change.status,
      statusCode: change.statusCode,
      indexStatus: change.indexStatus,
      worktreeStatus: change.worktreeStatus,
      path: change.path,
      previousPath: change.previousPath,
      similarity: change.similarity,
      oldMode: change.oldMode,
      newMode: change.newMode,
      oldObjectId: change.oldObjectId,
      newObjectId: change.newObjectId,
    },
    files,
  };
  return createHash('sha256').update(JSON.stringify(state), 'utf8').digest('hex');
}

async function snapshotFile(cwd: string, path: string): Promise<FileSnapshot> {
  const absolute = resolve(cwd, path);
  try {
    const details = await lstat(absolute);
    const mode = details.mode.toString(8);
    if (details.isSymbolicLink()) {
      return {
        path,
        kind: 'symlink',
        mode,
        size: details.size,
        content: createHash('sha256')
          .update(await readlink(absolute), 'utf8')
          .digest('hex'),
      };
    }
    if (!details.isFile()) {
      return {
        path,
        kind: details.isDirectory() ? 'directory' : 'other',
        mode,
        size: details.size,
        content: null,
      };
    }

    const hash = createHash('sha256');
    const stream = createReadStream(absolute);
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return { path, kind: 'file', mode, size: details.size, content: hash.digest('hex') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, kind: 'missing', mode: null, size: null, content: null };
    }
    throw error;
  }
}
