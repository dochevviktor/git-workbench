import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCancelledError, GitRunner } from '../../src/backend/git/runner';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import type { RepositoryOperation, RepositoryWorkingChangeTarget } from '../../src/common/ipc/contracts';
import {
  chooseConflictRegion,
  conflictTextRegions,
  hasConflictMarkers,
} from '../../src/common/conflict-text';

const roots: string[] = [];
const services: RepositoryService[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p06-'));
  roots.push(root);
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  const file = (path: string, content: string | Buffer) => writeFile(join(cwd, path), content);
  await run('init', '--quiet', '--initial-branch=main');
  await run('config', 'user.name', 'P06 Fixture');
  await run('config', 'user.email', 'p06@example.test');
  await run('config', 'commit.gpgsign', 'false');
  await file('value.txt', 'base\n');
  await file('unrelated.txt', 'original\n');
  await run('add', '--all');
  await run('commit', '--quiet', '-m', 'Base');
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner: git });
  services.push(service);
  const { id } = await service.open(1, cwd);
  await service.setTrust(1, id, true);
  return { root, cwd, git, run, file, service, id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function done(
  service: RepositoryService,
  operation: RepositoryOperation,
): Promise<RepositoryOperation> {
  const current = service.listOperations(1).find((entry) => entry.id === operation.id);
  if (current && current.status !== 'running') return current;
  return new Promise((resolve) => {
    const off = service.subscribeOperations((_owner, next) => {
      if (next.id === operation.id && next.status !== 'running') {
        off();
        resolve(next);
      }
    });
  });
}
async function reopen(f: Fixture) {
  f.service.dispose();
  const service = new RepositoryService({ storagePath: join(f.root, 'recent.json'), runner: f.git });
  services.push(service);
  await service.open(1, f.cwd);
  return { ...f, service };
}
async function recover(f: Fixture, action: 'abort' | 'continue' | 'skip') {
  return done(
    f.service,
    f.service.startRecovery(1, {
      id: f.id,
      action,
      snapshot: (await f.service.getRecovery(1, f.id)).snapshot,
    }),
  );
}
async function conflict(f: Fixture, kind: 'text' | 'binary' | 'delete' | 'add' | 'rename' = 'text') {
  if (kind === 'binary') {
    await f.file('value.txt', Buffer.from([0, 1]));
    await f.run('commit', '--quiet', '-am', 'Binary base');
  }
  await f.run('checkout', '--quiet', '-b', 'feature');
  if (kind === 'delete') await f.run('rm', 'value.txt');
  else if (kind === 'rename') await f.run('mv', 'value.txt', 'feature-name.txt');
  else
    await f.file(
      kind === 'add' ? 'added.txt' : 'value.txt',
      kind === 'binary' ? Buffer.from([0, 2]) : 'feature\n',
    );
  await f.run('add', '--all');
  await f.run('commit', '--quiet', '-m', 'Feature');
  const source = await f.run('rev-parse', 'HEAD');
  await f.run('checkout', '--quiet', 'main');
  if (kind === 'rename') await f.run('mv', 'value.txt', 'main-name.txt');
  else
    await f.file(
      kind === 'add' ? 'added.txt' : 'value.txt',
      kind === 'binary' ? Buffer.from([0, 3]) : 'main\n',
    );
  await f.run('add', '--all');
  await f.run('commit', '--quiet', '-m', 'Main');
  const head = await f.run('rev-parse', 'HEAD');
  await f.run('merge', '--no-edit', 'feature').catch(() => undefined);
  return { source, head };
}
afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('P06 complete operation states', () => {
  it('resolves nested rename/rename entries after the old directory has disappeared', async () => {
    let f = await fixture();
    await mkdir(join(f.cwd, 'old'));
    await f.run('mv', 'value.txt', 'old/value.txt');
    await f.run('commit', '--quiet', '-am', 'Nested base');
    await f.run('checkout', '--quiet', '-b', 'feature');
    await mkdir(join(f.cwd, 'feature-dir'));
    await f.run('mv', 'old/value.txt', 'feature-dir/value.txt');
    await f.run('commit', '--quiet', '-am', 'Feature rename');
    await f.run('checkout', '--quiet', 'main');
    await mkdir(join(f.cwd, 'main-dir'));
    await f.run('mv', 'old/value.txt', 'main-dir/value.txt');
    await f.run('commit', '--quiet', '-am', 'Main rename');
    await f.run('merge', '--no-edit', 'feature').catch(() => undefined);
    await rm(join(f.cwd, 'old'), { recursive: true, force: true });
    f = await reopen(f);
    let state = await f.service.getConflicts(1, { id: f.id });
    expect(state.files.some((entry) => entry.path === 'old/value.txt')).toBe(true);
    while (state.selected)
      state = await f.service.resolveConflict(
        { id: f.id, path: state.selected.path, snapshot: state.snapshot, choice: 'theirs' },
        1,
      );
    expect(await recover(f, 'continue')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).toBe('feature-dir/value.txt\nunrelated.txt');
    expect(await f.run('status', '--porcelain')).toBe('');
  });

  it('preserves raw symbolic-link target bytes when selecting a conflict source', async () => {
    const f = await fixture();
    const versions = [Buffer.from('base'), Buffer.from([0x61, 0xff]), Buffer.from([0x62, 0xfe])];
    const ids = [];
    for (const bytes of versions)
      ids.push(
        (await f.git.run(['hash-object', '-w', '--stdin'], { cwd: f.cwd, stdin: bytes })).stdout.trim(),
      );
    await f.git.run(['update-index', '-z', '--index-info'], {
      cwd: f.cwd,
      stdin: ids.map((id, index) => `120000 ${id} ${index + 1}\tlink\0`).join(''),
    });
    await symlink(versions[1]!, join(f.cwd, 'link'));
    const state = await f.service.getConflicts(1, { id: f.id, path: 'link' });
    expect(state.selected?.shape).toBe('symlink');
    await f.service.resolveConflict(
      { id: f.id, path: 'link', snapshot: state.snapshot, choice: 'theirs' },
      1,
    );
    expect(await readlink(join(f.cwd, 'link'), { encoding: 'buffer' })).toEqual(versions[2]);
    expect(await f.run('ls-files', '--stage', 'link')).toContain(`120000 ${ids[2]} 0`);
  });
  it('refuses an unborn stash before Stage new files can alter the index', async () => {
    const f = await fixture();
    await f.run('checkout', '--orphan', 'unborn');
    await f.run('rm', '--cached', '-r', '.');
    const status = await f.run('status', '--porcelain');
    const result = await done(
      f.service,
      f.service.startStashOperation(1, {
        id: f.id,
        request: { kind: 'save', message: '', stageNewFiles: true, includeUntracked: false, paths: [] },
      }),
    );
    expect(result).toMatchObject({
      status: 'failed',
      message: 'Create the first commit before saving a stash.',
    });
    expect(await f.run('status', '--porcelain')).toBe(status);
    expect(await f.run('ls-files')).toBe('');
  });
  it.each(['binary', 'delete', 'add', 'rename'] as const)(
    'aborts an external %s merge after reopening and retains unrelated edits',
    async (kind) => {
      let f = await fixture();
      const { head } = await conflict(f, kind);
      await f.file('unrelated.txt', 'keep this edit\n');
      await f.file('note.txt', 'keep this untracked file\n');
      f = await reopen(f);
      expect(await recover(f, 'abort')).toMatchObject({ status: 'succeeded' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(head);
      expect(await f.run('diff', '--cached')).toBe('');
      expect(await f.run('ls-files', '--unmerged')).toBe('');
      expect(await readFile(join(f.cwd, 'unrelated.txt'), 'utf8')).toBe('keep this edit\n');
      expect(await readFile(join(f.cwd, 'note.txt'), 'utf8')).toBe('keep this untracked file\n');
    },
  );
  it.each(['binary', 'delete', 'add', 'rename'] as const)(
    'resolves %s conflicts after restart without touching unrelated changes',
    async (kind) => {
      let f = await fixture();
      const { head, source } = await conflict(f, kind);
      await f.file('unrelated.txt', 'keep unstaged\n');
      await f.file('note.txt', 'keep untracked\n');
      f = await reopen(f);
      let state = await f.service.getConflicts(1, { id: f.id });
      expect(state.conflictedCount).toBeGreaterThan(0);
      const working = await f.service.getWorkingChanges(1, f.id, true, false);
      expect(working.staged.every((entry) => entry.status !== 'unmerged')).toBe(true);
      while (state.selected) {
        state = await f.service.resolveConflict(
          { id: f.id, path: state.selected.path, snapshot: state.snapshot, choice: 'theirs' },
          1,
        );
      }
      expect(await f.run('ls-files', '--unmerged')).toBe('');
      expect(await recover(f, 'continue')).toMatchObject({ status: 'succeeded' });
      expect((await f.run('show', '-s', '--format=%P', 'HEAD')).split(' ')).toEqual([head, source]);
      expect(await readFile(join(f.cwd, 'unrelated.txt'), 'utf8')).toBe('keep unstaged\n');
      expect(await readFile(join(f.cwd, 'note.txt'), 'utf8')).toBe('keep untracked\n');
      if (kind === 'binary') expect(await readFile(join(f.cwd, 'value.txt'))).toEqual(Buffer.from([0, 2]));
      if (kind === 'delete')
        await expect(readFile(join(f.cwd, 'value.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      if (kind === 'rename')
        expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).toBe('feature-name.txt\nunrelated.txt');
    },
  );

  it('rejects a same-size external binary edit after the selected source was reviewed', async () => {
    const f = await fixture();
    await conflict(f, 'binary');
    const state = await f.service.getConflicts(1, { id: f.id, path: 'value.txt' });
    await f.file('value.txt', Buffer.from([0, 9]));
    await expect(
      f.service.resolveConflict(
        { id: f.id, path: 'value.txt', snapshot: state.snapshot, choice: 'theirs' },
        1,
      ),
    ).rejects.toThrow('changed');
    expect(await readFile(join(f.cwd, 'value.txt'))).toEqual(Buffer.from([0, 9]));
  });

  it('retains stash provenance after restart and abort only restores affected paths', async () => {
    let f = await fixture();
    await f.file('value.txt', 'saved\n');
    await f.run('stash', 'push', '-m', 'Saved value');
    await f.file('value.txt', 'main\n');
    await f.run('commit', '--quiet', '-am', 'Main value');
    await f.file('note.txt', 'keep\n');
    const stashId = (await f.service.listStashes(1, f.id))[0]!.commitId;
    expect(
      await done(
        f.service,
        f.service.startStashOperation(1, {
          id: f.id,
          request: {
            kind: 'pop',
            stashId,
            changesSnapshot: (await f.service.previewLocalChanges(1, f.id)).snapshot,
          },
        }),
      ),
    ).toMatchObject({ status: 'failed' });
    f = await reopen(f);
    expect(await f.service.getConflicts(1, { id: f.id })).toMatchObject({
      operation: 'stash',
      theirsLabel: 'Stashed changes',
    });
    await f.file('unrelated.txt', 'new unrelated work\n');
    await f.run('add', 'unrelated.txt');
    expect(await recover(f, 'abort')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', ':unrelated.txt')).toBe('new unrelated work');
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe('main\n');
    expect(await readFile(join(f.cwd, 'note.txt'), 'utf8')).toBe('keep\n');
    expect((await f.service.listStashes(1, f.id))[0]?.commitId).toBe(stashId);
  });

  it.each(['continue', 'abort'] as const)(
    'recovers a no-commit cherry-pick through %s after restart',
    async (action) => {
      let f = await fixture();
      const { source, head } = await conflict(f);
      await f.run('merge', '--abort');
      const preview = await f.service.getHistoryOperationPreview(1, {
        id: f.id,
        kind: 'cherry-pick',
        commitId: source,
      });
      await done(
        f.service,
        f.service.startHistoryOperation(1, {
          id: f.id,
          action: {
            kind: 'cherry-pick',
            commitId: source,
            snapshot: preview.snapshot,
            autostash: false,
            commitChanges: false,
            appendOrigin: false,
          },
        }),
      );
      f = await reopen(f);
      expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe('cherry-pick');
      if (action === 'continue') {
        const state = await f.service.getConflicts(1, { id: f.id, path: 'value.txt' });
        await f.service.resolveConflict(
          { id: f.id, path: 'value.txt', snapshot: state.snapshot, choice: 'theirs' },
          1,
        );
      }
      const recovered = await recover(f, action);
      expect(recovered, recovered.message + recovered.output).toMatchObject({ status: 'succeeded' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(head);
      expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe(null);
      expect(await f.run('show', ':value.txt')).toBe(action === 'continue' ? 'feature' : 'main');
    },
  );

  it.each(['staged', 'unstaged'] as const)(
    'stashes one %s hunk, keeps other changes and restores its staging distinction',
    async (area) => {
      const f = await fixture();
      const base = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
      await f.file('value.txt', base);
      await f.run('commit', '--quiet', '-am', 'Lines');
      const changed = base.replace('line 2\n', 'selected\n').replace('line 22\n', 'remaining\n');
      await f.file('value.txt', changed);
      if (area === 'staged') await f.run('add', 'value.txt');
      await f.file('unrelated.txt', 'staged separately\n');
      await f.run('add', 'unrelated.txt');
      const target: RepositoryWorkingChangeTarget = { area, path: 'value.txt', previousPath: null };
      const diff = await f.service.getDiff(1, f.id, { kind: 'working', ...target }, 'normal');
      const result = await done(
        f.service,
        f.service.startStashOperation(1, {
          id: f.id,
          request: {
            kind: 'save-selection',
            target,
            selection: { kind: 'hunk', hunk: 0 },
            snapshot: diff.snapshot!,
            message: 'Just the first hunk',
          },
        }),
      );
      expect(result).toMatchObject({ status: 'succeeded' });
      expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe(base.replace('line 22\n', 'remaining\n'));
      expect(await f.run('show', ':unrelated.txt')).toBe('staged separately');
      const stash = (await f.service.listStashes(1, f.id))[0]!;
      expect(await f.run('stash', 'show', '--name-only', stash.commitId)).toBe('value.txt');
      // Commit the unselected work, then inspect the native stash's selected patch and index parent.
      await f.run('add', '--all');
      await f.run('commit', '--quiet', '-m', 'Remaining work');
      expect(
        await done(
          f.service,
          f.service.startStashOperation(1, { id: f.id, request: { kind: 'apply', stashId: stash.commitId } }),
        ),
      ).toMatchObject({ status: 'succeeded' });
      expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe(changed);
      expect(await f.run('diff', '--cached', '--name-only')).toBe(area === 'staged' ? 'value.txt' : '');
    },
  );

  it('parses CRLF/diff3/custom markers, keeps empty choices empty, and rejects broken markers', () => {
    const source =
      'start\r\n<<<<<<<<< ours\r\n||||||||| base\r\nbase\r\n=========\r\nincoming\r\n>>>>>>>>> theirs\r\nend\r\n';
    const region = conflictTextRegions(source)[0]!;
    expect(region.base).toBe('base\r\n');
    expect(chooseConflictRegion(source, region, 'ours')).toBe('start\r\nend\r\n');
    expect(chooseConflictRegion(source, region, 'both')).toBe('start\r\nincoming\r\nend\r\n');
    expect(hasConflictMarkers('<<<<<<< damaged\nnot closed')).toBe(true);
  });

  it('previews conflicts without moving refs or the index and binds the reviewed source', async () => {
    const f = await fixture();
    await conflict(f);
    await f.run('merge', '--abort');
    const before = await f.run('ls-files', '--stage');
    const head = await f.run('rev-parse', 'HEAD');
    const preview = await f.service.getMergeRebasePreview(1, {
      id: f.id,
      kind: 'merge',
      sourceFullName: 'refs/heads/feature',
    });
    expect(preview.state).toBe('conflicts');
    expect(await f.run('ls-files', '--stage')).toBe(before);
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe(null);
    const rebase = await f.service.getMergeRebasePreview(1, {
      id: f.id,
      kind: 'rebase',
      sourceFullName: 'refs/heads/feature',
    });
    expect(rebase.state).toBe('conflicts');
    const result = await done(
      f.service,
      f.service.startMergeRebase(1, {
        id: f.id,
        action: {
          kind: 'merge',
          sourceFullName: 'refs/heads/feature',
          sourceCommitId: head,
          snapshot: preview.snapshot,
          autostash: false,
        },
      }),
    );
    expect(result.status).toBe('failed');
    expect(await f.run('ls-files', '--unmerged')).toBe('');
  });

  it('stashes only selected lines and rejects a stale line selection', async () => {
    const f = await fixture();
    await f.file('value.txt', 'selected\n');
    const target = { area: 'unstaged' as const, path: 'value.txt', previousPath: null };
    const diff = await f.service.getDiff(1, f.id, { kind: 'working', ...target }, 'normal');
    const lines = diff.content.split('\n');
    const offset = lines.findIndex((line) => line.startsWith('@@')) + 1;
    const added = lines.indexOf('+selected') - offset;
    const request = {
      kind: 'save-selection' as const,
      message: 'Only the added line',
      target,
      snapshot: diff.snapshot!,
      selection: { kind: 'lines' as const, hunk: 0, lineIndexes: [added] },
    };
    await f.file('value.txt', 'different\n');
    expect(await done(f.service, f.service.startStashOperation(1, { id: f.id, request }))).toMatchObject({
      status: 'failed',
    });
    expect(await f.service.listStashes(1, f.id)).toHaveLength(0);
    await f.file('value.txt', 'selected\n');
    const fresh = await f.service.getDiff(1, f.id, { kind: 'working', ...target }, 'normal');
    expect(
      await done(
        f.service,
        f.service.startStashOperation(1, { id: f.id, request: { ...request, snapshot: fresh.snapshot! } }),
      ),
    ).toMatchObject({ status: 'succeeded' });
    expect(await f.run('show', 'refs/stash:value.txt')).toBe('base\nselected');
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe('');
    expect(await f.run('show', ':value.txt')).toBe('base');
  });

  it('uses literal file selections and keeps unrelated staged changes outside a selected stash', async () => {
    const f = await fixture();
    await f.file('a[1].txt', 'literal base\n');
    await f.file('a1.txt', 'other base\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Paths');
    await f.file('a[1].txt', 'selected\n');
    await f.run('add', '--', 'a[1].txt');
    await f.file('a1.txt', 'keep unstaged\n');
    await f.file('unrelated.txt', 'keep staged\n');
    await f.run('add', 'unrelated.txt');
    const result = await done(
      f.service,
      f.service.startStashOperation(1, {
        id: f.id,
        request: { kind: 'save', message: 'Literal path', includeUntracked: false, paths: ['a[1].txt'] },
      }),
    );
    expect(result, result.message).toMatchObject({ status: 'succeeded' });
    expect(await f.run('stash', 'show', '--name-only')).toBe('a[1].txt');
    expect(await f.run('show', 'refs/stash^2:unrelated.txt')).toBe('original');
    expect(await f.run('show', ':unrelated.txt')).toBe('keep staged');
    expect(await readFile(join(f.cwd, 'a1.txt'), 'utf8')).toBe('keep unstaged\n');
  });

  it.each(['mixed', 'hard'] as const)(
    'applies %s reset to the current HEAD and retains unrelated untracked work',
    async (mode) => {
      const f = await fixture();
      const head = await f.run('rev-parse', 'HEAD');
      await f.file('value.txt', 'staged\n');
      await f.run('add', 'value.txt');
      await f.file('value.txt', 'working\n');
      await f.file('note.txt', 'untracked\n');
      const preview = await f.service.getHistoryOperationPreview(1, {
        id: f.id,
        kind: 'reset',
        targetCommitId: head,
        mode,
      });
      expect(preview.canStart).toBe(true);
      expect(
        await done(
          f.service,
          f.service.startHistoryOperation(1, {
            id: f.id,
            action: {
              kind: 'reset',
              targetCommitId: head,
              mode,
              snapshot: preview.snapshot,
              confirmDiscard: true,
            },
          }),
        ),
      ).toMatchObject({ status: 'succeeded' });
      expect(await f.run('show', ':value.txt')).toBe('base');
      expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe(mode === 'hard' ? 'base\n' : 'working\n');
      expect(await readFile(join(f.cwd, 'note.txt'), 'utf8')).toBe('untracked\n');
      if (mode === 'hard') expect((await f.service.getRecovery(1, f.id)).copies).toHaveLength(1);
    },
  );

  it('refuses a hard reset that would destroy an ignored or untracked obstacle', async () => {
    const f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await f.file('private.txt', 'committed\n');
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Target');
    const target = await f.run('rev-parse', 'HEAD');
    await f.run('checkout', '--quiet', 'main');
    await f.file('.gitignore', 'private.txt\n');
    await f.run('add', '.gitignore');
    await f.run('commit', '--quiet', '-m', 'Ignore');
    await f.file('private.txt', 'untracked personal data\n');
    const preview = await f.service.getHistoryOperationPreview(1, {
      id: f.id,
      kind: 'reset',
      targetCommitId: target,
      mode: 'hard',
    });
    expect(preview.canStart).toBe(false);
    expect(
      await done(
        f.service,
        f.service.startHistoryOperation(1, {
          id: f.id,
          action: {
            kind: 'reset',
            targetCommitId: target,
            mode: 'hard',
            snapshot: preview.snapshot,
            confirmDiscard: true,
          },
        }),
      ),
    ).toMatchObject({ status: 'failed' });
    expect(await readFile(join(f.cwd, 'private.txt'), 'utf8')).toBe('untracked personal data\n');
  });

  it('skips an empty cherry-pick after reopening and preserves the current tree', async () => {
    let f = await fixture();
    await f.run('checkout', '--quiet', '-b', 'feature');
    await f.file('value.txt', 'same\n');
    await f.run('commit', '--quiet', '-am', 'Feature');
    const source = await f.run('rev-parse', 'HEAD');
    await f.run('checkout', '--quiet', 'main');
    await f.file('value.txt', 'same\n');
    await f.run('commit', '--quiet', '-am', 'Already applied');
    const head = await f.run('rev-parse', 'HEAD');
    const preview = await f.service.getHistoryOperationPreview(1, {
      id: f.id,
      kind: 'cherry-pick',
      commitId: source,
    });
    expect(
      await done(
        f.service,
        f.service.startHistoryOperation(1, {
          id: f.id,
          action: {
            kind: 'cherry-pick',
            commitId: source,
            snapshot: preview.snapshot,
            commitChanges: true,
            appendOrigin: false,
            autostash: false,
          },
        }),
      ),
    ).toMatchObject({ status: 'failed' });
    f = await reopen(f);
    expect(await recover(f, 'skip')).toMatchObject({ status: 'succeeded' });
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect(await f.run('status', '--porcelain')).toBe('');
  });

  it.each([1, 2])(
    'reverts a merge against parent %s and cherry-picks it back with its origin',
    async (mainlineParent) => {
      const f = await fixture();
      await f.run('checkout', '--quiet', '-b', 'feature');
      await f.file('feature.txt', 'feature\n');
      await f.run('add', '--all');
      await f.run('commit', '--quiet', '-m', 'Feature');
      await f.run('checkout', '--quiet', 'main');
      await f.file('main.txt', 'main\n');
      await f.run('add', '--all');
      await f.run('commit', '--quiet', '-m', 'Main');
      await f.run('merge', '--no-edit', '--no-ff', 'feature');
      const merged = await f.run('rev-parse', 'HEAD');
      const parentTree = await f.run('rev-parse', `${merged}^${mainlineParent}^{tree}`);
      for (const kind of ['revert', 'cherry-pick'] as const) {
        const preview = await f.service.getHistoryOperationPreview(1, {
          id: f.id,
          kind,
          commitId: merged,
          mainlineParent,
        });
        expect(preview.integration?.state).toBe('clean');
        const common = {
          commitId: merged,
          snapshot: preview.snapshot,
          mainlineParent,
          commitChanges: true,
          autostash: false,
        };
        const action = kind === 'revert' ? { kind, ...common } : { kind, appendOrigin: true, ...common };
        const result = await done(f.service, f.service.startHistoryOperation(1, { id: f.id, action }));
        expect(result, result.message).toMatchObject({ status: 'succeeded' });
        expect(await f.run('rev-parse', 'HEAD^{tree}')).toBe(
          kind === 'revert' ? parentTree : await f.run('rev-parse', `${merged}^{tree}`),
        );
      }
      expect(await f.run('show', '-s', '--format=%B', 'HEAD')).toContain(
        `cherry picked from commit ${merged}`,
      );
    },
  );

  it.each(['continue', 'abort', 'commit'] as const)(
    'recovers a no-commit revert with %s after restart',
    async (action) => {
      let f = await fixture();
      await f.file('value.txt', 'middle\n');
      await f.run('commit', '--quiet', '-am', 'Middle');
      const target = await f.run('rev-parse', 'HEAD');
      await f.file('value.txt', 'latest\n');
      await f.run('commit', '--quiet', '-am', 'Latest');
      const before = await f.run('rev-parse', 'HEAD');
      const preview = await f.service.getHistoryOperationPreview(1, {
        id: f.id,
        kind: 'revert',
        commitId: target,
      });
      expect(
        await done(
          f.service,
          f.service.startHistoryOperation(1, {
            id: f.id,
            action: {
              kind: 'revert',
              commitId: target,
              snapshot: preview.snapshot,
              commitChanges: false,
              autostash: false,
            },
          }),
        ),
      ).toMatchObject({ status: 'failed' });
      f = await reopen(f);
      if (action !== 'abort') {
        const state = await f.service.getConflicts(1, { id: f.id, path: 'value.txt' });
        await f.service.resolveConflict(
          { id: f.id, path: 'value.txt', snapshot: state.snapshot, choice: 'theirs' },
          1,
        );
      }
      const result =
        action === 'commit'
          ? await done(
              f.service,
              f.service.startCommit(1, {
                id: f.id,
                subject: 'Reviewed revert',
                body: '',
                amend: false,
                skipHooks: false,
                snapshot: (await f.service.getCommitContext(1, f.id)).snapshot,
              }),
            )
          : await recover(f, action);
      expect(result, result.message).toMatchObject({ status: 'succeeded' });
      expect((await f.service.getRecovery(1, f.id)).pendingOperation).toBe(null);
      expect(await f.run('show', ':value.txt')).toBe(action === 'abort' ? 'latest' : 'base');
      if (action !== 'commit') expect(await f.run('rev-parse', 'HEAD')).toBe(before);
      else expect(await f.run('show', '-s', '--format=%P', 'HEAD')).toBe(before);
    },
  );

  it('rejects a changed HEAD while the conflict stages and content still match', async () => {
    const f = await fixture();
    const { head } = await conflict(f);
    const state = await f.service.getConflicts(1, { id: f.id, path: 'value.txt' });
    await f.run('update-ref', 'refs/heads/main', await f.run('rev-parse', `${head}^`), head);
    await expect(
      f.service.resolveConflict({ id: f.id, path: 'value.txt', snapshot: state.snapshot, choice: 'ours' }, 1),
    ).rejects.toThrow('changed');
    expect(await f.run('ls-files', '--unmerged')).not.toBe('');
  });

  it('keeps resolution queryable as an operation and restores the unmerged result when staging is cancelled', async () => {
    const f = await fixture();
    await conflict(f);
    f.service.dispose();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = new RepositoryService({
      storagePath: join(f.root, 'recent.json'),
      runner: {
        executable: f.git.executable,
        version: () => f.git.version(),
        run: async (args, options) => {
          if (args[0] === 'add' && options.signal) {
            entered();
            await new Promise<never>((_resolve, reject) => {
              const cancel = () => reject(new GitCancelledError());
              options.signal!.addEventListener('abort', cancel, { once: true });
              if (options.signal!.aborted) cancel();
            });
          }
          return f.git.run(args, options);
        },
      },
    });
    services.push(service);
    await service.open(1, f.cwd);
    const before = await service.getConflicts(1, { id: f.id, path: 'value.txt' });
    const accepted = service.startConflictResolution(1, {
      id: f.id,
      path: 'value.txt',
      snapshot: before.snapshot,
      content: 'reviewed resolution\n',
    });
    await started;
    expect(service.listOperations(1).find((item) => item.id === accepted.id)?.status).toBe('running');
    service.cancelOperation(1, accepted.id);
    expect(await done(service, accepted)).toMatchObject({ status: 'cancelled', kind: 'resolve-conflict' });
    expect(await readFile(join(f.cwd, 'value.txt'), 'utf8')).toBe(before.selected!.result.content);
    expect(await f.run('ls-files', '--unmerged')).not.toBe('');
  });

  it('selects a conflicted submodule gitlink without changing its dirty checkout', async () => {
    let f = await fixture();
    const child = join(f.root, 'child');
    await mkdir(child);
    const childRun = async (...args: string[]) => (await f.git.run(args, { cwd: child })).stdout.trim();
    await childRun('init', '--quiet', '--initial-branch=main');
    await childRun('config', 'user.name', 'Child');
    await childRun('config', 'user.email', 'child@example.test');
    await childRun('config', 'commit.gpgsign', 'false');
    await writeFile(join(child, 'file.txt'), 'base\n');
    await childRun('add', '--all');
    await childRun('commit', '--quiet', '-m', 'Base');
    const base = await childRun('rev-parse', 'HEAD');
    await childRun('checkout', '--quiet', '-b', 'side');
    await writeFile(join(child, 'file.txt'), 'side\n');
    await childRun('commit', '--quiet', '-am', 'Side');
    const theirs = await childRun('rev-parse', 'HEAD');
    await childRun('checkout', '--quiet', 'main');
    await writeFile(join(child, 'file.txt'), 'main\n');
    await childRun('commit', '--quiet', '-am', 'Main');
    const ours = await childRun('rev-parse', 'HEAD');
    await f.run('-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', child, 'module');
    const subRun = async (...args: string[]) =>
      (await f.git.run(args, { cwd: join(f.cwd, 'module') })).stdout.trim();
    await subRun('checkout', '--quiet', base);
    await f.run('add', '--all');
    await f.run('commit', '--quiet', '-m', 'Submodule base');
    await f.run('checkout', '--quiet', '-b', 'feature');
    await subRun('checkout', '--quiet', theirs);
    await f.run('commit', '--quiet', '-am', 'Submodule feature');
    await f.run('checkout', '--quiet', 'main');
    await subRun('checkout', '--quiet', ours);
    await f.run('commit', '--quiet', '-am', 'Submodule main');
    await f.run('merge', '--no-edit', 'feature').catch(() => undefined);
    await writeFile(join(f.cwd, 'module', 'file.txt'), 'keep child work\n');
    f = await reopen(f);
    const state = await f.service.getConflicts(1, { id: f.id, path: 'module' });
    expect(state.selected).toMatchObject({ kind: 'submodule', workingCommitId: ours });
    await f.service.resolveConflict(
      { id: f.id, path: 'module', snapshot: state.snapshot, choice: 'theirs' },
      1,
    );
    expect(await f.run('ls-files', '--stage', 'module')).toContain(`160000 ${theirs} 0`);
    expect(await subRun('rev-parse', 'HEAD')).toBe(ours);
    expect(await readFile(join(f.cwd, 'module', 'file.txt'), 'utf8')).toBe('keep child work\n');
    expect(await recover(f, 'continue')).toMatchObject({ status: 'succeeded' });
  });
});
