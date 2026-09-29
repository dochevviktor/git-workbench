import { randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  gitObjectIdSchema,
  repositoryReferenceNameSchema,
  repositoryGitFlowBranchSchema,
  repositoryGitFlowConfigSchema,
} from '../../common/ipc/contracts';

const schema = z.strictObject({
  version: z.literal(1),
  config: repositoryGitFlowConfigSchema,
  source: repositoryGitFlowBranchSchema,
  noFastForward: z.boolean(),
  keepBranch: z.boolean(),
  tagMessage: z.string().max(65_536),
  tag: repositoryReferenceNameSchema.nullable(),
  targets: z
    .array(
      z.strictObject({
        branch: repositoryReferenceNameSchema,
        before: gitObjectIdSchema,
        result: gitObjectIdSchema.nullable(),
      }),
    )
    .min(1)
    .max(2),
  next: z.number().int().min(0).max(2),
  tagged: z.boolean(),
});
export type GitFlowJournal = z.infer<typeof schema>;
const filename = 'git-workbench-gitflow-finish.json';

export async function readGitFlowJournal(gitDir: string): Promise<GitFlowJournal | null> {
  const path = join(gitDir, filename);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid Git-flow finish journal.');
    return schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      'The saved Git-flow finish could not be read. Its branches and tags have been retained.',
      { cause: error },
    );
  }
}

export async function writeGitFlowJournal(gitDir: string, value: GitFlowJournal): Promise<void> {
  const temporary = join(gitDir, `${filename}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(schema.parse(value)), { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(gitDir, filename));
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function clearGitFlowJournal(gitDir: string): Promise<void> {
  await unlink(join(gitDir, filename)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
