import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { WorkspaceFile } from './workspace-file';

const recentRecordSchema = z.strictObject({
  id: z.string().regex(/^repo-[a-f0-9]{64}$/),
  name: z.string().min(1).max(512),
  path: z
    .string()
    .min(1)
    .max(32_768)
    .refine((value) => isAbsolute(value) && !value.includes('\0')),
  lastOpenedAt: z.string().datetime({ offset: true }),
});
const recentFileSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(recentRecordSchema).max(50),
});
export type RecentRecord = z.infer<typeof recentRecordSchema>;
export interface RecentRepositoryStoreOptions {
  readonly filePath: string;
  readonly maxEntries?: number;
}

export class RecentRepositoryStore {
  private readonly file: WorkspaceFile<z.infer<typeof recentFileSchema>>;
  constructor(private readonly options: RecentRepositoryStoreOptions) {
    this.file = new WorkspaceFile(options.filePath, recentFileSchema, () => ({ version: 1, entries: [] }));
  }
  async list(): Promise<RecentRecord[]> {
    return (await this.file.read()).entries;
  }
  async add(entry: RecentRecord): Promise<void> {
    const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
    await this.file.update((value) => {
      value.entries = [
        entry,
        ...value.entries.filter((candidate) => key(candidate.path) !== key(entry.path)),
      ].slice(0, this.options.maxEntries ?? 20);
    });
  }
  async remove(id: string): Promise<void> {
    await this.file.update((value) => {
      value.entries = value.entries.filter((entry) => entry.id !== id);
    });
  }
}

export async function recentPathStatus(path: string): Promise<'available' | 'missing' | 'not-directory'> {
  try {
    return (await stat(path)).isDirectory() ? 'available' : 'not-directory';
  } catch {
    return 'missing';
  }
}
