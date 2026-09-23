import { openTrustedFixture } from './trusted-fixture';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { signingFixture } from '../signing-fixture';

test('F28 signing key, signed commit, verification and signed tag through Electron', async () => {
  const f = await signingFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await writeFile(join(f.cwd, 'file.txt'), 'signed content\n');
    await f.run('add', '.');
    const env = Object.fromEntries(
      Object.entries(f.env).filter(
        ([key, value]) => value !== undefined && !['DISPLAY', 'WAYLAND_DISPLAY'].includes(key),
      ),
    ) as Record<string, string>;
    env.ELECTRON_RENDERER_URL = '';
    app = await electron.launch({
      chromiumSandbox: true,
      args: ['.', `--user-data-dir=${join(f.root, 'profile')}`, '--ozone-platform=headless', '--disable-gpu'],
      env,
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toHaveAttribute('data-desktop-status', 'connected');
    const opened = await page.evaluate(openTrustedFixture, f.cwd);
    if (!opened.ok) throw new Error(opened.error.message);
    await page.reload();
    await page.getByRole('button', { name: /^Local Changes/ }).click();
    const composer = page.getByTestId('commit-composer');
    await composer.getByRole('button', { name: 'Commit options' }).click();
    await page.getByRole('menuitem', { name: 'Signing…', exact: true }).click();
    await composer.getByRole('button', { name: 'Signing key…' }).click();
    let settings = page.getByRole('dialog', { name: 'Repository signing key' });
    await expect(settings).toContainText(f.fingerprint);
    await settings.getByRole('checkbox').check();
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await f.run('config', '--local', 'user.signingkey')).toBe(f.fingerprint);
    await composer.getByRole('button', { name: 'Signing key…' }).click();
    settings = page.getByRole('dialog', { name: 'Repository signing key' });
    await expect(settings.getByRole('textbox', { name: 'GPG key fingerprint' })).toHaveValue(f.fingerprint);
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await composer.getByRole('combobox', { name: 'Signing mode' }).selectOption('gpg');
    await page
      .getByRole('dialog', { name: 'Commit signing', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click();
    await composer.getByTestId('commit-subject').fill('Signed from Electron');
    await page.screenshot({ path: test.info().outputPath('f28-composer.png') });
    await composer.getByTestId('commit-submit').click();
    await expect(composer.getByTestId('commit-subject')).toHaveValue('');
    await f.run('verify-commit', 'HEAD');
    await composer.getByTestId('commit-amend').check();
    await expect(composer.getByTestId('commit-subject')).toHaveValue('Signed from Electron');
    await composer.getByTestId('commit-subject').fill('Signed amend from Electron');
    await composer.getByTestId('commit-submit').click();
    await expect(composer.getByTestId('commit-subject')).toHaveValue('');
    await f.run('verify-commit', 'HEAD');
    await page.getByRole('button', { name: 'All Commits', exact: true }).click();
    const commit = await f.run('rev-parse', 'HEAD');
    await page.locator(`[data-commit-id="${commit}"]`).click();
    await page.getByRole('button', { name: 'Verify GPG signature', exact: true }).click();
    await expect(page.locator('.signature-check')).toContainText('Valid GPG signature · trusted key');
    await page.screenshot({ path: test.info().outputPath('f28-verified-commit.png') });
    await page.locator(`[data-commit-id="${commit}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Tag…', exact: true }).click();
    const dialog = page.getByTestId('reference-dialog');
    await dialog.getByTestId('reference-name').fill('signed-e2e');
    await dialog.getByRole('combobox', { name: 'Signing mode' }).selectOption('gpg');
    await dialog.getByRole('button', { name: 'Signing key…' }).click();
    await page.getByRole('dialog', { name: 'Repository signing key' }).press('Escape');
    await expect(page.getByRole('dialog', { name: 'Repository signing key' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('f28-tag.png') });
    await dialog.getByTestId('reference-dialog-submit').click();
    await expect(dialog).toHaveCount(0);
    await f.run('verify-tag', 'signed-e2e');
    const tags = page.getByRole('treeitem', { name: 'Tags', exact: true });
    await expect(tags).toHaveAttribute('aria-expanded', /^(?:true|false)$/u);
    if ((await tags.getAttribute('aria-expanded')) === 'false') await tags.click();
    await page.getByRole('treeitem', { name: 'signed-e2e', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show Tag Details…', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Tag Details', exact: true });
    await details.getByRole('button', { name: 'Verify GPG signature', exact: true }).click();
    await expect(details).toContainText('Valid GPG signature · trusted key');
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    const result = await page.evaluate(
      async ({ id, objectId }) => window.desktop!.repository.verifySignature({ id, objectId, kind: 'tag' }),
      { id: opened.value.id, objectId: await f.run('rev-parse', 'signed-e2e') },
    );
    expect(result).toMatchObject({ ok: true, value: { status: 'valid', fingerprint: f.fingerprint } });
    const invalid = await page.evaluate(
      async (id) => window.desktop!.repository.verifySignature({ id, objectId: 'HEAD', kind: 'commit' }),
      opened.value.id,
    );
    expect(invalid.ok).toBe(false);
  } finally {
    await app?.close();
    await f.cleanup();
  }
});
