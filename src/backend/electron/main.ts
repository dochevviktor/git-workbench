import { app, dialog, session, safeStorage } from 'electron';
import type { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { registerAppIpc } from './ipc/register';
import { installApplicationMenu } from './menu';
import { RepositoryService } from '../repositories/repository-service';
import { createMainWindow } from './window';
import { forwardedRepositoryPaths, repositoryPathsFromArguments } from './launch-paths';
import { ExpectedBackendError } from '../errors';
import { HostingAccountStore } from '../hosting/account-store';
import { HostingService } from '../hosting/hosting-service';
import { GitInstanceStore } from '../git/instance-store';
import { GitRunner } from '../git/runner';

app.setName('Git Workbench');
const launchPaths = repositoryPathsFromArguments(process.argv, process.cwd(), process.defaultApp === true);

if (!app.requestSingleInstanceLock({ version: 1, repositoryPaths: launchPaths })) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let openRequestedPaths = (paths: readonly string[]) => {
    launchPaths.push(...paths.slice(0, 20));
  };
  const focusWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  app.on('second-instance', (_event, argv, cwd, additionalData) => {
    openRequestedPaths(
      forwardedRepositoryPaths(additionalData) ??
        repositoryPathsFromArguments(argv, cwd, process.defaultApp === true),
    );
    focusWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  void app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const gitInstances = new GitInstanceStore(join(app.getPath('userData'), 'git-instance.json'));
      // A damaged profile setting must not prevent opening Preferences to see its read error.
      const gitInstance = await gitInstances.read().catch(() => ({ executable: null }));
      const hosting = new HostingService(
        new HostingAccountStore(join(app.getPath('userData'), 'hosting-credentials.json'), {
          available: () =>
            safeStorage.isEncryptionAvailable() &&
            (process.platform !== 'linux' ||
              ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
                safeStorage.getSelectedStorageBackend(),
              )),
          encrypt: (value) => safeStorage.encryptString(value),
          decrypt: (value) => safeStorage.decryptString(value),
        }),
      );
      const repositories = new RepositoryService({
        runner: new GitRunner({
          ...(gitInstance.executable ? { executable: gitInstance.executable } : {}),
          credentials: {
            source: hosting.gitCredentials,
            executable: process.execPath,
            helperPath: join(__dirname, 'credential-helper.cjs'),
          },
        }),
        storagePath: join(app.getPath('userData'), 'recent-repositories.json'),
        managerStoragePath: join(app.getPath('userData'), 'repository-manager.json'),
        workspaceStoragePath: join(app.getPath('userData'), 'repository-workspace.json'),
      });
      const ipc = registerAppIpc(repositories, hosting, gitInstances);
      installApplicationMenu();
      const loadedWindows = new Set<number>();
      let openQueue = Promise.resolve();
      openRequestedPaths = (paths) => {
        openQueue = openQueue
          .then(async () => {
            const window = mainWindow;
            if (!window || window.isDestroyed() || !loadedWindows.has(window.webContents.id)) {
              launchPaths.push(...paths.slice(0, 20));
              return;
            }
            for (const path of paths.slice(0, 20)) {
              if (window.isDestroyed()) break;
              try {
                const repository = await repositories.open(window.webContents.id, path);
                if (!window.isDestroyed()) ipc.publishRepositoryActivated(window, repository);
              } catch (error) {
                if (!window.isDestroyed())
                  await dialog.showMessageBox(window, {
                    type: 'error',
                    title: 'Open Repository',
                    message: 'The requested repository could not be opened.',
                    detail:
                      error instanceof ExpectedBackendError
                        ? error.message
                        : 'Check that the selected directory contains an accessible Git repository.',
                  });
              }
            }
          })
          .catch((error: unknown) => console.error('Unable to handle repository launch', error));
      };

      const openWindow = () => {
        mainWindow = createMainWindow(ipc.attachWindow);
        const windowId = mainWindow.webContents.id;
        mainWindow.webContents.on('did-start-loading', () => hosting.cancel(windowId));
        mainWindow.webContents.once('did-finish-load', () => {
          loadedWindows.add(windowId);
          if (launchPaths.length) openRequestedPaths(launchPaths.splice(0, 20));
        });
        mainWindow.once('closed', () => {
          loadedWindows.delete(windowId);
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
      let quitting = false;
      let drained = false;
      app.on('before-quit', (event) => {
        if (drained) return;
        event.preventDefault();
        if (quitting) return;
        quitting = true;
        repositories.dispose();
        void repositories.settled().finally(() => {
          drained = true;
          app.quit();
        });
      });
    })
    .catch((error: unknown) => {
      console.error('Application startup failed', error);
      app.exit(1);
    });
}
