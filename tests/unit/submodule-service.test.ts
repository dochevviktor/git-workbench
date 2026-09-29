import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner, GitCancelledError } from '../../src/backend/git/runner';
import {
  applySubmoduleAction,
  readSubmoduleContext,
  readSubmoduleComparison,
} from '../../src/backend/repositories/submodule-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'b'.repeat(64)}`;

async function initRepository(git: GitRunner, path: string, file: string, content: string): Promise<string> {
  await mkdir(path, { recursive: true });
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: path });
  await git.run(['config', 'user.name', 'Submodule Author'], { cwd: path });
  await git.run(['config', 'user.email', 'submodule@example.test'], { cwd: path });
  await git.run(['config', 'protocol.file.allow', 'always'], { cwd: path });
  await writeFile(join(path, file), content, 'utf8');
  await git.run(['add', '--', file], { cwd: path });
  await git.run(['commit', '--quiet', '-m', 'baseline'], { cwd: path });
  return (await git.run(['rev-parse', 'HEAD'], { cwd: path })).stdout.trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-submodule-'));
  temporaryDirectories.push(root);
  const git = new GitRunner();
  const source = join(root, 'module-source');
  const parent = join(root, 'parent');
  const baseline = await initRepository(git, source, 'module.txt', 'baseline\n');
  await initRepository(git, parent, 'parent.txt', 'parent\n');
  await git.run(
    ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '--', source, 'modules/demo'],
    {
      cwd: parent,
    },
  );
  await git.run(['commit', '--quiet', '-m', 'add module'], { cwd: parent });
  return { root, git, source, parent, baseline };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('submodule service', () => {
  it('keeps ignored child files visible to removal review and rejects changed or unrelated child content', async () => {
    const f = await fixture();
    const child = join(f.parent, 'modules/demo');
    await writeFile(join(f.parent, '.git/modules/modules/demo/info/exclude'), 'cache/\n');
    await mkdir(join(child, 'cache'));
    await writeFile(join(child, 'cache/local.txt'), 'first\n');
    const before = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    expect(before.submodules[0]).toMatchObject({
      state: 'clean',
      dirtyFileCount: 0,
      ignoredPaths: ['cache'],
    });
    const action = { kind: 'remove' as const, submoduleId: before.submodules[0]!.id, force: false };
    expect(
      await applySubmoduleAction(f.git, { repositoryId, cwd: f.parent, action, snapshot: before.snapshot }),
    ).toMatchObject({ status: 'blocked', reason: 'dirty' });
    await writeFile(join(child, 'cache/local.txt'), 'newer\n');
    await expect(
      applySubmoduleAction(f.git, {
        repositoryId,
        cwd: f.parent,
        action: { ...action, force: true },
        snapshot: before.snapshot,
      }),
    ).rejects.toThrow('changed after it was read');
    const unrelated = join(child, 'independent');
    await initRepository(f.git, unrelated, 'precious.txt', 'preserve\n');
    const current = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    expect(
      await applySubmoduleAction(f.git, {
        repositoryId,
        cwd: f.parent,
        action: { ...action, force: true },
        snapshot: current.snapshot,
      }),
    ).toMatchObject({ status: 'blocked', reason: 'invalid-path' });
    expect(await readFile(join(unrelated, 'precious.txt'), 'utf8')).toBe('preserve\n');
  });
  it('does not discover the parent HEAD through an empty uninitialized child or a symbolic link', async () => {
    const f = await fixture();
    await f.git.run(['submodule', 'deinit', '--force', '--', 'modules/demo'], { cwd: f.parent });
    const empty = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    expect(empty.submodules[0]).toMatchObject({
      initialized: false,
      state: 'uninitialized',
      revisions: { working: null },
    });
    await rm(join(f.parent, 'modules/demo'), { recursive: true });
    await symlink(f.source, join(f.parent, 'modules/demo'));
    const linked = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    expect(linked.submodules[0]?.initialized).toBe(false);
    expect(
      await applySubmoduleAction(f.git, {
        repositoryId,
        cwd: f.parent,
        snapshot: linked.snapshot,
        action: { kind: 'remove', submoduleId: linked.submodules[0]!.id, force: true },
      }),
    ).toMatchObject({ status: 'blocked', reason: 'invalid-path' });
    expect(await readFile(join(f.source, 'module.txt'), 'utf8')).toBe('baseline\n');
  });

  it('recursively adds, inspects, synchronizes and removes nested gitlinks in their owning repository', async () => {
    const f = await fixture();
    const deep = join(f.root, 'deep');
    const baseline = await initRepository(f.git, deep, 'deep.txt', 'deep\n');
    const childPath = 'nested/space café (one)';
    await f.git.run(
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '--', deep, childPath],
      { cwd: f.source },
    );
    await f.git.run(['commit', '--quiet', '-am', 'nested child'], { cwd: f.source });
    const before = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    const added = await applySubmoduleAction(f.git, {
      repositoryId,
      cwd: f.parent,
      snapshot: before.snapshot,
      action: { kind: 'add', url: f.source, path: 'modules/tree', recursive: true },
    });
    expect(added.status).toBe('applied');
    const nested = added.context.submodules.find((item) => item.path === `modules/tree/${childPath}`)!;
    expect(nested).toMatchObject({
      ownerPath: 'modules/tree',
      relativePath: childPath,
      nested: true,
      state: 'detached',
      revisions: { head: baseline, index: baseline, working: baseline },
    });
    expect(await readFile(join(f.parent, nested.path, 'deep.txt'), 'utf8')).toBe('deep\n');
    const parentIndex = (await f.git.run(['ls-files', '--stage'], { cwd: f.parent })).stdout;
    const synced = await applySubmoduleAction(f.git, {
      repositoryId,
      cwd: f.parent,
      snapshot: added.context.snapshot,
      action: { kind: 'sync', submoduleId: nested.id, recursive: true },
    });
    expect(synced.status).toBe('applied');
    const removed = await applySubmoduleAction(f.git, {
      repositoryId,
      cwd: f.parent,
      snapshot: synced.context.snapshot,
      action: { kind: 'remove', submoduleId: nested.id, force: false },
    });
    expect(removed.status).toBe('applied');
    expect(removed.context.submodules.some((item) => item.id === nested.id)).toBe(false);
    expect((await f.git.run(['ls-files', '--stage'], { cwd: f.parent })).stdout).toBe(parentIndex);
    expect(await readFile(join(f.parent, 'modules/tree/.gitmodules'), 'utf8')).not.toContain(childPath);
    expect(await readFile(join(f.parent, 'parent.txt'), 'utf8')).toBe('parent\n');
  });

  it('fetches a missing recorded commit and compares staged and unstaged pointers independently', async () => {
    const f = await fixture();
    await gitCommit(f.git, f.source, 'module.txt', 'middle\n', 'Middle revision');
    const middle = (await f.git.run(['rev-parse', 'HEAD'], { cwd: f.source })).stdout.trim();
    await f.git.run(['update-index', '--cacheinfo', `160000,${middle},modules/demo`], { cwd: f.parent });
    let context = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    expect(context.submodules[0]?.state).toBe('missing-commit');
    const before = (await f.git.run(['ls-files', '--stage'], { cwd: f.parent })).stdout;
    const updated = await applySubmoduleAction(f.git, {
      repositoryId,
      cwd: f.parent,
      snapshot: context.snapshot,
      action: { kind: 'update', submoduleId: context.submodules[0]!.id, recursive: false },
    });
    expect(updated.status).toBe('applied');
    expect((await f.git.run(['ls-files', '--stage'], { cwd: f.parent })).stdout).toBe(before);
    await gitCommit(f.git, f.source, 'module.txt', 'latest\n', 'Latest revision');
    const latest = (await f.git.run(['rev-parse', 'HEAD'], { cwd: f.source })).stdout.trim();
    await f.git.run(['fetch', '--quiet'], { cwd: join(f.parent, 'modules/demo') });
    await f.git.run(['checkout', '--quiet', latest], { cwd: join(f.parent, 'modules/demo') });
    context = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    expect(await readSubmoduleComparison(f.git, f.parent, context.submodules[0]!, 'staged')).toMatchObject({
      before: f.baseline,
      after: middle,
      ahead: 1,
      behind: 0,
    });
    const unstaged = await readSubmoduleComparison(f.git, f.parent, context.submodules[0]!, 'unstaged');
    expect(unstaged).toMatchObject({ before: middle, after: latest, ahead: 1, behind: 0 });
    expect(unstaged.commits.map((commit) => commit.subject)).toEqual(['Latest revision', 'Middle revision']);
    const missingId = '1'.repeat(40);
    await f.git.run(['update-index', '--cacheinfo', `160000,${missingId},modules/demo`], { cwd: f.parent });
    context = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    const failed = await applySubmoduleAction(f.git, {
      repositoryId,
      cwd: f.parent,
      snapshot: context.snapshot,
      action: { kind: 'update', submoduleId: context.submodules[0]!.id, recursive: false },
    });
    expect(failed).toMatchObject({
      status: 'blocked',
      context: { submodules: [expect.objectContaining({ state: 'missing-commit' })] },
    });
    expect(await readFile(join(f.parent, 'modules/demo/module.txt'), 'utf8')).toBe('latest\n');
  });

  it('resumes an interrupted recursive initialization using native partial Git state', async () => {
    const f = await fixture();
    const deep = join(f.root, 'deep');
    await initRepository(f.git, deep, 'deep.txt', 'nested bytes\n');
    await f.git.run(['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', deep, 'nested'], {
      cwd: f.source,
    });
    await f.git.run(['commit', '--quiet', '-am', 'nested'], { cwd: f.source });
    const before = await readSubmoduleContext(f.git, { repositoryId, cwd: f.parent });
    const abort = new AbortController();
    await expect(
      applySubmoduleAction(
        {
          run: async (args, options) => {
            if (args.includes('update') && args.includes('--recursive')) {
              abort.abort();
              throw new GitCancelledError();
            }
            return f.git.run(args, options);
          },
        },
        {
          repositoryId,
          cwd: f.parent,
          snapshot: before.snapshot,
          signal: abort.signal,
          action: { kind: 'add', path: 'partial', url: f.source, recursive: true },
        },
      ),
    ).rejects.toBeInstanceOf(GitCancelledError);
    const partial = await readSubmoduleContext(new GitRunner(), { repositoryId, cwd: f.parent });
    expect(partial.submodules.find((item) => item.path === 'partial/nested')).toMatchObject({
      initialized: false,
      revisions: { working: null },
    });
    const resumed = await applySubmoduleAction(f.git, {
      repositoryId,
      cwd: f.parent,
      snapshot: partial.snapshot,
      action: {
        kind: 'update',
        submoduleId: partial.submodules.find((item) => item.path === 'partial')!.id,
        recursive: true,
      },
    });
    expect(resumed.status).toBe('applied');
    expect(await readFile(join(f.parent, 'partial/nested/deep.txt'), 'utf8')).toBe('nested bytes\n');
    expect(await readFile(join(f.parent, 'parent.txt'), 'utf8')).toBe('parent\n');
  });
  it('reads clean, dirty, and changed-child revision states without changing Git', async () => {
    const value = await fixture();
    const before = await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent });
    const clean = before.submodules.find((submodule) => submodule.path === 'modules/demo');
    expect(clean).toMatchObject({
      state: 'clean',
      initialized: true,
      parentStatus: 'clean',
      revisions: { head: value.baseline, index: value.baseline, working: value.baseline },
      url: value.source,
      nested: false,
      ownerPath: '',
      relativePath: 'modules/demo',
    });

    await writeFile(join(value.parent, 'modules/demo/module.txt'), 'dirty\n', 'utf8');
    const dirty = (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent })).submodules[0]!;
    expect(dirty).toMatchObject({ state: 'dirty', parentStatus: 'modified', dirtyFileCount: 1 });

    await value.git.run(['checkout', '--quiet', '--', 'module.txt'], {
      cwd: join(value.parent, 'modules/demo'),
    });
    await gitCommit(value.git, value.source, 'module.txt', 'advanced\n', 'advance module');
    await value.git.run(['-c', 'protocol.file.allow=always', 'fetch', '--quiet'], {
      cwd: join(value.parent, 'modules/demo'),
    });
    await value.git.run(['checkout', '--quiet', 'origin/main'], { cwd: join(value.parent, 'modules/demo') });
    const changed = (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent }))
      .submodules[0]!;
    expect(changed.state).toBe('changed');
    expect(changed.workingChanged).toBe(true);
    expect(changed.revisions.head).toBe(value.baseline);

    const updated = await applySubmoduleAction(value.git, {
      repositoryId,
      cwd: value.parent,
      action: { kind: 'update', submoduleId: changed.id, recursive: false },
      snapshot: (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent })).snapshot,
    });
    expect(updated).toMatchObject({ status: 'applied', context: { submodules: [{ state: 'detached' }] } });
    expect(
      (await value.git.run(['rev-parse', 'HEAD'], { cwd: join(value.parent, 'modules/demo') })).stdout.trim(),
    ).toBe(value.baseline);
  });

  it('reports an uninitialized child and updates it from its configured local source', async () => {
    const value = await fixture();
    await value.git.run(['submodule', 'deinit', '--force', '--', 'modules/demo'], { cwd: value.parent });
    await rm(join(value.parent, 'modules/demo'), { recursive: true, force: true });
    const missing = (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent }))
      .submodules[0]!;
    expect(missing).toMatchObject({
      state: 'missing',
      initialized: false,
      revisions: { index: value.baseline },
    });

    const result = await applySubmoduleAction(value.git, {
      repositoryId,
      cwd: value.parent,
      action: { kind: 'update', submoduleId: missing.id, recursive: false },
      snapshot: (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent })).snapshot,
    });
    expect(result).toMatchObject({ status: 'applied', context: { submodules: [{ state: 'detached' }] } });
  });

  it('blocks dirty removal until force is explicit, then removes only the selected path', async () => {
    const value = await fixture();
    await writeFile(join(value.parent, 'modules/demo/local.txt'), 'keep me\n', 'utf8');
    const current = await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent });
    const submodule = current.submodules[0]!;
    const blocked = await applySubmoduleAction(value.git, {
      repositoryId,
      cwd: value.parent,
      action: { kind: 'remove', submoduleId: submodule.id, force: false },
      snapshot: current.snapshot,
    });
    expect(blocked).toMatchObject({ status: 'blocked', reason: 'dirty', paths: ['modules/demo/local.txt'] });
    expect(await readFile(join(value.parent, 'parent.txt'), 'utf8')).toBe('parent\n');

    const forced = await applySubmoduleAction(value.git, {
      repositoryId,
      cwd: value.parent,
      action: { kind: 'remove', submoduleId: submodule.id, force: true },
      snapshot: (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent })).snapshot,
    });
    expect(forced).toMatchObject({ status: 'applied', context: { submodules: [] } });
    expect(await readFile(join(value.parent, 'parent.txt'), 'utf8')).toBe('parent\n');
    expect(await readFile(join(value.parent, '.gitmodules'), 'utf8')).not.toContain('modules/demo');

    const added = await applySubmoduleAction(value.git, {
      repositoryId,
      cwd: value.parent,
      action: { kind: 'add', url: value.source, path: 'modules/other', recursive: false },
      snapshot: (await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent })).snapshot,
    });
    expect(added).toMatchObject({
      status: 'applied',
      context: { submodules: [expect.objectContaining({ path: 'modules/other' })] },
    });
  });
});

async function gitCommit(
  git: GitRunner,
  cwd: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(join(cwd, file), content, 'utf8');
  await git.run(['add', '--', file], { cwd });
  await git.run(['commit', '--quiet', '-m', message], { cwd });
}
