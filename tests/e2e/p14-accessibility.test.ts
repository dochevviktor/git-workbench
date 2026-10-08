import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';

test('P14 accessibility: manager, history, changes, preferences and palette in both themes', async () => {
  test.setTimeout(180_000);
  const f = await auditFixture();
  const { page } = f;
  const audit = async (state: string) => {
    const result = await new AxeBuilder({ page })
      // Electron cannot create axe's auxiliary browser tab. This app has no cross-origin frames.
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    await test
      .info()
      .attach(state, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: test.info().outputPath(`${state}.png`) });
    expect
      .soft(
        result.violations.map(({ id, impact, nodes }) => ({
          id,
          impact,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
        state,
      )
      .toEqual([]);
  };
  try {
    await page.emulateMedia({ colorScheme: 'light' });
    await audit('manager-light');
    await f.open();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await audit(`history-${theme}`);
      await page.keyboard.press('ControlOrMeta+,');
      const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
      await expect(preferences).toBeVisible();
      for (const section of ['General', 'Git', 'Commit', 'Shortcuts', 'Accounts']) {
        await preferences.getByRole('button', { name: section, exact: true }).click();
        await audit(`preferences-${section}-${theme}`);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+p');
      await expect(page.getByRole('dialog', { name: 'Quick Launch', exact: true })).toBeVisible();
      await audit(`palette-${theme}`);
      await page.keyboard.press('Escape');
    }
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await page.keyboard.press('ControlOrMeta+1');
    await expect(page.getByTestId('working-change').first()).toBeVisible();
    await page.getByTestId('working-change').first().click();
    await expect(page.getByTestId('diff-content')).toContainText('value = 3');
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await audit(`changes-${theme}`);
    }
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.run('diff', '--cached', '--name-only')).toBe('');
  } finally {
    await f.close();
  }
});

test('P14 composing input cannot commit or open global menus over a modal', async () => {
  const f = await auditFixture();
  const { page } = f;
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.run('add', 'value.ts');
    await f.open();
    await page.keyboard.press('ControlOrMeta+1');
    const subject = page.getByTestId('commit-subject');
    await subject.fill('まだ編集中');
    await expect(page.getByTestId('commit-submit')).toBeEnabled();
    const composing = await subject.evaluate((element) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect.soft(composing, 'The IME owns its composing Enter').toBe(false);
    // Wait for an ordinary owned read after the event; any wrongly queued commit has then started.
    await expect.poll(() => f.run('rev-parse', 'HEAD')).toBe(f.head);
    await expect.soft(subject).toHaveValue('まだ編集中');
    await page.keyboard.press('ControlOrMeta+,');
    const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
    await expect(preferences).toBeVisible();
    await preferences.getByRole('button', { name: 'Git', exact: true }).click();
    await page.keyboard.press('Alt+f');
    await expect.soft(page.getByRole('menu')).toHaveCount(0);
    await expect.soft(preferences).toBeVisible();
    await expect.soft.poll(() => f.run('rev-parse', 'HEAD')).toBe(f.head);
  } finally {
    await f.close();
  }
});

test('P14 scaled keyboard navigation, forced colors and renderer crash recovery retain Git and drafts', async () => {
  const f = await auditFixture();
  const { page, app } = f;
  try {
    await f.open();
    for (const zoom of [1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, factor) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.setSize(1440, 960);
        window.webContents.setZoomFactor(factor);
      }, zoom);
      await page.keyboard.press('ControlOrMeta+,');
      const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
      for (let index = 0; index < 24; index++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`preferences-zoom-${zoom}.png`) });
      await page.keyboard.press('Escape');
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
    await page.emulateMedia({ forcedColors: 'active' });
    const list = page.getByRole('listbox', { name: 'Commits', exact: true });
    await list.focus();
    await page.keyboard.press('ArrowDown');
    const colors = await page.locator('.commit-row.selected').evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'Canvas';
      probe.style.color = 'Highlight';
      document.body.append(probe);
      const palette = getComputedStyle(probe);
      const selected = getComputedStyle(element);
      const result = {
        selected: selected.backgroundColor,
        canvas: palette.backgroundColor,
        highlight: palette.color,
      };
      probe.remove();
      return result;
    });
    await page.screenshot({ path: test.info().outputPath('forced-colors.png') });
    expect
      .soft(colors.selected, "Selection must use the user's high-contrast highlight")
      .toBe(colors.highlight);
    expect.soft(colors.selected).not.toBe(colors.canvas);
    await page.emulateMedia({ forcedColors: 'none' });
    const tab = page.getByRole('tab', { name: /^Café audit,/ });
    await expect(tab).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await tab.focus();
    await tab.press('Delete');
    await expect(tab).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+T');
    await expect(tab).toBeVisible();
    await page.keyboard.press('ControlOrMeta+1');
    await page.getByTestId('commit-subject').fill('Saved before renderer crash');
    await app.evaluate(({ BrowserWindow, dialog }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      Object.assign(dialog, {
        showMessageBox: async (_window: unknown, options: unknown) => {
          Object.assign(globalThis, { p14CrashPrompt: options });
          return { response: 0, checkboxChecked: false };
        },
      });
      window.webContents.once('render-process-gone', (_event, details) => {
        Object.assign(globalThis, { p14CrashReason: details.reason });
      });
      window.webContents.once('did-finish-load', () => Object.assign(globalThis, { p14Reloaded: true }));
      // Finish the inspector request before terminating its renderer. The native main process owns recovery.
      setTimeout(() => process.kill(window.webContents.getOSProcessId(), 'SIGKILL'), 50);
    });
    await expect
      .poll(() => app.evaluate(() => Object.assign({ p14Reloaded: false }, globalThis).p14Reloaded))
      .toBe(true);
    expect(await app.evaluate(() => Object.assign({ p14CrashReason: '' }, globalThis).p14CrashReason)).toBe(
      'killed',
    );
    // Playwright treats a crashed Page as terminal; inspect the recovered document through its native owner.
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
            'document.querySelector(".app")?.dataset.desktopStatus',
          ),
        ),
      )
      .toBe('connected');
    // Preload connection precedes repository restoration. A native JS click has no locator auto-wait.
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
            '[...document.querySelectorAll("button")].some(button => button.textContent.startsWith("Local Changes") && !button.disabled)',
          ),
        ),
      )
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
        '[...document.querySelectorAll("button")].find(button => button.textContent.startsWith("Local Changes"))?.click()',
      ),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
            'document.querySelector("[data-testid=commit-subject]")?.value',
          ),
        ),
      )
      .toBe('Saved before renderer crash');
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
          '"require" in window || "process" in window',
        ),
      ),
    ).toBe(false);
  } finally {
    await f.close();
  }
});
