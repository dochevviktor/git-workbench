import type { AppInfo, WindowCommand, WindowState } from './contracts';
import type { IpcResult } from './result';

export type Unsubscribe = () => void;

/** This is the entire capability surface available to a renderer. */
export interface DesktopApi {
  readonly app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  readonly window: {
    getState(): Promise<IpcResult<WindowState>>;
    command(command: WindowCommand): Promise<IpcResult<null>>;
    onStateChanged(listener: (state: WindowState) => void): Unsubscribe;
  };
}
