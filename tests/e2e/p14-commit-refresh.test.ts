import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { auditFixture } from './p14-fixture';

test('P14 commit completion refreshes the current context after an earlier watcher refresh', async () => {
  const f = await auditFixture(true);
  try {
    await writeFile(join(f.repo, 'value.ts'), 'export const value = 3;\n');
    await f.run('add', 'value.ts');
    await f.open();
    await f.page.keyboard.press('Control+1');
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
    await f.close();
  }
});
