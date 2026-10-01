import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';

/** A renderer crash must leave a reachable recovery action without replaying repository mutations. */
export function installRendererRecovery(window: BrowserWindow): void {
  let prompting = false;
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || window.isDestroyed() || prompting) return;
    prompting = true;
    void dialog
      .showMessageBox(window, {
        type: 'error',
        title: 'Restore Git Workbench',
        message: 'This window stopped responding.',
        detail:
          'Reload to restore your saved workspace and drafts. Check Activity and Recovery before repeating a Git operation; work already started may have finished.',
        buttons: ['Reload Window', 'Close Window'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (window.isDestroyed()) return;
        if (response === 0) window.webContents.reload();
        else window.close();
      })
      .catch(() => {
        // If the native prompt itself fails, closing leaves normal restart available.
        if (!window.isDestroyed()) window.close();
      })
      .finally(() => {
        prompting = false;
      });
  });
}
