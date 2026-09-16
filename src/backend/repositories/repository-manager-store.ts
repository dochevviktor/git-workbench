import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';

const sourceDirectoryRecordSchema = z.strictObject({
  id: z.string().regex(/^source-[a-f0-9]{64}$/),
  path: z
    .string()
    .min(1)
    .max(32_768)
    .refine((value) => isAbsolute(value) && !value.includes('\0')),
});

const managerFileSchema = z.strictObject({
  version: z.literal(1),
  sourceDirectories: z.array(sourceDirectoryRecordSchema).max(20),
});

export type SourceDirectoryRecord = z.infer<typeof sourceDirectoryRecordSchema>;

export interface RepositoryManagerStoreOptions {
  readonly filePath: string;
  readonly maxSourceDirectories?: number;
}

/** Persists source roots only; the folder tree is rebuilt from the filesystem on each snapshot. */
export class RepositoryManagerStore {
  private readonly filePath: string;
  private readonly maxSourceDirectories: number;
  private entries: SourceDirectoryRecord[] | undefined;
  private loading: Promise<void> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: RepositoryManagerStoreOptions) {
    this.filePath = options.filePath;
    this.maxSourceDirectories = options.maxSourceDirectories ?? 10;
  }

  async list(): Promise<SourceDirectoryRecord[]> {
    await this.mutationQueue;
    await this.load();
    return [...(this.entries ?? [])];
  }

  async add(entry: SourceDirectoryRecord): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      const existing = this.entries ?? [];
      const key = this.pathKey(entry.path);
      this.entries = [entry, ...existing.filter((candidate) => this.pathKey(candidate.path) !== key)].slice(
        0,
        this.maxSourceDirectories,
      );
      await this.save();
    });
  }

  async remove(id: string): Promise<boolean> {
    let removed = false;
    await this.mutate(async () => {
      await this.load();
      const existing = this.entries ?? [];
      const next = existing.filter((entry) => entry.id !== id);
      removed = next.length !== existing.length;
      if (!removed) return;
      this.entries = next;
      await this.save();
    });
    return removed;
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => undefined);
    await next;
  }

  private async load(): Promise<void> {
    if (this.entries) return;
    if (this.loading) {
      await this.loading;
      return;
    }

    this.loading = this.readPersisted();
    try {
      await this.loading;
    } finally {
      this.loading = undefined;
    }
  }

  private async readPersisted(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = managerFileSchema.safeParse(JSON.parse(content) as unknown);
      this.entries = parsed.success ? this.deduplicate(parsed.data.sourceDirectories) : [];
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
    const content = `${JSON.stringify({ version: 1, sourceDirectories: this.entries ?? [] }, null, 2)}\n`;
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

  private deduplicate(entries: SourceDirectoryRecord[]): SourceDirectoryRecord[] {
    const seen = new Set<string>();
    return entries
      .filter((entry) => {
        const key = this.pathKey(entry.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.maxSourceDirectories);
  }

  private pathKey(path: string): string {
    return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path;
  }

  private isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}
