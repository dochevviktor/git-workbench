import { defineConfig } from '@playwright/test';
import { isolateTestGitConfiguration } from './tests/test-environment';

isolateTestGitConfiguration();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // One launch walks the whole local workflow, from opening a repository to committing.
  timeout: 90_000,
  expect: { timeout: process.platform === 'win32' ? 15000 : 5000 },
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
