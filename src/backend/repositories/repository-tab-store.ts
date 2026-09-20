import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  repositoryIdSchema,
  repositoryPathSchema,
  repositoryTabOrientationSchema,
} from '../../common/ipc/contracts';
import type { RepositoryTabOrientation, RepositoryTabPreferences } from '../../common/ipc/contracts';

const repositoryTabRecordSchema = z.strictObject({
  id: repositoryIdSchema,
  path: repositoryPathSchema.refine(
    (value) => isAbsolute(value),
    'A persisted repository tab must use an absolute path.',
  ),
});

const legacyRepositoryTabFileSchema = z.strictObject({
  version: z.literal(1),
  tabOrientation: repositoryTabOrientationSchema,
  activeRepositoryId: repositoryIdSchema.nullable(),
  tabs: z.array(repositoryTabRecordSchema).max(20),
});

const repositoryTabFileSchema = z.strictObject({
  version: z.literal(2),
  repositoryListVisible: z.boolean(),
  activeRepositoryId: repositoryIdSchema.nullable(),
  tabs: z.array(repositoryTabRecordSchema).max(20),
  recentlyClosed: z.array(repositoryTabRecordSchema).max(20),
});

export type RepositoryTabRecord = z.infer<typeof repositoryTabRecordSchema>;

export interface RepositoryTabStoreOptions {
  readonly filePath: string;
  readonly maxTabs?: number;
}

/** Versioned, atomic persistence for the workspace's open-tab order and tab preferences. */
export class RepositoryTabStore {
  private readonly filePath: string;
  private readonly maxTabs: number;
  private tabs: RepositoryTabRecord[] | undefined;
  private tabOrientation: RepositoryTabOrientation | undefined;
  private recentlyClosed: RepositoryTabRecord[] = [];
  private activeRepositoryId: string | null | undefined;
  private loading: Promise<void> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: RepositoryTabStoreOptions) {
    this.filePath = options.filePath;
    this.maxTabs = Math.max(1, Math.min(options.maxTabs ?? 20, 20));
  }

  async listTabs(): Promise<RepositoryTabRecord[]> {
    await this.mutationQueue;
    await this.load();
    return [...(this.tabs ?? [])];
  }

  async getPreferences(): Promise<RepositoryTabPreferences> {
    await this.mutationQueue;
    await this.load();
    return {
      tabOrientation: this.tabOrientation ?? 'horizontal',
      activeRepositoryId: this.activeRepositoryId ?? null,
      repositoryListVisible: this.tabOrientation === 'vertical',
      recentlyClosed: this.recentlyClosed.map((tab) => ({ ...tab, name: basename(tab.path) || tab.path })),
    };
  }

  async addTab(tab: RepositoryTabRecord): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      this.recentlyClosed = this.recentlyClosed.filter((candidate) => candidate.id !== tab.id);
      const existingIndex = (this.tabs ?? []).findIndex((candidate) => candidate.id === tab.id);
      if (existingIndex >= 0) {
        this.tabs![existingIndex] = tab;
      } else {
        this.tabs = [...(this.tabs ?? []), tab].slice(-this.maxTabs);
      }
      await this.save();
    });
  }

  async removeTab(id: string): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      const existing = this.tabs ?? [];
      const closed = existing.find((tab) => tab.id === id);
      if (closed)
        this.recentlyClosed = [closed, ...this.recentlyClosed.filter((tab) => tab.id !== id)].slice(0, 20);
      const next = existing.filter((tab) => tab.id !== id);
      const activeChanged = this.activeRepositoryId === id;
      if (next.length === existing.length && !activeChanged) return;
      this.tabs = next;
      if (activeChanged) this.activeRepositoryId = null;
      await this.save();
    });
  }

  async setActiveRepositoryId(id: string | null): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      if (this.activeRepositoryId === id) return;
      this.activeRepositoryId = id;
      await this.save();
    });
  }

  async setTabOrientation(tabOrientation: RepositoryTabOrientation): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      if (this.tabOrientation === tabOrientation) return;
      this.tabOrientation = tabOrientation;
      await this.save();
    });
  }

  async reorder(ids: readonly string[]): Promise<void> {
    await this.mutate(async () => {
      await this.load();
      const byId = new Map(this.tabs!.map((tab) => [tab.id, tab]));
      if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
        throw new Error('The tab order is stale. Refresh and try again.');
      }
      this.tabs = [...ids.map((id) => byId.get(id)!), ...this.tabs!.filter((tab) => !ids.includes(tab.id))];
      await this.save();
    });
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => undefined);
    await next;
  }

  private async load(): Promise<void> {
    if (this.tabs && this.tabOrientation && this.activeRepositoryId !== undefined) return;
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
      const value: unknown = JSON.parse(content);
      const parsed = repositoryTabFileSchema.safeParse(value);
      const legacy = legacyRepositoryTabFileSchema.safeParse(value);
      if (parsed.success) {
        this.tabs = this.deduplicate(parsed.data.tabs);
        this.tabOrientation = parsed.data.repositoryListVisible ? 'vertical' : 'horizontal';
        this.activeRepositoryId = parsed.data.activeRepositoryId;
        const closed = new Map(parsed.data.recentlyClosed.map((tab) => [tab.id, tab]));
        this.recentlyClosed = [...closed.values()]
          .filter((tab) => !this.tabs!.some((open) => open.id === tab.id))
          .slice(0, 20);
      } else if (legacy.success) {
        this.tabs = this.deduplicate(legacy.data.tabs);
        this.tabOrientation = legacy.data.tabOrientation;
        this.activeRepositoryId = legacy.data.activeRepositoryId;
        this.recentlyClosed = [];
        await this.save();
      } else {
        this.setDefaults();
        await this.quarantineCorruptFile();
      }
    } catch (error) {
      if (this.isMissing(error)) {
        this.setDefaults();
        return;
      }
      if (error instanceof SyntaxError) {
        this.setDefaults();
        await this.quarantineCorruptFile();
        return;
      }
      throw error;
    }
  }

  private setDefaults(): void {
    this.tabs = [];
    this.tabOrientation = 'horizontal';
    this.activeRepositoryId = null;
    this.recentlyClosed = [];
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const content = `${JSON.stringify(
      {
        version: 2,
        repositoryListVisible: this.tabOrientation === 'vertical',
        activeRepositoryId: this.activeRepositoryId ?? null,
        tabs: this.tabs ?? [],
        recentlyClosed: this.recentlyClosed,
      },
      null,
      2,
    )}\n`;
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

  private deduplicate(tabs: RepositoryTabRecord[]): RepositoryTabRecord[] {
    const seen = new Set<string>();
    return tabs
      .filter((tab) => {
        if (seen.has(tab.id)) return false;
        seen.add(tab.id);
        return true;
      })
      .slice(-this.maxTabs);
  }

  private isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}
