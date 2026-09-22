import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ExpectedBackendError } from '../errors';

const schema = z.strictObject({
  version: z.literal(1),
  repositories: z
    .array(z.strictObject({ path: z.string().max(32_768), identity: z.string().max(256) }))
    .max(1000),
});

/** Trust belongs to an exact common Git directory, including its filesystem identity. */
export class RepositoryTrustStore {
  private queue: Promise<unknown> = Promise.resolve();
  private loaded: Promise<Map<string, string>> | undefined;
  constructor(private readonly path: string) {}

  private load(): Promise<Map<string, string>> {
    this.loaded ??= (async () => {
      try {
        const text = await readFile(this.path, 'utf8');
        if (text.length > 2 * 1024 * 1024) throw new Error('Oversized trust store');
        const data = schema.parse(JSON.parse(text));
        return new Map(data.repositories.map((entry) => [entry.path, entry.identity]));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map<string, string>();
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          'Repository trust settings could not be read. The file has been preserved.',
        );
      }
    })();
    return this.loaded;
  }

  async isTrusted(path: string): Promise<boolean> {
    try {
      const canonical = await realpath(path);
      return (await this.load()).get(canonical) === (await identity(canonical));
    } catch {
      return false;
    }
  }

  set(path: string, trusted: boolean): Promise<void> {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        const entries = await this.load();
        const canonical = await realpath(path);
        const updated = new Map(entries);
        if (trusted) updated.set(canonical, await identity(canonical));
        else updated.delete(canonical);
        const data = schema.parse({
          version: 1,
          repositories: [...updated].map(([path, identity]) => ({ path, identity })),
        });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await mkdir(dirname(this.path), { recursive: true });
          await writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
          await rename(temporary, this.path);
          this.loaded = Promise.resolve(updated);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      });
    this.queue = next;
    return next;
  }
}

async function identity(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error('Missing repository directory');
  return `${info.dev}:${info.ino}:${info.birthtimeMs}`;
}
