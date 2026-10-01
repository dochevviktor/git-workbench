import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

/** Resolve programs without invoking a command shell or searching the repository directory. */
export async function findProgram(name: string): Promise<string | null> {
  const paths =
    isAbsolute(name) || /[/\\]/u.test(name)
      ? [resolve(name)]
      : (process.env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .filter(isAbsolute)
          .flatMap((directory) =>
            process.platform === 'win32' && !/\.(?:exe|com)$/iu.test(name)
              ? [join(directory, `${name}.exe`), join(directory, `${name}.com`)]
              : [join(directory, name)],
          );
  for (const path of paths) {
    try {
      if (!(await stat(path)).isFile()) continue;
      await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return await realpath(path);
    } catch {
      /* Try the next installed program. */
    }
  }
  return null;
}

/** Git for Windows ships Bash beside Git; never accidentally launch the Windows WSL stub. */
export async function findBash(): Promise<string | null> {
  if (process.platform !== 'win32') return findProgram('/bin/bash');
  const git = await findProgram('git');
  if (git) {
    for (const path of [join(dirname(git), '../bin/bash.exe'), join(dirname(git), '../../bin/bash.exe')]) {
      const executable = await findProgram(path);
      if (executable) return executable;
    }
  }
  const bash = await findProgram('bash');
  return bash && !/[/\\]Windows[/\\](?:System32|SysWOW64)[/\\]/iu.test(bash) ? bash : null;
}

export interface ProgramInvocation {
  executable: string;
  args: string[];
}

/** Native executables and explicit Node shebangs only; batch/PowerShell text is never shell-evaluated. */
export async function programInvocation(
  program: string,
  args: readonly string[],
): Promise<ProgramInvocation> {
  if (process.platform !== 'win32') return { executable: program, args: [...args] };
  const executable = await findProgram(program);
  if (!executable) throw new Error('Program is unavailable.');
  if (/\.(?:exe|com)$/iu.test(executable)) return { executable, args: [...args] };
  const file = await open(executable, 'r');
  let header: string;
  try {
    const bytes = Buffer.alloc(256);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    header = bytes.subarray(0, bytesRead).toString('utf8').split(/\r?\n/u)[0] ?? '';
  } finally {
    await file.close();
  }
  if (/^#!\s*(?:\/usr\/bin\/env\s+node|\/usr\/bin\/node)\s*$/u.test(header)) {
    const node = await findProgram('node');
    if (node) return { executable: node, args: [executable, ...args] };
  }
  throw new Error(
    'Select a native executable or a Node CLI with an installed Node runtime. Windows batch and PowerShell scripts require an explicitly configured interpreter.',
  );
}

/** Windows environment keys are case-insensitive; copying PATH twice can silently select the wrong one. */
export function selectedEnvironment(names: readonly string[]): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  const allowed = [
    ...names,
    ...(process.platform === 'win32'
      ? [
          'SystemRoot',
          'WINDIR',
          'USERPROFILE',
          'HOMEDRIVE',
          'HOMEPATH',
          'APPDATA',
          'LOCALAPPDATA',
          'TEMP',
          'TMP',
          'PATHEXT',
          'COMSPEC',
        ]
      : []),
  ];
  for (const name of allowed) {
    const key =
      process.platform === 'win32'
        ? Object.keys(process.env).find((entry) => entry.toLowerCase() === name.toLowerCase())
        : name;
    if (key && process.env[key] !== undefined) environment[name] = process.env[key];
  }
  return environment;
}

/** Cancel the active process tree and wait for native termination before releasing its files. */
export async function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (process.platform === 'win32' && child.pid && process.env.SystemRoot) {
    await new Promise<void>((done) => {
      const killer = spawn(
        join(process.env.SystemRoot!, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { shell: false, windowsHide: true, stdio: 'ignore' },
      );
      killer.once('error', () => {
        child.kill();
        done();
      });
      killer.once('close', () => done());
    });
    return;
  }
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    /* Already exited. */
  }
}
