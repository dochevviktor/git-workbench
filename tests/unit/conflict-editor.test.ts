import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { RepositoryMergeRebaseAction, RepositoryOperation } from '../../src/common/ipc/contracts';

const directories: string[] = [];
const services: RepositoryService[] = [];

async function terminal(
  service: RepositoryService,
  operation: RepositoryOperation,
): Promise<RepositoryOperation> {
  const current = service.listOperations(1).find((candidate) => candidate.id === operation.id);
  if (current && current.status !== 'running') return current;
  return new Promise((resolve) => {
    const unsubscribe = service.subscribeOperations((_owner, next) => {
      if (next.id === operation.id && next.status !== 'running') {
        unsubscribe();
        resolve(next);
      }
    });
  });
}

async function fixture(options: { readonly binary?: boolean; readonly multiple?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-conflict-'));
  directories.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'Conflict Fixture');
  await run('config', 'user.email', 'conflict@example.test');
  await run('config', 'commit.gpgsign', 'false');

  if (options.binary) await writeFile(join(cwd, 'conflict.bin'), Buffer.from([0, 1, 2, 3]));
  else {
    const base = options.multiple
      ? [
          'zero',
          'base-one',
          'two',
          'three',
          'four',
          'five',
          'six',
          'seven',
          'eight',
          'nine',
          'base-ten',
          'eleven',
          'twelve',
          'thirteen',
        ].join('\n') + '\n'
      : 'header\nbase value\nfooter\n';
    await writeFile(join(cwd, 'conflict.txt'), base);
  }
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'base');
  await run('checkout', '--quiet', '-b', 'feature');
  if (options.binary) await writeFile(join(cwd, 'conflict.bin'), Buffer.from([0, 4, 5, 6]));
  else {
    const feature = options.multiple
      ? [
          'zero',
          'feature-one',
          'two',
          'three',
          'four',
          'five',
          'six',
          'seven',
          'eight',
          'nine',
          'feature-ten',
          'eleven',
          'twelve',
          'thirteen',
        ].join('\n') + '\n'
      : 'header\nfeature value\nfooter\n';
    await writeFile(join(cwd, 'conflict.txt'), feature);
  }
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'feature');
  const source = await run('rev-parse', 'HEAD');
  await run('checkout', '--quiet', 'main');
  if (options.binary) await writeFile(join(cwd, 'conflict.bin'), Buffer.from([0, 7, 8, 9]));
  else {
    const main = options.multiple
      ? [
          'zero',
          'main-one',
          'two',
          'three',
          'four',
          'five',
          'six',
          'seven',
          'eight',
          'nine',
          'main-ten',
          'eleven',
          'twelve',
          'thirteen',
        ].join('\n') + '\n'
      : 'header\nmain value\nfooter\n';
    await writeFile(join(cwd, 'conflict.txt'), main);
  }
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'main');
  const before = await run('rev-parse', 'HEAD');
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner: git });
  services.push(service);
  const { id } = await service.open(1, cwd);
  await service.setTrust(1, id, true);
  return {
    root,
    cwd,
    git,
    run,
    service,
    id,
    source,
    before,
    path: options.binary ? 'conflict.bin' : 'conflict.txt',
  };
}

async function startMerge(f: Awaited<ReturnType<typeof fixture>>) {
  const action: RepositoryMergeRebaseAction = {
    kind: 'merge',
    mode: 'default',
    sourceFullName: 'refs/heads/feature',
    autostash: false,
    snapshot: (await f.service.getReferenceContext(1, f.id)).snapshot,
    changesSnapshot: (await f.service.previewLocalChanges(1, f.id)).snapshot,
  };
  return terminal(f.service, f.service.startMergeRebase(1, { id: f.id, action }));
}

async function startRebase(f: Awaited<ReturnType<typeof fixture>>) {
  const action: RepositoryMergeRebaseAction = {
    kind: 'rebase',
    sourceFullName: 'refs/heads/main',
    autostash: false,
    snapshot: (await f.service.getReferenceContext(1, f.id)).snapshot,
    changesSnapshot: (await f.service.previewLocalChanges(1, f.id)).snapshot,
  };
  return terminal(f.service, f.service.startMergeRebase(1, { id: f.id, action }));
}

async function abort(f: Awaited<ReturnType<typeof fixture>>) {
  const state = await f.service.getRecovery(1, f.id);
  return terminal(
    f.service,
    f.service.startRecovery(1, {
      id: f.id,
      action: 'abort',
      snapshot: state.snapshot,
    }),
  );
}

afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('F17 built-in conflict helper', () => {
  it('reads operation-aware merge stages and writes, stages, then commits a manual result', async () => {
    const f = await fixture();
    expect(await startMerge(f)).toMatchObject({ status: 'failed', failureReason: 'conflict' });

    const state = await f.service.getConflicts(1, { id: f.id, path: f.path });
    expect(state).toMatchObject({
      operation: 'merge',
      oursLabel: "Current 'main'",
      theirsLabel: "Merged 'feature'",
      conflictedCount: 1,
    });
    expect(state.selected).toMatchObject({
      kind: 'text',
      unresolvedRegions: 1,
      base: { state: 'text', content: 'header\nbase value\nfooter\n' },
      ours: { state: 'text', content: 'header\nmain value\nfooter\n' },
      theirs: { state: 'text', content: 'header\nfeature value\nfooter\n' },
    });

    await expect(
      f.service.resolveConflict(
        { id: f.id, path: f.path, snapshot: state.snapshot, content: state.selected!.result.content },
        1,
      ),
    ).rejects.toThrow('every conflict marker');

    const resolved = await f.service.resolveConflict(
      {
        id: f.id,
        path: f.path,
        snapshot: state.snapshot,
        content: 'header\nfeature value\nfooter\n',
      },
      1,
    );
    expect(resolved.conflictedCount).toBe(0);
    expect(await f.run('diff', '--cached', '--name-only')).toBe(f.path);
    expect(await f.run('show', `:${f.path}`)).toBe('header\nfeature value\nfooter');

    const context = await f.service.getCommitContext(1, f.id);
    const committed = await terminal(
      f.service,
      f.service.startCommit(1, {
        id: f.id,
        subject: 'Merge resolved conflict',
        body: '',
        amend: false,
        skipHooks: false,
        snapshot: context.snapshot,
      }),
    );
    expect(committed.status).toBe('succeeded');
    expect((await f.run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toEqual(
      expect.arrayContaining([f.before, f.source]),
    );
  });

  it('counts and accepts a manually edited result containing multiple conflict regions', async () => {
    const f = await fixture({ multiple: true });
    await startMerge(f);
    const state = await f.service.getConflicts(1, { id: f.id, path: f.path });
    expect(state.selected?.regions).toHaveLength(2);
    const resolved = await f.service.resolveConflict(
      {
        id: f.id,
        path: f.path,
        snapshot: state.snapshot,
        content:
          'zero\nfeature-one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nmain-ten\neleven\ntwelve\nthirteen\n',
      },
      1,
    );
    expect(resolved.conflictedCount).toBe(0);
    expect(await readFile(join(f.cwd, f.path), 'utf8')).toBe(
      'zero\nfeature-one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nmain-ten\neleven\ntwelve\nthirteen\n',
    );
  });

  it('keeps binary conflicts unmerged and refuses to label them resolved', async () => {
    const f = await fixture({ binary: true });
    await startMerge(f);
    const state = await f.service.getConflicts(1, { id: f.id, path: f.path });
    expect(state.selected?.kind).toBe('binary');
    await expect(
      f.service.resolveConflict(
        { id: f.id, path: f.path, snapshot: state.snapshot, content: 'not a binary resolution' },
        1,
      ),
    ).rejects.toThrow('not a bounded text file');
    expect((await f.service.getConflicts(1, { id: f.id })).conflictedCount).toBe(1);
    expect((await f.run('ls-files', '--unmerged')).length).toBeGreaterThan(0);
  });

  it('labels rebase sides in replay order instead of reversing ours and theirs', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', 'feature');
    expect(await startRebase(f)).toMatchObject({ status: 'failed', failureReason: 'conflict' });
    const state = await f.service.getConflicts(1, { id: f.id, path: f.path });
    expect(state).toMatchObject({
      operation: 'rebase',
      operationLabel: "Rebase conflict while replaying 'feature'",
      oursLabel: expect.stringContaining('Rebase base'),
      theirsLabel: 'Commit being replayed',
    });
    await abort(f);
  });

  it('retains conflict inspection across a fresh service and abort restores the original tree', async () => {
    const f = await fixture();
    await startMerge(f);
    const beforeRestart = await f.service.getConflicts(1, { id: f.id, path: f.path });
    expect(beforeRestart.conflictedCount).toBe(1);
    f.service.dispose();
    const reopened = new RepositoryService({ storagePath: join(f.root, 'reopened.json'), runner: f.git });
    services.push(reopened);
    await reopened.open(1, f.cwd);
    await reopened.setTrust(1, f.id, true);
    expect((await reopened.getConflicts(1, { id: f.id, path: f.path })).conflictedCount).toBe(1);
    expect(await abort({ ...f, service: reopened })).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.before);
    expect(await readFile(join(f.cwd, f.path), 'utf8')).toBe('header\nmain value\nfooter\n');
    expect((await reopened.getConflicts(1, { id: f.id })).conflictedCount).toBe(0);
  });

  it('does not turn a cancelled merge into a successful resolution state', async () => {
    const f = await fixture();
    const originalRun = f.git.run.bind(f.git);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new RepositoryService({
      storagePath: join(f.root, 'cancel.json'),
      runner: {
        executable: f.git.executable,
        version: () => f.git.version(),
        run: async (args, options) => {
          if (args[0] === 'merge') {
            entered();
            await gate;
          }
          return originalRun(args, options);
        },
      },
    });
    services.push(service);
    await service.open(1, f.cwd);
    await service.setTrust(1, f.id, true);
    const action: RepositoryMergeRebaseAction = {
      kind: 'merge',
      mode: 'default',
      sourceFullName: 'refs/heads/feature',
      autostash: false,
      snapshot: (await service.getReferenceContext(1, f.id)).snapshot,
      changesSnapshot: (await service.previewLocalChanges(1, f.id)).snapshot,
    };
    const accepted = service.startMergeRebase(1, { id: f.id, action });
    await started;
    service.cancelOperation(1, accepted.id);
    release();
    const finished = await terminal(service, accepted);
    expect(finished.status).toBe('cancelled');
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.before);
  });
});
