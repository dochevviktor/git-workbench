import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import type {
  RepositoryDiffTarget,
  RepositoryWorkingChangeAction,
  RepositoryWorkingChangeSelection,
} from '../../src/common/ipc/contracts';
import {
  applyWorkingChange,
  StaleWorkingSnapshotError,
} from '../../src/backend/repositories/staging-service';
import { readRepositoryDiff } from '../../src/backend/repositories/diff-service';
import { parseUnifiedDiff } from '../../src/frontend/react/lib/diff';
import { readWorkingChanges } from '../../src/backend/repositories/working-tree-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'c'.repeat(64)}`;
const author = ['-c', 'user.name=Staging Author', '-c', 'user.email=staging@example.test'];

async function fixtureRepository(): Promise<{ readonly root: string; readonly git: GitRunner }> {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-staging-'));
  temporaryDirectories.push(root);
  const repository = join(root, 'repository');
  await mkdir(repository);
  const git = new GitRunner();
  await git.run(['init', '--quiet'], { cwd: repository });
  return { root: repository, git };
}

async function commit(git: GitRunner, repository: string, path: string, content: string): Promise<void> {
  await writeFile(join(repository, path), content, 'utf8');
  await git.run(['add', '--', path], { cwd: repository });
  await git.run([...author, 'commit', '--quiet', '-m', 'base'], { cwd: repository });
}

async function diffFor(git: GitRunner, repository: string, area: 'staged' | 'unstaged', path = 'file.txt') {
  const target: RepositoryDiffTarget = { kind: 'working', area, path, previousPath: null };
  const diff = await readRepositoryDiff(git, { repositoryId, cwd: repository, target, whitespace: 'normal' });
  if (!diff.snapshot) throw new Error('Expected a working-tree snapshot.');
  return { diff, target };
}

async function apply(
  git: GitRunner,
  repository: string,
  action: RepositoryWorkingChangeAction,
  target: Extract<RepositoryDiffTarget, { readonly kind: 'working' }>,
  snapshot: string,
  selection: RepositoryWorkingChangeSelection,
): Promise<void> {
  await applyWorkingChange(git, {
    repositoryId,
    cwd: repository,
    action,
    targets: [target],
    snapshot,
    selection,
  });
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('working-change staging service', () => {
  it('stages one hunk and leaves a distant hunk unstaged', async () => {
    const { root, git } = await fixtureRepository();
    const base = Array.from({ length: 16 }, (_, index) => `line-${index + 1}`).join('\n') + '\n';
    await commit(git, root, 'file.txt', base);
    const changed = base.replace('line-2', 'changed-2').replace('line-14', 'changed-14');
    await writeFile(join(root, 'file.txt'), changed, 'utf8');

    const { diff, target } = await diffFor(git, root, 'unstaged');
    expect(parseUnifiedDiff(diff.content).hunks).toHaveLength(2);
    await apply(git, root, 'stage', target, diff.snapshot!, { kind: 'hunk', hunk: 0 });

    const staged = await git.run(['diff', '--cached', '--', 'file.txt'], { cwd: root });
    const unstaged = await git.run(['diff', '--', 'file.txt'], { cwd: root });
    expect(staged.stdout).toContain('+changed-2');
    expect(staged.stdout).not.toContain('+changed-14');
    expect(unstaged.stdout).toContain('+changed-14');
    expect(unstaged.stdout).not.toContain('+changed-2');
  });

  it('reconstructs repeated line selections without absorbing the other change', async () => {
    const { root, git } = await fixtureRepository();
    const base = Array.from({ length: 16 }, (_, index) => `line-${index + 1}`).join('\n') + '\n';
    await commit(git, root, 'file.txt', base);
    const changed = base.replace('line-2', 'changed-2').replace('line-14', 'changed-14');
    await writeFile(join(root, 'file.txt'), changed, 'utf8');

    const first = await diffFor(git, root, 'unstaged');
    const firstDocument = parseUnifiedDiff(first.diff.content);
    const firstLine = firstDocument.hunks[0]?.lines.findIndex(
      (line) => line.kind === 'add' && line.text === 'changed-2',
    );
    expect(firstLine).toBeGreaterThanOrEqual(0);
    await apply(git, root, 'stage', first.target, first.diff.snapshot!, {
      kind: 'lines',
      hunk: 0,
      lineIndexes: [firstLine!],
    });

    const second = await diffFor(git, root, 'unstaged');
    const secondDocument = parseUnifiedDiff(second.diff.content);
    const firstRemoval = secondDocument.hunks[0]?.lines.findIndex(
      (line) => line.kind === 'remove' && line.text === 'line-2',
    );
    expect(firstRemoval).toBeGreaterThanOrEqual(0);
    await apply(git, root, 'stage', second.target, second.diff.snapshot!, {
      kind: 'lines',
      hunk: 0,
      lineIndexes: [firstRemoval!],
    });

    const third = await diffFor(git, root, 'unstaged');
    const thirdDocument = parseUnifiedDiff(third.diff.content);
    const secondRemoval = thirdDocument.hunks[0]?.lines.findIndex(
      (line) => line.kind === 'remove' && line.text === 'line-14',
    );
    const secondAddition = thirdDocument.hunks[0]?.lines.findIndex(
      (line) => line.kind === 'add' && line.text === 'changed-14',
    );
    expect(secondRemoval).toBeGreaterThanOrEqual(0);
    expect(secondAddition).toBeGreaterThanOrEqual(0);
    await apply(git, root, 'stage', third.target, third.diff.snapshot!, {
      kind: 'lines',
      hunk: 0,
      lineIndexes: [secondRemoval!, secondAddition!],
    });

    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe(changed);
    await expect(git.run(['diff', '--cached', '--exit-code'], { cwd: root })).rejects.toMatchObject({
      exitCode: 1,
    });
    await expect(git.run(['diff', '--exit-code'], { cwd: root })).resolves.toMatchObject({ stdout: '' });
  });

  it('keeps selected replacement lines in order when one diff group contains multiple pairs', async () => {
    const { root, git } = await fixtureRepository();
    const base = 'one\ntwo\nthree\nfour\n';
    await commit(git, root, 'file.txt', base);
    const changed = 'ONE\nTWO\nthree\nfour\n';
    await writeFile(join(root, 'file.txt'), changed, 'utf8');
    const { diff, target } = await diffFor(git, root, 'unstaged');
    const lines = parseUnifiedDiff(diff.content).hunks[0]?.lines ?? [];
    const removed = lines.findIndex((line) => line.kind === 'remove' && line.text === 'one');
    const added = lines.findIndex((line) => line.kind === 'add' && line.text === 'ONE');
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(added).toBeGreaterThanOrEqual(0);
    await apply(git, root, 'stage', target, diff.snapshot!, {
      kind: 'lines',
      hunk: 0,
      lineIndexes: [removed, added],
    });

    await expect(git.run(['show', ':file.txt'], { cwd: root })).resolves.toMatchObject({
      stdout: 'ONE\ntwo\nthree\nfour\n',
    });
    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe(changed);
  });

  it('partially stages a CRLF replacement and preserves a missing final newline', async () => {
    const { root, git } = await fixtureRepository();
    await git.run(['config', 'core.autocrlf', 'false'], { cwd: root });
    const base = 'one\r\ntwo\r\nthree\r\n';
    await commit(git, root, 'file.txt', base);
    const changed = 'one\r\nchanged\r\nthree';
    await writeFile(join(root, 'file.txt'), changed, 'utf8');
    const { diff, target } = await diffFor(git, root, 'unstaged');
    const lines = parseUnifiedDiff(diff.content).hunks[0]?.lines ?? [];
    const removed = lines.findIndex(
      (line) => line.kind === 'remove' && line.text.replace(/\r$/u, '') === 'two',
    );
    const added = lines.findIndex(
      (line) => line.kind === 'add' && line.text.replace(/\r$/u, '') === 'changed',
    );
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(added).toBeGreaterThanOrEqual(0);
    await apply(git, root, 'stage', target, diff.snapshot!, {
      kind: 'lines',
      hunk: 0,
      lineIndexes: [removed, added],
    });

    await expect(git.run(['show', ':file.txt'], { cwd: root })).resolves.toMatchObject({
      stdout: 'one\r\nchanged\r\nthree\r\n',
    });
    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe(changed);
  });

  it('rejects a stale file action before changing the index', async () => {
    const { root, git } = await fixtureRepository();
    await commit(git, root, 'file.txt', 'base\n');
    await writeFile(join(root, 'file.txt'), 'first edit\n', 'utf8');
    const { diff, target } = await diffFor(git, root, 'unstaged');
    await writeFile(join(root, 'file.txt'), 'external edit\n', 'utf8');

    await expect(apply(git, root, 'stage', target, diff.snapshot!, { kind: 'file' })).rejects.toBeInstanceOf(
      StaleWorkingSnapshotError,
    );
    await expect(git.run(['diff', '--cached', '--exit-code'], { cwd: root })).resolves.toMatchObject({
      stdout: '',
    });
    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe('external edit\n');
  });

  it('discards a selected hunk while preserving the other worktree hunk', async () => {
    const { root, git } = await fixtureRepository();
    const base = Array.from({ length: 16 }, (_, index) => `line-${index + 1}`).join('\n') + '\n';
    await commit(git, root, 'file.txt', base);
    const changed = base.replace('line-2', 'changed-2').replace('line-14', 'changed-14');
    await writeFile(join(root, 'file.txt'), changed, 'utf8');
    const { diff, target } = await diffFor(git, root, 'unstaged');

    await apply(git, root, 'discard', target, diff.snapshot!, { kind: 'hunk', hunk: 0 });
    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe(
      base.replace('line-14', 'changed-14'),
    );
    await expect(git.run(['diff', '--cached', '--exit-code'], { cwd: root })).resolves.toMatchObject({
      stdout: '',
    });
  });

  it('stages and unstages a complete CRLF file without changing its bytes', async () => {
    const { root, git } = await fixtureRepository();
    await git.run(['config', 'core.autocrlf', 'false'], { cwd: root });
    await commit(git, root, 'file.txt', 'one\ntwo\n');
    const content = 'one changed\r\ntwo\r\nthree';
    await writeFile(join(root, 'file.txt'), content, 'utf8');
    const stagedDiff = await diffFor(git, root, 'unstaged');
    await apply(git, root, 'stage', stagedDiff.target, stagedDiff.diff.snapshot!, { kind: 'file' });
    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe(content);
    await expect(git.run(['show', ':file.txt'], { cwd: root })).resolves.toMatchObject({ stdout: content });

    const staged = await diffFor(git, root, 'staged');
    await apply(git, root, 'unstage', staged.target, staged.diff.snapshot!, { kind: 'file' });
    await expect(readFile(join(root, 'file.txt'), 'utf8')).resolves.toBe(content);
    await expect(git.run(['diff', '--cached', '--exit-code'], { cwd: root })).resolves.toMatchObject({
      stdout: '',
    });
  });

  it('handles complete-file actions for rename, deletion, symlink, binary, and mode changes', async () => {
    const { root, git } = await fixtureRepository();
    await writeFile(join(root, 'old name.txt'), 'rename me\n', 'utf8');
    await writeFile(join(root, 'delete.txt'), 'delete me\n', 'utf8');
    await writeFile(join(root, 'mode.txt'), 'mode\n', 'utf8');
    await writeFile(join(root, 'link-target.txt'), 'target\n', 'utf8');
    await writeFile(join(root, 'link-target-two.txt'), 'target two\n', 'utf8');
    await symlink('link-target.txt', join(root, 'link.txt'));
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]), 'binary');
    await git.run(['add', '--', '.'], { cwd: root });
    await git.run([...author, 'commit', '--quiet', '-m', 'file action base'], { cwd: root });

    await rename(join(root, 'old name.txt'), join(root, 'new name.txt'));
    await unlink(join(root, 'delete.txt'));
    if (process.platform !== 'win32') await chmod(join(root, 'mode.txt'), 0o755);
    await unlink(join(root, 'link.txt'));
    await symlink('link-target-two.txt', join(root, 'link.txt'));
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 9]), 'binary');

    const repositoryIdForFixture = `repo-${'d'.repeat(64)}`;
    const changes = await readWorkingChanges(git, {
      repositoryId: repositoryIdForFixture,
      cwd: root,
      includeUntracked: true,
      includeIgnored: true,
    });
    const targets = [...changes.unstaged, ...changes.untracked].map((change) => ({
      area: change.area,
      path: change.path,
      previousPath: change.previousPath,
    }));
    expect(targets.map((target) => target.path)).toEqual(
      expect.arrayContaining(['new name.txt', 'delete.txt', 'mode.txt', 'link.txt', 'binary.bin']),
    );
    for (const target of targets) {
      const current = await readRepositoryDiff(git, {
        repositoryId: repositoryIdForFixture,
        cwd: root,
        target: { kind: 'working', ...target },
        whitespace: 'normal',
      });
      if (!current.snapshot) throw new Error('Expected a working-tree snapshot.');
      await applyWorkingChange(git, {
        repositoryId: repositoryIdForFixture,
        cwd: root,
        action: 'stage',
        targets: [target],
        snapshot: current.snapshot,
        selection: { kind: 'file' },
      });
    }

    const stagedNames = (await git.run(['diff', '--cached', '--name-status'], { cwd: root })).stdout;
    expect(stagedNames).toContain('new name.txt');
    expect(stagedNames).toContain('delete.txt');
    expect(stagedNames).toContain('binary.bin');
    if (process.platform !== 'win32') expect(stagedNames).toContain('mode.txt');
  });

  it('stages several selected files in one action and leaves the rest alone', async () => {
    const { root, git } = await fixtureRepository();
    await commit(git, root, 'file.txt', 'base\n');
    for (const name of ['first.txt', 'second.txt', 'third.txt']) {
      await writeFile(join(root, name), `${name}\n`, 'utf8');
    }
    await writeFile(join(root, 'file.txt'), 'changed\n', 'utf8');

    const commands: string[][] = [];
    const recording = {
      run: (args: readonly string[], options: Parameters<GitRunner['run']>[1]) => {
        commands.push([...args]);
        return git.run(args, options);
      },
    };
    await applyWorkingChange(recording, {
      repositoryId,
      cwd: root,
      action: 'stage',
      targets: [
        { area: 'untracked', path: 'first.txt', previousPath: null },
        { area: 'untracked', path: 'third.txt', previousPath: null },
      ],
      snapshot: null,
      selection: { kind: 'file' },
    });

    const staged = (await git.run(['diff', '--cached', '--name-only'], { cwd: root })).stdout;
    expect(staged.split('\n').filter(Boolean)).toEqual(['first.txt', 'third.txt']);
    // One `git add` for the whole selection, not one Git invocation per file.
    expect(commands.filter((command) => command[0] === 'add')).toEqual([
      ['add', '--', 'first.txt', 'third.txt'],
    ]);
  });

  it('unstages several files in one action', async () => {
    const { root, git } = await fixtureRepository();
    await commit(git, root, 'file.txt', 'base\n');
    for (const name of ['first.txt', 'second.txt']) {
      await writeFile(join(root, name), `${name}\n`, 'utf8');
      await git.run(['add', '--', name], { cwd: root });
    }

    await applyWorkingChange(git, {
      repositoryId,
      cwd: root,
      action: 'unstage',
      targets: [
        { area: 'staged', path: 'first.txt', previousPath: null },
        { area: 'staged', path: 'second.txt', previousPath: null },
      ],
      snapshot: null,
      selection: { kind: 'file' },
    });

    await expect(git.run(['diff', '--cached', '--name-only'], { cwd: root })).resolves.toMatchObject({
      stdout: '',
    });
    await expect(readFile(join(root, 'first.txt'), 'utf8')).resolves.toBe('first.txt\n');
  });

  it('refuses a selection that no longer matches the working tree', async () => {
    const { root, git } = await fixtureRepository();
    await commit(git, root, 'file.txt', 'base\n');
    await writeFile(join(root, 'present.txt'), 'present\n', 'utf8');

    await expect(
      applyWorkingChange(git, {
        repositoryId,
        cwd: root,
        action: 'stage',
        targets: [
          { area: 'untracked', path: 'present.txt', previousPath: null },
          { area: 'untracked', path: 'vanished.txt', previousPath: null },
        ],
        snapshot: null,
        selection: { kind: 'file' },
      }),
    ).rejects.toThrow(/vanished\.txt/u);
    await expect(git.run(['diff', '--cached', '--name-only'], { cwd: root })).resolves.toMatchObject({
      stdout: '',
    });
  });

  it('unstages a file in an unborn repository without deleting the worktree file', async () => {
    const { root, git } = await fixtureRepository();
    const content = 'still here\n';
    await writeFile(join(root, 'new.txt'), content, 'utf8');
    await git.run(['add', '--', 'new.txt'], { cwd: root });
    const repositoryIdForFixture = `repo-${'e'.repeat(64)}`;
    const staged = await readRepositoryDiff(git, {
      repositoryId: repositoryIdForFixture,
      cwd: root,
      target: { kind: 'working', area: 'staged', path: 'new.txt', previousPath: null },
      whitespace: 'normal',
    });
    if (!staged.snapshot) throw new Error('Expected a working-tree snapshot.');
    await applyWorkingChange(git, {
      repositoryId: repositoryIdForFixture,
      cwd: root,
      action: 'unstage',
      targets: [{ area: 'staged', path: 'new.txt', previousPath: null }],
      snapshot: staged.snapshot,
      selection: { kind: 'file' },
    });

    await expect(readFile(join(root, 'new.txt'), 'utf8')).resolves.toBe(content);
    await expect(git.run(['diff', '--cached', '--name-only'], { cwd: root })).resolves.toMatchObject({
      stdout: '',
    });
  });
});
