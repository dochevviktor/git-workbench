import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('P02 manager folders, aliases, summaries, default source and automatic discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-ui-'));
  const source = join(root, 'Projects');
  const repository = join(source, 'Workbench');
  await mkdir(repository, { recursive: true });
  const git = new GitRunner();
  await git.run(['init', '--initial-branch=main'], { cwd: repository });
  await writeFile(join(repository, 'README.md'), '# Workbench\n');
  await git.run(['add', '.'], { cwd: repository });
  await git.run(
    [
      '-c',
      'user.name=Alex',
      '-c',
      'user.email=alex@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Create workspace',
    ],
    { cwd: repository },
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  environment.ELECTRON_RENDERER_URL = '';
  const app = await electron.launch({
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
    env: environment,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    await page.evaluate(async (path) => {
      const result = await window.desktop!.repository.addSourceDirectory({ path });
      if (!result.ok) throw new Error(result.error.message);
    }, source);
    await page.reload();
    await page.getByTestId('manager-repository').click();
    await expect(page.getByTestId('manager-summary')).toContainText('Create workspace');
    await expect(page.getByTestId('manager-summary')).toContainText('Commits:1');
    const indexBefore = await readFile(join(repository, '.git', 'index'));
    await page.getByRole('button', { name: 'New Folder…', exact: true }).click();
    const folder = page.getByRole('dialog', { name: 'New Folder', exact: true });
    await folder.getByLabel('Name:', { exact: true }).fill('Work');
    await folder.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: 'Work', exact: true })).toBeVisible();
    await page.getByTestId('manager-repository').click();
    await page.getByRole('button', { name: 'Organize Repository…', exact: true }).click();
    const organize = page.getByRole('dialog', { name: 'Organize Repository', exact: true });
    await organize.getByLabel('Display name:').fill('Client App');
    await organize.getByLabel('Folder:').selectOption({ label: 'Work' });
    await organize.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('manager-repository')).toHaveText('Client App');
    await page.getByRole('button', { name: 'Clone…', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Clone', exact: true }).getByLabel('Parent Folder:'),
    ).toHaveValue(source);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await page.getByTestId('manager-repository').click();
    await expect(page.getByTestId('manager-summary')).toContainText('Create workspace');
    await expect(page.getByRole('button', { name: 'Cancel Scan', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/p02-manager-light.png' });
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await page.screenshot({ path: 'test-results/p02-manager-dark.png' });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setBounds({ width: 880, height: 600 }),
    );
    await expect(page.getByLabel('Filter repositories', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/p02-manager-narrow.png' });
    const geometry = await page.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.body.scrollWidth,
      overflow: [...document.querySelectorAll('body *')]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 12)
        .map((element) => ({ name: element.className, right: element.getBoundingClientRect().right })),
    }));
    expect(geometry.scroll <= geometry.width, JSON.stringify(geometry)).toBe(true);
    const other = join(source, 'Newly discovered');
    await mkdir(other);
    await git.run(['init', '--initial-branch=main'], { cwd: other });
    await expect(page.getByTestId('manager-repository').filter({ hasText: 'Newly discovered' })).toBeVisible({
      timeout: 8000,
    });
    await page.getByLabel('Filter repositories', { exact: true }).fill('client');
    await expect(page.getByTestId('manager-repository')).toHaveCount(1);
    await page.getByLabel('Filter repositories', { exact: true }).fill('');
    await page.reload();
    await expect(page.getByTestId('manager-repository').filter({ hasText: 'Client App' })).toBeVisible();
    expect(await readFile(join(repository, '.git', 'index'))).toEqual(indexBefore);
    expect((await git.run(['status', '--porcelain'], { cwd: repository })).stdout).toBe('');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('P02 tab isolation, close/reopen, live file changes, drafts, restart and moved-path recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-tabs-'));
  const profile = join(root, 'profile');
  const first = join(root, 'First');
  const second = join(root, 'Second');
  const git = new GitRunner();
  const run = async (cwd: string, ...args: string[]) => (await git.run(args, { cwd })).stdout.trim();
  for (const path of [first, second]) {
    await mkdir(path);
    await run(path, 'init', '--initial-branch=main');
    await run(path, 'config', 'user.name', 'Alex');
    await run(path, 'config', 'user.email', 'alex@example.invalid');
    await run(path, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(path, 'file.txt'), 'one\n');
    await run(path, 'add', '.');
    await run(path, 'commit', '-m', `${path === first ? 'First' : 'Second'} initial`);
  }
  const old = await run(first, 'rev-parse', 'HEAD');
  await writeFile(join(first, 'file.txt'), 'two\n');
  await run(first, 'commit', '-am', 'First current');
  const head = await run(first, 'rev-parse', 'HEAD');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  const launch = () =>
    electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    for (const path of [first, second])
      await page.evaluate(async (path) => {
        const opened = await window.desktop!.repository.open({ path });
        if (!opened.ok) throw new Error(opened.error.message);
        const trusted = await window.desktop!.repository.setTrust({ id: opened.value.id, trusted: true });
        if (!trusted.ok) throw new Error(trusted.error.message);
      }, path);
    await page.reload();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('tab', { name: /^First, /u }).click();
    await page.getByTestId('history-commit').filter({ hasText: 'First initial' }).click();
    await expect(page.locator('.history-full-hash')).toHaveText(old);
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByRole('tab', { name: /^Second, /u }).click();
    await expect(page.getByTestId('history-commit').first()).toContainText('Second initial');
    await page.getByRole('tab', { name: /^First, /u }).click();
    await expect(page.getByTestId('history-commit').filter({ hasText: 'First initial' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Control+w');
    expect(errors).toEqual([]);
    await expect(page.getByRole('tab', { name: /^First, /u })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+t');
    await expect(page.getByRole('tab', { name: /^First, /u })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await expect(page.getByRole('tab', { name: 'Commit', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Control+1');
    await page.getByTestId('commit-subject').fill('Draft for First');
    await page.getByTestId('commit-description').fill('Retain through close and restart.');
    await writeFile(join(first, 'file.txt'), 'external first version\n');
    await expect(page.getByTestId('diff-content')).toContainText('external first version', { timeout: 7000 });
    await writeFile(join(first, 'file.txt'), 'external second version\n');
    await expect(page.getByTestId('diff-content')).toContainText('external second version', {
      timeout: 7000,
    });
    await page.getByRole('tab', { name: /^Second, /u }).click();
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('commit-subject')).toHaveValue('');
    await page.getByTestId('commit-subject').fill('Draft for Second');
    await page.getByRole('tab', { name: /^First, /u }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Draft for First');
    await page.getByRole('button', { name: 'Show repository list', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await app.close();
    const moved = join(root, 'First moved');
    await rename(first, moved);
    await writeFile(join(profile, 'repository-manager.json'), '{broken');
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('listbox', { name: 'Repository list' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Workspace Recovery', exact: true }).click();
    const recovery = page.getByRole('region', { name: 'Workspace recovery', exact: true });
    await expect(recovery).toContainText('First');
    await expect(recovery).toContainText('Recovered settings');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, moved);
    await recovery.getByRole('button', { name: 'Locate…', exact: true }).click();
    await expect(recovery.getByRole('button', { name: 'Locate…', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^First moved, /u }).click();
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('commit-subject')).toHaveValue('Draft for First');
    await expect(page.getByTestId('commit-description')).toHaveValue('Retain through close and restart.');
    expect(await run(moved, 'rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(moved, 'file.txt'), 'utf8')).toBe('external second version\n');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('P02 initialize dialog supports Cancel and a bare repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-init-'));
  const destination = join(root, 'bare.git');
  await mkdir(destination);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  env.ELECTRON_RENDERER_URL = '';
  const app = await electron.launch({
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Initialize Repository…', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Initialize Repository', exact: true });
    await dialog.getByLabel('Folder:', { exact: true }).fill(destination);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(readFile(join(destination, 'HEAD'))).rejects.toThrow();
    await page.getByRole('button', { name: 'Initialize Repository…', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Initialize Repository', exact: true });
    await dialog.getByLabel('Folder:', { exact: true }).fill(destination);
    await dialog.getByLabel('Bare repository (no working files)').check();
    await dialog.getByRole('button', { name: 'Initialize', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^bare.git, /u })).toBeVisible();
    expect(
      (await new GitRunner().run(['rev-parse', '--is-bare-repository'], { cwd: destination })).stdout.trim(),
    ).toBe('true');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('P02 a delayed history response cannot replace the active repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-p02-delayed-'));
  const slow = join(root, 'Slow');
  const fast = join(root, 'Fast');
  const git = new GitRunner();
  for (const cwd of [slow, fast]) {
    await mkdir(cwd);
    await git.run(['init', '--initial-branch=main'], { cwd });
    await git.run(
      [
        '-c',
        'user.name=Alex',
        '-c',
        'user.email=alex@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        cwd === slow ? 'Slow history' : 'Fast history',
      ],
      { cwd },
    );
  }
  const wrapper = join(root, 'delayed-git.ts');
  await copyFile(resolve('tests/fixtures/delayed-git.ts'), wrapper);
  await chmod(wrapper, 0o700);
  const marker = join(root, 'read-started');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
    ),
  ) as Record<string, string>;
  Object.assign(env, {
    ELECTRON_RENDERER_URL: '',
    GIT_EXECUTABLE: wrapper,
    GIT_WORKBENCH_REAL_GIT: (await git.version()).executable,
    GIT_WORKBENCH_DELAY_REPOSITORY: slow,
    GIT_WORKBENCH_DELAY_MARKER: marker,
  });
  const app = await electron.launch({
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${join(root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    for (const path of [slow, fast])
      await page.evaluate(async (path) => {
        const result = await window.desktop!.repository.open({ path });
        if (!result.ok) throw new Error(result.error.message);
      }, path);
    await page.reload();
    await expect(page.getByTestId('history-commit').first()).toContainText('Fast history');
    await page.getByRole('tab', { name: /^Slow, /u }).click();
    await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).toBe('log started');
    await page.getByRole('tab', { name: /^Fast, /u }).click();
    await expect(page.getByTestId('history-commit').first()).toContainText('Fast history');
    await expect
      .poll(() => readFile(`${marker}.done`, 'utf8').catch(() => ''), { timeout: 5000 })
      .toBe('log cancelled');
    await expect(page.getByTestId('history-commit').first()).toContainText('Fast history');
    await expect(page.getByTestId('history-commit').filter({ hasText: 'Slow history' })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
