import { openTrustedFixture } from './trusted-fixture';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

async function initRepository(git: GitRunner, path: string, file: string, content: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: path });
  await git.run(['config', 'user.name', 'F23 Author'], { cwd: path });
  await git.run(['config', 'user.email', 'f23@example.test'], { cwd: path });
  await writeFile(join(path, file), content, 'utf8');
  await git.run(['add', '--', file], { cwd: path });
  await git.run(['commit', '--quiet', '-m', 'baseline'], { cwd: path });
}

test('F23 reads submodule state, shows revision cards, opens the child tab, and updates a missing child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-f23-ui-'));
  const source = join(root, 'module-source');
  const parent = join(root, 'parent');
  const profile = join(root, 'profile');
  const git = new GitRunner();
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await initRepository(git, source, 'module.txt', 'baseline\n');
    await initRepository(git, parent, 'parent.txt', 'parent\n');
    await git.run(
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '--', source, 'modules/demo'],
      { cwd: parent },
    );
    await git.run(['commit', '--quiet', '-m', 'add module'], { cwd: parent });

    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    environment.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment,
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, parent);
    expect(opened).toMatchObject({ ok: true, value: { name: 'parent' } });
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');

    await expect(page.getByRole('treeitem', { name: 'Submodules', exact: true })).toBeVisible();
    await page.getByRole('treeitem', { name: 'modules', exact: true }).dblclick();
    await expect(page.getByRole('treeitem', { name: 'demo', exact: true })).toBeVisible();
    const parentId = opened.value.id;
    const initial = await page.evaluate(
      async (id) => window.desktop!.repository.getSubmodules({ id }),
      parentId,
    );
    expect(initial).toMatchObject({
      ok: true,
      value: { submodules: [{ path: 'modules/demo', state: 'clean' }] },
    });

    await writeFile(join(parent, 'modules/demo/module.txt'), 'dirty from child\n', 'utf8');
    await expect
      .poll(async () => {
        const value = await page.evaluate(
          async (id) => window.desktop!.repository.getSubmodules({ id }),
          parentId,
        );
        return value.ok ? value.value.submodules[0]?.state : 'error';
      })
      .toBe('dirty');
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await expect(page.getByTestId('submodule-preview')).toBeVisible();
    await expect(page.getByTestId('submodule-preview')).toContainText("Submodule 'demo'");
    await expect(page.getByTestId('submodule-preview')).toContainText('1 uncommitted file');
    await page.screenshot({ path: 'test-results/f23-submodule-dirty-card.png' });

    await page.getByRole('button', { name: 'Open Submodule', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^parent: demo,/u })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^parent: demo,/u })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^parent,/u }).click();

    await git.run(['submodule', 'deinit', '--force', '--', 'modules/demo'], { cwd: parent });
    await rm(join(parent, 'modules/demo'), { recursive: true, force: true });
    const missing = await page.evaluate(
      async (id) => window.desktop!.repository.getSubmodules({ id }),
      parentId,
    );
    expect(missing).toMatchObject({ ok: true, value: { submodules: [{ state: 'missing' }] } });
    if (!missing.ok) throw new Error(missing.error.message);
    const submoduleId = missing.value.submodules[0]!.id;
    const accepted = await page.evaluate(
      async ({ id, submoduleId, snapshot }) =>
        window.desktop!.repository.startSubmoduleOperation({
          id,
          action: { kind: 'update', submoduleId, recursive: false },
          snapshot,
        }),
      { id: parentId, submoduleId, snapshot: missing.value.snapshot },
    );
    expect(accepted).toMatchObject({ ok: true, value: { kind: 'submodule', status: 'running' } });
    if (!accepted.ok) throw new Error(accepted.error.message);
    await expect
      .poll(async () => {
        const operations = await page.evaluate(() => window.desktop!.repository.listOperations());
        const operation = operations.ok
          ? operations.value.find((candidate) => candidate.id === accepted.value.id)
          : undefined;
        return operation?.status;
      })
      .toBe('succeeded');
    expect(await readFile(join(parent, 'modules/demo/module.txt'), 'utf8')).toBe('baseline\n');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
