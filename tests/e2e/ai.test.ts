import { openTrustedFixture } from './trusted-fixture';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { statisticsFixture } from '../statistics-fixture';

test('F37 opt-in setup, exact preview, editable draft, range review, cancellation and disable', async () => {
  const f = await statisticsFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await f.populate();
    await writeFile(join(f.cwd, 'README.md'), 'staged change\n');
    await f.run('add', '.');
    await writeFile(join(f.cwd, 'README.md'), 'unstaged private content\n');
    const keyPath = join(f.root, 'ai-key.txt');
    await writeFile(keyPath, 'sk-synthetic-test-key');
    const beforeRefs = await f.run('show-ref');
    const beforeIndex = await readFile(join(f.cwd, '.git/index'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(f.root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      const state = globalThis as unknown as {
        aiRequests: string[];
        aiWait: boolean;
        aiAborted: boolean;
        aiFailure: boolean;
      };
      state.aiRequests = [];
      state.aiWait = false;
      state.aiAborted = false;
      state.aiFailure = false;
      globalThis.fetch = async (input, init) => {
        if (String(input) !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected origin');
        state.aiRequests.push(String(init?.body));
        if (state.aiWait)
          await new Promise<void>((_resolve, reject) =>
            init?.signal?.addEventListener(
              'abort',
              () => {
                state.aiAborted = true;
                reject(new Error('cancelled'));
              },
              { once: true },
            ),
          );
        if (state.aiFailure) return new Response('must-not-leak-provider-secret', { status: 401 });
        return Response.json({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'Improve README\n\nGenerated draft with <script>inert text</script>.',
                },
              ],
            },
          ],
        });
      };
    }, keyPath);
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const menu = async (name: string, item: string) => {
      await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await menu('File', 'AI Integration…');
    const settings = page.getByRole('dialog', { name: 'AI Integration', exact: true });
    await expect(settings).toContainText('Disabled');
    await expect(settings.getByRole('button', { name: 'Select key file and enable…' })).toBeDisabled();
    await settings.getByLabel('AI model').fill('test-model');
    await settings.getByRole('button', { name: 'Select key file and enable…' }).click();
    await expect(settings).toContainText('Enabled for this session');
    await page.screenshot({ path: test.info().outputPath('f37-settings-light.png') });
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/u }).click();
    await page.getByTestId('commit-subject').fill('Existing draft');
    await page.getByRole('button', { name: 'Generate Message…' }).click();
    const generated = page.getByRole('dialog', { name: 'Generate Commit Message', exact: true });
    await generated.getByRole('button', { name: 'Preview material' }).click();
    await expect(generated.getByLabel('Material to send')).toContainText('+staged change');
    await expect(generated.getByLabel('Material to send')).not.toContainText('unstaged private content');
    expect(
      await app.evaluate(() => (globalThis as unknown as { aiRequests: string[] }).aiRequests.length),
    ).toBe(0);
    await expect(generated.getByRole('button', { name: 'Send to OpenAI' })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('f37-preview-light.png') });
    await generated.getByRole('checkbox', { name: /I reviewed this material/u }).check();
    await generated.getByRole('button', { name: 'Send to OpenAI' }).click();
    await expect(generated.getByLabel('AI result')).toHaveValue(/Improve README/u);
    await expect(page.getByTestId('commit-subject')).toHaveValue('Existing draft');
    await generated.getByLabel('AI result').fill('Edited message\n\nHuman-reviewed body');
    await generated.getByRole('button', { name: 'Replace commit draft' }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Edited message');
    await expect(page.getByTestId('commit-description')).toHaveValue('Human-reviewed body');
    const request = JSON.parse(
      await app.evaluate(() => (globalThis as unknown as { aiRequests: string[] }).aiRequests[0]!),
    ) as { input: string; store: boolean; tools: unknown[] };
    expect(request.input).toContain('+staged change');
    expect(request.store).toBe(false);
    expect(request.tools).toEqual([]);
    // A draft edited while generation is open must not be overwritten by a late result.
    await page.getByRole('button', { name: 'Generate Message…' }).click();
    await generated.getByRole('button', { name: 'Preview material' }).click();
    await generated.getByRole('checkbox', { name: /I reviewed this material/u }).check();
    await generated.getByRole('button', { name: 'Send to OpenAI' }).click();
    await expect(generated.getByLabel('AI result')).toHaveValue(/Improve README/u);
    await page.getByTestId('commit-subject').evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Newer draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(generated.getByRole('button', { name: 'Replace commit draft' })).toBeDisabled();
    await generated.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('commit-subject')).toHaveValue('Newer draft');
    const base = await f.run('rev-parse', 'HEAD~2');
    await menu('Repository', 'AI Code Review…');
    const review = page.getByRole('dialog', { name: 'AI Code Review', exact: true });
    await review.getByLabel('Review base').fill(base);
    await review.getByLabel('Review tip').fill('refs/heads/main');
    await review.getByRole('button', { name: 'Preview material' }).click();
    await expect(review.getByLabel('Material to send')).toContainText('-one\n+two');
    await review.getByRole('checkbox', { name: /I reviewed this material/u }).check();
    await review.getByRole('button', { name: 'Send to OpenAI' }).click();
    await expect(review.getByLabel('AI result')).toHaveValue(/<script>inert text<\/script>/u);
    await expect(review.getByRole('button', { name: 'Replace commit draft' })).toHaveCount(0);
    await page.evaluate(() => {
      document.documentElement.style.colorScheme = 'dark';
    });
    await page.screenshot({ path: test.info().outputPath('f37-review-dark.png') });
    await page.setViewportSize({ width: 720, height: 680 });
    await page.screenshot({ path: test.info().outputPath('f37-review-narrow.png') });
    await review.getByRole('button', { name: 'New preview' }).click();
    await review.getByRole('checkbox', { name: /I reviewed this material/u }).check();
    await app.evaluate(() => {
      (globalThis as unknown as { aiWait: boolean }).aiWait = true;
    });
    await review.getByRole('button', { name: 'Send to OpenAI' }).click();
    await expect(review.getByRole('status')).toHaveText('Waiting for OpenAI…');
    await review.getByRole('button', { name: 'Cancel request and close' }).click();
    await expect
      .poll(async () => app!.evaluate(() => (globalThis as unknown as { aiAborted: boolean }).aiAborted))
      .toBe(true);
    await app.evaluate(() => {
      const state = globalThis as unknown as { aiWait: boolean; aiFailure: boolean };
      state.aiWait = false;
      state.aiFailure = true;
    });
    await menu('Repository', 'AI Code Review…');
    await review.getByLabel('Review base').fill(base);
    await review.getByRole('button', { name: 'Preview material' }).click();
    await review.getByRole('checkbox', { name: /I reviewed this material/u }).check();
    await review.getByRole('button', { name: 'Send to OpenAI' }).click();
    await expect(review.getByRole('alert')).toContainText('OpenAI denied access');
    await expect(review).not.toContainText('must-not-leak-provider-secret');
    await page.keyboard.press('Escape');
    await menu('File', 'AI Integration…');
    await settings.getByRole('button', { name: 'Disable and forget key' }).click();
    await expect(settings).toContainText('Disabled');
    await page.keyboard.press('Escape');
    expect(await f.run('show-ref')).toBe(beforeRefs);
    expect(await readFile(join(f.cwd, '.git/index'))).toEqual(beforeIndex);
    expect(await readFile(join(f.cwd, 'README.md'), 'utf8')).toBe('unstaged private content\n');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-synthetic-test-key');
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
