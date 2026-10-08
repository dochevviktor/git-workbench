import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

function hasProgram(program: string, args = ['--version']): boolean {
  try {
    execFileSync(program, args, { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function canCreateSymlinks(): boolean {
  const directory = mkdtempSync(join(tmpdir(), 'workbench-capability-'));
  try {
    writeFileSync(join(directory, 'target'), '');
    symlinkSync(join(directory, 'target'), join(directory, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function usesMsysGpg(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const program = execFileSync('where.exe', ['gpg.exe'], { encoding: 'utf8', windowsHide: true })
      .trim()
      .split(/\r?\n/u)[0];
    return !!program && existsSync(join(dirname(program), 'msys-2.0.dll'));
  } catch {
    return false;
  }
}

/** Capabilities, not failed test names, determine which OS-specific assertions are meaningful. */
export const testPlatform = {
  os: process.platform,
  windows: process.platform === 'win32',
  linux: process.platform === 'linux',
  posix: process.platform !== 'win32',
  symlinks: canCreateSymlinks(),
  gpg: hasProgram('gpg') && hasProgram('gpgconf'),
  openssl: hasProgram('openssl', ['version']),
  gitLfs: hasProgram('git', ['lfs', 'version']),
  msysGpg: usesMsysGpg(),
};

/** MSYS GnuPG interprets environment paths itself; native Gpg4win takes Windows paths. */
export function gpgHome(path: string): string {
  const forward = path.replaceAll('\\', '/');
  return testPlatform.msysGpg
    ? forward.replace(/^([a-z]):/iu, (_, drive: string) => `/${drive.toLowerCase()}`)
    : forward;
}

/** Retain spaces, Unicode and leading dashes while using a legal native filename. Parser tests stay literal. */
export function fixtureName(value: string): string {
  // eslint-disable-next-line no-control-regex -- Windows cannot create these filenames.
  return testPlatform.windows ? value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ') : value;
}

export function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function processState(pid: number): Promise<string> {
  if (!testPlatform.linux) return processIsRunning(pid) ? 'running' : 'gone';
  try {
    return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2] ?? 'unknown';
  } catch {
    return 'gone';
  }
}
