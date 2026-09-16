import type { DesktopApi } from '../../common/ipc/api';

declare global {
  interface Window {
    readonly desktop?: DesktopApi;
  }
}
