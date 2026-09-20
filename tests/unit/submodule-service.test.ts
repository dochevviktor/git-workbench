import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { applySubmoduleAction, readSubmoduleContext } from '../../src/backend/repositories/submodule-service';

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
  it('reads clean, dirty, and changed-child revision states without changing Git', async () => {
    const value = await fixture();
    const before = await readSubmoduleContext(value.git, { repositoryId, cwd: value.parent });
    const clean = before.submodules.find((submodule) => submodule.path === 'modules/demo');
    expect(clean).toMatchObject({
      state: 'clean',
      initialized: true,
      parentStatus: 'clean',
      revisions: { head: value.baseline, index: value.baseline, working: value.baseline },
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
