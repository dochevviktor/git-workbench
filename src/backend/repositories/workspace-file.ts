import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';

/** Serialize profile writers, validate migrations, and retain invalid originals. */
export class WorkspaceFile<T> {
  private value: T | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T>,
    private readonly defaults: () => T,
    private readonly migrate: (value: unknown) => unknown = (value) => value,
  ) {}
  read(): Promise<T> {
    return this.enqueue(async () => structuredClone(await this.load()));
  }
  update(change: (value: T) => void): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(await this.load());
      change(next);
      const valid = this.schema.parse(next);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      this.value = valid;
    });
  }
  private enqueue<R>(work: () => Promise<R>): Promise<R> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async load(): Promise<T> {
    if (this.value !== undefined) return this.value;
    try {
      if ((await stat(this.path)).size > 4 * 1024 * 1024) throw new SyntaxError('Settings too large.');
      const parsed = this.schema.safeParse(this.migrate(JSON.parse(await readFile(this.path, 'utf8'))));
      if (!parsed.success) throw new SyntaxError('Invalid settings.');
      this.value = parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (!(error instanceof SyntaxError)) throw error;
        await rename(this.path, `${this.path}.corrupt-${randomUUID()}`);
      }
      this.value = this.defaults();
    }
    return this.value;
  }
}
