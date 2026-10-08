import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { isolateTestGitConfiguration } from './tests/test-environment';

isolateTestGitConfiguration();
const reports = process.env.CI_REPORT_DIR;
const group = process.env.CI_REPORT_GROUP ?? 'desktop';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // One launch walks the whole local workflow, from opening a repository to committing.
  timeout: 90_000,
  expect: { timeout: process.platform === 'win32' ? 15000 : 5000 },
  ...(reports ? { outputDir: 'test-results/desktop' } : {}),
  reporter: reports
    ? [
        ['list'],
        ['json', { outputFile: join(reports, `playwright-${group}.json`) }],
        ['html', { outputFolder: join(reports, `playwright-${group}`), open: 'never' }],
      ]
    : 'list',
  use: { trace: 'retain-on-failure' },
});
