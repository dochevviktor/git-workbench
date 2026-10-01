import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';
import { programInvocation } from '../processes/platform-process';

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    if (!(await stat(candidate)).isFile()) return false;
    if (process.platform === 'win32') await programInvocation(candidate, []);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a configured Git executable without asking a shell to interpret it. */
export async function resolveGitExecutable(requested = process.env.GIT_EXECUTABLE || 'git') {
  if (isAbsolute(requested) || requested.includes(sep)) {
    const candidate = isAbsolute(requested) ? requested : resolve(requested);
    return (await isExecutable(candidate)) ? realpath(candidate) : null;
  }

  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const extensions =
    process.platform === 'win32' ? (/\.(?:exe|com)$/iu.test(requested) ? [''] : ['.exe', '.com']) : [''];

  for (const directory of pathValue.split(delimiter)) {
    const base = directory || '.';
    for (const extension of extensions) {
      const candidate = join(base, `${requested}${extension}`);
      if (await isExecutable(candidate)) return realpath(candidate);
    }
  }
  return null;
}
