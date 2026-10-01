import { isolateTestGitConfiguration } from '../tests/test-environment.ts';

isolateTestGitConfiguration();
const { testPlatform } = await import('../tests/platform.ts');
process.stdout.write(`${JSON.stringify(testPlatform, null, 2)}\n`);
