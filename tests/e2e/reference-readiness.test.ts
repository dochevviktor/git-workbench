import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { auditFixture } from './p14-fixture';

/** Hold real, validated reference results while the tab/history can observe a new HEAD. */
async function holdReferences(app: ElectronApplication, holdSessions = false) {
  await app.evaluate(({ ipcMain }, holdSessions) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
      }
    )._invokeHandlers;
    const state = { entered: 0, release: () => {} };
    const gate = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    Object.assign(globalThis, { referenceReadGate: state });
    const channels = ['repository:get-reference-context', ...(holdSessions ? ['repository:list-open'] : [])];
    for (const channel of channels) {
      const original = handlers.get(channel);
      if (!original) throw new Error(`Missing ${channel} handler.`);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args: unknown[]) => {
        const result = await original(...args);
        state.entered++;
        await gate;
        return result;
      });
    }
  }, holdSessions);
  return {
    entered: () =>
      app.evaluate(
        () =>
          (
            globalThis as unknown as {
              referenceReadGate: { entered: number };
            }
          ).referenceReadGate.entered,
      ),
    release: () =>
      app.evaluate(() =>
        (
          globalThis as unknown as {
            referenceReadGate: { release: () => void };
          }
        ).referenceReadGate.release(),
      ),
  };
}

test('new branch waits for the reference snapshot after a commit', async () => {
  const f = await auditFixture();
  let gate: Awaited<ReturnType<typeof holdReferences>> | undefined;
  try {
    await f.open();
    await expect(f.page.getByRole('button', { name: 'Branch', exact: true })).toBeEnabled();
    gate = await holdReferences(f.app);
    await f.run('commit', '--allow-empty', '-qm', 'New head before reference refresh');
    const head = await f.run('rev-parse', 'HEAD');
    await f.page.keyboard.press('F5');
    await expect(f.page.locator('.commit-row.head')).toHaveAttribute('data-commit-id', head);
    await expect.poll(gate.entered).toBeGreaterThan(0);
    await f.page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    const create = f.page
      .getByRole('menu', { name: 'Branch', exact: true })
      .getByRole('menuitem', { name: 'New Branch…', exact: true });
    await expect(create).toBeDisabled();
    await gate.release();
    await expect(create).toBeEnabled();
    await create.click();
    const dialog = f.page.getByTestId('reference-dialog');
    await dialog.getByTestId('reference-name').fill('fresh-branch');
    await dialog.getByTestId('reference-checkout').check();
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    expect(await f.run('branch', '--show-current')).toBe('fresh-branch');
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
  } finally {
    await gate?.release().catch(() => undefined);
    await f.close();
  }
});

test('an open branch menu waits for the checked-out branch and updates without reopening', async () => {
  const f = await auditFixture();
  let gate: Awaited<ReturnType<typeof holdReferences>> | undefined;
  try {
    await f.open();
    await expect(f.page.getByRole('button', { name: 'Branch', exact: true })).toBeEnabled();
    gate = await holdReferences(f.app);
    await f.run('checkout', '-qb', 'topic');
    await f.page.keyboard.press('F5');
    await expect(f.page.locator('.toolbar-repository-branch')).toHaveText('topic');
    await expect.poll(gate.entered).toBeGreaterThan(0);
    await f.page.getByRole('treeitem', { name: 'main', exact: true }).click({ button: 'right' });
    const menu = f.page.getByRole('menu', { name: 'main', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: "Rebase 'main' on 'main'…", exact: true })).toHaveCount(
      0,
    );
    await gate.release();
    const rebase = menu.getByRole('menuitem', { name: "Rebase 'topic' on 'main'…", exact: true });
    await expect(rebase).toBeEnabled();
    await rebase.click();
    const dialog = f.page.getByTestId('reference-dialog');
    await expect(dialog).toContainText('topic');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('branch', '--show-current')).toBe('topic');
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await gate?.release().catch(() => undefined);
    await f.close();
  }
});

test('a reference change after review remains a visible refusal without creating the branch', async () => {
  const f = await auditFixture();
  try {
    await f.open();
    await f.page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    await f.page.getByRole('menuitem', { name: 'New Branch…', exact: true }).click();
    const dialog = f.page.getByTestId('reference-dialog');
    await dialog.getByTestId('reference-name').fill('reviewed-branch');
    await f.run('commit', '--allow-empty', '-qm', 'Changed after review');
    const head = await f.run('rev-parse', 'HEAD');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog.getByRole('alert')).toContainText('references changed');
    expect(await f.run('branch', '--list', 'reviewed-branch')).toBe('');
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await f.close();
  }
});

test('new branch reviews fresh references even before the tab observes a commit', async () => {
  const f = await auditFixture();
  let gate: Awaited<ReturnType<typeof holdReferences>> | undefined;
  try {
    await f.open();
    await expect(f.page.getByRole('button', { name: 'Branch', exact: true })).toBeEnabled();
    gate = await holdReferences(f.app, true);
    await f.run('commit', '--allow-empty', '-qm', 'Commit before tab refresh');
    const head = await f.run('rev-parse', 'HEAD');
    await f.page.getByRole('button', { name: 'Branch menu', exact: true }).click();
    await f.page.getByRole('menuitem', { name: 'New Branch…', exact: true }).click();
    await expect.poll(gate.entered).toBeGreaterThan(0);
    await gate.release();
    const dialog = f.page.getByTestId('reference-dialog');
    await expect(dialog.locator('.reference-target-detail')).toHaveText(head.slice(0, 7));
    await dialog.getByTestId('reference-name').fill('fresh-before-tab');
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    expect(await f.run('rev-parse', 'fresh-before-tab')).toBe(head);
    expect(await f.run('branch', '--show-current')).toBe('main');
  } finally {
    await gate?.release().catch(() => undefined);
    await f.close();
  }
});
