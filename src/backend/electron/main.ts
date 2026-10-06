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
import { HostingPreferencesStore } from '../hosting/preferences-store';
import { GitInstanceStore } from '../git/instance-store';
import { GitRunner } from '../git/runner';

app.setName('Git Workbench');
const launchPaths = repositoryPathsFromArguments(process.argv, process.cwd(), process.defaultApp === true);

if (!app.requestSingleInstanceLock({ version: 1, repositoryPaths: launchPaths })) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const mainWindows = new Map<number, BrowserWindow>();
  const mainWorkspaceIds = new Map<number, string>();
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
  // Finder/Dock requests arrive as events, including before ready, rather than positional argv.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    openRequestedPaths([path]);
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
        undefined,
        undefined,
        undefined,
        new HostingPreferencesStore(join(app.getPath('userData'), 'hosting-preferences.json')),
      );
      const repositories = new RepositoryService({
        hostingPullRequestUrl: (remote, branch) => hosting.pullRequestUrl(remote, branch),
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
      let workspaceQueue = Promise.resolve();
      let quitting = false;
      const ipc = registerAppIpc(repositories, hosting, gitInstances, (owner, id, newWindow) => {
        const action = workspaceQueue.then(async () => {
          if (owner.isDestroyed()) return;
          const state = await repositories.getWorkspaces(owner.webContents.id);
          if (!state.entries.some((entry) => entry.id === id))
            throw new ExpectedBackendError('INVALID_REQUEST', 'That workspace no longer exists.');
          if (state.activeId === id) return;
          if (
            !newWindow &&
            repositories
              .listOperations(owner.webContents.id)
              .some((operation) => operation.status === 'running')
          )
            throw new ExpectedBackendError(
              'OPERATION_FAILED',
              'Wait for running operations, or open the workspace in a new window.',
            );
          await repositories.namedWorkspaces.activate(id);
          const existingOwner = repositories.workspaceOwner(id);
          const target = existingOwner === undefined ? openWindow(id) : mainWindows.get(existingOwner);
          if (!target || target.isDestroyed())
            throw new ExpectedBackendError('UNAVAILABLE', 'The workspace window closed. Try again.');
          mainWindow = target;
          if (loadedWindows.has(target.webContents.id)) focusWindow();
          else
            target.webContents.once('did-finish-load', () => {
              if (!target.isDestroyed()) {
                target.show();
                target.focus();
              }
            });
          if (!newWindow) {
            // Keep at least one main window alive and let this request return before closing its sender.
            const closeSource = () => {
              if (!owner.isDestroyed()) owner.close();
            };
            if (loadedWindows.has(target.webContents.id)) setImmediate(closeSource);
            else target.webContents.once('did-finish-load', closeSource);
          }
        });
        workspaceQueue = action.catch(() => undefined);
        return action;
      });
      installApplicationMenu();
      const loadedWindows = new Set<number>();
      let openQueue = Promise.resolve();
      openRequestedPaths = (paths) => {
        openQueue = openQueue
          .then(async () => {
            const window = await ensureMainWindow();
            if (!window) return;
            if (!loadedWindows.has(window.webContents.id)) {
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

      const openWindow = (workspaceId: string) => {
        const window = createMainWindow((created, url) => {
          repositories.bindWorkspace(created.webContents.id, workspaceId);
          ipc.attachWindow(created, url);
        }, workspaceId);
        mainWindow = window;
        const windowId = window.webContents.id;
        mainWindows.set(windowId, window);
        mainWorkspaceIds.set(windowId, workspaceId);
        window.on('focus', () => {
          mainWindow = window;
          if (!quitting) void repositories.namedWorkspaces.activate(workspaceId).catch(() => undefined);
        });
        window.webContents.on('did-start-loading', () => hosting.cancel(windowId));
        window.webContents.once('did-finish-load', () => {
          loadedWindows.add(windowId);
          if (launchPaths.length) openRequestedPaths(launchPaths.splice(0, 20));
        });
        window.once('closed', () => {
          loadedWindows.delete(windowId);
          mainWindows.delete(windowId);
          mainWorkspaceIds.delete(windowId);
          if (mainWindow === window) mainWindow = [...mainWindows.values()].at(-1) ?? null;
          if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
            const remaining = mainWorkspaceIds.get(mainWindow.webContents.id);
            if (remaining) void repositories.namedWorkspaces.activate(remaining).catch(() => undefined);
          }
        });
        return window;
      };

      const ensureMainWindow = async () => {
        if (quitting) return null;
        if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
        const state = await repositories.namedWorkspaces.read();
        if (quitting) return null;
        // An activation or another open request may have created it while settings were loading.
        return mainWindow && !mainWindow.isDestroyed() ? mainWindow : openWindow(state.lastActiveId);
      };
      await ensureMainWindow();
      app.on('activate', () => {
        void ensureMainWindow()
          .then(() => focusWindow())
          .catch((error: unknown) => console.error('Unable to restore the workspace window', error));
      });
      app.once('will-quit', () => {
        hosting.dispose();
        repositories.dispose();
        ipc.dispose();
      });
      let drained = false;
      app.on('before-quit', (event) => {
        if (drained) return;
        event.preventDefault();
        if (quitting) return;
        quitting = true;
        repositories.dispose();
        void Promise.allSettled([repositories.settled(), repositories.namedWorkspaces.read()]).finally(() => {
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
