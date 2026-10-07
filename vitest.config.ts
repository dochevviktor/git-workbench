import { defineConfig } from 'vitest/config';
import { isolateTestGitConfiguration } from './tests/test-environment';

isolateTestGitConfiguration();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    clearMocks: true,
    maxWorkers: 2,
    ...(process.env.CI_REPORT_DIR
      ? {
          reporters: ['default', 'json', 'junit'],
          outputFile: {
            json: `${process.env.CI_REPORT_DIR}/vitest.json`,
            junit: `${process.env.CI_REPORT_DIR}/vitest.xml`,
          },
        }
      : {}),
    expect: { poll: { timeout: process.platform === 'win32' ? 15000 : 5000 } },
    ...(process.platform === 'win32' ? { testTimeout: 30000, hookTimeout: 30000 } : {}),
  },
});
