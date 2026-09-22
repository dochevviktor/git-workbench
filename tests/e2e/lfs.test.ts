import { openTrustedFixture } from './trusted-fixture';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';

test('F24 identifies a historical LFS pointer and saves its local payload without changing Git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-lfs-e2e-'));
  const profile = await mkdtemp(join(tmpdir(), 'git-workbench-lfs-e2e-profile-'));
  const repositoryPath = join(root, 'repository');
  const destination = join(root, 'saved.bin');
  await mkdir(repositoryPath);
  const git = new GitRunner();
  const payload = Buffer.alloc(32_768, 0x37);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256}\nsize ${payload.byteLength}\n`;
  let application: ElectronApplication | undefined;
  try {
    await git.run(['init', '--quiet', '--initial-branch=main'], { cwd: repositoryPath });
    await writeFile(join(repositoryPath, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    await writeFile(join(repositoryPath, 'sample.bin'), pointer);
    await git.run(['add', '--', '.gitattributes', 'sample.bin'], { cwd: repositoryPath });
    await git.run(
      [
        '-c',
        'user.name=LFS E2E',
        '-c',
        'user.email=lfs-e2e@test.invalid',
        'commit',
        '--quiet',
        '-m',
        'LFS payload',
      ],
      { cwd: repositoryPath },
    );
    const objectDirectory = join(
      repositoryPath,
      '.git',
      'lfs',
      'objects',
      sha256.slice(0, 2),
      sha256.slice(2, 4),
    );
    await mkdir(objectDirectory, { recursive: true });
    await writeFile(join(objectDirectory, sha256), payload);
    const head = (await git.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim();

    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    application = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${profile}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await application.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, repositoryPath);
    expect(opened).toMatchObject({ ok: true });
    await page.reload();
    await expect(page.locator('.history-full-hash')).toHaveText(head);
    await page.getByRole('tab', { name: 'Changes', exact: true }).click();
    await page.getByTestId('commit-change').filter({ hasText: 'sample.bin' }).click();
    await expect(page.getByTestId('lfs-file-card')).toContainText('32.0 KB (32,768 B)');
    await expect(page.getByRole('button', { name: 'LFS payload options' })).toBeVisible();

    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, destination);
    const openRepositories = await page.evaluate(() => window.desktop!.repository.listOpen());
    expect(openRepositories).toMatchObject({ ok: true });
    if (!openRepositories.ok || !openRepositories.value[0])
      throw new Error('The LFS repository tab is missing.');
    const accepted = await page.evaluate(
      async ({ id, commitId }) =>
        window.desktop!.repository.saveLfsPayload({ id, commitId, path: 'sample.bin' }),
      {
        id: openRepositories.value[0].id,
        commitId: head,
      },
    );
    expect(accepted).toMatchObject({ ok: true, value: { kind: 'lfs' } });
    await expect
      .poll(async () => (await readFile(destination).catch(() => Buffer.alloc(0))).byteLength)
      .toBe(payload.byteLength);
    expect(await readFile(destination)).toEqual(payload);
    expect(await readFile(join(repositoryPath, 'sample.bin'), 'utf8')).toBe(pointer);
    expect((await git.run(['status', '--porcelain'], { cwd: repositoryPath })).stdout).toBe('');
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
