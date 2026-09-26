import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { repositoryRebaseBackupSchema } from '../../common/ipc/contracts';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

export const interactiveRebaseArtifactRoot = 'git-workbench-interactive-rebase';
type Backup = z.infer<typeof repositoryRebaseBackupSchema>;
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

interface ArtifactRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

export interface InteractiveRebaseArtifacts {
  readonly directory: string;
  readonly sequenceEditor: string;
  readonly backupRef: string;
  readonly messageFiles: readonly string[];
  readonly messageEditor: string;
}

export const rebaseBackupRef = (id: string) => 'refs/git-workbench/rebase-backup/' + id;
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Main supplies the executable and private plan; no user editor program or command is evaluated. */
export async function createInteractiveRebaseArtifacts(
  gitDir: string,
  backup: Backup,
  messages: readonly string[],
): Promise<InteractiveRebaseArtifacts> {
  const root = join(gitDir, interactiveRebaseArtifactRoot);
  await mkdir(root, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  if (!(await lstat(root)).isDirectory()) throw new Error('Invalid rebase recovery directory.');
  const directory = join(root, backup.id);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'backup.json.tmp'), JSON.stringify({ version: 1, ...backup }), {
    mode: 0o600,
  });
  await rename(join(directory, 'backup.json.tmp'), join(directory, 'backup.json'));
  const messageFiles: string[] = [];
  for (const [index, message] of messages.entries()) {
    const path = join(directory, 'message-' + index + '.txt');
    await writeFile(path, message, { encoding: 'utf8', mode: 0o600 });
    messageFiles.push(path);
  }
  const helper = process.versions.electron
    ? join(__dirname, 'rebase-sequence-editor.cjs')
    : fileURLToPath(new URL('./rebase-sequence-editor.ts', import.meta.url));
  const sequenceEditor =
    'ELECTRON_RUN_AS_NODE=1 ' + [process.execPath, helper, join(directory, 'plan.json')].map(quote).join(' ');
  const messageEditor =
    'ELECTRON_RUN_AS_NODE=1 ' + [process.execPath, helper, '--append-message'].map(quote).join(' ');
  return { directory, sequenceEditor, messageEditor, backupRef: rebaseBackupRef(backup.id), messageFiles };
}

export async function readRebaseBackups(gitDir: string): Promise<Backup[]> {
  const root = join(gitDir, interactiveRebaseArtifactRoot);
  const rootDetails = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!rootDetails) return [];
  if (!rootDetails.isDirectory()) throw new Error('Invalid rebase recovery directory.');
  const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const backups: Backup[] = [];
  for (const id of entries.filter((entry) => idPattern.test(entry))) {
    if (!(await lstat(join(root, id))).isDirectory()) continue;
    const path = join(root, id, 'backup.json');
    const details = await lstat(path).catch(() => undefined);
    if (!details) continue; // Pre-P07 artifacts retain their recovery ref.
    if (!details.isFile() || details.size > 65_536) throw new Error('Invalid rebase recovery metadata.');
    const { version, ...value } = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    if (version !== 1) throw new Error('Unsupported rebase recovery metadata.');
    const backup = repositoryRebaseBackupSchema.parse(value);
    if (backup.id !== id) throw new Error('Invalid rebase recovery identity.');
    backups.push(backup);
  }
  if (backups.length > 100) throw new Error('Too many rebase backups. Review Recovery before continuing.');
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Completion/Abort removes executable artifacts, but retains original history until confirmation. */
export async function cleanupInteractiveRebaseArtifacts(
  _runner: ArtifactRunner,
  _cwd: string,
  gitDir: string,
): Promise<void> {
  for (const backup of await readRebaseBackups(gitDir)) {
    const directory = join(gitDir, interactiveRebaseArtifactRoot, backup.id);
    for (const file of await readdir(directory)) {
      if (file === 'plan.json' || /^message-\d+\.txt$/u.test(file))
        await rm(join(directory, file), { force: true });
    }
  }
}

export async function dismissRebaseBackup(runner: ArtifactRunner, cwd: string, gitDir: string, id: string) {
  const backup = (await readRebaseBackups(gitDir)).find((item) => item.id === id);
  if (!backup) throw new Error('That rebase backup no longer exists.');
  await runner.run(['update-ref', '-d', rebaseBackupRef(id), backup.commitId], {
    cwd,
    timeoutMs: 15_000,
    maxOutputBytes: 65_536,
  });
  // Only this validated, application-owned directory is removed; optional visible branches remain.
  await rm(join(gitDir, interactiveRebaseArtifactRoot, id), { recursive: true });
}
