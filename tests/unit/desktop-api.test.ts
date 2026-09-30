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
  it('validates notification controls and snapshots and cleans the exact change subscription', async () => {
    const { api, invoke, emitter } = fixture();
    expect(
      await api.hosting.setNotifications({
        accountId: 'github-42',
        enabled: true,
        token: 'not-admitted',
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
    expect(await api.hosting.setNotifications({ accountId: 'github-42', enabled: true })).toMatchObject({
      ok: true,
    });
    expect(invoke).toHaveBeenLastCalledWith('hosting:set-notifications', {
      accountId: 'github-42',
      enabled: true,
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { revision: 1, accounts: [], token: 'not-admitted' } });
    expect(await api.hosting.getNotifications()).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    const listener = vi.fn();
    const release = api.hosting.onNotificationsChanged(listener);
    emitter.emit(events.hostingNotificationsChanged.channel, {}, { token: 'not-admitted' });
    expect(listener).not.toHaveBeenCalled();
    emitter.emit(events.hostingNotificationsChanged.channel, {}, null);
    expect(listener).toHaveBeenCalledOnce();
    release();
    release();
    expect(emitter.listenerCount(events.hostingNotificationsChanged.channel)).toBe(0);
  });
  it('validates P10 LFS management inputs/results without admitting commands, endpoints or forced unlocks', async () => {
    const { api, invoke } = fixture();
    const id = `repo-${'a'.repeat(64)}`;
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        repositoryId: id,
        snapshot: 'b'.repeat(64),
        available: false,
        version: null,
        head: null,
        remotes: [],
        defaultRemote: null,
        patterns: [],
      },
    });
    expect(await api.repository.getLfsContext({ id })).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith('repository:get-lfs-context', { id });
    invoke.mockClear();
    for (const action of [
      { kind: 'fetch', remote: 'origin', endpoint: 'https://unreviewed.invalid' },
      { kind: 'unlock', remote: 'origin', path: '../secret', lockId: '1' },
      { kind: 'unlock', remote: 'origin', path: 'asset.bin', lockId: '1', force: true },
      { kind: 'track', pattern: '*.bin\n* filter=program', lockable: false },
      { kind: 'exec', command: 'anything' },
    ])
      expect(
        await api.repository.startLfsOperation({ id, snapshot: 'b'.repeat(64), action } as never),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: true, value: { repositoryId: id, secret: 'must not cross' } });
    expect(await api.repository.getLfsContext({ id })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('validates P09 comparison reads and named topology mutations in both directions', async () => {
    const { api, invoke } = fixture();
    const id = `repo-${'a'.repeat(64)}`;
    const submoduleId = `submodule-${'b'.repeat(64)}`;
    const request = { id, submoduleId, area: 'staged' as const };
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { before: null, after: null, commits: [], ahead: null, behind: null, truncated: false },
    });
    expect(await api.repository.getSubmoduleComparison(request)).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith('repository:get-submodule-comparison', request);
    invoke.mockClear();
    expect(
      await api.repository.getSubmoduleComparison({ ...request, path: '/unowned' } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      await api.repository.startWorktreeOperation({
        id,
        snapshot: 'c'.repeat(64),
        action: { kind: 'create-detached', path: '/worktree', commitId: 'HEAD~1' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      await api.repository.startGitFlowOperation({
        id,
        action: { kind: 'continue', snapshot: 'c'.repeat(64), command: 'merge anything' },
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { before: null, after: null, commits: [], ahead: -1, behind: null, truncated: false },
    });
    expect(await api.repository.getSubmoduleComparison(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('validates P08 investigation scopes, cancellation, historical saving and attribution results', async () => {
    const { api, invoke } = fixture();
    const id = `repo-${'a'.repeat(64)}`;
    const commitId = 'b'.repeat(40);
    const request = {
      id,
      commitId,
      path: 'source/code.txt',
      scope: { kind: 'lines' as const, start: 2, end: 4 },
    };
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED', message: 'Stopped.' } });
    await api.repository.getFileHistory(request);
    expect(invoke).toHaveBeenLastCalledWith('repository:get-file-history', request);
    invoke.mockClear();
    expect(
      await api.repository.getFileHistory({ ...request, scope: { kind: 'lines', start: 4, end: 2 } }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      await api.repository.saveRevisionFile({
        id,
        commitId,
        path: '../outside',
        destination: '/tmp/x',
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
    const cancel = { id, readId: '00000000-0000-4000-8000-000000000001' };
    await api.repository.cancelInvestigation(cancel);
    expect(invoke).toHaveBeenLastCalledWith('repository:cancel-investigation', cancel);
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        repositoryId: id,
        commitId,
        path: 'x',
        state: 'text',
        byteLength: 1,
        commits: [],
        lines: [{ line: 1, commitId, content: 'x', originalPath: '../x', originalLine: 1 }],
        truncated: false,
        message: null,
      },
    });
    expect(await api.repository.getBlame({ id, commitId, path: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('validates P07 plan/ref/backup capabilities and rejects renderer commands or malformed results', async () => {
    const { api, invoke } = fixture();
    const id = `repo-${'a'.repeat(64)}`;
    const request = {
      id,
      ontoCommitId: 'b'.repeat(40),
      quickAction: { commitId: 'c'.repeat(40), action: 'edit' as const },
    };
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED', message: 'Read failed.' } });
    await api.repository.getInteractiveRebasePlan(request);
    expect(invoke).toHaveBeenLastCalledWith('repository:get-interactive-rebase-plan', request);
    invoke.mockResolvedValueOnce({ ok: true, value: { commits: [], snapshot: 'c'.repeat(64) } });
    expect(await api.repository.getInteractiveRebasePlan(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    invoke.mockClear();
    expect(
      await api.repository.startInteractiveRebase({
        id,
        ontoCommitId: null,
        snapshot: 'c'.repeat(64),
        actions: [{ commitId: 'b'.repeat(40), action: 'exec', subject: 'anything', body: '' }],
        autosquash: false,
        autostash: false,
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      await api.repository.getInteractiveRebasePlan({ ...request, sequenceEditor: 'sh' } as never),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'OPERATION_FAILED', message: 'No backup.' } });
    const dismiss = {
      id,
      action: 'dismiss-rebase-backup' as const,
      snapshot: 'c'.repeat(64),
      copyId: '00000000-0000-4000-8000-000000000001',
    };
    await api.repository.recover(dismiss);
    expect(invoke).toHaveBeenLastCalledWith('repository:recover', dismiss);
  });
  it('validates P06 previews, explicit conflict choices and partial stash coordinates', async () => {
    const { api, invoke } = fixture();
    const id = `repo-${'a'.repeat(64)}`;
    const request = { id, kind: 'merge' as const, sourceFullName: 'refs/heads/topic' };
    const value = {
      state: 'conflicts',
      message: 'Merge will cause conflicts.',
      sourceCommitId: 'b'.repeat(40),
      snapshot: 'c'.repeat(64),
    };
    invoke.mockResolvedValueOnce({ ok: true, value });
    expect(await api.repository.getMergeRebasePreview(request)).toEqual({ ok: true, value });
    expect(invoke).toHaveBeenLastCalledWith('repository:get-merge-rebase-preview', request);
    expect(
      await api.repository.getMergeRebasePreview({ ...request, sourceFullName: 'HEAD; echo danger' }),
    ).toMatchObject({ ok: false });
    expect(
      await api.repository.resolveConflict({
        id,
        path: '../outside',
        snapshot: 'c'.repeat(64),
        choice: 'ours',
      }),
    ).toMatchObject({ ok: false });
    expect(
      await api.repository.resolveConflict({
        id,
        path: 'file',
        snapshot: 'c'.repeat(64),
        choice: 'ours',
        content: 'ambiguous',
      } as never),
    ).toMatchObject({ ok: false });
    expect(
      await api.repository.startStashOperation({
        id,
        request: {
          kind: 'save-selection',
          message: '',
          target: { area: 'unstaged', path: 'file', previousPath: null },
          snapshot: 'c'.repeat(64),
          selection: { kind: 'lines', hunk: 0, lineIndexes: [-1] },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValueOnce({ ok: true, value: { ...value, state: 'invented' } });
    expect(await api.repository.getMergeRebasePreview(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('keeps P03 directory paging inside the validated revision capability', async () => {
    const { api, invoke } = fixture();
    const request = { id: `repo-${'a'.repeat(64)}`, commitId: 'a'.repeat(40), path: '', offset: 5_000 };
    const value = {
      repositoryId: request.id,
      commitId: request.commitId,
      path: '',
      entries: [],
      truncated: false,
      nextOffset: null,
    };
    invoke.mockResolvedValueOnce({ ok: true, value });
    await expect(api.repository.getRevisionTree(request)).resolves.toEqual({ ok: true, value });
    expect(invoke).toHaveBeenLastCalledWith(requests.getRepositoryRevisionTree.channel, request);
    await expect(api.repository.getRevisionTree({ ...request, offset: -1 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValueOnce({ ok: true, value: { ...value, nextOffset: -5 } });
    await expect(api.repository.getRevisionTree(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
  it('validates manager jobs and invalidations and removes the exact event listener', async () => {
    const { api, emitter, invoke } = fixture();
    const listener = vi.fn();
    const release = api.repository.onInvalidated(listener);
    emitter.emit(
      events.repositoryInvalidated.channel,
      {},
      { kind: 'repository', id: 'invalid', revision: 1, watching: 'active' },
    );
    expect(listener).not.toHaveBeenCalled();
    const event = { kind: 'repository', id: `repo-${'a'.repeat(64)}`, revision: 3, watching: 'active' };
    emitter.emit(events.repositoryInvalidated.channel, {}, event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    release();
    release();
    expect(emitter.listenerCount(events.repositoryInvalidated.channel)).toBe(0);
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { generation: 1, state: 'scanning', snapshot: null, error: null },
    });
    expect(await api.repository.startManagerScan()).toMatchObject({ ok: true, value: { state: 'scanning' } });
    expect(invoke).toHaveBeenLastCalledWith('repository-manager:start-scan', undefined);
    invoke.mockResolvedValueOnce({ ok: true, value: { state: 'complete', path: '/etc' } });
    expect(await api.repository.getManagerScan()).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(await api.repository.editManager({ kind: 'remove-group', path: '/etc' } as never)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });
  it('validates Lean Branching requests and backend results through fixed channels', async () => {
    const { api, invoke } = fixture();
    const id = `repo-${'a'.repeat(64)}`;
    const request = { id, kind: 'start' as const, base: 'main', snapshot: 'a'.repeat(64) };
    expect(await api.repository.startLean(request)).toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: true, value: { repositoryId: id, arbitrary: true } });
    expect(await api.repository.getLean({ id })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(invoke).toHaveBeenLastCalledWith('repository:get-lean', { id });
  });
  it('validates AI input and results and exposes only fixed preview/send/cancel channels', async () => {
    const { api, invoke } = fixture();
    expect(await api.ai.configure({ model: '--invalid model' })).toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: true, value: { text: 'Generated message', key: 'unexpected' } });
    expect(await api.ai.send({ id: 'repo', token: 'f82f46b0-6fb3-4bcb-a22b-7b28e5a6ad4b' })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(invoke).toHaveBeenLastCalledWith('ai:send', {
      id: 'repo',
      token: 'f82f46b0-6fb3-4bcb-a22b-7b28e5a6ad4b',
    });
    expect(await api.ai.cancel({ id: 'repo' })).toMatchObject({ ok: true, value: null });
    expect(invoke).toHaveBeenLastCalledWith('ai:cancel', { id: 'repo' });
  });
  it('validates patch preview results and only exposes token-based application', async () => {
    const { api, invoke } = fixture();
    const id = 'repo-' + 'a'.repeat(64);
    const token = 'f82f46b0-6fb3-4bcb-a22b-7b28e5a6ad4b';
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { token, location: 'Clipboard', state: 'clean', message: 'Ready', byteLength: 10 },
    });
    expect(await api.repository.previewPatch({ id, source: 'clipboard' })).toMatchObject({
      ok: true,
      value: { token },
    });
    expect(invoke).toHaveBeenLastCalledWith('repository:preview-patch', { id, source: 'clipboard' });
    invoke.mockResolvedValueOnce({ ok: true, value: { token, state: 'invented' } });
    expect(await api.repository.previewPatch({ id, source: 'file' })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(await api.repository.applyPatch({ id, token, content: 'raw patch' } as never)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(await api.repository.releasePatch({ id, token })).toEqual({ ok: true, value: null });
  });
  it('validates settings in both directions and releases the exact change listener', async () => {
    const { api, emitter, invoke } = fixture();
    expect(await api.settings.getGit({ id: null })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(invoke).toHaveBeenLastCalledWith('settings:get-git', { id: null });
    expect(
      await api.settings.saveGit({
        id: null,
        snapshot: 'a'.repeat(64),
        name: 'x',
        email: 'invalid',
        issueRule: null,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(invoke).toHaveBeenCalledTimes(1);
    const listener = vi.fn();
    const release = api.settings.onChanged(listener);
    emitter.emit(events.settingsChanged.channel, {}, 'invalid');
    expect(listener).not.toHaveBeenCalled();
    emitter.emit(events.settingsChanged.channel, {}, null);
    expect(listener).toHaveBeenCalledTimes(1);
    release();
    release();
    expect(emitter.listenerCount(events.settingsChanged.channel)).toBe(0);
  });
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
        images: { ...value.images, after: { ...value.images.after, mime: 'text/html' } },
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
  it('accepts only scoped write-only credential entry and rejects secrets in results', async () => {
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
    expect(
      await api.hosting.connect({ remember: false, provider: 'github', token: 'synthetic_token' }),
    ).toMatchObject({
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
      'ai',
      'customCommands',
      'settings',
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

  it('validates repository trust requests and results through the explicit bridge', async () => {
    const { api, invoke } = fixture();
    const request = { id: `repo-${'a'.repeat(64)}`, trusted: true };
    invoke.mockResolvedValueOnce({ ok: true, value: null });
    expect(await api.repository.setTrust(request)).toEqual({ ok: true, value: null });
    expect(invoke).toHaveBeenCalledWith(requests.setRepositoryTrust.channel, request);
    expect(await api.repository.setTrust({ id: 'not-owned', trusted: true })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { trusted: true } });
    expect(await api.repository.setTrust(request)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
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

  it('validates push reviews on both sides of the preload boundary', async () => {
    const { api, invoke } = fixture();
    const request = {
      id: `repo-${'5'.repeat(64)}`,
      remote: 'origin',
      targets: [{ fullName: 'refs/heads/main', remoteBranch: 'main' }],
      tags: false,
    };
    const preview = {
      token: '12345678-1234-4234-8234-123456789abc',
      remote: 'origin',
      tagCount: 0,
      targets: [
        { ...request.targets[0]!, localId: 'a'.repeat(40), remoteId: 'b'.repeat(40), replacedCommits: 1 },
      ],
    };
    invoke.mockResolvedValueOnce({ ok: true, value: preview });
    expect(await api.repository.previewPush(request)).toEqual({ ok: true, value: preview });
    expect(invoke).toHaveBeenLastCalledWith(requests.previewRepositoryPush.channel, request);
    expect(await api.repository.previewPush({ ...request, remote: '--upload-pack=sh' })).toMatchObject({
      ok: false,
    });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { ...preview, targets: [{ ...preview.targets[0], localId: 'HEAD' }] },
    });
    expect(await api.repository.previewPush(request)).toMatchObject({ ok: false });
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
