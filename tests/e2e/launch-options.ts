import type { _electron as electron } from '@playwright/test';

/** The same feature scenarios exercise development output and an installed package. */
export function launchOptions(
  profile: string,
  env: Record<string, string>,
): NonNullable<Parameters<typeof electron.launch>[0]> {
  const executablePath = process.env.ELECTRON_TEST_EXECUTABLE;
  return {
    chromiumSandbox: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ['.']),
      `--user-data-dir=${profile}`,
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu'] : []),
    ],
    env,
  };
}
