import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { repositoryIdSchema, repositoryRemoteNameSchema } from '../../common/ipc/contracts';

const maximumRepositories = 1_000;
const maximumRemotesPerRepository = 100;

const preferenceEntrySchema = z.strictObject({
  repositoryId: repositoryIdSchema,
  remotes: z.array(repositoryRemoteNameSchema).max(maximumRemotesPerRepository),
});

const preferenceFileSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  enabled: z.boolean().default(true),
  entries: z.array(preferenceEntrySchema).max(maximumRepositories),
});

/** Durable, user-owned automatic-fetch opt-outs. Git's remote configuration remains untouched. */
export class RemoteFetchPreferenceStore {
  private readonly filePath: string;
  private entries: Map<string, Set<string>> | undefined;
  private enabled = true;
  private loading: Promise<void> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async isGloballyEnabled(): Promise<boolean> {
    await this.mutationQueue;
    await this.load();
    return this.enabled;
  }

  async setGloballyEnabled(enabled: boolean): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      this.enabled = enabled;
      await this.save();
    });
  }

  async isDisabled(repositoryId: string, remote: string): Promise<boolean> {
    await this.load();
    return this.entries?.get(repositoryId)?.has(remote) ?? false;
  }

  async disabledRemotes(repositoryId: string): Promise<string[]> {
    await this.load();
    return [...(this.entries?.get(repositoryId) ?? [])];
  }

  async setEnabled(repositoryId: string, remote: string, enabled: boolean): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      const entries = this.entries!;
      const remotes = entries.get(repositoryId) ?? new Set<string>();
      if (enabled) remotes.delete(remote);
      else remotes.add(remote);
      if (remotes.size === 0) entries.delete(repositoryId);
      else entries.set(repositoryId, remotes);
      await this.save();
    });
  }

  async rename(repositoryId: string, previousRemote: string, nextRemote: string): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      const entries = this.entries!;
      const remotes = entries.get(repositoryId);
      if (!remotes?.has(previousRemote)) return;
      remotes.delete(previousRemote);
      remotes.add(nextRemote);
      await this.save();
    });
  }

  async remove(repositoryId: string, remote: string): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      const entries = this.entries!;
      const remotes = entries.get(repositoryId);
      if (!remotes?.delete(remote)) return;
      if (remotes.size === 0) entries.delete(repositoryId);
      await this.save();
    });
  }

  async clearRepository(repositoryId: string): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      if (!this.entries!.delete(repositoryId)) return;
      await this.save();
    });
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
      const parsed = preferenceFileSchema.safeParse(JSON.parse(content) as unknown);
      if (parsed.success) {
        this.enabled = parsed.data.enabled;
        this.entries = new Map(
          parsed.data.entries.map((entry) => [entry.repositoryId, new Set(entry.remotes)]),
        );
      } else {
        this.entries = new Map();
        await this.quarantineCorruptFile();
      }
    } catch (error) {
      if (this.isMissing(error)) {
        this.entries = new Map();
        return;
      }
      if (error instanceof SyntaxError) {
        this.entries = new Map();
        await this.quarantineCorruptFile();
        return;
      }
      throw error;
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const entries = [...(this.entries ?? new Map())].map(([repositoryId, remotes]) => ({
      repositoryId,
      remotes: [...remotes].slice(0, maximumRemotesPerRepository),
    }));
    const content = `${JSON.stringify({ version: 2, enabled: this.enabled, entries }, null, 2)}\n`;
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

  private isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}
