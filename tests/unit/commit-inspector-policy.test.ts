import { describe, expect, it } from 'vitest';
import {
  canInvokeCommitInspector,
  canInvokeInspector,
} from '../../src/backend/electron/commit-inspector-policy';
import { requests, repositoryCommitDetailsRequestSchema } from '../../src/common/ipc/contracts';

describe('commit inspector capabilities', () => {
  it('permits committed reads but rejects working files, repository mutations and generic window actions', () => {
    expect(canInvokeCommitInspector(requests.getRepositoryHistory.channel, {})).toBe(true);
    expect(canInvokeCommitInspector(requests.getRepositoryDiff.channel, { target: { kind: 'commit' } })).toBe(
      true,
    );
    expect(
      canInvokeCommitInspector(requests.getRepositoryDiff.channel, { target: { kind: 'working' } }),
    ).toBe(false);
    expect(canInvokeCommitInspector(requests.getRepositoryWorkingChanges.channel, {})).toBe(false);
    expect(canInvokeCommitInspector(requests.applyRepositoryReferenceAction.channel, {})).toBe(false);
    expect(canInvokeCommitInspector(requests.openRepository.channel, {})).toBe(false);
    expect(canInvokeCommitInspector(requests.openRepositoryCommitDetails.channel, {})).toBe(false);
    expect(canInvokeCommitInspector(requests.windowCommand.channel, { action: 'quit' })).toBe(false);
    expect(
      canInvokeCommitInspector(requests.windowCommand.channel, { action: 'toggle-developer-tools' }),
    ).toBe(false);
    expect(canInvokeCommitInspector(requests.windowCommand.channel, { action: 'close' })).toBe(true);
    expect(canInvokeCommitInspector('unknown:future-capability', {})).toBe(false);
  });

  it('requires a repository ID and object ID, never a URL or absolute content path', () => {
    const valid = {
      id: `repo-${'a'.repeat(64)}`,
      commitId: 'b'.repeat(40),
      tab: 'changes',
      path: 'src/file.ts',
      theme: 'dark',
    };
    expect(repositoryCommitDetailsRequestSchema.safeParse(valid).success).toBe(true);
    expect(repositoryCommitDetailsRequestSchema.safeParse({ ...valid, path: '../secret' }).success).toBe(
      false,
    );
    expect(
      repositoryCommitDetailsRequestSchema.safeParse({ ...valid, url: 'https://example.invalid' }).success,
    ).toBe(false);
    expect(repositoryCommitDetailsRequestSchema.safeParse({ ...valid, commitId: 'HEAD~1' }).success).toBe(
      false,
    );
  });

  it('keeps file-history and blame inspectors read-only while allowing their named handoffs', () => {
    expect(canInvokeInspector('commit-details', requests.verifyRepositorySignature.channel, {})).toBe(true);
    expect(canInvokeInspector('commit-details', requests.setRepositorySigningKey.channel, {})).toBe(false);
    expect(
      canInvokeInspector('file-history', requests.getRepositoryFileHistoryContext.channel, undefined),
    ).toBe(true);
    expect(canInvokeInspector('file-history', requests.getRepositoryFileHistory.channel, {})).toBe(true);
    expect(canInvokeInspector('file-history', requests.openRepositoryBlame.channel, {})).toBe(true);
    expect(canInvokeInspector('file-history', requests.openRepositoryFileHistory.channel, {})).toBe(false);
    expect(canInvokeInspector('blame', requests.getRepositoryBlameContext.channel, undefined)).toBe(true);
    expect(canInvokeInspector('blame', requests.getRepositoryBlame.channel, {})).toBe(true);
    expect(canInvokeInspector('blame', requests.openRepositoryCommitDetails.channel, {})).toBe(true);
    expect(canInvokeInspector('blame', requests.applyRepositoryReferenceAction.channel, {})).toBe(false);
    expect(canInvokeInspector('blame', requests.windowCommand.channel, { action: 'quit' })).toBe(false);
  });
});
