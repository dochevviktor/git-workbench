import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopApi } from './create-desktop-api';

contextBridge.exposeInMainWorld(
  'desktop',
  createDesktopApi({
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    on: (channel, listener) => {
      ipcRenderer.on(channel, listener);
    },
    removeListener: (channel, listener) => {
      ipcRenderer.removeListener(channel, listener);
    },
  }),
);
