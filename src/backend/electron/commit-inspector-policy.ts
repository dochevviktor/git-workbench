import { requests } from '../../common/ipc/contracts';

export type InspectorKind = 'commit-details' | 'file-history' | 'blame';

const readChannels = new Set<string>([
  requests.getAppInfo.channel,
  requests.getWindowState.channel,
  requests.editCommand.channel,
  requests.writeClipboardText.channel,
  requests.getRepositoryCommitDetailsContext.channel,
  requests.getRepositoryHistory.channel,
  requests.getRepositoryCommitChanges.channel,
  requests.getRepositoryRevisionTree.channel,
  requests.getRepositoryRevisionBlob.channel,
  requests.cancelRepositoryDiff.channel,
]);
const windowActions = new Set([
  'close',
  'minimize',
  'toggle-maximize',
  'toggle-full-screen',
  'zoom-in',
  'zoom-out',
  'reset-zoom',
]);

/** The shared preload exposes names; main additionally restricts an inspector to committed-content reads. */
export function canInvokeInspector(kind: InspectorKind, channel: string, payload: unknown): boolean {
  if (readChannels.has(channel)) {
    if (channel === requests.getRepositoryCommitDetailsContext.channel) return kind === 'commit-details';
    return true;
  }
  if (channel === requests.getRepositoryFileHistoryContext.channel) return kind === 'file-history';
  if (channel === requests.getRepositoryBlameContext.channel) return kind === 'blame';
  if (typeof payload !== 'object' || payload === null) return false;
  if (channel === requests.openRepositoryCommitDetails.channel) {
    return kind === 'file-history' || kind === 'blame';
  }
  if (channel === requests.openRepositoryBlame.channel) return kind === 'file-history';
  if (channel === requests.openRepositoryFileHistory.channel) return kind === 'blame';
  if (channel === requests.getRepositoryFileHistory.channel)
    return kind === 'file-history' || kind === 'blame';
  if (channel === requests.getRepositoryBlame.channel) return kind === 'blame';
  if (channel === requests.windowCommand.channel) {
    return 'action' in payload && typeof payload.action === 'string' && windowActions.has(payload.action);
  }
  if (channel === requests.getRepositoryDiff.channel && 'target' in payload) {
    const target = payload.target;
    return typeof target === 'object' && target !== null && 'kind' in target && target.kind === 'commit';
  }
  return false;
}

export function canInvokeCommitInspector(channel: string, payload: unknown): boolean {
  return canInvokeInspector('commit-details', channel, payload);
}
