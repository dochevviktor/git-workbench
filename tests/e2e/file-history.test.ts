import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

const author = ['-c', 'user.name=F21 Author', '-c', 'user.email=f21@example.test'];

function environment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key)) result[key] = value;
  }
  result.ELECTRON_RENDERER_URL = '';
  return result;
}

async function commit(git: GitRunner, cwd: string, subject: string): Promise<string> {
  await git.run(['add', '-A', '--'], { cwd });
  await git.run([...author, 'commit', '--quiet', '-m', subject], { cwd });
  return (await git.run(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}

test('F21 opens rename-aware file history and blame inspectors without changing Git state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-f21-e2e-'));
  const repositoryPath = join(root, 'repository');
  const profile = join(root, 'profile');
  await mkdir(repositoryPath);
  const git = new GitRunner();
  let application: ElectronApplication | undefined;
  try {
    await git.run(['init', '-q'], { cwd: repositoryPath });
    await git.run(['config', 'user.name', 'F21 Author'], { cwd: repositoryPath });
    await git.run(['config', 'user.email', 'f21@example.test'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, 'old.txt'), 'Alpha\nBeta\n', 'utf8');
    await commit(git, repositoryPath, 'Create original filename');
    await writeFile(join(repositoryPath, 'old.txt'), 'Alpha\nBeta revised\n', 'utf8');
    await commit(git, repositoryPath, 'Edit before rename');
    await git.run(['mv', '--', 'old.txt', 'renamed café.txt'], { cwd: repositoryPath });
    await commit(git, repositoryPath, 'Rename synthetic notes');
    await writeFile(join(repositoryPath, 'renamed café.txt'), 'Alpha\nBeta revised\nGamma\n', 'utf8');
    const head = await commit(git, repositoryPath, 'Edit after rename');

    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
      env: environment(),
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(
      async (path) => window.desktop!.repository.open({ path }),
      repositoryPath,
    );
    expect(opened).toMatchObject({ ok: true });
    if (!opened.ok) throw new Error(opened.error.message);

    const fileHistoryWindow = application.waitForEvent('window');
    const openedHistory = await page.evaluate(
      async ({ id, commitId }) =>
        window.desktop!.repository.openFileHistory({
          id,
          commitId,
          path: 'renamed café.txt',
          theme: 'light',
        }),
      { id: opened.value.id, commitId: head },
    );
    expect(openedHistory).toMatchObject({ ok: true });
    const historyPage = await fileHistoryWindow;
    await expect(historyPage.getByTestId('file-history-inspector')).toBeVisible();
    await expect(historyPage.getByTestId('file-history-revision')).toHaveCount(4);
    await expect(historyPage.getByTestId('diff-content')).toContainText('Gamma');
    await historyPage.screenshot({ path: 'test-results/f21-file-history.png' });

    const blameWindow = application.waitForEvent('window');
    await historyPage.getByRole('button', { name: 'Blame / Timeline', exact: true }).click();
    const blamePage = await blameWindow;
    await expect(blamePage.getByTestId('blame-inspector')).toBeVisible();
    await expect(blamePage.getByTestId('blame-line')).toHaveCount(3);
    await blamePage.getByRole('combobox', { name: 'Blame revision' }).selectOption('2');
    await expect(blamePage.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
    await expect(blamePage.getByTestId('blame-line')).toHaveCount(2);
    await expect(blamePage.getByTestId('blame-line').last()).toContainText('Beta revised');
    await blamePage.screenshot({ path: 'test-results/f21-blame.png' });

    const commitWindow = application.waitForEvent('window');
    await blamePage.getByRole('button', { name: /[0-9a-f]{7} · Edit before rename/u }).click();
    const commitPage = await commitWindow;
    await expect(commitPage.getByTestId('commit-inspector')).toBeVisible();
    await commitPage.getByRole('tab', { name: 'Commit', exact: true }).click();
    await expect(commitPage.getByRole('heading', { name: 'Edit before rename', exact: true })).toBeVisible();

    await commitPage.close();
    await blamePage.close();
    await historyPage.close();
    expect((await git.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim()).toBe(head);
    expect((await git.run(['status', '--porcelain'], { cwd: repositoryPath })).stdout).toBe('');
    expect(await readFile(join(repositoryPath, 'renamed café.txt'), 'utf8')).toBe(
      'Alpha\nBeta revised\nGamma\n',
    );
  } finally {
    await application?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
