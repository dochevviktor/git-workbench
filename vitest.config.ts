import { defineConfig } from 'vitest/config';
import { isolateTestGitConfiguration } from './tests/test-environment';

isolateTestGitConfiguration();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    clearMocks: true,
    maxWorkers: 2,
    ...(process.platform === 'win32' ? { testTimeout: 30000, hookTimeout: 30000 } : {}),
  },
});
