import type { z } from 'zod';
import type { DesktopApi, Unsubscribe } from '../../common/ipc/api';
import { events, requests } from '../../common/ipc/contracts';
import type { RequestContract } from '../../common/ipc/contracts';
import { failure, resultSchema } from '../../common/ipc/result';
import type { IpcResult } from '../../common/ipc/result';

type TransportListener = (event: unknown, payload: unknown) => void;

export interface IpcTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: TransportListener): void;
  removeListener(channel: string, listener: TransportListener): void;
}

export function createDesktopApi(transport: IpcTransport, timeoutMs = 15_000): DesktopApi {
  const invoke = <Input, Output>(
    contract: RequestContract<Input, Output>,
    input: Input,
  ): Promise<IpcResult<Output>> => {
    const parsedInput = contract.input.safeParse(input);
    if (!parsedInput.success) {
      return Promise.resolve(failure('INVALID_REQUEST', 'The request is not valid.'));
    }

    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve(failure('TIMEOUT', 'The application did not respond in time.')),
        timeoutMs,
      );

      // Also catch a synchronous transport failure (for example a destroyed renderer).
      void Promise.resolve()
        .then(() => transport.invoke(contract.channel, parsedInput.data))
        .then((response) => {
          const parsed = resultSchema(contract.output).safeParse(response);
          resolve(
            parsed.success
              ? parsed.data
              : failure('INTERNAL_ERROR', 'The application returned an invalid response.'),
          );
        })
        .catch(() => resolve(failure('UNAVAILABLE', 'The application connection is unavailable.')))
        .finally(() => clearTimeout(timer));
    });
  };

  const subscribe = <Payload>(
    contract: { channel: string; payload: z.ZodType<Payload> },
    listener: (payload: Payload) => void,
  ): Unsubscribe => {
    const wrapped: TransportListener = (_event, payload) => {
      const parsed = contract.payload.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    transport.on(contract.channel, wrapped);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      // The same function reference must be passed to removeListener.
      transport.removeListener(contract.channel, wrapped);
    };
  };

  return {
    app: { getInfo: () => invoke(requests.getAppInfo, undefined) },
    window: {
      getState: () => invoke(requests.getWindowState, undefined),
      command: (command) => invoke(requests.windowCommand, command),
      onStateChanged: (listener) => subscribe(events.windowStateChanged, listener),
    },
    edit: { command: (command) => invoke(requests.editCommand, command) },
    clipboard: { writeText: (request) => invoke(requests.writeClipboardText, request) },
    repository: {
      getGitInfo: () => invoke(requests.getGitInfo, undefined),
      pickDirectory: () => invoke(requests.pickRepositoryDirectory, undefined),
      listRecent: () => invoke(requests.listRecentRepositories, undefined),
      listOpen: () => invoke(requests.listOpenRepositories, undefined),
      open: (request) => invoke(requests.openRepository, request),
      initialize: (request) => invoke(requests.initializeRepository, request),
      close: (request) => invoke(requests.closeRepository, request),
      getTabPreferences: () => invoke(requests.getRepositoryTabPreferences, undefined),
      setTabOrientation: (orientation) =>
        invoke(requests.setRepositoryTabOrientation, { tabOrientation: orientation }),
      selectTab: (request) => invoke(requests.selectRepositoryTab, request),
      removeRecent: (request) => invoke(requests.removeRecentRepository, request),
      listManager: () => invoke(requests.listRepositoryManager, undefined),
      addSourceDirectory: (request) => invoke(requests.addSourceDirectory, request),
      removeSourceDirectory: (request) => invoke(requests.removeSourceDirectory, request),
      rescanSourceDirectory: (request) => invoke(requests.rescanSourceDirectory, request),
      getHistory: (request) => invoke(requests.getRepositoryHistory, request),
      getCommitChanges: (request) => invoke(requests.getRepositoryCommitChanges, request),
      getDiff: (request) => invoke(requests.getRepositoryDiff, request),
      getWorkingChanges: (request) => invoke(requests.getRepositoryWorkingChanges, request),
      applyWorkingChange: (request) => invoke(requests.applyRepositoryWorkingChange, request),
      getRevisionTree: (request) => invoke(requests.getRepositoryRevisionTree, request),
      getRevisionBlob: (request) => invoke(requests.getRepositoryRevisionBlob, request),
      openInFileManager: (location) => invoke(requests.openRepositoryInFileManager, location),
    },
  };
}
