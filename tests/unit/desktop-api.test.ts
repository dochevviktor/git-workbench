import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopApi } from '../../src/backend/preload/create-desktop-api';
import type { IpcTransport } from '../../src/backend/preload/create-desktop-api';
import { events, requests } from '../../src/common/ipc/contracts';
import type { WindowCommand } from '../../src/common/ipc/contracts';

function fixture() {
  const emitter = new EventEmitter();
  const invoke = vi.fn<IpcTransport['invoke']>().mockResolvedValue({ ok: true, value: null });
  const api = createDesktopApi(
    {
      invoke,
      on: (channel, listener) => {
        emitter.on(channel, listener);
      },
      removeListener: (channel, listener) => {
        emitter.removeListener(channel, listener);
      },
    },
    100,
  );
  return { api, emitter, invoke };
}

afterEach(() => vi.useRealTimers());

describe('preload capability API', () => {
  it('validates external tool definitions, responses and named launch targets', async () => {
    const { api, invoke } = fixture();
    invoke.mockResolvedValueOnce({ ok: true, value: [] });
    expect(await api.externalTools.list()).toEqual({ ok: true, value: [] });
    expect(invoke).toHaveBeenLastCalledWith('external-tools:list', undefined);
    invoke.mockResolvedValueOnce({ ok: true, value: [{ executable: '/bin/sh' }] });
    expect(await api.externalTools.list()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(
      await api.externalTools.run({
        repositoryId: `repo-${'a'.repeat(64)}`,
        executable: '/bin/sh',
        target: { kind: 'repository' },
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(2);
    invoke.mockResolvedValueOnce({ ok: true, value: '/usr/bin/meld' });
    expect(await api.externalTools.pickExecutable()).toEqual({ ok: true, value: '/usr/bin/meld' });
    expect(invoke).toHaveBeenLastCalledWith('external-tools:pick-executable', undefined);
  });
  it('routes bounded image diffs through the existing validated capability', async () => {
    const { api, invoke } = fixture();
    const request = {
      id: `repo-${'a'.repeat(64)}`,
      target: { kind: 'commit' as const, commitId: 'b'.repeat(40), path: 'image.png', previousPath: null },
      whitespace: 'normal' as const,
      options: { includeImages: true },
    };
    const value = {
      repositoryId: request.id,
      target: request.target,
      state: 'binary',
      content: '',
      byteLength: 0,
      message: null,
      snapshot: null,
      images: {
        before: { state: 'missing' },
        after: { state: 'ready', mime: 'image/png', width: 1, height: 1, base64: 'AAAA' },
      },
    };
    invoke.mockResolvedValueOnce({ ok: true, value });
    expect(await api.repository.getDiff(request)).toEqual({ ok: true, value });
    expect(invoke).toHaveBeenLastCalledWith('repository:get-diff', request);
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        ...value,
        images: { ...value.images, after: { ...value.images.after, mime: 'image/svg+xml' } },
      },
    });
    expect(await api.repository.getDiff(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(
      await api.repository.getDiff({
        ...request,
        options: { includeImages: true, url: 'file:///secret' },
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('validates activity requests, results and fixed browser selection channels', async () => {
    const { api, invoke } = fixture();
    const request = {
      accountId: 'github-42',
      kind: 'notifications' as const,
      page: 1,
      all: false,
      participating: false,
    };
    expect(await api.hosting.listActivity({ ...request, token: 'forbidden' } as never)).toMatchObject({
      ok: false,
    });
    expect(
      await api.hosting.openActivity({
        accountId: 'github-42',
        itemId: '9',
        url: 'https://evil.example',
      } as never),
    ).toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: true, value: { items: [], page: 1, nextPage: null, limited: false } });
    expect(await api.hosting.listActivity(request)).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith('hosting:list-activity', request);
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { items: [], page: 1, nextPage: null, limited: false, token: 'forbidden' },
    });
    expect(await api.hosting.listActivity(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('keeps hosting secrets and arbitrary URLs out of the bridge in both directions', async () => {
    const { api, invoke } = fixture();
    expect(await api.hosting.connect({ remember: false, token: 'not-allowed' } as never)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(await api.hosting.openRepository({ url: 'https://example.com' } as never)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: true, value: { accounts: [], secureStorageAvailable: false } });
    expect(await api.hosting.listAccounts()).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith('hosting:list-accounts', undefined);
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { id: 'github-1', provider: 'github', login: 'test', storage: 'session', token: 'not-allowed' },
    });
    expect(await api.hosting.connect({ remember: false })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('validates signature results and signing settings requests on named channels', async () => {
    const { api, invoke } = fixture();
    const request = { id: 'repo-' + 'b'.repeat(64), objectId: 'a'.repeat(40), kind: 'commit' as const };
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'unsigned', fingerprint: null } });
    expect(await api.repository.verifySignature(request)).toMatchObject({
      ok: true,
      value: { status: 'unsigned' },
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.verifyRepositorySignature.channel, request);
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'verified', passphrase: 'never' } });
    expect(await api.repository.verifySignature(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    invoke.mockClear();
    expect(
      await api.repository.setSigningKey({ id: request.id, key: '../private.key', snapshot: 'a'.repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('validates named bisect requests and rejects malformed responses', async () => {
    const { api, invoke } = fixture();
    const request = { id: 'repo-' + 'b'.repeat(64), action: 'start' as const, snapshot: 'a'.repeat(64) };
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'STALE_SNAPSHOT', message: 'Refresh' } });
    expect(await api.repository.startBisectOperation(request)).toMatchObject({
      ok: false,
      error: { code: 'STALE_SNAPSHOT' },
    });
    expect(invoke).toHaveBeenCalledWith(requests.startRepositoryBisectOperation.channel, request);
    invoke.mockClear();
    expect(await api.repository.startBisectOperation({ ...request, snapshot: 'HEAD' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: true, value: { active: true } });
    expect(await api.repository.getBisect({ id: request.id })).toMatchObject({ ok: false });
  });
  it('validates repository activation events and removes exactly its subscription', () => {
    const { api, emitter } = fixture();
    const channel = events.repositoryActivated.channel;
    const listener = vi.fn();
    const keep = vi.fn();
    const stop = api.repository.onActivated(listener);
    const stopKeep = api.repository.onActivated(keep);
    emitter.emit(channel, {}, { path: '/invalid-only' });
    expect(listener).not.toHaveBeenCalled();
    const repository = {
      id: `repo-${'c'.repeat(64)}`,
      name: 'repository',
      path: '/repository',
      worktreePath: '/repository',
      gitDir: '/repository/.git',
      commonDir: '/repository/.git',
      bare: false,
      head: { state: 'unborn', name: 'main', commit: null },
      workingTree: { state: 'clean', changedFileCount: 0 },
    };
    const valid = events.repositoryActivated.payload.safeParse(repository);
    expect(valid.success).toBe(true);
    emitter.emit(channel, {}, repository);
    expect(listener).toHaveBeenCalledExactlyOnceWith(repository);
    stop();
    stop();
    expect(emitter.listenerCount(channel)).toBe(1);
    stopKeep();
    expect(emitter.listenerCount(channel)).toBe(0);
  });
  it('uses a named channel and preserves a structured result', async () => {
    const { api, invoke } = fixture();
    await expect(api.window.command({ action: 'minimize' })).resolves.toEqual({ ok: true, value: null });
    expect(invoke).toHaveBeenCalledWith(requests.windowCommand.channel, { action: 'minimize' });
    expect(Object.keys(api)).toEqual([
      'customCommands',
      'externalTools',
      'hosting',
      'app',
      'window',
      'edit',
      'clipboard',
      'repository',
    ]);
  });

  it('blocks malformed input before crossing IPC', async () => {
    const { api, invoke } = fixture();
    const result = await api.window.command({ action: 'execute-code' } as unknown as WindowCommand);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses fixed commit inspector requests and rejects unbounded or malformed targets', async () => {
    const { api, invoke } = fixture();
    const request = {
      id: `repo-${'a'.repeat(64)}`,
      commitId: 'b'.repeat(40),
      tab: 'commit' as const,
      theme: 'light' as const,
    };
    expect(await api.repository.openCommitDetails(request)).toEqual({ ok: true, value: null });
    expect(invoke).toHaveBeenCalledWith(requests.openRepositoryCommitDetails.channel, request);
    expect(await api.repository.openCommitDetails({ ...request, commitId: 'HEAD' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { repositoryId: request.id } });
    expect(await api.repository.getCommitDetailsContext()).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('validates repository paths before crossing IPC', async () => {
    const { api, invoke } = fixture();
    const result = await api.repository.open({ path: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates source-directory paths before crossing IPC', async () => {
    const { api, invoke } = fixture();
    const result = await api.repository.addSourceDirectory({ path: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates history requests and uses the history channel', async () => {
    const { api, invoke } = fixture();
    const invalid = await api.repository.getHistory({ id: 'not-a-repository', offset: 0, limit: 50 });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();

    const repositoryId = `repo-${'a'.repeat(64)}`;
    const invalidFilter = await api.repository.getHistory({
      id: repositoryId,
      offset: 0,
      limit: 50,
      filter: { kind: 'commit-search', query: '   ' },
    });
    expect(invalidFilter).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();

    const page = {
      repositoryId,
      offset: 0,
      commits: [],
      references: [],
      head: { state: 'unborn', name: 'main', commit: null },
      tracking: { upstream: null, ahead: null, behind: null },
      hasMore: false,
      nextOffset: null,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: page });
    const filter = { kind: 'commit-search', query: '[literal]' } as const;
    await expect(
      api.repository.getHistory({ id: repositoryId, offset: 0, limit: 50, filter }),
    ).resolves.toEqual({
      ok: true,
      value: page,
    });
    expect(invoke).toHaveBeenCalledWith(requests.getRepositoryHistory.channel, {
      id: repositoryId,
      offset: 0,
      limit: 50,
      filter,
    });

    invoke.mockResolvedValueOnce({ ok: true, value: page });
    await expect(
      api.repository.getHistory({ id: repositoryId, offset: 0, limit: 50, mode: 'reflog' }),
    ).resolves.toEqual({ ok: true, value: page });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryHistory.channel, {
      id: repositoryId,
      offset: 0,
      limit: 50,
      mode: 'reflog',
    });
  });

  it('validates and routes cherry-pick, revert, and reset previews/actions', async () => {
    const { api, invoke } = fixture();
    const repositoryId = `repo-${'a'.repeat(64)}`;
    const commitId = 'b'.repeat(40);
    const snapshot = 'c'.repeat(64);
    const preview = {
      repositoryId,
      kind: 'reset' as const,
      currentHead: { state: 'branch' as const, name: 'main', commit: 'd'.repeat(40) },
      currentBranch: 'main',
      targetCommitId: commitId,
      targetSubject: 'Base',
      targetParents: [],
      mode: 'mixed' as const,
      workingChanges: {
        snapshot,
        paths: [],
        untrackedPaths: [],
        pendingOperation: null,
        conflictedCount: 0,
      },
      snapshot,
      canStart: true,
      message: 'Ready to review and start.',
    };
    invoke.mockResolvedValueOnce({ ok: true, value: preview });
    await expect(
      api.repository.getHistoryOperationPreview({
        kind: 'reset',
        id: repositoryId,
        targetCommitId: commitId,
        mode: 'mixed',
      }),
    ).resolves.toEqual({ ok: true, value: preview });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryHistoryOperationPreview.channel, {
      kind: 'reset',
      id: repositoryId,
      targetCommitId: commitId,
      mode: 'mixed',
    });

    const accepted = {
      id: `op-${'e'.repeat(32)}`,
      repositoryId,
      source: 'user' as const,
      kind: 'reset' as const,
      title: "Reset 'main' (mixed)",
      status: 'running' as const,
      revision: 0,
      startedAt: '2026-09-19T12:00:00.000Z',
      finishedAt: null,
      progress: null,
      command: 'git reset',
      output: '',
      message: 'Running…',
      failureReason: null,
      canForceWithLease: false,
    };
    const action = {
      kind: 'reset' as const,
      targetCommitId: commitId,
      mode: 'mixed' as const,
      snapshot,
      changesSnapshot: snapshot,
      confirmDiscard: false,
    };
    invoke.mockResolvedValueOnce({ ok: true, value: accepted });
    await expect(api.repository.startHistoryOperation({ id: repositoryId, action })).resolves.toEqual({
      ok: true,
      value: accepted,
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.startRepositoryHistoryOperation.channel, {
      id: repositoryId,
      action,
    });
    expect(
      await api.repository.startHistoryOperation({
        id: repositoryId,
        action: { ...action, targetCommitId: 'HEAD' } as never,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('validates and routes committed revision inspection capabilities', async () => {
    const { api, invoke } = fixture();
    const repositoryId = `repo-${'c'.repeat(64)}`;
    const commitId = 'd'.repeat(40);
    const changes = {
      repositoryId,
      commitId,
      changes: [],
      truncated: false,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: changes });
    await expect(api.repository.getCommitChanges({ id: repositoryId, commitId })).resolves.toEqual({
      ok: true,
      value: changes,
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryCommitChanges.channel, {
      id: repositoryId,
      commitId,
    });

    const tree = {
      repositoryId,
      commitId,
      path: '',
      entries: [],
      truncated: false,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: tree });
    await expect(api.repository.getRevisionTree({ id: repositoryId, commitId, path: '' })).resolves.toEqual({
      ok: true,
      value: tree,
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryRevisionTree.channel, {
      id: repositoryId,
      commitId,
      path: '',
    });

    const blob = {
      repositoryId,
      commitId,
      path: 'README.md',
      state: 'text',
      content: 'hello\n',
      byteLength: 6,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: blob });
    await expect(
      api.repository.getRevisionBlob({ id: repositoryId, commitId, path: 'README.md' }),
    ).resolves.toEqual({
      ok: true,
      value: blob,
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryRevisionBlob.channel, {
      id: repositoryId,
      commitId,
      path: 'README.md',
    });

    const diff = {
      repositoryId,
      target: { kind: 'commit', commitId, path: 'README.md', previousPath: null },
      state: 'text',
      content: '@@ -1 +1 @@\n-old\n+new\n',
      byteLength: 26,
      message: null,
      snapshot: null,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: diff });
    await expect(
      api.repository.getDiff({
        id: repositoryId,
        target: diff.target,
        whitespace: 'normal',
      }),
    ).resolves.toEqual({ ok: true, value: diff });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryDiff.channel, {
      id: repositoryId,
      target: diff.target,
      whitespace: 'normal',
    });

    const invalidTreePath = await api.repository.getRevisionTree({ id: repositoryId, commitId, path: '../' });
    expect(invalidTreePath).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    const invalidBlobPath = await api.repository.getRevisionBlob({ id: repositoryId, commitId, path: '' });
    expect(invalidBlobPath).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    const invalidDiffPath = await api.repository.getDiff({
      id: repositoryId,
      target: { kind: 'working', area: 'untracked', path: '../secret', previousPath: null },
      whitespace: 'normal',
    });
    expect(invalidDiffPath).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('validates and routes working-tree visibility requests', async () => {
    const { api, invoke } = fixture();
    const repositoryId = `repo-${'e'.repeat(64)}`;
    const changes = {
      repositoryId,
      staged: [],
      unstaged: [],
      untracked: [],
      ignored: [],
      counts: { staged: 0, unstaged: 0, untracked: 0, ignored: 0, conflicted: 0 },
      truncated: false,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: changes });
    await expect(
      api.repository.getWorkingChanges({ id: repositoryId, includeUntracked: true, includeIgnored: false }),
    ).resolves.toEqual({ ok: true, value: changes });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryWorkingChanges.channel, {
      id: repositoryId,
      includeUntracked: true,
      includeIgnored: false,
    });

    const invalid = await api.repository.getWorkingChanges({
      id: repositoryId,
      includeUntracked: 'yes',
      includeIgnored: false,
    } as never);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('validates and routes named working-tree mutation requests', async () => {
    const { api, invoke } = fixture();
    const repositoryId = `repo-${'f'.repeat(64)}`;
    const target = { area: 'unstaged', path: 'file.txt', previousPath: null } as const;
    const request = {
      id: repositoryId,
      action: 'stage' as const,
      targets: [target],
      snapshot: 'a'.repeat(64),
      selection: { kind: 'lines' as const, hunk: 0, lineIndexes: [1, 2] },
    };
    const changes = {
      repositoryId,
      staged: [],
      unstaged: [],
      untracked: [],
      ignored: [],
      counts: { staged: 0, unstaged: 0, untracked: 0, ignored: 0, conflicted: 0 },
      truncated: false,
    } as const;
    const result = {
      repositoryId,
      action: 'stage',
      targets: [target],
      selection: request.selection,
      changes,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: result });
    await expect(api.repository.applyWorkingChange(request)).resolves.toEqual({ ok: true, value: result });
    expect(invoke).toHaveBeenCalledWith(requests.applyRepositoryWorkingChange.channel, request);

    const invalid = await api.repository.applyWorkingChange({
      ...request,
      snapshot: 'not-a-snapshot',
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('validates and routes commit requests', async () => {
    const { api, invoke, emitter } = fixture();
    const repositoryId = `repo-${'9'.repeat(64)}`;
    const request = {
      id: repositoryId,
      subject: 'Add a file',
      body: 'Why it changed',
      amend: false,
      snapshot: 'b'.repeat(64),
      skipHooks: false,
    } as const;
    const result = {
      status: 'committed',
      repositoryId,
      commitId: 'c'.repeat(40),
      amended: false,
      subject: 'Add a file',
      output: '',
    } as const;
    const accepted = {
      id: `op-${'a'.repeat(32)}`,
      repositoryId,
      source: 'user',
      kind: 'commit',
      title: 'Commit',
      status: 'running',
      revision: 0,
      startedAt: '2026-09-19T12:00:00.000Z',
      finishedAt: null,
      progress: null,
      command: 'git commit',
      output: '',
      message: 'Running…',
      failureReason: null,
      canForceWithLease: false,
    };
    invoke.mockResolvedValueOnce({ ok: true, value: accepted });
    await expect(api.repository.commit(request)).resolves.toEqual({ ok: true, value: accepted });
    expect(invoke).toHaveBeenLastCalledWith(requests.commitRepositoryChanges.channel, request);
    const completed = vi.fn();
    const unsubscribe = api.repository.onOperationChanged(completed);
    emitter.emit(
      events.repositoryOperationChanged.channel,
      {},
      {
        ...accepted,
        revision: 1,
        status: 'succeeded',
        finishedAt: accepted.startedAt,
        result: { kind: 'commit', value: result },
      },
    );
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({ result: { kind: 'commit', value: result } }),
    );
    unsubscribe();

    const invalid = await api.repository.commit({ ...request, snapshot: 'short' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    // A backend answer that does not match the result contract must not reach the renderer.
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'committed', repositoryId } });
    const malformed = await api.repository.commit(request);
    expect(malformed).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });

    const context = await api.repository.getCommitContext({ id: 'not-a-repository' } as never);
    expect(context).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('validates and routes reference requests', async () => {
    const { api, invoke, emitter } = fixture();
    const repositoryId = `repo-${'7'.repeat(64)}`;
    const request = {
      id: repositoryId,
      action: {
        kind: 'create-branch' as const,
        name: 'topic',
        startPoint: { kind: 'commit' as const, commitId: 'd'.repeat(40) },
        checkout: true,
        tracking: 'auto' as const,
      },
      snapshot: 'e'.repeat(64),
    };
    const result = {
      status: 'applied',
      repositoryId,
      kind: 'create-branch',
      message: "Created and checked out 'topic'.",
      output: '',
      head: { state: 'branch', name: 'topic', commit: 'd'.repeat(40) },
    } as const;
    const accepted = {
      id: `op-${'b'.repeat(32)}`,
      repositoryId,
      source: 'user',
      kind: 'reference',
      title: 'Create branch',
      status: 'running',
      revision: 0,
      startedAt: '2026-09-19T12:00:00.000Z',
      finishedAt: null,
      progress: null,
      command: 'git checkout',
      output: '',
      message: 'Running…',
      failureReason: null,
      canForceWithLease: false,
    };
    invoke.mockResolvedValueOnce({ ok: true, value: accepted });
    await expect(api.repository.applyReferenceAction(request)).resolves.toEqual({
      ok: true,
      value: accepted,
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.applyRepositoryReferenceAction.channel, request);
    const completed = vi.fn();
    const unsubscribe = api.repository.onOperationChanged(completed);
    emitter.emit(
      events.repositoryOperationChanged.channel,
      {},
      {
        ...accepted,
        revision: 1,
        status: 'succeeded',
        finishedAt: accepted.startedAt,
        result: { kind: 'reference', value: result },
      },
    );
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({ result: { kind: 'reference', value: result } }),
    );
    unsubscribe();

    // A name that Git would read as an option never crosses IPC.
    const dashed = await api.repository.applyReferenceAction({
      ...request,
      action: { ...request.action, name: '--force' },
    });
    expect(dashed).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const unknownAction = await api.repository.applyReferenceAction({
      ...request,
      action: { kind: 'reset-branch', fullName: 'refs/heads/main' },
    } as never);
    expect(unknownAction).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const context = await api.repository.getReferenceContext({ id: 'not-a-repository' } as never);
    expect(context).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('validates and routes network operation requests', async () => {
    const { api, invoke } = fixture();
    const repositoryId = `repo-${'5'.repeat(64)}`;
    const request = {
      id: repositoryId,
      request: {
        kind: 'push' as const,
        remote: 'origin',
        targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
        setUpstream: true,
        force: 'none' as const,
        tags: false,
      },
    };
    const operation = {
      id: `op-${'a'.repeat(32)}`,
      repositoryId,
      source: 'user',
      kind: 'push',
      title: "Push 'main' to 'origin'",
      status: 'running',
      startedAt: '2026-09-19T10:00:00.000Z',
      finishedAt: null,
      progress: null,
      command: 'git push --progress --set-upstream -- origin refs/heads/main:refs/heads/main',
      output: '',
      message: 'Running…',
      failureReason: null,
      canForceWithLease: false,
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: operation });
    await expect(api.repository.startNetworkOperation(request)).resolves.toEqual({
      ok: true,
      value: operation,
    });
    expect(invoke).toHaveBeenLastCalledWith(requests.startRepositoryNetworkOperation.channel, request);

    // A remote name that Git would read as an option never crosses IPC.
    const dashed = await api.repository.startNetworkOperation({
      ...request,
      request: { ...request.request, remote: '--upload-pack=sh' },
    });
    expect(dashed).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const empty = await api.repository.startNetworkOperation({
      ...request,
      request: { ...request.request, targets: [] },
    });
    expect(empty).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const unknownForce = await api.repository.startNetworkOperation({
      ...request,
      request: { ...request.request, force: 'always' },
    } as never);
    expect(unknownForce).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const cancel = await api.repository.cancelOperation({ operationId: 'not-an-operation' } as never);
    expect(cancel).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('validates remote changes and delivers operation events to the listener', async () => {
    const { api, emitter, invoke } = fixture();
    const repositoryId = `repo-${'6'.repeat(64)}`;
    const request = {
      id: repositoryId,
      action: { kind: 'add' as const, name: 'origin', url: 'https://example.test/repo.git' },
    };
    const result = {
      status: 'applied',
      repositoryId,
      message: "Added the remote 'origin'.",
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://example.test/repo.git',
          pushUrl: null,
          branchCount: 0,
          fetchAutomatically: true,
        },
      ],
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: result });
    await expect(api.repository.applyRemoteAction(request)).resolves.toEqual({ ok: true, value: result });

    const spacedName = await api.repository.applyRemoteAction({
      ...request,
      action: { ...request.action, name: 'my remote' },
    });
    expect(spacedName).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);

    const received: string[] = [];
    const unsubscribe = api.repository.onOperationChanged((operation) => received.push(operation.status));
    const running = {
      id: `op-${'b'.repeat(32)}`,
      repositoryId,
      source: 'user',
      kind: 'fetch',
      title: "Fetch 'origin'",
      status: 'running',
      startedAt: '2026-09-19T10:00:00.000Z',
      finishedAt: null,
      progress: { phase: 'Receiving objects', percent: 12 },
      command: 'git fetch --progress -- origin',
      output: '',
      message: 'Running…',
      failureReason: null,
      canForceWithLease: false,
    };
    emitter.emit(events.repositoryOperationChanged.channel, {}, running);
    emitter.emit(events.repositoryOperationChanged.channel, {}, { ...running, status: 'succeeded' });
    // A payload that does not match the contract is dropped rather than passed on.
    emitter.emit(events.repositoryOperationChanged.channel, {}, { id: 'nonsense' });
    unsubscribe();
    emitter.emit(events.repositoryOperationChanged.channel, {}, running);
    expect(received).toEqual(['running', 'succeeded']);
  });

  it('uses fixed channels for editing, clipboard, and file-manager requests', async () => {
    const { api, invoke } = fixture();
    await api.edit.command({ action: 'copy' });
    expect(invoke).toHaveBeenLastCalledWith(requests.editCommand.channel, { action: 'copy' });
    await api.clipboard.writeText({ text: 'commit message' });
    expect(invoke).toHaveBeenLastCalledWith(requests.writeClipboardText.channel, { text: 'commit message' });
    const location = { kind: 'source-directory', id: `source-${'b'.repeat(64)}` } as const;
    await api.repository.openInFileManager(location);
    expect(invoke).toHaveBeenLastCalledWith(requests.openRepositoryInFileManager.channel, location);

    const invalidLocation = await api.repository.openInFileManager({
      kind: 'recent',
      id: '../../etc',
    });
    expect(invalidLocation).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    const invalidEdit = await api.edit.command({ action: 'print' } as never);
    expect(invalidEdit).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('validates tab preferences and uses named tab channels', async () => {
    const { api, invoke } = fixture();
    const preferences = {
      tabOrientation: 'horizontal',
      activeRepositoryId: null,
      repositoryListVisible: false,
      recentlyClosed: [],
    } as const;
    invoke.mockResolvedValueOnce({ ok: true, value: preferences });
    await expect(api.repository.setTabOrientation('horizontal')).resolves.toEqual({
      ok: true,
      value: preferences,
    });
    expect(invoke).toHaveBeenCalledWith(requests.setRepositoryTabOrientation.channel, {
      tabOrientation: 'horizontal',
    });

    const invalid = await api.repository.setTabOrientation('diagonal' as never);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed responses and preserves known backend errors', async () => {
    const { api, invoke } = fixture();
    invoke.mockResolvedValueOnce({ maximized: true });
    expect(await api.window.getState()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const denied = { ok: false, error: { code: 'FORBIDDEN', message: 'Denied.' } };
    invoke.mockResolvedValueOnce(denied);
    expect(await api.window.getState()).toEqual(denied);
  });

  it('converts a disconnected transport to a recoverable error', async () => {
    const { api, invoke } = fixture();
    invoke.mockRejectedValueOnce(new Error('renderer destroyed'));
    expect(await api.app.getInfo()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });

  it('settles requests even when the backend never replies', async () => {
    vi.useFakeTimers();
    const { api, invoke } = fixture();
    invoke.mockImplementation(() => new Promise(() => undefined));
    const result = api.app.getInfo();
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });

  it('validates events, hides the Electron event, and unsubscribes exactly once', () => {
    const { api, emitter } = fixture();
    const listener = vi.fn();
    const channel = events.windowStateChanged.channel;
    const unsubscribe = api.window.onStateChanged(listener);
    emitter.emit(channel, { privileged: true }, { maximized: 'invalid', focused: true, fullScreen: false });
    expect(listener).not.toHaveBeenCalled();
    emitter.emit(channel, { privileged: true }, { maximized: true, focused: false, fullScreen: false });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ maximized: true, focused: false, fullScreen: false });
    unsubscribe();
    unsubscribe();
    expect(emitter.listenerCount(channel)).toBe(0);
    emitter.emit(channel, {}, { maximized: false, focused: true, fullScreen: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports independent subscribers and repeated mount/unmount cycles', () => {
    const { api, emitter } = fixture();
    const channel = events.windowStateChanged.channel;
    const persistent = vi.fn();
    const stopPersistent = api.window.onStateChanged(persistent);
    for (let index = 0; index < 20; index += 1) api.window.onStateChanged(vi.fn())();
    expect(emitter.listenerCount(channel)).toBe(1);
    emitter.emit(channel, {}, { maximized: false, focused: true, fullScreen: false });
    expect(persistent).toHaveBeenCalledOnce();
    stopPersistent();
    expect(emitter.listenerCount(channel)).toBe(0);
  });
});
