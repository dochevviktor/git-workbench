import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import type { OpenDialogOptions } from 'electron';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { statisticsFixture } from '../statistics-fixture';
import { openTrustedFixture } from './trusted-fixture';
import { launchOptions } from './launch-options';

test('P13 saved prompts, local generation, root amend and installed agent adapters stay explicit and read-only', async () => {
  const f = await statisticsFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await writeFile(join(f.cwd, 'initial.txt'), 'initial committed content\n');
    await f.commit('Initial subject', '2025-01-01T00:00:00Z');
    const beforeRefs = await f.run('show-ref');
    const beforeIndex = await readFile(join(f.cwd, '.git/index'));
    const executable = join(f.root, 'fake-agent.ts');
    await copyFile(resolve('tests/fixtures/ai-agent.ts'), executable);
    await chmod(executable, 0o700);
    const key = join(f.root, 'key.txt');
    await writeFile(key, 'synthetic-cursor-api-key');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(name),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    const launch = async () => {
      const instance = await electron.launch(launchOptions(join(f.root, 'profile'), env));
      await instance.evaluate(
        ({ dialog }, paths) => {
          dialog.showOpenDialog = async (_windowOrOptions, options?: OpenDialogOptions) => ({
            canceled: false,
            filePaths: [options?.title?.includes('executable') ? paths.executable : paths.key],
          });
          const state = globalThis as unknown as { requests: string[] };
          state.requests = [];
          globalThis.fetch = async (url, init) => {
            state.requests.push(String(init?.body));
            if (String(url) === 'http://127.0.0.1:11434/api/show')
              return Response.json({ details: { family: 'local' } });
            if (String(url) !== 'http://127.0.0.1:11434/api/chat')
              throw new Error('Unexpected network request');
            return Response.json({
              done: true,
              message: { role: 'assistant', content: 'Local amended message' },
            });
          };
        },
        { executable, key },
      );
      const page = await instance.firstWindow();
      await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
      return { instance, page };
    };
    let launched = await launch();
    app = launched.instance;
    let page = launched.page;
    const menu = async (item: string) => {
      await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await menu('AI Integration…');
    let settings = page.getByRole('dialog', { name: 'AI Integration', exact: true });
    await settings.getByLabel('AI provider').selectOption('ollama');
    await settings.getByLabel('AI model').fill('local-test');
    await settings.getByRole('checkbox', { name: 'Remember model, executable and requests' }).check();
    await settings.getByRole('button', { name: 'Default requests', exact: true }).click();
    await settings.getByLabel('Commit message request').fill('Use a short imperative subject.');
    await settings.getByLabel('Code review request').fill('Focus on concurrency errors.');
    await settings.getByRole('button', { name: 'Enable for this session' }).click();
    await expect(settings).toContainText('Enabled for this session');
    await page.screenshot({ path: test.info().outputPath('p13-ai-prompts-light.png') });
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await page.getByTestId('commit-amend').check();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Initial subject');
    await page.getByRole('button', { name: 'Commit options' }).click();
    await page.getByRole('menuitem', { name: 'Generate Message…' }).click();
    const generated = page.getByRole('dialog', { name: 'Generate Commit Message', exact: true });
    await generated.getByRole('button', { name: 'Preview material' }).click();
    await expect(generated.getByLabel('Material to send')).toContainText('+initial committed content');
    await expect(generated).toContainText('index against empty tree');
    expect(await app.evaluate(() => (globalThis as unknown as { requests: string[] }).requests.length)).toBe(
      0,
    );
    await generated.getByText('Instructions sent to Ollama').click();
    await expect(generated).toContainText('Use a short imperative subject.');
    await generated.getByRole('checkbox', { name: /I reviewed this material/u }).check();
    await generated.getByRole('button', { name: 'Send to Ollama' }).click();
    await expect(generated.getByLabel('AI result')).toHaveValue('Local amended message');
    await generated.getByRole('button', { name: 'Replace commit draft' }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Local amended message');
    expect(await f.run('show-ref')).toBe(beforeRefs);
    await app.close();
    app = undefined;
    launched = await launch();
    app = launched.instance;
    page = launched.page;
    await menu('AI Integration…');
    settings = page.getByRole('dialog', { name: 'AI Integration', exact: true });
    await expect(settings.getByLabel('AI provider')).toHaveValue('ollama');
    await expect(settings.getByLabel('AI model')).toHaveValue('local-test');
    await expect(settings).toContainText('Disabled');
    await settings.getByRole('button', { name: 'Default requests', exact: true }).click();
    await expect(settings.getByLabel('Commit message request')).toHaveValue(
      'Use a short imperative subject.',
    );
    await expect(settings.getByLabel('Code review request')).toHaveValue('Focus on concurrency errors.');
    expect(await app.evaluate(() => (globalThis as unknown as { requests: string[] }).requests.length)).toBe(
      0,
    );
    await settings.getByRole('button', { name: 'Provider', exact: true }).click();
    for (const [provider, label] of [
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
      ['cursor', 'Cursor'],
    ] as const) {
      await settings.getByLabel('AI provider').selectOption(provider);
      await settings.getByLabel('AI model').fill('ui-test');
      await settings
        .getByRole('button', {
          name: provider === 'cursor' ? 'Select key file and enable…' : 'Select executable and enable…',
        })
        .click();
      await expect(settings).toContainText('Enabled for this session');
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: /^Local Changes/u }).click();
      await page.getByTestId('commit-amend').check();
      await page.getByRole('button', { name: 'Commit options' }).click();
      await page.getByRole('menuitem', { name: 'Generate Message…' }).click();
      const request = page.getByRole('dialog', { name: 'Generate Commit Message', exact: true });
      await request.getByRole('button', { name: 'Preview material' }).click();
      await request.getByRole('checkbox', { name: /I reviewed this material/u }).check();
      await request.getByRole('button', { name: `Send to ${label}` }).click();
      await expect(request.getByLabel('AI result')).toHaveValue('Draft from approved material');
      await request.getByRole('button', { name: 'Close', exact: true }).click();
      await menu('AI Integration…');
    }
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.setViewportSize({ width: 720, height: 680 });
    await page.screenshot({ path: test.info().outputPath('p13-ai-agent-narrow-dark.png') });
    await settings.getByRole('button', { name: 'Disable and forget key' }).click();
    await expect(settings).toContainText('Disabled');
    expect(await f.run('show-ref')).toBe(beforeRefs);
    expect(await readFile(join(f.cwd, '.git/index'))).toEqual(beforeIndex);
    expect(await f.run('status', '--porcelain')).toBe('');
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
