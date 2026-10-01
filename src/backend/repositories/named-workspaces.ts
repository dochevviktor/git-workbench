import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkspaceFile } from './workspace-file';
import { ExpectedBackendError } from '../errors';
import { workspaceIdSchema, workspaceSchema } from '../../common/ipc/workspaces';
import type { WorkspaceEdit } from '../../common/ipc/workspaces';

const schema = z
  .strictObject({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    lastActiveId: workspaceIdSchema,
    entries: z.array(workspaceSchema).min(1).max(20),
  })
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.id)).size === value.entries.length &&
      value.entries.some((entry) => entry.id === 'default') &&
      value.entries.some((entry) => entry.id === value.lastActiveId),
  );

/** Named workspaces refer to profile-owned tab files; no repository-supplied configuration is loaded. */
export class NamedWorkspaces {
  private readonly file: WorkspaceFile<z.infer<typeof schema>>;
  constructor(path: string) {
    this.file = new WorkspaceFile(path, schema, () => ({
      version: 1,
      revision: 0,
      lastActiveId: 'default',
      entries: [{ id: 'default', name: 'Work', tabColors: {} }],
    }));
  }
  read() {
    return this.file.read();
  }
  async activate(id: string) {
    await this.file.update((value) => {
      if (!value.entries.some((entry) => entry.id === id))
        throw new ExpectedBackendError('INVALID_REQUEST', 'That workspace no longer exists.');
      value.lastActiveId = id;
    });
  }
  async edit(request: WorkspaceEdit, activeId: string, openIds: ReadonlySet<string>) {
    await this.file.update((value) => {
      if (request.revision !== value.revision)
        throw new ExpectedBackendError('OPERATION_FAILED', 'Workspaces changed. Reload and try again.');
      if (request.kind === 'create' || request.kind === 'rename') {
        if (
          value.entries.some(
            (entry) =>
              entry.name.toLocaleLowerCase() === request.name.toLocaleLowerCase() &&
              (request.kind === 'create' || entry.id !== request.id),
          )
        )
          throw new ExpectedBackendError('INVALID_REQUEST', 'A workspace already has that name.');
      }
      if (request.kind === 'create') {
        if (value.entries.length >= 20)
          throw new ExpectedBackendError('OPERATION_FAILED', 'At most 20 workspaces can be saved.');
        value.entries.push({ id: randomUUID(), name: request.name, tabColors: {} });
      } else if (request.kind === 'color') {
        const entry = value.entries.find((item) => item.id === activeId)!;
        if (request.color === 'none') delete entry.tabColors[request.repositoryId];
        else entry.tabColors[request.repositoryId] = request.color;
      } else {
        const entry = value.entries.find((item) => item.id === request.id);
        if (!entry) throw new ExpectedBackendError('INVALID_REQUEST', 'That workspace no longer exists.');
        if (request.kind === 'rename') entry.name = request.name;
        else {
          if (request.id === 'default' || openIds.has(request.id))
            throw new ExpectedBackendError(
              'OPERATION_FAILED',
              'Close the workspace window before removing it. The original workspace is retained.',
            );
          value.entries = value.entries.filter((item) => item.id !== request.id);
          if (value.lastActiveId === request.id) value.lastActiveId = 'default';
        }
      }
      value.revision++;
    });
  }
}
