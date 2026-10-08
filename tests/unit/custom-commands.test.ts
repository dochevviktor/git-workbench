import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { CustomCommandStore } from '../../src/backend/commands/custom-command-store';
import { expandCommand, runCustomCommand } from '../../src/backend/commands/custom-command-service';
import type { CustomDefinition, CustomPreview } from '../../src/common/ipc/custom-commands';
import { customSaveSchema } from '../../src/common/ipc/custom-commands';
import { requests } from '../../src/common/ipc/contracts';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';

const roots: string[] = [];
const services: RepositoryService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const definition: CustomDefinition = {
  name: 'Read-only status',
  target: 'repository',
  action: { kind: 'bash', script: 'git status --short --branch\ngit rev-parse --short HEAD' },
  fields: [],
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f32-'));
  roots.push(root);
  const cwd = join(root, "Café '$() ; repository");
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'F32 Test');
  await run('config', 'user.email', 'f32@example.test');
  await writeFile(join(cwd, 'value.txt'), 'fixture\n');
  await run('add', '.');
  await run('commit', '-qm', 'Baseline');
  const service = new RepositoryService({ storagePath: join(root, 'profile', 'recent.json') });
  services.push(service);
  const summary = await service.open(1, cwd);
  await service.setTrust(1, summary.id, true);
  const store = service.customCommands.store;
  const [command] = await store.save({ definition, enabled: true });
  const context = { repositoryId: summary.id, target: 'repository' as const, value: '' };
  const preview = () => service.previewCustomCommand(1, { commandId: command!.id, context, inputs: [] });
  const finish = async (id: string) => {
    await expect
      .poll(() => service.listOperations(1).find((item) => item.id === id)?.status)
      .not.toBe('running');
    return service.listOperations(1).find((item) => item.id === id)!;
  };
  return { root, cwd, git, run, service, store, summary, command: command!, context, preview, finish };
}
describe('F32 custom command definitions and execution', () => {
  it('validates branch/file inputs and rejects a moved input branch after review', async () => {
    const f = await fixture();
    const form: CustomDefinition = {
      ...definition,
      fields: [
        { kind: 'branch', label: 'Branch', required: true, initial: '' },
        { kind: 'file', label: 'File', required: true, initial: '' },
      ],
    };
    const commands = await f.store.save({ definition: form, enabled: true });
    const command = commands.at(-1)!;
    const request = { commandId: command.id, context: f.context, inputs: ['refs/heads/main', 'value.txt'] };
    const preview = await f.service.previewCustomCommand(1, request);
    expect(preview.variables['input:2']).toBe(join(f.cwd, 'value.txt'));
    await expect(
      f.service.previewCustomCommand(1, { ...request, inputs: ['', 'value.txt'] }),
    ).rejects.toThrow('required');
    await expect(
      f.service.previewCustomCommand(1, { ...request, inputs: ['refs/heads/main', 'missing'] }),
    ).rejects.toThrow('existing file');
    await f.run('branch', 'input');
    const prepared = await f.service.previewCustomCommand(1, {
      ...request,
      inputs: ['refs/heads/input', 'value.txt'],
    });
    await f.run('commit', '--allow-empty', '-qm', 'next');
    await f.run('branch', '-f', 'input', 'HEAD');
    expect(
      (await f.finish(f.service.startCustomCommand(1, prepared.token, async () => undefined).id)).status,
    ).toBe('failed');
  });
  it('serializes linked worktrees and cancels queued work when its owner closes', async () => {
    const f = await fixture();
    const linked = join(f.root, 'linked');
    await f.run('worktree', 'add', '-b', 'linked', linked);
    const second = await f.service.open(2, linked);
    const saved = await f.store.save({
      definition: {
        ...definition,
        action: { kind: 'bash', script: 'printf "started\\n"; sleep 0.3; printf finished' },
      },
      enabled: true,
    });
    const commandId = saved.at(-1)!.id;
    const a = await f.service.previewCustomCommand(1, { commandId, context: f.context, inputs: [] });
    const b = await f.service.previewCustomCommand(2, {
      commandId,
      context: { ...f.context, repositoryId: second.id },
      inputs: [],
    });
    const first = f.service.startCustomCommand(1, a.token, async () => undefined);
    const next = f.service.startCustomCommand(2, b.token, async () => undefined);
    await expect
      .poll(() => f.service.listOperations(1).find((item) => item.id === first.id)?.output)
      .toBe('started\n');
    expect(f.service.listOperations(2).find((item) => item.id === next.id)?.output).toBe('');
    f.service.disposeWindow(2);
    expect((await f.finish(first.id)).output).toBe('started\nfinished');
    expect(f.service.listOperations(2)).toEqual([]);
    expect(() => f.service.customCommands.repositoryFor(2, b.token)).toThrow('expired');
  });
  it('matches the captured create/run/output/remove route without changing Git state', async () => {
    const f = await fixture();
    const before = await f.run('show-ref');
    const tree = await f.run('write-tree');
    const preview = await f.preview();
    expect(preview.cwd).toBe(f.cwd);
    const operation = f.service.startCustomCommand(1, preview.token, async () => undefined);
    const result = await f.finish(operation.id);
    expect(result).toMatchObject({ status: 'succeeded', kind: 'custom-command' });
    expect(result.output).toContain('## main');
    expect(result.output).toContain(await f.run('rev-parse', '--short', 'HEAD'));
    expect(await f.run('show-ref')).toBe(before);
    expect(await f.run('write-tree')).toBe(tree);
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(() => f.service.startCustomCommand(1, preview.token, async () => undefined)).toThrow(
      'Preview expired',
    );
    await f.store.remove(f.command);
    expect(await f.store.list()).toEqual([]);
  });
  it('round trips shared definitions, disables imports, persists restart and rejects stale edits', async () => {
    const f = await fixture();
    const exported = JSON.parse(await f.store.export(f.command)) as unknown;
    await f.store.import(exported);
    const fresh = new CustomCommandStore(join(f.root, 'profile', 'recent.json.custom-commands'));
    const list = await fresh.list();
    expect(list).toHaveLength(2);
    expect(list[1]?.enabled).toBe(false);
    await expect(
      f.service.previewCustomCommand(1, { commandId: list[1]!.id, context: f.context, inputs: [] }),
    ).rejects.toThrow('enable');
    await f.store.save({ id: f.command.id, revision: f.command.revision, definition, enabled: false });
    await expect(f.store.remove(f.command)).rejects.toThrow('changed');
    await expect(
      f.store.import({ version: 1, commands: [{ ...definition, executable: 'bad' }] }),
    ).rejects.toThrow('valid');
    expect(await fresh.list()).toHaveLength(2);
  });
  it('preserves corrupt and unwritable storage, and serializes simultaneous saves', async () => {
    const f = await fixture();
    await Promise.all([
      f.store.save({ definition, enabled: false }),
      f.store.save({ definition, enabled: false }),
    ]);
    expect(await f.store.list()).toHaveLength(3);
    const path = join(f.root, 'bad.json');
    await writeFile(path, '{broken');
    const bad = new CustomCommandStore(path);
    await expect(bad.save({ definition, enabled: false })).rejects.toThrow('preserved');
    expect(await readFile(path, 'utf8')).toBe('{broken');
    const impossible = new CustomCommandStore(join(path, 'nested.json'));
    await expect(impossible.save({ definition, enabled: true })).rejects.toThrow();
  });
  it('binds previews to owner, definition revision and repository HEAD', async () => {
    const f = await fixture();
    const preview = await f.preview();
    expect(() => f.service.startCustomCommand(2, preview.token, async () => undefined)).toThrow('expired');
    await f.run('commit', '--allow-empty', '-qm', 'Moved');
    expect(
      (await f.finish(f.service.startCustomCommand(1, preview.token, async () => undefined).id)).message,
    ).toContain('changed');
    const next = await f.preview();
    await f.store.save({ id: f.command.id, revision: f.command.revision, definition, enabled: false });
    expect(
      (await f.finish(f.service.startCustomCommand(1, next.token, async () => undefined).id)).message,
    ).toContain('changed');
  });
  it('resolves commit, branch, file and gitlink targets; rejects traversal and wrong targets', async () => {
    const f = await fixture();
    const head = await f.run('rev-parse', 'HEAD');
    const context = (target: 'commit' | 'branch' | 'file' | 'submodule', value: string) =>
      f.service.customCommands.context(f.summary, { ...f.context, target, value });
    expect(await context('commit', head)).toMatchObject({ sha: head });
    expect(await context('branch', 'refs/heads/main')).toMatchObject({ branch: 'main', sha: head });
    expect(await context('file', 'value.txt')).toMatchObject({ file: 'value.txt' });
    await f.run('update-index', '--add', '--cacheinfo', `160000,${head},child`);
    expect(await context('submodule', 'child')).toMatchObject({ submodule: 'child' });
    await expect(context('file', '../value.txt')).rejects.toThrow('relative');
    await expect(context('branch', '--help')).rejects.toThrow('branch');
    await expect(context('submodule', 'value.txt')).rejects.toThrow('available');
    await expect(
      f.service.previewCustomCommand(1, {
        commandId: f.command.id,
        context: { ...f.context, target: 'commit', value: head },
        inputs: [],
      }),
    ).rejects.toThrow('target');
  });
  it('passes unusual input literally through Bash environment and direct argv', async () => {
    const f = await fixture();
    const values = ['\'"; $(touch injected) `touch injected`', 'a\nb\t日本', '--leading * ? [a] \\', f.cwd];
    for (const value of values) {
      const preview: CustomPreview = {
        token: randomUUID(),
        name: 'Quoting',
        cwd: f.cwd,
        action: { kind: 'bash', script: 'printf "%s" "$GW_INPUT_1"' },
        variables: { 'input:1': value },
      };
      const handle = {
        signal: new AbortController().signal,
        appendOutput: () => undefined,
        setProgress: () => undefined,
      };
      expect((await runCustomCommand(preview, handle, async () => undefined)).output).toBe(value);
      const action = expandCommand(
        {
          kind: 'process',
          executable: process.execPath,
          args: ['-e', 'process.stdout.write(process.argv[1])', '--', '${input:1}'],
        },
        preview.variables,
      );
      expect((await runCustomCommand({ ...preview, action }, handle, async () => undefined)).output).toBe(
        value,
      );
    }
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(
      expandCommand({ kind: 'url', url: 'https://example.test/?q=${input:1}' }, { 'input:1': 'a&b#c' }),
    ).toEqual({ kind: 'url', url: 'https://example.test/?q=a%26b%23c' });
    expect(() => expandCommand({ kind: 'url', url: 'file:///tmp/foo' }, {})).toThrow('HTTP');
    expect(() => expandCommand({ kind: 'process', executable: 'git', args: ['${unknown}'] }, {})).toThrow(
      'Unavailable variable',
    );
  });
  it('reports nonzero exit, missing executable, bounded output, timeout and cancellation', async () => {
    const f = await fixture();
    const base: CustomPreview = {
      token: randomUUID(),
      name: 'Outcomes',
      cwd: f.cwd,
      action: { kind: 'bash', script: '' },
      variables: {},
    };
    const execute = (script: string, signal = new AbortController().signal, timeout = 300000) =>
      runCustomCommand(
        { ...base, action: { kind: 'bash', script } },
        { signal, appendOutput: () => undefined, setProgress: () => undefined },
        async () => undefined,
        timeout,
      );
    expect(await execute('printf err >&2; exit 7')).toMatchObject({
      status: 'failed',
      output: 'err',
      message: 'Command exited with status 7.',
    });
    const missing = await runCustomCommand(
      { ...base, action: { kind: 'process', executable: '/no/such/executable', args: [] } },
      { signal: new AbortController().signal, appendOutput: () => undefined, setProgress: () => undefined },
      async () => undefined,
    );
    expect(missing.message).toContain('could not be started');
    const large = await execute('yes large');
    expect(large.message).toContain('Output limit');
    expect(Buffer.byteLength(large.output)).toBeLessThanOrEqual(65536);
    expect((await execute('sleep 20', undefined, 40)).message).toContain('timed out');
    const controller = new AbortController();
    const pending = execute('sleep 20', controller.signal);
    controller.abort();
    expect((await pending).message).toContain('Cancelled');
  });
  it('validates the IPC surface and denies all custom capabilities to inspectors', () => {
    expect(
      customSaveSchema.safeParse({
        definition: { ...definition, action: { kind: 'process', executable: 'git', args: ['a\0b'] } },
        enabled: true,
      }).success,
    ).toBe(false);
    for (const contract of Object.values(requests).filter((item) =>
      item.channel.startsWith('custom-commands:'),
    ))
      expect(canInvokeInspector('commit-details', contract.channel, undefined)).toBe(false);
    expect(requests.runCustomCommand.input.safeParse({ script: 'evil', token: randomUUID() }).success).toBe(
      false,
    );
  });
});
