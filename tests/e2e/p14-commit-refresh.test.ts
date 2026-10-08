import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect as baseExpect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';

// These fixtures wrap every Git process, including the reads made while a write is held.
const expect = baseExpect.configure({ timeout: 15000 });

test('staging controls retain a pressed action across an unchanged background refresh', async () => {
  const f = await auditFixture(true);
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
      await rm(`${f.gate}.waiting`, { force: true });
      await writeFile(f.gate, JSON.stringify({ command: 'status', phase: 'before' }));
      await f.page.keyboard.press('F5');
      await expect.poll(() => readFile(`${f.gate}.waiting`, 'utf8').catch(() => '')).toBe('status:before');
      await expect(control).toBeEnabled();
      await f.page.mouse.up();
      await rm(f.gate);
      await expect(staged).toHaveCount(area === 'unstaged' ? 1 : 0);
      await expect(unstaged).toHaveCount(area === 'unstaged' ? 0 : 1);
    }
    expect(await f.run('diff', '--cached')).toBe('');
    expect(await f.run('diff')).toContain('+export const value = 3;');
    expect(await f.run('rev-parse', 'HEAD')).toBe(f.head);
  } finally {
    await f.page.mouse.up().catch(() => undefined);
    await rm(f.gate, { force: true });
    await f.close();
  }
});

test('P14 commit completion refreshes the current context after an earlier watcher refresh', async () => {
  const f = await auditFixture(true);
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.run('add', 'value.ts');
    await f.open();
    await f.page.keyboard.press('ControlOrMeta+1');
    const subject = f.page.getByTestId('commit-subject');
    const submit = f.page.getByTestId('commit-submit');
    const amend = f.page.getByTestId('commit-amend');
    await subject.fill('Commit before delayed process exit');
    await expect(submit).toBeEnabled();
    await writeFile(f.gate, JSON.stringify({ command: 'commit', phase: 'after' }));
    await submit.click();
    await expect.poll(() => readFile(`${f.gate}.waiting`, 'utf8').catch(() => '')).toBe('commit:after');
    expect(await f.run('log', '-1', '--format=%s')).toBe('Commit before delayed process exit');
    // The worktree/HEAD watcher observes Git's result before the accepted operation completes.
    await expect(f.page.getByTestId('working-changes-staged').getByTestId('working-change')).toHaveCount(0);
    await expect.poll(() => submit.getAttribute('title')).toMatch(/^(Stage at least|Another working-tree)/u);
    await rm(f.gate);
    await expect(subject).toHaveValue('');
    await expect(amend).toBeEnabled();
    await amend.check();
    await expect(subject).toHaveValue('Commit before delayed process exit');
    expect(await f.run('rev-list', '--count', 'HEAD')).toBe('3');
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await rm(f.gate, { force: true });
    await f.close();
  }
});
