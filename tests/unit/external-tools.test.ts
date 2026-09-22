import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { ExternalToolStore, expandToolArguments } from '../../src/backend/tools/external-tool-store';
import type { ExternalTarget, ExternalToolDefinition } from '../../src/common/ipc/external-tools';
import { externalToolRunSchema } from '../../src/common/ipc/external-tools';
import { requests } from '../../src/common/ipc/contracts';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';

const roots: string[] = [];
const services: RepositoryService[] = [];
afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(path = "-value ' $(touch injected);\n.txt") {
  const root = await mkdtemp(join(tmpdir(), 'workbench-f33-'));
  roots.push(root);
  const cwd = join(root, "Café '$() ; repository");
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.name', 'F33 Test');
  await run('config', 'user.email', 'f33@example.test');
  await run('config', 'core.autocrlf', 'false');
  await writeFile(join(cwd, path), 'base\r\n');
  await run('add', '.');
  await run('commit', '-qm', 'Base');
  const base = await run('rev-parse', 'HEAD');
  await writeFile(join(cwd, path), 'middle\r\n');
  await run('commit', '-qam', 'Middle');
  const middle = await run('rev-parse', 'HEAD');
  await writeFile(join(cwd, path), 'latest\r\n');
  await run('commit', '-qam', 'Latest');
  const service = new RepositoryService({ storagePath: join(root, 'profile', 'recent.json') });
  services.push(service);
  const summary = await service.open(1, cwd);
  await service.setTrust(1, summary.id, true);
  const store = service.externalTools.store;
  const finish = async (id: string) => {
    await expect
      .poll(() => service.listOperations(1).find((item) => item.id === id)?.status)
      .not.toBe('running');
    return service.listOperations(1).find((item) => item.id === id)!;
  };
  const execute = async (definition: ExternalToolDefinition, target: ExternalTarget) => {
    const tool = (await store.save({ definition })).at(-1)!;
    return finish(
      service.startExternalTool(1, {
        repositoryId: summary.id,
        tool: { id: tool.id, revision: tool.revision },
        target,
      }).id,
    );
  };
  return { root, cwd, path, base, middle, service, store, summary, run, execute, finish };
}
describe('F33 external tools', () => {
  it('cancels on owner close and releases temporary files across repeated launches', async () => {
    const f = await fixture();
    const marker = join(f.root, 'materialized-path');
    const [tool] = await f.store.save({
      definition: {
        kind: 'editor',
        name: 'Owned viewer',
        executable: process.execPath,
        args: [
          '-e',
          "require('node:fs').writeFileSync(process.argv[1],process.argv[2]);setInterval(()=>{},1000)",
          marker,
          '$LOCAL',
        ],
      },
    });
    for (let count = 0; count < 3; count += 1) {
      if (count) await f.service.open(1, f.cwd);
      f.service.startExternalTool(1, {
        repositoryId: f.summary.id,
        tool: { id: tool!.id, revision: tool!.revision },
        target: { kind: 'revision', commitId: f.middle, path: f.path, line: 1 },
      });
      await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).toContain('git-workbench-tool-');
      const path = await readFile(marker, 'utf8');
      f.service.disposeWindow(1);
      await expect
        .poll(() =>
          access(path).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      await rm(marker);
    }
    const blocked = join(f.root, 'not-a-directory');
    await writeFile(blocked, 'keep');
    await expect(
      new ExternalToolStore(join(blocked, 'tools')).save({
        definition: { kind: 'terminal', name: 'Terminal', executable: process.execPath, args: [] },
      }),
    ).rejects.toThrow();
    expect(await readFile(blocked, 'utf8')).toBe('keep');
  });
  it('hands off exact historical versions and byte-preserving binary copies without changing Git or checkout; cleans temporary files', async () => {
    const f = await fixture();
    const before = await f.run('show-ref');
    const index = await f.run('write-tree');
    const result = await f.execute(
      {
        kind: 'diff',
        name: 'Historical viewer',
        executable: process.execPath,
        args: [
          '-e',
          "const fs=require('node:fs'); console.log(JSON.stringify(process.argv.slice(1).map(p=>[p,fs.readFileSync(p).toString('base64')])));",
          '$REMOTE',
          '$LOCAL',
        ],
      },
      { kind: 'revision', commitId: f.middle, path: f.path, line: 1 },
    );
    expect(result.status).toBe('succeeded');
    const sides = JSON.parse(result.output.trim()) as [string, string][];
    expect(sides.map((entry) => Buffer.from(entry[1], 'base64').toString())).toEqual([
      'base\r\n',
      'middle\r\n',
    ]);
    for (const [path] of sides) await expect(access(path)).rejects.toThrow();
    expect(await readFile(join(f.cwd, f.path), 'utf8')).toBe('latest\r\n');
    expect(await f.run('show-ref')).toBe(before);
    expect(await f.run('write-tree')).toBe(index);
    expect(await f.run('status', '--porcelain')).toBe('');
    const binary = Buffer.from([0, 255, 128, 13, 10]);
    await writeFile(join(f.cwd, 'binary.bin'), binary);
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Binary');
    const binaryResult = await f.execute(
      {
        kind: 'editor',
        name: 'Binary viewer',
        executable: process.execPath,
        args: [
          '-e',
          "console.log(require('node:fs').readFileSync(process.argv[1]).toString('hex'))",
          '$LOCAL',
        ],
      },
      { kind: 'revision', commitId: await f.run('rev-parse', 'HEAD'), path: 'binary.bin', line: 1 },
    );
    expect(binaryResult.output.trim()).toBe(binary.toString('hex'));
  });
  it('distinguishes staged and unstaged versions, additions, deletions and renames', async () => {
    const f = await fixture();
    const reader: ExternalToolDefinition = {
      kind: 'diff',
      name: 'Pair',
      executable: process.execPath,
      args: [
        '-e',
        "console.log(JSON.stringify(process.argv.slice(1).map(p=>require('node:fs').readFileSync(p,'utf8'))))",
        '$REMOTE',
        '$LOCAL',
      ],
    };
    await writeFile(join(f.cwd, f.path), 'index\n');
    await f.run('add', '--', f.path);
    await writeFile(join(f.cwd, f.path), 'working\n');
    expect(
      JSON.parse(
        (await f.execute(reader, { kind: 'working', path: f.path, area: 'staged', line: 1 })).output,
      ),
    ).toEqual(['latest\r\n', 'index\n']);
    expect(
      JSON.parse(
        (await f.execute(reader, { kind: 'working', path: f.path, area: 'unstaged', line: 1 })).output,
      ),
    ).toEqual(['index\n', 'working\n']);
    await writeFile(join(f.cwd, 'new.txt'), 'new\n');
    expect(
      JSON.parse(
        (await f.execute(reader, { kind: 'working', path: 'new.txt', area: 'untracked', line: 1 })).output,
      ),
    ).toEqual(['', 'new\n']);
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Changes');
    await f.run('mv', '--', f.path, 'renamed.txt');
    expect(
      JSON.parse(
        (await f.execute(reader, { kind: 'working', path: 'renamed.txt', area: 'staged', line: 1 })).output,
      ),
    ).toEqual(['working\n', 'working\n']);
    await f.run('commit', '-qm', 'Rename');
    expect(
      JSON.parse(
        (
          await f.execute(reader, {
            kind: 'revision',
            path: 'renamed.txt',
            commitId: await f.run('rev-parse', 'HEAD'),
            line: 1,
          })
        ).output,
      ),
    ).toEqual(['working\n', 'working\n']);
    await f.run('rm', '--', 'renamed.txt');
    await f.run('commit', '-qm', 'Delete');
    expect(
      JSON.parse(
        (
          await f.execute(reader, {
            kind: 'revision',
            path: 'renamed.txt',
            commitId: await f.run('rev-parse', 'HEAD'),
            line: 1,
          })
        ).output,
      ),
    ).toEqual(['working\n', '']);
  });
  it('opens a working file and line with exact argv and repository cwd; refuses symlinks, oversized blobs and missing executables', async () => {
    const f = await fixture();
    const reader: ExternalToolDefinition = {
      kind: 'editor',
      name: 'Editor',
      executable: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify([process.cwd(),...process.argv.slice(1)]))',
        '$LOCAL',
        '$LINE',
        '$REPO',
      ],
    };
    const target: ExternalTarget = { kind: 'working', path: f.path, area: 'unstaged', line: 37 };
    const result = await f.execute(reader, target);
    expect(JSON.parse(result.output)).toEqual([f.cwd, join(f.cwd, f.path), '37', f.cwd]);
    await symlink(join(f.cwd, f.path), join(f.cwd, 'link'));
    await f.run('add', '--', 'link');
    expect((await f.execute(reader, { ...target, path: 'link' })).status).toBe('failed');
    expect((await f.execute({ ...reader, executable: join(f.root, 'missing') }, target)).message).toMatch(
      /missing|executable/u,
    );
    await writeFile(join(f.cwd, 'large'), Buffer.alloc(8 * 1024 * 1024 + 1));
    await f.run('add', '.');
    await f.run('commit', '-qm', 'Large');
    expect(
      (
        await f.execute(reader, {
          kind: 'revision',
          path: 'large',
          commitId: await f.run('rev-parse', 'HEAD'),
          line: 1,
        })
      ).status,
    ).toBe('failed');
    const terminal = await f.execute(
      {
        kind: 'terminal',
        name: 'Terminal adapter',
        executable: process.execPath,
        args: ['-e', 'console.log(process.cwd())'],
      },
      { kind: 'repository' },
    );
    expect(terminal.output.trim()).toBe(f.cwd);
  });
  it('returns merge output for explicit review without writing/staging and preserves the conflict snapshot guard', async () => {
    const f = await fixture('conflict.txt');
    await f.run('checkout', '-qb', 'side', f.base);
    await writeFile(join(f.cwd, f.path), 'side\r\n');
    await f.run('commit', '-qam', 'Side');
    await f.run('checkout', 'main');
    await expect(f.run('merge', 'side')).rejects.toThrow();
    const state = await f.service.getConflicts(1, { id: f.summary.id, path: f.path });
    const before = await readFile(join(f.cwd, f.path));
    const index = await f.run('ls-files', '-u');
    const definition: ExternalToolDefinition = {
      kind: 'merge',
      name: 'Merger',
      executable: process.execPath,
      args: ['-e', "require('node:fs').writeFileSync(process.argv[1],'reviewed\\r\\n')", '$MERGED'],
    };
    const target: ExternalTarget = { kind: 'conflict', path: f.path, snapshot: state.snapshot };
    const result = await f.execute(definition, target);
    expect(result.status).toBe('succeeded');
    expect(result.result).toMatchObject({
      kind: 'external-merge',
      value: { content: 'reviewed\r\n', snapshot: state.snapshot },
    });
    expect(await readFile(join(f.cwd, f.path))).toEqual(before);
    expect(await f.run('ls-files', '-u')).toBe(index);
    await writeFile(join(f.cwd, f.path), 'external edit\n');
    expect((await f.execute(definition, target)).status).toBe('failed');
    await expect(
      f.service.resolveConflict(
        { id: f.summary.id, path: f.path, snapshot: state.snapshot, content: 'reviewed\r\n' },
        1,
      ),
    ).rejects.toThrow(/changed/u);
  });
  it('persists settings, checks stale edits/removal, refuses corrupt stores and validates the IPC surface', async () => {
    const f = await fixture();
    const definition: ExternalToolDefinition = {
      kind: 'diff',
      name: 'Viewer',
      executable: process.execPath,
      args: ['$LOCAL'],
    };
    const [tool] = await f.store.save({ definition });
    const reopened = new ExternalToolStore(join(f.root, 'profile', 'recent.json.external-tools'));
    expect(await reopened.list()).toEqual([tool]);
    await reopened.save({
      id: tool!.id,
      revision: tool!.revision,
      definition: { ...definition, name: 'Renamed' },
    });
    await expect(f.store.remove({ id: tool!.id, revision: tool!.revision })).rejects.toThrow(/changed/u);
    const result = await f.finish(
      f.service.startExternalTool(1, {
        repositoryId: f.summary.id,
        tool: { id: tool!.id, revision: tool!.revision },
        target: { kind: 'revision', path: f.path, commitId: f.middle, line: 1 },
      }).id,
    );
    expect(result.status).toBe('failed');
    expect(() => f.store.save({ definition: { ...definition, args: ['$UNKNOWN'] } })).toThrow(/variable/u);
    const storePath = join(f.root, 'corrupt');
    await writeFile(storePath, 'bad');
    await expect(new ExternalToolStore(storePath).save({ definition })).rejects.toThrow(/preserved/u);
    expect(await readFile(storePath, 'utf8')).toBe('bad');
    expect(() =>
      f.service.startExternalTool(2, {
        repositoryId: f.summary.id,
        tool: { id: tool!.id, revision: tool!.revision },
        target: { kind: 'repository' },
      }),
    ).toThrow(/not open/u);
    for (const contract of [
      requests.listExternalTools,
      requests.saveExternalTool,
      requests.removeExternalTool,
      requests.pickExternalTool,
      requests.runExternalTool,
    ])
      expect(canInvokeInspector('commit-details', contract.channel, {})).toBe(false);
    expect(
      externalToolRunSchema.safeParse({
        repositoryId: f.summary.id,
        tool: { id: randomUUID(), revision: randomUUID() },
        target: { kind: 'working', path: '../escape', line: 1 },
        executable: '/bin/sh',
      }).success,
    ).toBe(false);
    for (const value of ["a b'$(touch nope)", 'line\nbreak', '日本語', '$LOCAL', '--option'])
      expect(
        expandToolArguments(
          { kind: 'diff', args: ['$LOCAL', 'prefix=$REMOTE'] },
          { LOCAL: value, REMOTE: value },
        ),
      ).toEqual([value, `prefix=${value}`]);
  });
  it('cancels running tools, cleans materializations, reports nonzero exit and bounds output', async () => {
    const f = await fixture();
    const definition: ExternalToolDefinition = {
      kind: 'editor',
      name: 'Wait',
      executable: process.execPath,
      args: ['-e', 'console.log(process.argv[1]); setInterval(()=>{},1000)', '$LOCAL'],
    };
    const [tool] = await f.store.save({ definition });
    const accepted = f.service.startExternalTool(1, {
      repositoryId: f.summary.id,
      tool: { id: tool!.id, revision: tool!.revision },
      target: { kind: 'revision', commitId: f.middle, path: f.path, line: 1 },
    });
    await expect
      .poll(() => f.service.listOperations(1).find((item) => item.id === accepted.id)?.output)
      .toContain('git-workbench-tool-');
    f.service.cancelOperation(1, accepted.id);
    const result = await f.finish(accepted.id);
    expect(result.status).toBe('cancelled');
    await expect(access(result.output.trim())).rejects.toThrow();
    expect(
      (
        await f.execute(
          { ...definition, args: ['-e', 'process.exit(7)'] },
          { kind: 'working', path: f.path, area: 'unstaged', line: 1 },
        )
      ).message,
    ).toContain('7');
    expect(
      (
        await f.execute(
          { ...definition, args: ['-e', "console.log('x'.repeat(70000))"] },
          { kind: 'working', path: f.path, area: 'unstaged', line: 1 },
        )
      ).status,
    ).toBe('failed');
  });
});
