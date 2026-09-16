import { app, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

/**
 * macOS needs a native application menu for its global menu bar and standard editing shortcuts.
 * Other platforms show the renderer's title-bar menu, whose shortcuts the renderer handles; a hidden
 * native menu there would duplicate accelerators and could appear when Alt is pressed.
 */
export function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  // Tab commands such as Command+W and Command+T belong to the renderer, so this menu avoids
  // native roles that would close the whole window for those shortcuts.
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(!app.isPackaged ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
