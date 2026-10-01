import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { externalToolsSchema, externalToolSaveSchema } from '../../common/ipc/external-tools';
import type { ExternalTool, ExternalToolSave, ExternalToolSelection } from '../../common/ipc/external-tools';
import { readCommandFile } from '../commands/custom-command-store';
import { ExpectedBackendError } from '../errors';

const schema = z.strictObject({ version: z.literal(1), tools: externalToolsSchema });
const variables: Record<ExternalTool['kind'], string[]> = {
  editor: ['LOCAL', 'LINE', 'REPO'],
  diff: ['LOCAL', 'REMOTE', 'REPO'],
  merge: ['BASE', 'LOCAL', 'REMOTE', 'MERGED', 'REPO'],
  terminal: ['REPO'],
};
export function expandToolArguments(
  tool: Pick<ExternalTool, 'kind' | 'args'>,
  values: Record<string, string>,
): string[] {
  return tool.args.map((arg) =>
    arg.replace(/\$([A-Z][A-Z0-9_]*)/gu, (_match, key: string) => {
      if (!variables[tool.kind].includes(key) || values[key] === undefined)
        throw new ExpectedBackendError('INVALID_REQUEST', `Unavailable tool variable: $${key}`);
      return values[key]!;
    }),
  );
}
export class ExternalToolStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  async list(): Promise<ExternalTool[]> {
    try {
      return schema.parse(await readCommandFile(this.path)).tools;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'External tool settings could not be read. The existing file has been preserved.',
      );
    }
  }
  match(tools: ExternalTool[], selection: ExternalToolSelection): ExternalTool {
    const tool = tools.find((entry) => entry.id === selection.id && entry.revision === selection.revision);
    if (!tool)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Tool settings changed. Reopen External Tools and review them.',
      );
    return tool;
  }
  private update(change: (tools: ExternalTool[]) => ExternalTool[]): Promise<ExternalTool[]> {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        const tools = externalToolsSchema.parse(change(await this.list()));
        const content = JSON.stringify({ version: 1, tools }, null, 2);
        if (Buffer.byteLength(content) > 2 * 1024 * 1024)
          throw new ExpectedBackendError('INVALID_REQUEST', 'External tool settings cannot exceed 2 MiB.');
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await mkdir(dirname(this.path), { recursive: true });
          await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
          await rename(temporary, this.path);
        } catch {
          throw new ExpectedBackendError('UNAVAILABLE', 'External tool settings could not be saved.');
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
        return tools;
      });
    this.queue = next;
    return next;
  }
  save(input: ExternalToolSave): Promise<ExternalTool[]> {
    const request = externalToolSaveSchema.parse(input);
    const definition = request.definition;
    if (!isAbsolute(definition.executable))
      throw new ExpectedBackendError('INVALID_REQUEST', 'Select an absolute executable path.');
    expandToolArguments(definition, Object.fromEntries(variables[definition.kind].map((key) => [key, key])));
    return this.update((tools) => {
      if (request.id) this.match(tools, { id: request.id, revision: request.revision ?? '' });
      if (!request.id && tools.length >= 32)
        throw new ExpectedBackendError('INVALID_REQUEST', 'At most 32 external tools can be saved.');
      const saved = { ...definition, id: request.id ?? randomUUID(), revision: randomUUID() };
      if (saved.isDefault)
        tools = tools.map((tool) =>
          tool.kind === saved.kind && tool.isDefault
            ? { ...tool, isDefault: false, revision: randomUUID() }
            : tool,
        );
      return request.id ? tools.map((tool) => (tool.id === request.id ? saved : tool)) : [...tools, saved];
    });
  }
  remove(selection: ExternalToolSelection): Promise<ExternalTool[]> {
    return this.update((tools) => {
      this.match(tools, selection);
      return tools.filter((tool) => tool.id !== selection.id);
    });
  }
}
