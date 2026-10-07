import { isolateTestGitConfiguration } from '../tests/test-environment.ts';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

isolateTestGitConfiguration();
const { testPlatform } = await import('../tests/platform.ts');
function version(program: string, args = ['--version']): string | null {
  try {
    return execFileSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      .split(/\r?\n/u)[0]!
      .trim();
  } catch {
    return null;
  }
}
process.stdout.write(
  `${JSON.stringify(
    {
      ...testPlatform,
      temporaryDirectory: tmpdir(),
      versions: {
        node: process.version,
        npm: process.env.npm_config_user_agent ?? null,
        git: version('git'),
        gitLfs: version('git', ['lfs', 'version']),
        gpg: version('gpg'),
        gpgconf: version('gpgconf'),
        openssl: version('openssl', ['version']),
      },
    },
    null,
    2,
  )}\n`,
);
