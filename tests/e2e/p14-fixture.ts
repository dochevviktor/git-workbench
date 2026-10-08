import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { GitRunner } from '../../src/backend/git/runner';
import { openTrustedFixture } from './trusted-fixture';
import { launchOptions } from './launch-options';

export async function auditFixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-p14-'));
  const repo = join(root, 'Café audit');
  const profile = join(root, 'profile');
  const git = new GitRunner();
  const run = async (...args: string[]) => (await git.run(args, { cwd: repo })).stdout.trim();
  let app: ElectronApplication | undefined;
  const close = async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await mkdir(repo);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.name', 'Audit Author');
    await run('config', 'user.email', 'audit@example.test');
    await run('config', 'commit.gpgsign', 'false');
    await writeFile(join(repo, 'value.ts'), 'export const value = 1;\n');
    await run('add', '.');
    await run('commit', '-qm', 'Initial audit fixture');
    await writeFile(join(repo, 'value.ts'), 'export const value = 2;\n');
    await run('commit', '-qam', 'Second audit revision');
    const head = await run('rev-parse', 'HEAD');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    const started = performance.now();
    app = await electron.launch(launchOptions(profile, env));
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const startupMs = performance.now() - started;
    const open = async () => {
      const result = await page.evaluate(openTrustedFixture, repo);
      if (!result.ok) throw new Error(result.error.message);
      await page.reload();
      await expect(page.locator('.history-full-hash')).toHaveText(head);
      return result.value;
    };
    return { root, repo, profile, git, run, app, page, head, startupMs, open, close };
  } catch (error) {
    await close();
    throw error;
  }
}
