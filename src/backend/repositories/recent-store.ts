import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';

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

/** Versioned, atomic persistence for the small recent-repository list. */
export class RecentRepositoryStore {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private entries: RecentRecord[] | undefined;

  constructor(options: RecentRepositoryStoreOptions) {
    this.filePath = options.filePath;
    this.maxEntries = options.maxEntries ?? 20;
  }

  async list(): Promise<RecentRecord[]> {
    await this.load();
    return [...(this.entries ?? [])];
  }

  async add(entry: RecentRecord): Promise<void> {
    await this.load();
    const existing = this.entries ?? [];
    const key = this.pathKey(entry.path);
    this.entries = [entry, ...existing.filter((candidate) => this.pathKey(candidate.path) !== key)].slice(
      0,
      this.maxEntries,
    );
    await this.save();
  }

  async remove(id: string): Promise<void> {
    await this.load();
    const next = (this.entries ?? []).filter((entry) => entry.id !== id);
    if (next.length === (this.entries ?? []).length) return;
    this.entries = next;
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.entries) return;
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = recentFileSchema.safeParse(JSON.parse(content) as unknown);
      this.entries = parsed.success ? parsed.data.entries : [];
      if (!parsed.success) await this.quarantineCorruptFile();
    } catch (error) {
      if (this.isMissing(error)) {
        this.entries = [];
        return;
      }
      if (error instanceof SyntaxError) {
        this.entries = [];
        await this.quarantineCorruptFile();
        return;
      }
      throw error;
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const content = `${JSON.stringify({ version: 1, entries: this.entries ?? [] }, null, 2)}\n`;
    try {
      await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      try {
        await rename(temporaryPath, `${temporaryPath}.failed`);
      } catch {
        // Preserve the original persistence error; a failed temp cleanup is not actionable here.
      }
      throw error;
    }
  }

  private async quarantineCorruptFile(): Promise<void> {
    const recoveryPath = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      await rename(this.filePath, recoveryPath);
    } catch (error) {
      if (!this.isMissing(error)) throw error;
    }
  }

  private pathKey(path: string): string {
    return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path;
  }

  private isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export async function recentPathStatus(path: string): Promise<'available' | 'missing' | 'not-directory'> {
  try {
    const details = await stat(path);
    return details.isDirectory() ? 'available' : 'not-directory';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    return 'missing';
  }
}
