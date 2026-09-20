import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

export const interactiveRebaseArtifactRoot = 'git-workbench-interactive-rebase';

interface ArtifactRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface InteractiveRebaseArtifacts {
  readonly directory: string;
  readonly sequenceEditor: string;
  readonly backupRef: string;
  readonly messageFiles: readonly string[];
}

/** Creates only application-owned files; Git invokes the sequence editor with the todo path. */
export async function createInteractiveRebaseArtifacts(
  gitDir: string,
  id: string,
  backupRef: string,
  todo: string,
  messages: readonly string[],
): Promise<InteractiveRebaseArtifacts> {
  const root = join(gitDir, interactiveRebaseArtifactRoot);
  const directory = join(root, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const todoPath = join(directory, 'todo');
  await writeFile(todoPath, todo, { encoding: 'utf8', mode: 0o600 });
  const messageFiles: string[] = [];
  for (const [index, message] of messages.entries()) {
    const path = join(directory, `message-${index}.txt`);
    await writeFile(path, message, { encoding: 'utf8', mode: 0o600 });
    messageFiles.push(path);
  }
  const sequenceEditor =
    process.platform === 'win32'
      ? join(directory, 'sequence-editor.cmd')
      : join(directory, 'sequence-editor.sh');
  const script =
    process.platform === 'win32'
      ? '@echo off\r\nif "%~1"=="" exit /b 2\r\ncopy /Y "%GIT_WORKBENCH_TODO_FILE%" "%~1" >NUL\r\n'
      : '#!/bin/sh\nset -eu\nif [ "$#" -lt 1 ]; then exit 2; fi\ncp -- "$GIT_WORKBENCH_TODO_FILE" "$1"\n';
  await writeFile(sequenceEditor, script, { encoding: 'utf8', mode: 0o700 });
  await writeFile(join(directory, 'backup-ref'), `${backupRef}\n`, { encoding: 'utf8', mode: 0o600 });
  return { directory, sequenceEditor, backupRef, messageFiles };
}

/** Removes completed/aborted rebase artifacts and their application-owned backup refs. */
export async function cleanupInteractiveRebaseArtifacts(
  runner: ArtifactRunner,
  cwd: string,
  gitDir: string,
): Promise<void> {
  const root = join(gitDir, interactiveRebaseArtifactRoot);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!/^[0-9a-f-]{36}$/u.test(entry)) continue;
    const directory = join(root, entry);
    const backupPath = join(directory, 'backup-ref');
    let backupRef = '';
    try {
      backupRef = (await readFile(backupPath, 'utf8')).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (backupRef && /^refs\/git-workbench\/rebase-backup\/[0-9a-f-]{36}$/u.test(backupRef)) {
      await runner.run(['update-ref', '-d', backupRef], {
        cwd,
        timeoutMs: 15_000,
        maxOutputBytes: 64 * 1024,
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
  await rm(root, { recursive: true, force: true });
}

export async function interactiveRebaseArtifactsExist(gitDir: string): Promise<boolean> {
  try {
    return (await lstat(join(gitDir, interactiveRebaseArtifactRoot))).isDirectory();
  } catch {
    return false;
  }
}
