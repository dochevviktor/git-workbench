import { expect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';
import { installIpcGate } from './ipc-gate';

for (const route of ['pointer', 'keyboard', 'dismissed', 'replaced'] as const) {
  test(`history menu refreshes loading actions without changing its target (${route})`, async () => {
    const f = await auditFixture();
    const gate = await installIpcGate(f.app, [
      { channel: 'repository:get-reference-context', phase: 'after' },
    ]);
    try {
      await f.open();
      await expect(f.page.getByRole('button', { name: 'Branch', exact: true })).toBeEnabled();
      await gate.pause();
      await f.run('commit', '--allow-empty', '-qm', 'New HEAD before history menu');
      const head = await f.run('rev-parse', 'HEAD');
      await f.page.keyboard.press('F5');
      await expect(f.page.locator('.commit-row.head')).toHaveAttribute('data-commit-id', head);
      await gate.wait();

      const row = f.page.locator(`.commit-row[data-commit-id="${f.head}"]`);
      if (route === 'keyboard') {
        await row.click();
        await f.page.keyboard.press('Shift+F10');
      } else await row.click({ button: 'right' });
      const menu = f.page.getByRole('menu', { name: `Commit ${f.head.slice(0, 7)}`, exact: true });
      const reset = menu.getByRole('menuitem', { name: "Reset 'main' to Here…", exact: true });
      await expect(reset).toBeDisabled();

      if (route === 'dismissed') await f.page.keyboard.press('Escape');
      if (route === 'replaced') {
        await f.page.getByRole('treeitem', { name: 'main', exact: true }).click({
          button: 'right',
          position: { x: 8, y: 10 },
        });
      }
      await gate.release();
      await expect(f.page.getByRole('button', { name: 'Branch', exact: true })).toBeEnabled();

      if (route === 'dismissed' || route === 'replaced') {
        await expect(menu).toHaveCount(0);
        if (route === 'dismissed') await expect(f.page.getByRole('menu')).toHaveCount(0);
        else await expect(f.page.getByRole('menu', { name: 'main', exact: true })).toBeVisible();
        expect(await f.run('rev-parse', 'HEAD')).toBe(head);
      } else {
        await expect(reset).toBeEnabled();
        await reset.click();
        const dialog = f.page.getByTestId('reference-dialog');
        await expect(dialog).toContainText('Second audit revision');
        await expect(dialog.locator('.reference-target-detail')).toHaveText(f.head.slice(0, 7));
        await dialog.getByTestId('reference-dialog-submit').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => f.run('rev-parse', 'HEAD')).toBe(f.head);
        await expect
          .poll(() =>
            f.page.evaluate(async () => {
              const result = await window.desktop!.repository.listOperations();
              if (!result.ok) throw new Error(result.error.message);
              return result.value.find((operation) => operation.kind === 'reset')?.status;
            }),
          )
          .toBe('succeeded');
        expect(await f.run('status', '--porcelain')).toBe('');
      }
    } finally {
      await gate.dispose();
      await f.close();
    }
  });
}
