import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExpectedBackendError } from '../errors';

const schema = z.strictObject({
  version: z.literal(1),
  notifications: z.array(z.string().max(100)).max(20),
  searches: z
    .array(z.strictObject({ key: z.string().max(350), values: z.array(z.string().max(200)).max(10) }))
    .max(40),
});
type Preferences = z.infer<typeof schema>;

/** Public preferences only. Account credentials remain in the separate encrypted store. */
export class HostingPreferencesStore {
  private state: Preferences = { version: 1, notifications: [], searches: [] };
  private loaded: Promise<void> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly path?: string) {}
  private load() {
    this.loaded ??= (async () => {
      if (!this.path) return;
      try {
        const file = await open(this.path, 'r');
        try {
          if ((await file.stat()).size > 512 * 1024) throw new Error();
          this.state = schema.parse(JSON.parse(await file.readFile('utf8')));
        } finally {
          await file.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new ExpectedBackendError(
            'UNAVAILABLE',
            'Hosting preferences could not be read. The original file was left unchanged.',
          );
      }
    })();
    return this.loaded;
  }
  async enabled(id: string) {
    await this.load();
    return this.state.notifications.includes(id);
  }
  async recent(key: string) {
    await this.load();
    return this.state.searches.find((entry) => entry.key === key)?.values ?? [];
  }
  setEnabled(id: string, enabled: boolean) {
    return this.update((state) => ({
      ...state,
      notifications: [...state.notifications.filter((value) => value !== id), ...(enabled ? [id] : [])],
    }));
  }
  remember(key: string, text: string) {
    return this.update((state) => ({
      ...state,
      searches: [
        {
          key,
          values: [
            text,
            ...(state.searches.find((entry) => entry.key === key)?.values ?? []).filter(
              (value) => value !== text,
            ),
          ].slice(0, 10),
        },
        ...state.searches.filter((entry) => entry.key !== key),
      ].slice(0, 40),
    }));
  }
  remove(id: string) {
    return this.update((state) => ({
      ...state,
      notifications: state.notifications.filter((value) => value !== id),
      searches: state.searches.filter((entry) => !entry.key.startsWith(`${id}/`)),
    }));
  }
  private update(change: (state: Preferences) => Preferences) {
    const work = this.writes.then(async () => {
      await this.load();
      const next = schema.parse(change(this.state));
      if (this.path) {
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(JSON.stringify(next));
            await file.sync();
          } finally {
            await file.close();
          }
          await rename(temporary, this.path);
        } catch {
          throw new ExpectedBackendError('UNAVAILABLE', 'Hosting preferences could not be saved.');
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
      }
      this.state = next;
    });
    this.writes = work.catch(() => undefined);
    return work;
  }
}
