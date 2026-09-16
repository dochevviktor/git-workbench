import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a configured Git executable without asking a shell to interpret it. */
export async function resolveGitExecutable(requested = process.env.GIT_EXECUTABLE || 'git') {
  if (isAbsolute(requested) || requested.includes(sep)) {
    const candidate = isAbsolute(requested) ? requested : resolve(requested);
    return (await isExecutable(candidate)) ? candidate : null;
  }

  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];

  for (const directory of pathValue.split(delimiter)) {
    const base = directory || '.';
    for (const extension of extensions) {
      const candidate = join(base, `${requested}${extension}`);
      if (await isExecutable(candidate)) return resolve(candidate);
    }
  }
  return null;
}
