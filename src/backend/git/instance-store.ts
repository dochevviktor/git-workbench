import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { gitInstanceSchema } from '../../common/ipc/settings';
import type { GitInstance } from '../../common/ipc/settings';
import { ExpectedBackendError } from '../errors';
import { GitRunner } from './runner';
import { gitCapabilities, minimumGitVersion } from './capabilities';

const schema = gitInstanceSchema.extend({ version: z.literal(1) }).strict();
/** A selected executable applies at next startup so running operations retain their Git instance. */
export class GitInstanceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  async read(): Promise<GitInstance> {
    try {
      const file = await readFile(this.path, 'utf8');
      if (file.length > 8192) throw new Error('Oversized');
      const { executable, revision } = schema.parse(JSON.parse(file));
      if (executable !== null && !isAbsolute(executable)) throw new Error('Relative executable');
      return { executable, revision };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { executable: null, revision: 'initial' };
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Git instance settings could not be read. The file has been preserved.',
      );
    }
  }
  save(input: GitInstance): Promise<GitInstance> {
    const request = gitInstanceSchema.parse(input);
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        if ((await this.read()).revision !== request.revision)
          throw new ExpectedBackendError(
            'STALE_SNAPSHOT',
            'Git instance settings changed. Reopen Preferences.',
          );
        if (request.executable !== null) {
          if (!isAbsolute(request.executable))
            throw new ExpectedBackendError('INVALID_REQUEST', 'Choose an absolute Git executable path.');
          try {
            const version = await new GitRunner({ executable: request.executable }).version();
            if (!gitCapabilities(version.version).supported) throw new Error('Unsupported Git');
          } catch {
            throw new ExpectedBackendError(
              'GIT_UNAVAILABLE',
              `The selected executable must report Git ${minimumGitVersion} or newer.`,
            );
          }
        }
        const saved = { executable: request.executable, revision: randomUUID() };
        const temporary = `${this.path}.${saved.revision}.tmp`;
        try {
          await mkdir(dirname(this.path), { recursive: true });
          await writeFile(temporary, JSON.stringify({ version: 1, ...saved }), { flag: 'wx', mode: 0o600 });
          await rename(temporary, this.path);
        } catch {
          throw new ExpectedBackendError('OPERATION_FAILED', 'Git instance settings could not be saved.');
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        return saved;
      });
    this.queue = next;
    return next;
  }
}
