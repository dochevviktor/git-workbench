import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

/** Only the disposable GitHub Linux runner needs privileged SUID helper installation. */
export async function prepareCiSandbox(helper: string): Promise<void> {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Sandbox installation is restricted to Linux GitHub Actions runners.');
  const path = resolve(helper);
  if (!(await lstat(path)).isFile()) throw new Error('Expected a regular Chromium sandbox helper.');
  const execute = promisify(execFile);
  await execute('sudo', ['-n', 'chown', 'root:root', path], { timeout: 10000 });
  await execute('sudo', ['-n', 'chmod', '4755', path], { timeout: 10000 });
  const installed = await lstat(path);
  if (installed.uid !== 0 || (installed.mode & 0o7777) !== 0o4755)
    throw new Error('Chromium sandbox helper installation failed.');
  console.log(`Configured sandbox helper: ${path}`);
}

if (import.meta.main) await prepareCiSandbox('node_modules/electron/dist/chrome-sandbox');
