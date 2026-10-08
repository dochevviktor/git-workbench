import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect as baseExpect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';
import { installIpcGate } from './ipc-gate';

// Leave time for the renderer to reconcile a deliberately held request on hosted runners.
const expect = baseExpect.configure({ timeout: 15000 });

test('staging controls retain a pressed action across an unchanged background refresh', async () => {
  const f = await auditFixture();
  const gate = await installIpcGate(f.app, [{ channel: 'repository:get-working-changes', phase: 'after' }]);
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.open();
    await f.page.keyboard.press('ControlOrMeta+1');
    const unstaged = f.page.getByTestId('working-changes-unstaged').getByTestId('working-change');
    const staged = f.page.getByTestId('working-changes-staged').getByTestId('working-change');
    await expect(unstaged).toHaveCount(1);
    for (const area of ['unstaged', 'staged'] as const) {
      const control = f.page.getByTestId(`working-${area}-action`);
      await expect(control).toBeEnabled();
      const bounds = (await control.boundingBox())!;
      await f.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await f.page.mouse.down();
      await gate.pause();
      await f.page.keyboard.press('F5');
      await gate.wait();
      await expect(control).toBeEnabled();
      await f.page.mouse.up();
      await gate.release();
      await expect(staged).toHaveCount(area === 'unstaged' ? 1 : 0);
      await expect(unstaged).toHaveCount(area === 'unstaged' ? 0 : 1);
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

test('P14 commit completion refreshes the current context after an earlier watcher refresh', async () => {
  const f = await auditFixture();
  const gate = await installIpcGate(f.app, [{ channel: 'repository:commit', phase: 'after' }]);
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.run('add', 'value.ts');
    await f.open();
    await f.page.keyboard.press('ControlOrMeta+1');
    const subject = f.page.getByTestId('commit-subject');
    const submit = f.page.getByTestId('commit-submit');
    const amend = f.page.getByTestId('commit-amend');
    await subject.fill('Commit before delayed acknowledgement');
    await expect(submit).toBeEnabled();
    await gate.pause();
    await submit.click();
    await gate.wait();
    await expect.poll(() => f.run('log', '-1', '--format=%s')).toBe('Commit before delayed acknowledgement');
    // Real Git completes and the watcher advances the composer before its submit callback resumes.
    await expect(f.page.getByTestId('working-changes-staged').getByTestId('working-change')).toHaveCount(0);
    await expect.poll(() => submit.getAttribute('title')).toMatch(/^(Stage at least|Another working-tree)/u);
    await gate.release();
    await expect(subject).toHaveValue('');
    await expect(amend).toBeEnabled();
    await amend.check();
    await expect(subject).toHaveValue('Commit before delayed acknowledgement');
    expect(await f.run('rev-list', '--count', 'HEAD')).toBe('3');
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await gate.dispose();
    await f.close();
  }
});
