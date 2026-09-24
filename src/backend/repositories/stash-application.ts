import { randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { gitObjectIdSchema, repositoryRevisionPathSchema } from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

interface Runner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}
const stashPath = repositoryRevisionPathSchema.refine(
  (path) => path.length > 0 && !path.split('/').some((part) => part.toLowerCase() === '.git'),
  'Unsafe stash path.',
);
const schema = z.strictObject({
  version: z.literal(1),
  head: gitObjectIdSchema,
  source: gitObjectIdSchema,
  paths: z.array(stashPath).max(10_000),
  createdPaths: z.array(stashPath).max(10_000),
});
const name = 'git-workbench-stash-apply.json';

export async function readStashApplication(gitDir: string) {
  try {
    const path = join(gitDir, name);
    const details = await lstat(path);
    if (!details.isFile() || details.size > 1024 * 1024) throw new Error('Invalid stash journal');
    return schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'The saved stash-application state could not be read. Its Git stash has been retained.',
    );
  }
}

/** Persist provenance and exact rollback scope before the application can change the index. */
export async function beginStashApplication(runner: Runner, cwd: string, gitDir: string, source: string) {
  if (await readStashApplication(gitDir))
    throw new ExpectedBackendError(
      'OPERATION_FAILED',
      'Finish or abort the previous stash application first.',
    );
  const options = { cwd, timeoutMs: 15_000, maxOutputBytes: 4 * 1024 * 1024 };
  const head = (await runner.run(['rev-parse', '--verify', 'HEAD'], options)).stdout.trim();
  const parents = (await runner.run(['show', '-s', '--format=%P', source], options)).stdout.trim().split(' ');
  const changed = (
    await runner.run(
      ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', `${source}^1`, source, '--'],
      options,
    )
  ).stdout
    .split('\0')
    .filter(Boolean);
  const third = parents[2];
  if (third)
    changed.push(
      ...(await runner.run(['ls-tree', '-r', '--name-only', '-z', third], options)).stdout
        .split('\0')
        .filter(Boolean),
    );
  const headPaths = new Set(
    (await runner.run(['ls-tree', '-r', '--name-only', '-z', head], options)).stdout.split('\0'),
  );
  const paths: string[] = [];
  const createdPaths: string[] = [];
  for (const path of new Set(changed)) {
    repositoryRevisionPathSchema.parse(path);
    if (!path || path.split('/').some((part) => part.toLowerCase() === '.git'))
      throw new ExpectedBackendError('INVALID_REQUEST', 'The stash contains an unsafe path.');
    if (headPaths.has(path)) paths.push(path);
    else if (!(await lstat(join(cwd, path)).catch(() => undefined))) createdPaths.push(path);
  }
  const journal = schema.parse({ version: 1, head, source, paths, createdPaths });
  const temporary = join(gitDir, `${name}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  await rename(temporary, join(gitDir, name));
}

export async function finishStashApplication(gitDir: string) {
  await unlink(join(gitDir, name)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function abortStashApplication(runner: Runner, cwd: string, gitDir: string) {
  const journal = await readStashApplication(gitDir);
  if (!journal) return;
  const options = { cwd, timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024 };
  const head = (await runner.run(['rev-parse', '--verify', 'HEAD'], options)).stdout.trim();
  if (head !== journal.head)
    throw new ExpectedBackendError(
      'STALE_SNAPSHOT',
      'HEAD moved since the stash was applied. Resolve the remaining files and finish the application.',
    );
  // Preflight every affected path before restoring anything. Never traverse a replaced directory.
  for (const path of [...journal.paths, ...journal.createdPaths]) {
    let parent = cwd;
    for (const part of path.split('/').slice(0, -1)) {
      parent = join(parent, part);
      const details = await lstat(parent).catch(() => undefined);
      if (details && (!details.isDirectory() || details.isSymbolicLink()))
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'A stash path now traverses a symlink. Resolve that path before aborting.',
        );
    }
    if ((await lstat(join(cwd, path)).catch(() => undefined))?.isDirectory())
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'A directory now occupies an affected stash path. Move its contents before aborting.',
      );
  }
  if (journal.paths.length)
    await runner.run(
      [
        '--literal-pathspecs',
        'restore',
        `--source=${journal.head}`,
        '--staged',
        '--worktree',
        '--',
        ...journal.paths,
      ],
      options,
    );
  for (const path of journal.createdPaths) {
    await runner.run(['update-index', '--force-remove', '--', path], options);
    await unlink(join(cwd, path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  await finishStashApplication(gitDir);
}
