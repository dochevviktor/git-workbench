import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const valuedSwitches = new Set([
  '--user-data-dir',
  '--ozone-platform',
  '--js-flags',
  '--remote-debugging-port',
  '--inspect',
  '--inspect-brk',
  '--lang',
  '--log-file',
]);
const booleanSwitches = new Set([
  '--disable-gpu',
  '--enable-logging',
  '--no-sandbox',
  '--disable-dev-shm-usage',
]);

const forwardedPathsSchema = z.strictObject({
  version: z.literal(1),
  repositoryPaths: z
    .array(
      z
        .string()
        .min(1)
        .max(32_768)
        .refine((path) => isAbsolute(path) && !path.includes('\0')),
    )
    .max(20),
});

/** Electron can reorder second-instance argv; additionalData preserves the launching cwd resolution. */
export function forwardedRepositoryPaths(data: unknown): string[] | undefined {
  const parsed = forwardedPathsSchema.safeParse(data);
  return parsed.success ? [...new Set(parsed.data.repositoryPaths)] : undefined;
}

/** Resolves only positional repository paths; switches, URLs and executable paths are never opened. */
export function repositoryPathsFromArguments(
  argv: readonly string[],
  cwd: string,
  defaultApp: boolean,
): string[] {
  const paths: string[] = [];
  let positionalOnly = false;
  let skipApplication = defaultApp;
  for (let index = 1; index < argv.length && paths.length < 20; index += 1) {
    const argument = argv[index]!;
    if (!positionalOnly && argument === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith('-')) {
      if (valuedSwitches.has(argument)) index += 1;
      else if (!argument.includes('=') && !booleanSwitches.has(argument) && !argv[index + 1]?.startsWith('-'))
        index += 1;
      continue;
    }
    if (skipApplication) {
      skipApplication = false;
      continue;
    }
    if (
      !argument ||
      argument.length > 32_768 ||
      argument.includes('\0') ||
      /^[a-z][a-z\d+.-]*:\/\//iu.test(argument)
    )
      continue;
    const path = resolve(cwd, argument);
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}
