import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { customCommandsSchema, customSaveSchema, customSharedSchema } from '../../common/ipc/custom-commands';
import type { CustomCommand, CustomSave, CustomSelection } from '../../common/ipc/custom-commands';
import { ExpectedBackendError } from '../errors';

const storeSchema = z.strictObject({ version: z.literal(1), commands: customCommandsSchema });
export async function readCommandFile(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('size');
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > 2 * 1024 * 1024) throw new Error('size');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await file.close();
  }
}

/** Profile-owned definitions. Disk is re-read inside every serialized update; failures preserve it. */
export class CustomCommandStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  async list(): Promise<CustomCommand[]> {
    try {
      return storeSchema.parse(await readCommandFile(this.path)).commands;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Custom command definitions could not be read. The existing file has been preserved.',
      );
    }
  }
  private update(change: (commands: CustomCommand[]) => CustomCommand[]): Promise<CustomCommand[]> {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        const commands = customCommandsSchema.parse(change(await this.list()));
        const content = JSON.stringify({ version: 1, commands }, null, 2);
        if (Buffer.byteLength(content) > 2 * 1024 * 1024)
          throw new ExpectedBackendError('INVALID_REQUEST', 'Saved custom commands cannot exceed 2 MiB.');
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await mkdir(dirname(this.path), { recursive: true });
          await writeFile(temporary, content, {
            mode: 0o600,
            flag: 'wx',
          });
          await rename(temporary, this.path);
        } catch {
          throw new ExpectedBackendError('UNAVAILABLE', 'Custom commands could not be saved.');
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
        return commands;
      });
    this.queue = next;
    return next;
  }
  save(input: CustomSave): Promise<CustomCommand[]> {
    const request = customSaveSchema.parse(input);
    return this.update((commands) => {
      if (request.id) this.match(commands, { id: request.id, revision: request.revision ?? '' });
      const saved = {
        ...request.definition,
        id: request.id ?? randomUUID(),
        revision: randomUUID(),
        enabled: request.enabled,
      };
      return request.id
        ? commands.map((item) => (item.id === request.id ? saved : item))
        : [...commands, saved];
    });
  }
  remove(selection: CustomSelection): Promise<CustomCommand[]> {
    return this.update((commands) => {
      this.match(commands, selection);
      return commands.filter((item) => item.id !== selection.id);
    });
  }
  async import(data: unknown): Promise<CustomCommand[]> {
    const parsed = customSharedSchema.safeParse(data);
    if (!parsed.success)
      throw new ExpectedBackendError(
        'INVALID_REQUEST',
        'Choose a valid Git Workbench custom commands file (version 1).',
      );
    return this.update((commands) => {
      if (commands.length + parsed.data.commands.length > 100)
        throw new ExpectedBackendError('INVALID_REQUEST', 'At most 100 custom commands can be saved.');
      return [
        ...commands,
        ...parsed.data.commands.map((definition) => ({
          ...definition,
          id: randomUUID(),
          revision: randomUUID(),
          enabled: false,
        })),
      ];
    });
  }
  async export(selection: CustomSelection): Promise<string> {
    const { name, target, action, fields, waitForExit, showOutput } = this.match(
      await this.list(),
      selection,
    );
    const definition = { name, target, action, fields, waitForExit, showOutput };
    return JSON.stringify(
      { format: 'git-workbench-custom-commands', version: 1, commands: [definition] },
      null,
      2,
    );
  }
  match(commands: CustomCommand[], selection: CustomSelection): CustomCommand {
    const command = commands.find((item) => item.id === selection.id && item.revision === selection.revision);
    if (!command)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'This custom command changed. Reload and review it again.',
      );
    return command;
  }
}
