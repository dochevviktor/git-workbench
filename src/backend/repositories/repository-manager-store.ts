import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { repositoryGroupSchema, sourceDirectoryIdSchema } from '../../common/ipc/contracts';
import type { RepositoryManagerAction } from '../../common/ipc/contracts';
import { ExpectedBackendError } from '../errors';
import { WorkspaceFile } from './workspace-file';

const pathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((path) => isAbsolute(path) && !path.includes('\0'));
const sourceDirectoryRecordSchema = z.strictObject({ id: sourceDirectoryIdSchema, path: pathSchema });
const managerFileSchema = z
  .strictObject({
    version: z.literal(2),
    sourceDirectories: z.array(sourceDirectoryRecordSchema).max(20),
    defaultSourceId: sourceDirectoryIdSchema.nullable(),
    groups: z.array(repositoryGroupSchema).max(200),
    repositories: z
      .array(
        z.strictObject({
          path: pathSchema,
          name: z.string().max(512),
          groupId: z.string().uuid().nullable(),
        }),
      )
      .max(5_000),
  })
  .superRefine((value, context) => {
    const groups = new Map(value.groups.map((group) => [group.id, group]));
    let invalid = groups.size !== value.groups.length;
    for (const group of value.groups) {
      const seen = new Set([group.id]);
      let parent = group.parentId;
      while (parent) {
        if (seen.has(parent) || !groups.has(parent)) {
          invalid = true;
          break;
        }
        seen.add(parent);
        parent = groups.get(parent)!.parentId;
      }
    }
    if (value.repositories.some((repository) => repository.groupId && !groups.has(repository.groupId)))
      invalid = true;
    if (
      value.defaultSourceId &&
      !value.sourceDirectories.some((source) => source.id === value.defaultSourceId)
    )
      invalid = true;
    if (invalid) context.addIssue({ code: 'custom', message: 'Invalid repository folder hierarchy.' });
  });

export type SourceDirectoryRecord = z.infer<typeof sourceDirectoryRecordSchema>;
export interface RepositoryManagerStoreOptions {
  readonly filePath: string;
  readonly maxSourceDirectories?: number;
}
const empty = () => ({
  version: 2 as const,
  sourceDirectories: [] as SourceDirectoryRecord[],
  defaultSourceId: null,
  groups: [],
  repositories: [],
});
const pathKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);

/** Logical folders/display names never rename or write a repository on disk. */
export class RepositoryManagerStore {
  private readonly file: WorkspaceFile<z.infer<typeof managerFileSchema>>;
  constructor(private readonly options: RepositoryManagerStoreOptions) {
    this.file = new WorkspaceFile(options.filePath, managerFileSchema, empty, (value) => {
      const legacy = z
        .strictObject({
          version: z.literal(1),
          sourceDirectories: z.array(sourceDirectoryRecordSchema).max(20),
        })
        .safeParse(value);
      return legacy.success ? { ...empty(), sourceDirectories: legacy.data.sourceDirectories } : value;
    });
  }
  configuration() {
    return this.file.read();
  }
  async list() {
    return (await this.file.read()).sourceDirectories;
  }
  async add(entry: SourceDirectoryRecord): Promise<void> {
    await this.file.update((value) => {
      if (value.sourceDirectories.some((source) => pathKey(source.path) === pathKey(entry.path))) return;
      if (value.sourceDirectories.length >= (this.options.maxSourceDirectories ?? 10))
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'Remove a source directory before adding another.',
        );
      value.sourceDirectories.unshift(entry);
      value.defaultSourceId ??= entry.id;
    });
  }
  async remove(id: string): Promise<boolean> {
    let removed = false;
    await this.file.update((value) => {
      removed = value.sourceDirectories.some((entry) => entry.id === id);
      value.sourceDirectories = value.sourceDirectories.filter((entry) => entry.id !== id);
      if (value.defaultSourceId === id) value.defaultSourceId = value.sourceDirectories[0]?.id ?? null;
    });
    return removed;
  }
  async remember(path: string): Promise<void> {
    const current = await this.file.read();
    if (current.repositories.some((entry) => pathKey(entry.path) === pathKey(path))) return;
    await this.file.update((value) => {
      if (value.repositories.some((entry) => pathKey(entry.path) === pathKey(path))) return;
      if (value.repositories.length < 5_000) value.repositories.push({ path, name: '', groupId: null });
    });
  }
  async relocate(oldPath: string, path: string): Promise<void> {
    await this.file.update((value) => {
      const old = value.repositories.find((entry) => entry.path === oldPath);
      value.repositories = value.repositories.filter(
        (entry) => entry.path !== oldPath && entry.path !== path,
      );
      value.repositories.push(old ? { ...old, path } : { path, name: '', groupId: null });
    });
  }
  async edit(action: RepositoryManagerAction, path?: string): Promise<void> {
    await this.file.update((value) => {
      const requireGroup = (id: string | null) => {
        if (id && !value.groups.some((group) => group.id === id))
          throw new ExpectedBackendError('INVALID_REQUEST', 'That folder is no longer listed.');
      };
      switch (action.kind) {
        case 'add-source':
          throw new ExpectedBackendError(
            'INVALID_REQUEST',
            'Source paths must be resolved by the repository service.',
          );
        case 'add-group':
          requireGroup(action.parentId);
          if (value.groups.length >= 200)
            throw new ExpectedBackendError('OPERATION_FAILED', 'The folder limit has been reached.');
          value.groups.push({ id: randomUUID(), name: action.name, parentId: action.parentId });
          break;
        case 'rename-group':
          requireGroup(action.id);
          value.groups.find((group) => group.id === action.id)!.name = action.name;
          break;
        case 'move-group': {
          requireGroup(action.id);
          requireGroup(action.parentId);
          let parent = action.parentId;
          while (parent) {
            if (parent === action.id)
              throw new ExpectedBackendError('INVALID_REQUEST', 'A folder cannot contain itself.');
            parent = value.groups.find((group) => group.id === parent)!.parentId;
          }
          value.groups.find((group) => group.id === action.id)!.parentId = action.parentId;
          break;
        }
        case 'remove-group': {
          requireGroup(action.id);
          const parent = value.groups.find((group) => group.id === action.id)!.parentId;
          value.groups = value.groups.filter((group) => group.id !== action.id);
          for (const group of value.groups) if (group.parentId === action.id) group.parentId = parent;
          for (const repository of value.repositories)
            if (repository.groupId === action.id) repository.groupId = parent;
          break;
        }
        case 'edit-repository': {
          requireGroup(action.groupId);
          if (!path) throw new ExpectedBackendError('INVALID_REQUEST', 'Select a listed repository.');
          const entry = value.repositories.find((entry) => pathKey(entry.path) === pathKey(path));
          if (entry) {
            entry.name = action.name;
            entry.groupId = action.groupId;
          } else value.repositories.push({ path, name: action.name, groupId: action.groupId });
          break;
        }
        case 'set-default-source':
          if (action.id && !value.sourceDirectories.some((source) => source.id === action.id))
            throw new ExpectedBackendError('INVALID_REQUEST', 'That source directory is no longer listed.');
          value.defaultSourceId = action.id;
      }
    });
  }
}
