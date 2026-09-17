import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // One launch walks the whole local workflow, from opening a repository to committing.
  timeout: 90_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
