import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { operationFixture } from '../operation-fixture';

for (const route of ['titlebar', 'native', 'quit'] as const) {
  test(`closing through ${route} releases inspectors and exits without main-process error dialogs`, async () => {
    const fixture = await operationFixture();
    let application: ElectronApplication | undefined;
    const diagnostics: string[] = [];
    try {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
        ),
      ) as Record<string, string>;
      env.ELECTRON_RENDERER_URL = '';
      application = await electron.launch({
        chromiumSandbox: true,
        args: [
          '.',
          `--user-data-dir=${join(fixture.root, 'profile')}`,
          '--ozone-platform=headless',
          '--disable-gpu',
        ],
        env,
      });
      application.process().stderr?.on('data', (chunk: Buffer) => diagnostics.push(chunk.toString()));
      await application.evaluate(({ dialog }) => {
        // Record native error boxes instead of letting an uncaught exception hang a headless test.
        // The assertions below still fail for every dialog/uncaught exception.
        dialog.showErrorBox = (title, content) => {
          process.stderr.write(`WINDOW_CLOSE_DIALOG: ${title}\n${content}\n`);
        };
        process.on('uncaughtExceptionMonitor', (error) => {
          process.stderr.write(`WINDOW_CLOSE_EXCEPTION: ${error.stack ?? error.message}\n`);
        });
      });
      const page = await application.firstWindow();
      await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
      const opened = await page.evaluate((path) => window.desktop!.repository.open({ path }), fixture.cwd);
      if (!opened.ok || !opened.value.head.commit) throw new Error('Fixture repository did not open.');
      const request = {
        id: opened.value.id,
        commitId: opened.value.head.commit,
        tab: 'commit' as const,
        theme: 'light' as const,
      };
      const mainId = await (await application.browserWindow(page)).evaluate((window) => window.id);
      const firstReady = application.waitForEvent('window');
      expect(
        await page.evaluate((request) => window.desktop!.repository.openCommitDetails(request), request),
      ).toMatchObject({ ok: true });
      const first = await firstReady;
      await expect(first.getByTestId('commit-inspector')).toBeVisible();
      const secondReady = application.waitForEvent('window');
      expect(
        await page.evaluate((request) => window.desktop!.repository.openCommitDetails(request), request),
      ).toMatchObject({ ok: true });
      const second = await secondReady;
      await expect(second.getByTestId('commit-inspector')).toBeVisible();

      const firstId = await (await application.browserWindow(first)).evaluate((window) => window.id);
      const firstClosed = first.waitForEvent('close');
      await application.evaluate(({ BrowserWindow }, id) => {
        setImmediate(() => BrowserWindow.fromId(id)?.close());
      }, firstId);
      await firstClosed;
      expect(await page.evaluate(() => window.desktop!.window.getState())).toMatchObject({ ok: true });
      expect(await second.evaluate(() => window.desktop!.repository.getCommitDetailsContext())).toMatchObject(
        { ok: true },
      );
      expect(diagnostics.join('')).not.toMatch(/WINDOW_CLOSE_(?:DIALOG|EXCEPTION)/u);

      const mainClosed = page.waitForEvent('close');
      const childClosed = second.waitForEvent('close');
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        application!.process().once('close', (code, signal) => resolve({ code, signal }));
      });
      if (route === 'titlebar') {
        await application.evaluate(({ BrowserWindow }, id) => {
          const window = BrowserWindow.fromId(id)!;
          const close = window.close.bind(window);
          window.close = () => {
            process.stderr.write('WINDOW_CLOSE_REQUESTED\n');
            close();
          };
        }, mainId);
        await page.bringToFront();
        await page
          .getByTestId('titlebar')
          .getByRole('button', { name: 'Close', exact: true })
          .click()
          .catch((error: unknown) => {
            // Electron can finish the requested shutdown before Playwright receives click's reply.
            // The request marker, inspector closure and clean process exit below remain mandatory.
            if (
              !(error instanceof Error) ||
              !error.message.includes('Target page, context or browser has been closed')
            )
              throw error;
          });
      } else {
        await application.evaluate(
          ({ app, BrowserWindow }, { route, mainId }) => {
            setImmediate(() => {
              if (route === 'quit') app.quit();
              else BrowserWindow.fromId(mainId)?.close();
            });
          },
          { route, mainId },
        );
      }
      await Promise.all([mainClosed, childClosed]);
      expect(await exited).toEqual({ code: 0, signal: null });
      if (route === 'titlebar') expect(diagnostics.join('')).toContain('WINDOW_CLOSE_REQUESTED');
      application = undefined;
      expect(diagnostics.join('')).not.toMatch(/WINDOW_CLOSE_(?:DIALOG|EXCEPTION)/u);
    } finally {
      await application?.close();
      await fixture.cleanup();
    }
  });
}
