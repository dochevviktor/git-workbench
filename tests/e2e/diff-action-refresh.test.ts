import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';
import { installIpcGate } from './ipc-gate';

test('hunk staging and unstaging retain a pressed action through an unchanged diff refresh', async () => {
  const f = await auditFixture();
  const gate = await installIpcGate(f.app, [{ channel: 'repository:get-diff', phase: 'after' }]);
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.open();
    await f.page.keyboard.press('ControlOrMeta+1');
    for (const area of ['unstaged', 'staged'] as const) {
      const row = f.page.getByTestId(`working-changes-${area}`).getByTestId('working-change');
      await row.click();
      const content = f.page.getByTestId('diff-content');
      await expect(content).toContainText('export const value = 3;');
      await expect(content).toHaveAttribute('aria-busy', 'false');
      await f.page
        .getByTestId('diff-change-region')
        .first()
        .hover({ position: { x: 120, y: 4 } });
      const control = f.page.getByTestId(`diff-hunk-${area === 'unstaged' ? 'stage' : 'unstage'}`).first();
      await expect(control).toBeEnabled();
      const bounds = (await control.boundingBox())!;
      await f.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await f.page.mouse.down();
      await gate.pause();
      await f.page.keyboard.press('F5');
      await gate.wait();
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(control).toBeEnabled();
      await f.page.mouse.up();
      await gate.release();
      await expect(row).toHaveCount(0);
    }
    expect(await f.run('diff', '--cached')).toBe('');
    expect(await f.run('diff')).toContain('+export const value = 3;');
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
  } finally {
    await f.page.mouse.up().catch(() => undefined);
    await gate.dispose();
    await f.close();
  }
});

test('a hunk action during refresh still rejects externally changed content', async () => {
  const f = await auditFixture();
  const gate = await installIpcGate(f.app, [{ channel: 'repository:get-diff', phase: 'after' }]);
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.open();
    await f.page.keyboard.press('ControlOrMeta+1');
    await f.page.getByTestId('working-changes-unstaged').getByTestId('working-change').click();
    const content = f.page.getByTestId('diff-content');
    await expect(content).toContainText('export const value = 3;');
    await expect(content).toHaveAttribute('aria-busy', 'false');
    await gate.pause();
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 4;\n');
    await f.page.keyboard.press('F5');
    await gate.wait();
    await f.page
      .getByTestId('diff-change-region')
      .first()
      .hover({ position: { x: 120, y: 4 } });
    const control = f.page.getByTestId('diff-hunk-stage').first();
    await expect(control).toBeEnabled();
    await control.click();
    await expect(f.page.getByTestId('working-changes').getByRole('alert')).toContainText(/changed|refresh/i);
    expect(await f.run('diff', '--cached')).toBe('');
    expect(await f.run('diff')).toContain('+export const value = 4;');
  } finally {
    await gate.dispose();
    await f.close();
  }
});
