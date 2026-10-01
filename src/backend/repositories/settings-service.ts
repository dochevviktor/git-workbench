import { createHash } from 'node:crypto';
import { lstat, readFile, open, rename, unlink, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  gitSettingsSchema,
  issueRuleSchema,
  saveGitSettingsSchema,
  gitOptionKeys,
} from '../../common/ipc/settings';
import type { GitSettings, SaveGitSettings } from '../../common/ipc/settings';
import { ExpectedBackendError } from '../errors';
import { GitCommandError } from '../git/runner';
import type { CommitRunner } from './commit-service';

const bounds = { timeoutMs: 5000, maxOutputBytes: 64 * 1024 };
const issueKey = 'gitworkbench.issueRule';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function contents(path: string) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Settings require a regular configuration file smaller than 1 MiB.',
      );
    return await readFile(path);
  } catch (error) {
    if (missing(error)) return Buffer.alloc(0);
    throw error;
  }
}

/** Git's global write destination: explicit override, existing home config, then existing XDG config. */
export async function globalConfigPath(env = process.env) {
  if (env.GIT_CONFIG_GLOBAL) return resolve(env.GIT_CONFIG_GLOBAL);
  const homeConfig = join(env.HOME ?? homedir(), '.gitconfig');
  const xdgConfig = join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config'), 'git', 'config');
  try {
    await lstat(homeConfig);
    return homeConfig;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    await lstat(xdgConfig);
    return xdgConfig;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return homeConfig;
}

export class GitSettingsService {
  constructor(private readonly runner: CommitRunner) {}

  private async get(cwd: string, args: string[]) {
    try {
      return (await this.runner.run(['config', ...args], { cwd, ...bounds })).stdout;
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) return null;
      throw error;
    }
  }

  async read(id: string | null, cwd: string, destination: string): Promise<GitSettings> {
    const path = await realpath(destination).catch((error: unknown) => {
      if (missing(error)) return destination;
      throw error;
    });
    const raw = await contents(path);
    const own = async (key: string) =>
      raw.length
        ? ((await this.get(cwd, ['--file', path, '--no-includes', '-z', '--get', key]))?.replace(
            /\0$/u,
            '',
          ) ?? null)
        : null;
    const effective = async (key: string) => {
      const result = await this.get(cwd, [
        ...(id === null ? ['--global', '--includes'] : []),
        '-z',
        '--show-origin',
        '--show-scope',
        '--get',
        key,
      ]);
      const [scope, origin, value] = result?.split('\0') ?? [];
      return { value: value ?? null, origin: origin ?? null, scope: scope ?? null };
    };
    const [name, email, effectiveName, effectiveEmail, issue] = await Promise.all([
      own('user.name'),
      own('user.email'),
      effective('user.name'),
      effective('user.email'),
      id === null ? null : own(issueKey),
    ]);
    let issueRule = null;
    if (issue) {
      try {
        issueRule = issueRuleSchema.parse(JSON.parse(issue));
      } catch {
        throw new ExpectedBackendError(
          'OPERATION_FAILED',
          'The repository issue-link rule is invalid. Correct gitworkbench.issueRule in Git configuration.',
        );
      }
    }
    const options = await Promise.all(
      gitOptionKeys.map(async (key) => ({ key, value: await own(key), effective: await effective(key) })),
    );
    const values = { id, path, name, email, effectiveName, effectiveEmail, issueRule, options };
    return gitSettingsSchema.parse({ ...values, snapshot: hash(JSON.stringify([values, hash(raw)])) });
  }

  /** Hold Git's config lock; edit a private copy, then atomically publish the whole reviewed change. */
  async save(cwd: string, destination: string, input: SaveGitSettings) {
    const request = saveGitSettingsSchema.parse(input);
    if (request.id === null && request.issueRule !== null)
      throw new ExpectedBackendError('INVALID_REQUEST', 'Issue links belong to a repository.');
    const before = await this.read(request.id, cwd, destination);
    const stale = () =>
      new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'Settings changed outside this dialog. Reload settings before saving.',
      );
    if (before.snapshot !== request.snapshot) throw stale();
    if (
      before.name === request.name &&
      before.email === request.email &&
      JSON.stringify(before.issueRule) === JSON.stringify(request.issueRule) &&
      (request.options ?? []).every(
        (entry) => entry.value === before.options?.find((item) => item.key === entry.key)?.value,
      )
    )
      return before;
    const lockPath = `${before.path}.lock`;
    const lock = await open(lockPath, 'wx', 0o600).catch(() => {
      throw new ExpectedBackendError(
        'OPERATION_FAILED',
        'Cannot lock configuration. Check permissions or another Git settings writer.',
      );
    });
    let temporary: string | undefined;
    let published = false;
    try {
      if ((await this.read(request.id, cwd, destination)).snapshot !== request.snapshot) throw stale();
      temporary = await mkdtemp(join(tmpdir(), 'workbench-settings-'));
      const copy = join(temporary, 'config');
      await writeFile(copy, await contents(before.path), { mode: 0o600 });
      const changes = [
        ['user.name', request.name, before.name],
        ['user.email', request.email, before.email],
        ...(request.options ?? []).map((entry) => [
          entry.key,
          entry.value,
          before.options?.find((item) => item.key === entry.key)?.value ?? null,
        ]),
        ...(request.id === null
          ? []
          : [
              [
                issueKey,
                request.issueRule ? JSON.stringify(request.issueRule) : null,
                before.issueRule ? JSON.stringify(before.issueRule) : null,
              ],
            ]),
      ];
      for (const [key, value, old] of changes) {
        if (!key || value === old) continue;
        await this.runner.run(
          [
            'config',
            '--file',
            copy,
            '--no-includes',
            ...(value == null ? ['--unset-all', key] : ['--replace-all', key, value]),
          ],
          { cwd, ...bounds },
        );
      }
      if ((await this.read(request.id, cwd, destination)).snapshot !== request.snapshot) throw stale();
      const stat = await lstat(before.path).catch((error: unknown) => {
        if (missing(error)) return null;
        throw error;
      });
      await lock.chmod(stat ? stat.mode & 0o777 : 0o600);
      await lock.writeFile(await readFile(copy));
      await lock.sync();
      await lock.close();
      await rename(lockPath, before.path);
      published = true;
    } finally {
      await lock.close();
      // After rename another Git process may already own a new lock at this path.
      if (!published) await unlink(lockPath).catch(() => undefined);
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
    return this.read(request.id, cwd, destination);
  }
}
