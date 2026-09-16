import { app, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

export function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }] },
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
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
