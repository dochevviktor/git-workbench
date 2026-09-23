import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
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
  previewDiscard,
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
  it('unstages only text in a staged rename with CRLF and a missing final newline', async () => {
    const { root, git } = await fixtureRepository();
    await git.run(['config', 'core.autocrlf', 'false'], { cwd: root });
    const base = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\r\n');
    await commit(git, root, 'old name.txt', base);
    await git.run(['mv', '--', 'old name.txt', 'new name.txt'], { cwd: root });
    const changed = base.replace('line 3\r\n', 'changed 3\r\n');
    await writeFile(join(root, 'new name.txt'), changed);
    await git.run(['add', '--', 'new name.txt'], { cwd: root });
    const target = {
      kind: 'working' as const,
      area: 'staged' as const,
      path: 'new name.txt',
      previousPath: 'old name.txt',
    };
    const diff = await readRepositoryDiff(git, { repositoryId, cwd: root, target, whitespace: 'normal' });
    await apply(git, root, 'unstage', target, diff.snapshot!, { kind: 'hunk', hunk: 0 });
    expect((await git.run(['show', ':new name.txt'], { cwd: root })).stdout).toBe(base);
    expect((await git.run(['diff', '--cached', '--name-status'], { cwd: root })).stdout).toContain(
      'R100\told name.txt\tnew name.txt',
    );
    expect(await readFile(join(root, 'new name.txt'), 'utf8')).toBe(changed);
  });

  it('discards only selected deleted lines by restoring that subset with an exact preview', async () => {
    const { root, git } = await fixtureRepository();
    await commit(git, root, 'file.txt', 'one\ntwo\nthree\n');
    await unlink(join(root, 'file.txt'));
    const { diff, target } = await diffFor(git, root, 'unstaged');
    const selection = { kind: 'lines' as const, hunk: 0, lineIndexes: [1] };
    const preview = await previewDiscard(git, { repositoryId, cwd: root, targets: [target], selection });
    expect(preview.files[0]!.content).toContain('-two\n');
    await apply(git, root, 'discard', target, diff.snapshot!, selection);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('two\n');
    expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe('one\ntwo\nthree\n');
  });

  it('unstages selected lines of a new file while keeping its other staged lines', async () => {
    const { root, git } = await fixtureRepository();
    await commit(git, root, 'base.txt', 'base\n');
    await writeFile(join(root, 'file.txt'), 'one\ntwo\nthree\n');
    await git.run(['add', '--', 'file.txt'], { cwd: root });
    const { diff, target } = await diffFor(git, root, 'staged');
    await apply(git, root, 'unstage', target, diff.snapshot!, { kind: 'lines', hunk: 0, lineIndexes: [1] });
    expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe('one\nthree\n');
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('partially stages text without staging an unrelated executable-bit change', async () => {
    const { root, git } = await fixtureRepository();
    await git.run(['config', 'core.filemode', 'true'], { cwd: root });
    await commit(git, root, 'file.txt', 'one\ntwo\nthree\n');
    await writeFile(join(root, 'file.txt'), 'one\nTWO\nthree\n');
    await chmod(join(root, 'file.txt'), 0o755);
    const { diff, target } = await diffFor(git, root, 'unstaged');
    await apply(git, root, 'stage', target, diff.snapshot!, { kind: 'hunk', hunk: 0 });
    expect((await git.run(['ls-files', '--stage', 'file.txt'], { cwd: root })).stdout).toMatch(/^100644 /u);
    expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe('one\nTWO\nthree\n');
  });

  it.each(['stage', 'discard'] as const)(
    '%s preserves a staged rename and an unrelated file recreated at its old path',
    async (action) => {
      const { root, git } = await fixtureRepository();
      await commit(git, root, 'old.txt', 'rename baseline\n');
      await git.run(['mv', '--', 'old.txt', 'new.txt'], { cwd: root });
      await writeFile(join(root, 'new.txt'), 'rename baseline\nedit\n');
      // Reusing the source name must never stage or discard this unrelated untracked file.
      await writeFile(join(root, 'old.txt'), 'unrelated new work\n');
      const target = { area: 'unstaged' as const, path: 'new.txt', previousPath: 'old.txt' };
      const snapshot =
        action === 'discard'
          ? (await previewDiscard(git, { repositoryId, cwd: root, targets: [target] })).snapshot
          : null;
      await applyWorkingChange(git, {
        repositoryId,
        cwd: root,
        action,
        targets: [target],
        snapshot,
        selection: { kind: 'file' },
      });
      expect(await readFile(join(root, 'old.txt'), 'utf8')).toBe('unrelated new work\n');
      expect((await git.run(['ls-files', '--', 'old.txt'], { cwd: root })).stdout).toBe('');
      expect((await git.run(['show', ':new.txt'], { cwd: root })).stdout).toBe(
        action === 'stage' ? 'rename baseline\nedit\n' : 'rename baseline\n',
      );
      expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe(
        action === 'stage' ? 'rename baseline\nedit\n' : 'rename baseline\n',
      );
    },
  );

  it.each(['unstage', 'discard'] as const)(
    '%s selects either side of a replacement without absorbing its unselected partner',
    async (action) => {
      const { root, git } = await fixtureRepository();
      const base = 'start\none\ntwo\nend\n';
      const changed = 'start\nONE\nTWO\nend\n';
      await commit(git, root, 'file.txt', base);
      await writeFile(join(root, 'file.txt'), changed);
      if (action === 'unstage') await git.run(['add', '--', 'file.txt'], { cwd: root });
      const initialHead = (await git.run(['rev-parse', 'HEAD'], { cwd: root })).stdout;
      const first = await diffFor(git, root, action === 'unstage' ? 'staged' : 'unstaged');
      const lines = parseUnifiedDiff(first.diff.content).hunks[0]!.lines;
      const selection = {
        kind: 'lines' as const,
        hunk: 0,
        lineIndexes: [lines.findIndex((line) => line.kind === 'add' && line.text === 'ONE')],
      };
      if (action === 'discard') {
        const preview = await previewDiscard(git, {
          repositoryId,
          cwd: root,
          targets: [first.target],
          selection,
        });
        expect(preview.files[0]!.content).not.toContain('-one\n');
        expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe(changed);
      }
      await apply(git, root, action, first.target, first.diff.snapshot!, selection);
      const readResult = async () =>
        action === 'unstage'
          ? (await git.run(['show', ':file.txt'], { cwd: root })).stdout
          : readFile(join(root, 'file.txt'), 'utf8');
      expect(await readResult()).toBe('start\nTWO\nend\n');
      const second = await diffFor(git, root, action === 'unstage' ? 'staged' : 'unstaged');
      const remaining = parseUnifiedDiff(second.diff.content).hunks[0]!.lines;
      await apply(git, root, action, second.target, second.diff.snapshot!, {
        kind: 'lines',
        hunk: 0,
        lineIndexes: [remaining.findIndex((line) => line.kind === 'remove' && line.text === 'one')],
      });
      expect(await readResult()).toBe('start\none\nTWO\nend\n');
      expect((await git.run(['rev-parse', 'HEAD'], { cwd: root })).stdout).toBe(initialHead);
      if (action === 'unstage') expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe(changed);
      else expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe(base);
    },
  );

  it('previews multi-file discard without mutation, rejects stale bytes, and retains a recoverable copy', async () => {
    const { root, git } = await fixtureRepository();
    await git.run(['config', 'user.name', 'Discard Author'], { cwd: root });
    await git.run(['config', 'user.email', 'discard@example.test'], { cwd: root });
    await commit(git, root, 'file.txt', 'base\n');
    await commit(git, root, 'other.txt', 'other base\n');
    await commit(git, root, 'untouched.txt', 'untouched base\n');
    await writeFile(join(root, 'file.txt'), 'staged\n');
    await git.run(['add', '--', 'file.txt'], { cwd: root });
    await writeFile(join(root, 'file.txt'), 'discard one\n');
    await writeFile(join(root, 'other.txt'), 'discard two\n');
    await writeFile(join(root, 'untouched.txt'), 'keep this work\n');
    await writeFile(join(root, 'untracked.txt'), 'keep untracked\n');
    const targets = ['file.txt', 'other.txt'].map((path) => ({
      area: 'unstaged' as const,
      path,
      previousPath: null,
    }));
    const before = await git.run(['diff', '--binary'], { cwd: root });
    const index = await git.run(['ls-files', '--stage'], { cwd: root });
    const head = await git.run(['rev-parse', 'HEAD'], { cwd: root });
    const preview = await previewDiscard(git, { repositoryId, cwd: root, targets });
    expect(preview.files.map((file) => file.target.path)).toEqual(['file.txt', 'other.txt']);
    expect((await git.run(['diff', '--binary'], { cwd: root })).stdout).toBe(before.stdout);
    expect((await git.run(['ls-files', '--stage'], { cwd: root })).stdout).toBe(index.stdout);
    await expect(readFile(join(root, '.git', 'git-workbench-recovery.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await writeFile(join(root, 'other.txt'), 'new external edit\n');
    await expect(
      applyWorkingChange(git, {
        repositoryId,
        cwd: root,
        targets,
        action: 'discard',
        selection: { kind: 'file' },
        snapshot: preview.snapshot,
      }),
    ).rejects.toBeInstanceOf(StaleWorkingSnapshotError);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('discard one\n');
    const fresh = await previewDiscard(git, { repositoryId, cwd: root, targets });
    await applyWorkingChange(git, {
      repositoryId,
      cwd: root,
      targets,
      action: 'discard',
      selection: { kind: 'file' },
      snapshot: fresh.snapshot,
    });
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('staged\n');
    expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe('other base\n');
    expect(await readFile(join(root, 'untouched.txt'), 'utf8')).toBe('keep this work\n');
    expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('keep untracked\n');
    expect((await git.run(['ls-files', '--stage'], { cwd: root })).stdout).toBe(index.stdout);
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: root })).stdout).toBe(head.stdout);
    const recovery = JSON.parse(
      await readFile(join(root, '.git', 'git-workbench-recovery.json'), 'utf8'),
    ) as { copies: { id: string; commitId: string }[] };
    const copy = recovery.copies[0]!;
    expect((await git.run(['show', `${copy.commitId}:file.txt`], { cwd: root })).stdout).toBe(
      'discard one\n',
    );
    expect((await git.run(['show', `${copy.commitId}^2:file.txt`], { cwd: root })).stdout).toBe('staged\n');
    expect(
      (await git.run(['rev-parse', `refs/git-workbench/recovery/${copy.id}`], { cwd: root })).stdout.trim(),
    ).toBe(copy.commitId);
  });

  it('uses the displayed whole-file context coordinates for insertion-only staging', async () => {
    const { root, git } = await fixtureRepository();
    const base = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    await commit(git, root, 'file.txt', base);
    const changed = base.replace('line 40\n', 'changed 40\n');
    await writeFile(join(root, 'file.txt'), changed);
    const target = {
      kind: 'working' as const,
      area: 'unstaged' as const,
      path: 'file.txt',
      previousPath: null,
    };
    const diff = await readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { entireFile: true },
    });
    const hunk = parseUnifiedDiff(diff.content).hunks[0]!;
    const insertion = hunk.lines.findIndex((line) => line.kind === 'add');
    expect(insertion).toBeGreaterThan(30);
    await apply(git, root, 'stage', target, diff.snapshot!, {
      kind: 'lines',
      hunk: 0,
      lineIndexes: [insertion],
      entireFile: true,
      contextLines: 3,
    });
    expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe(
      base.replace('line 40\n', 'line 40\nchanged 40\n'),
    );
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe(changed);
  });

  it('stages a hunk displayed with zero context without absorbing other changes', async () => {
    const { root, git } = await fixtureRepository();
    const base = 'first\nsecond\nthird\nfourth\nfifth\n';
    await commit(git, root, 'file.txt', base);
    await writeFile(join(root, 'file.txt'), base.replace('second', 'SECOND').replace('fifth', 'FIFTH'));
    const target = {
      kind: 'working' as const,
      area: 'unstaged' as const,
      path: 'file.txt',
      previousPath: null,
    };
    const diff = await readRepositoryDiff(git, {
      repositoryId,
      cwd: root,
      target,
      whitespace: 'normal',
      options: { contextLines: 0 },
    });
    await apply(git, root, 'stage', target, diff.snapshot!, { kind: 'hunk', hunk: 0, contextLines: 0 });
    expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe(
      base.replace('second', 'SECOND'),
    );
  });

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
    // P0-022: insertion-only selection leaves the old line in the intermediate index blob.
    expect((await git.run(['show', ':file.txt'], { cwd: root })).stdout).toBe(
      base.replace('line-2\n', 'line-2\nchanged-2\n'),
    );

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
    expect((await git.run(['diff', '--exit-code'], { cwd: root })).stdout).toBe('');
    const stagedTree = (await git.run(['write-tree'], { cwd: root })).stdout;
    await git.run([...author, 'commit', '--quiet', '-m', 'Record all file types'], { cwd: root });
    expect((await git.run(['rev-parse', 'HEAD^{tree}'], { cwd: root })).stdout).toBe(stagedTree);
    // Re-create the staged set against its parent without changing any working bytes.
    await git.run(['reset', '--soft', 'HEAD^'], { cwd: root });
    const current = await readWorkingChanges(git, {
      repositoryId: repositoryIdForFixture,
      cwd: root,
      includeUntracked: true,
      includeIgnored: false,
    });
    await applyWorkingChange(git, {
      repositoryId: repositoryIdForFixture,
      cwd: root,
      action: 'unstage',
      targets: current.staged.map(({ area, path, previousPath }) => ({ area, path, previousPath })),
      snapshot: null,
      selection: { kind: 'file' },
    });
    expect((await git.run(['write-tree'], { cwd: root })).stdout).toBe(
      (await git.run(['rev-parse', 'HEAD^{tree}'], { cwd: root })).stdout,
    );
    expect(await readFile(join(root, 'new name.txt'), 'utf8')).toBe('rename me\n');
    expect(await readlink(join(root, 'link.txt'))).toBe('link-target-two.txt');
    expect(await readFile(join(root, 'binary.bin'))).toEqual(Buffer.from([0, 1, 2, 9]));
    await expect(lstat(join(root, 'delete.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (process.platform !== 'win32') expect((await lstat(join(root, 'mode.txt'))).mode & 0o111).toBe(0o111);
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
