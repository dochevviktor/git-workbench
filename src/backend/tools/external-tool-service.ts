import { constants } from 'node:fs';
import { access, lstat, stat, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ExternalToolRun } from '../../common/ipc/external-tools';
import type { RepositorySummary } from '../../common/ipc/contracts';
import type { GitRunnerLike } from '../repositories/repository-service';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import { ExpectedBackendError } from '../errors';
import { readCommitChanges, parseRawChanges } from '../repositories/revision-service';
import { readConflictState } from '../repositories/conflict-service';
import { readWorkingChanges } from '../repositories/working-tree-service';
import { runCustomCommand } from '../commands/custom-command-service';
import { expandToolArguments } from './external-tool-store';
import type { ExternalToolStore } from './external-tool-store';

const limit = 8 * 1024 * 1024;
function unavailable(message: string): never {
  throw new ExpectedBackendError('UNAVAILABLE', message);
}
async function regularBytes(path: string, max = limit): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > max) unavailable('External tools support regular files up to 8 MiB.');
    const bytes = Buffer.alloc(max + 1);
    let count = 0;
    while (count < bytes.length) {
      const part = await file.read(bytes, count, bytes.length - count, count);
      if (!part.bytesRead) break;
      count += part.bytesRead;
    }
    if (count > max) unavailable('The tool file exceeds the supported size.');
    return bytes.subarray(0, count);
  } finally {
    await file.close();
  }
}
async function workingPath(root: string, path: string): Promise<string> {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) unavailable('External tools do not follow repository symlinks.');
  }
  await regularBytes(current);
  return current;
}

export class ExternalToolService {
  constructor(
    readonly store: ExternalToolStore,
    private readonly git: GitRunnerLike,
  ) {}
  async run(
    summary: RepositorySummary,
    request: ExternalToolRun,
    handle: OperationHandle,
  ): Promise<OperationOutcome> {
    const tool = this.store.match(await this.store.list(), request.tool);
    const target = request.target;
    if (
      (tool.kind === 'terminal' && target.kind !== 'repository') ||
      (tool.kind === 'merge' && target.kind !== 'conflict') ||
      (['editor', 'diff'].includes(tool.kind) && !['revision', 'working'].includes(target.kind))
    )
      unavailable('This tool does not support the selected target.');
    try {
      if (!(await stat(tool.executable)).isFile()) unavailable('Select a regular executable file.');
      await access(tool.executable, constants.X_OK);
    } catch {
      unavailable('The configured tool is missing or not executable. Update External Tools settings.');
    }
    const directory = await mkdtemp(join(tmpdir(), 'git-workbench-tool-'));
    const values: Record<string, string> = {
      REPO: summary.path,
      LINE: 'line' in target ? String(target.line) : '1',
    };
    const options = {
      cwd: summary.path,
      timeoutMs: 10000,
      maxOutputBytes: limit,
      signal: handle.signal,
      env: { GIT_NO_LAZY_FETCH: '1' },
    };
    const blob = async (id: string | null, mode: string | null): Promise<Buffer> => {
      if (!id) return Buffer.alloc(0);
      if (mode !== '100644' && mode !== '100755')
        unavailable('Symlinks and submodules are not external-tool file targets.');
      const size = Number((await this.git.run(['cat-file', '-s', id], options)).stdout.trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > limit)
        unavailable('External tools support blobs up to 8 MiB.');
      return Buffer.from(
        (await this.git.run(['cat-file', 'blob', id], { ...options, stdoutEncoding: 'base64' })).stdout,
        'base64',
      );
    };
    const materialize = async (key: string, bytes: Buffer | string) => {
      const folder = join(directory, key);
      await mkdir(folder);
      const file = join(folder, 'path' in target ? basename(target.path) : 'content');
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      values[key] = file;
    };
    try {
      if (target.kind === 'revision') {
        const changes = await readCommitChanges(this.git, {
          repositoryId: summary.id,
          cwd: summary.path,
          commitId: target.commitId,
        });
        const change = changes.changes.find((entry) => entry.path === target.path);
        if (tool.kind === 'diff') {
          if (!change) unavailable('Select a changed file for an external diff.');
          await materialize('REMOTE', await blob(change.oldObjectId, change.oldMode));
          await materialize('LOCAL', await blob(change.newObjectId, change.newMode));
        } else {
          const listing = await this.git.run(
            ['--literal-pathspecs', 'ls-tree', '-z', target.commitId, '--', target.path],
            options,
          );
          const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/u.exec(listing.stdout);
          if (!match || match[3] !== target.path)
            unavailable('That revision does not contain a regular file at this path.');
          await materialize('LOCAL', await blob(match[2]!, match[1]!));
        }
      } else if (target.kind === 'working') {
        if (!summary.worktreePath) unavailable('This tool requires a working tree.');
        const listing = (
          await this.git.run(
            [
              '--literal-pathspecs',
              'ls-files',
              '--cached',
              '--others',
              '--exclude-standard',
              '-z',
              '--',
              target.path,
            ],
            options,
          )
        ).stdout.split('\0');
        if (!listing.includes(target.path)) unavailable('The selected file is no longer available.');
        if (tool.kind === 'editor') values.LOCAL = await workingPath(summary.worktreePath, target.path);
        else {
          const state = await readWorkingChanges(this.git, {
            repositoryId: summary.id,
            cwd: summary.worktreePath,
            includeUntracked: true,
            includeIgnored: false,
          });
          const selected = state[target.area].find(
            (entry) => entry.path === target.path && entry.status !== 'unmerged',
          );
          if (!selected)
            unavailable(
              'This file changed or is conflicted. Refresh Local Changes or use the conflict editor.',
            );
          const args = [
            '--literal-pathspecs',
            'diff',
            '--raw',
            '--no-abbrev',
            '-z',
            '--no-ext-diff',
            '--no-textconv',
            '--find-renames',
          ];
          if (target.area === 'staged') args.push('--cached');
          args.push('--', target.path);
          if (selected.previousPath) args.push(selected.previousPath);
          const changes = parseRawChanges((await this.git.run(args, options)).stdout);
          const change = changes.find((entry) => entry.path === target.path);
          if (!change && target.area !== 'untracked')
            unavailable('This file has no changes on the selected side. Refresh Local Changes.');
          await materialize('REMOTE', await blob(change?.oldObjectId ?? null, change?.oldMode ?? null));
          if (target.area === 'staged')
            await materialize('LOCAL', await blob(change?.newObjectId ?? null, change?.newMode ?? null));
          else
            await materialize(
              'LOCAL',
              change?.status === 'deleted'
                ? Buffer.alloc(0)
                : await regularBytes(await workingPath(summary.worktreePath, target.path)),
            );
        }
      } else if (target.kind === 'conflict') {
        const state = await readConflictState(
          this.git,
          { repositoryId: summary.id, cwd: summary.path, gitDir: summary.gitDir },
          { id: summary.id, path: target.path },
        );
        if (state.snapshot !== target.snapshot)
          throw new ExpectedBackendError(
            'STALE_SNAPSHOT',
            'The conflict changed. Refresh the conflict editor.',
          );
        const file = state.selected;
        if (
          !file ||
          file.kind !== 'text' ||
          file.result.state !== 'text' ||
          (['base', 'ours', 'theirs'] as const).some(
            (side) => file.stages[side].objectId && file[side].state !== 'text',
          )
        )
          unavailable(
            'External merge review supports bounded text conflicts. Select a source version for binary or submodule entries.',
          );
        await materialize('BASE', file.base.content);
        await materialize('LOCAL', file.ours.content);
        await materialize('REMOTE', file.theirs.content);
        await materialize('MERGED', file.result.content);
      }
      if (handle.signal.aborted) return { status: 'failed', message: 'Cancelled before launch.', output: '' };
      const args = expandToolArguments(tool, values);
      handle.setCommand?.(tool.name);
      const outcome = await runCustomCommand(
        {
          token: randomUUID(),
          name: tool.name,
          cwd: summary.path,
          action: { kind: 'process', executable: tool.executable, args },
          variables: {},
        },
        handle,
        async () => undefined,
      );
      if (outcome.status !== 'succeeded' || handle.signal.aborted || target.kind !== 'conflict')
        return outcome;
      const bytes = await regularBytes(values.MERGED!, 2 * 1024 * 1024);
      const content = bytes.toString('utf8');
      if (content.includes('\0') || !Buffer.from(content).equals(bytes))
        unavailable('The merge tool returned unsupported non-UTF-8 or binary content.');
      return {
        ...outcome,
        message: 'Merge output is ready for review. Nothing has been written or staged.',
        result: { kind: 'external-merge', value: { path: target.path, snapshot: target.snapshot, content } },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
