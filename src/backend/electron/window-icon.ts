import { join } from 'node:path';
import { app } from 'electron';

/** Independently authored project artwork; research screenshots are never application resources. */
export function windowIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources/icon.png');
}
