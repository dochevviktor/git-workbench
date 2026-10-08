import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The command palette exposes the actual menu callbacks on macOS as well as Windows/Linux. */
export async function chooseCommand(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Quick Launch', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Quick Launch', exact: true });
  await palette.getByRole('combobox').fill(label);
  const command = palette.getByRole('option').filter({ hasText: label });
  await expect(command).toHaveCount(1);
  await command.click();
  await expect(palette).toHaveCount(0);
}
