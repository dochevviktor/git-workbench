import { app, session } from 'electron';
import type { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { registerAppIpc } from './ipc/register';
import { installApplicationMenu } from './menu';
import { RepositoryService } from '../repositories/repository-service';
import { createMainWindow } from './window';

app.setName('Git Workbench');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const focusWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  app.on('second-instance', focusWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  void app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const repositories = new RepositoryService({
        storagePath: join(app.getPath('userData'), 'recent-repositories.json'),
      });
      const ipc = registerAppIpc(repositories);
      installApplicationMenu();

      const openWindow = () => {
        mainWindow = createMainWindow(ipc.attachWindow);
        mainWindow.once('closed', () => {
          mainWindow = null;
        });
      };

      openWindow();
      app.on('activate', () => {
        if (!mainWindow) openWindow();
        else focusWindow();
      });
      app.once('will-quit', () => {
        repositories.dispose();
        ipc.dispose();
      });
    })
    .catch((error: unknown) => {
      console.error('Application startup failed', error);
      app.exit(1);
    });
}
