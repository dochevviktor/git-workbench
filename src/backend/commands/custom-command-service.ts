import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type {
  CustomAction,
  CustomContext,
  CustomPreview,
  CustomPreviewRequest,
} from '../../common/ipc/custom-commands';
import type { RepositorySummary } from '../../common/ipc/contracts';
import type { GitRunnerLike } from '../repositories/repository-service';
import type { OperationHandle, OperationOutcome } from '../operations/operation-registry';
import type { CustomCommandStore } from './custom-command-store';
import { customPreviewSchema } from '../../common/ipc/custom-commands';
import { ExpectedBackendError } from '../errors';

interface Prepared {
  owner: number;
  request: CustomPreviewRequest;
  revision: string;
  fingerprint: string;
  preview: CustomPreview;
  expires: number;
}
function invalid(message: string): never {
  throw new ExpectedBackendError('INVALID_REQUEST', message);
}
export function expandCommand(action: CustomAction, variables: Record<string, string>): CustomAction {
  // Bash reads environment variables, never interpolated source code. Values cannot become shell syntax.
  if (action.kind === 'bash') return action;
  const expand = (value: string) =>
    value.replace(/\$\{([^}]+)\}/gu, (_match, key: string) => {
      if (!Object.hasOwn(variables, key)) return invalid(`Unavailable variable: ${key}`);
      return action.kind === 'url' ? encodeURIComponent(variables[key]!) : variables[key]!;
    });
  if (action.kind === 'process')
    return { kind: 'process', executable: expand(action.executable), args: action.args.map(expand) };
  const url = expand(action.url);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid('Enter a valid HTTP or HTTPS URL.');
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
    return invalid('Only HTTP and HTTPS URLs without credentials are supported.');
  return { kind: 'url', url: parsed.href };
}
export const commandEnvironmentName = (name: string): string =>
  `GW_${name.replaceAll(':', '_').toUpperCase()}`;

export class CustomCommandService {
  private readonly previews = new Map<string, Prepared>();
  constructor(
    readonly store: CustomCommandStore,
    private readonly git: GitRunnerLike,
  ) {}
  disposeOwner(owner: number): void {
    for (const [token, item] of this.previews) if (item.owner === owner) this.previews.delete(token);
  }
  async context(summary: RepositorySummary, context: CustomContext): Promise<Record<string, string>> {
    const variables: Record<string, string> = {
      'repo:path': summary.path,
      'repo:name': summary.name,
      git: this.git.executable,
    };
    const read = async (args: string[]) =>
      (
        await this.git.run(args, { cwd: summary.path, timeoutMs: 10000, maxOutputBytes: 1024 * 1024 })
      ).stdout.trim();
    if (context.target === 'commit') {
      if (!/^[a-f0-9]{40,64}$/u.test(context.value)) invalid('Select a commit.');
      variables.sha = await read(['rev-parse', '--verify', `${context.value}^{commit}`]);
    } else if (context.target === 'branch') {
      if (!/^refs\/(heads|remotes)\//u.test(context.value)) invalid('Select a branch.');
      await read(['check-ref-format', context.value]);
      variables.sha = await read(['rev-parse', '--verify', `${context.value}^{commit}`]);
      variables.branch = context.value.replace(/^refs\/(heads|remotes)\//u, '');
    } else if (context.target === 'file' || context.target === 'submodule') {
      const path = context.value;
      if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.'))
        invalid('Select a repository-relative path.');
      // File commands intentionally refer to the working path, never an implied historical blob.
      if (!summary.worktreePath) invalid('This target requires a working tree.');
      const entries = await this.git.run(
        ['--literal-pathspecs', 'ls-files', '--stage', '--others', '--exclude-standard', '-z', '--', path],
        { cwd: summary.path, maxOutputBytes: 1024 * 1024 },
      );
      const found = entries.stdout
        .split('\0')
        .some((entry) =>
          context.target === 'submodule'
            ? entry.startsWith('160000 ') && entry.slice(entry.indexOf('\t') + 1) === path
            : entry === path || (entry.includes('\t') && entry.slice(entry.indexOf('\t') + 1) === path),
        );
      if (!found) invalid('That path is no longer available in this repository.');
      variables.file = path;
      variables['file:name'] = basename(path);
      if (context.target === 'submodule') variables.submodule = path;
    } else if (context.value) invalid('Repository commands do not take a selected object.');
    if (!variables.sha && summary.head.commit) variables.sha = summary.head.commit;
    if (variables.sha) variables['sha:abbr'] = variables.sha.slice(0, 7);
    return variables;
  }
  async preview(
    owner: number,
    summary: RepositorySummary,
    request: CustomPreviewRequest,
  ): Promise<CustomPreview> {
    const command = (await this.store.list()).find((item) => item.id === request.commandId);
    if (!command?.enabled) invalid('Select and enable this custom command before running it.');
    if (command.target !== request.context.target)
      invalid('This command does not apply to the selected target.');
    if (request.inputs.length !== command.fields.length) invalid('Complete the command input form.');
    const variables = await this.context(summary, request.context);
    await this.inputVariables(summary, command.fields, request.inputs, variables);
    const action = expandCommand(command.action, variables);
    const token = randomUUID();
    const parsed = customPreviewSchema.safeParse({
      token,
      name: command.name,
      cwd: summary.path,
      action,
      variables,
    });
    if (!parsed.success)
      invalid('Expanded command exceeds the supported size. Shorten its arguments or inputs.');
    const preview = parsed.data;
    this.disposeOwner(owner);
    this.previews.set(token, {
      owner,
      request,
      revision: command.revision,
      fingerprint: this.fingerprint(summary, variables),
      preview,
      expires: Date.now() + 5 * 60 * 1000,
    });
    return preview;
  }
  private async inputVariables(
    summary: RepositorySummary,
    fields: { kind: string; required: boolean; label: string }[],
    inputs: string[],
    variables: Record<string, string>,
  ): Promise<void> {
    for (const [index, field] of fields.entries()) {
      let value = inputs[index]!;
      if (field.required && !value.trim()) invalid(`${field.label} is required.`);
      if (field.kind === 'branch' && value) {
        if (!/^refs\/(heads|remotes)\//u.test(value)) invalid('Choose an existing branch.');
        await this.git.run(['check-ref-format', value], { cwd: summary.path });
        variables[`input:${index + 1}:sha`] = (
          await this.git.run(['rev-parse', '--verify', `${value}^{commit}`], { cwd: summary.path })
        ).stdout.trim();
      }
      if (field.kind === 'file' && value) {
        value = resolve(summary.path, value);
        const info = await stat(value).catch(() => null);
        if (!info?.isFile()) invalid(`${field.label} must refer to an existing file.`);
      }
      variables[`input:${index + 1}`] = value;
    }
  }
  repositoryFor(owner: number, token: string): string {
    const item = this.previews.get(token);
    if (!item || item.owner !== owner || item.expires < Date.now())
      throw new ExpectedBackendError('STALE_SNAPSHOT', 'Preview expired. Review the command again.');
    return item.request.context.repositoryId;
  }
  async consume(owner: number, token: string, summary: RepositorySummary): Promise<CustomPreview> {
    this.repositoryFor(owner, token);
    const item = this.previews.get(token)!;
    this.previews.delete(token);
    const command = this.store.match(await this.store.list(), {
      id: item.request.commandId,
      revision: item.revision,
    });
    if (!command.enabled) invalid('This command is disabled.');
    const variables = await this.context(summary, item.request.context);
    await this.inputVariables(summary, command.fields, item.request.inputs, variables);
    if (this.fingerprint(summary, variables) !== item.fingerprint)
      throw new ExpectedBackendError(
        'STALE_SNAPSHOT',
        'The repository target changed. Review the command again.',
      );
    return item.preview;
  }
  private fingerprint(summary: RepositorySummary, variables: Record<string, string>): string {
    return createHash('sha256')
      .update(JSON.stringify([summary.id, summary.gitDir, summary.head, variables]))
      .digest('hex');
  }
}

/** Supervised process group, bounded combined output, no shell for Start Process. */
export async function runCustomCommand(
  preview: CustomPreview,
  handle: OperationHandle,
  openUrl: (url: string) => Promise<void>,
  timeoutMs = 300000,
): Promise<OperationOutcome> {
  if (handle.signal.aborted) return { status: 'failed', message: 'Cancelled before execution.', output: '' };
  if (preview.action.kind === 'url') {
    await openUrl(preview.action.url);
    return { status: 'succeeded', message: 'Opened in the system browser.', output: '' };
  }
  if (process.platform === 'win32')
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Custom process commands currently require Linux or macOS.',
    );
  const action = preview.action;
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'SSH_AUTH_SOCK',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'XDG_CURRENT_DESKTOP',
    'XDG_SESSION_TYPE',
    'XDG_CONFIG_HOME',
    'XDG_CONFIG_DIRS',
    'XDG_DATA_HOME',
    'XDG_DATA_DIRS',
    'PULSE_SERVER',
    'DBUS_SESSION_BUS_ADDRESS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  for (const [key, value] of Object.entries(preview.variables)) env[commandEnvironmentName(key)] = value;
  env.GIT_TERMINAL_PROMPT = '0';
  return new Promise((resolve) => {
    const child = spawn(
      action.kind === 'bash' ? '/bin/bash' : action.executable,
      action.kind === 'bash' ? ['--noprofile', '--norc', '-p', '-c', action.script] : action.args,
      { cwd: preview.cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let reason = '';
    let output = '';
    let size = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* already exited */
        }
      }
    };
    const stop = (message: string) => {
      if (reason) return;
      reason = message;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 300);
    };
    const cancel = () => stop('Cancelled. Changes already made are not rolled back.');
    handle.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('Command timed out.'), timeoutMs);
    const append = (chunk: Buffer, decoder: StringDecoder) => {
      const available = Math.max(0, 65536 - size);
      const text = decoder.write(chunk.subarray(0, available));
      size += chunk.length;
      output += text;
      handle.appendOutput(text);
      if (size > 65536) stop('Output limit reached (64 KiB).');
    };
    child.stdout.on('data', (chunk: Buffer) => append(chunk, stdoutDecoder));
    child.stderr.on('data', (chunk: Buffer) => append(chunk, stderrDecoder));
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    child.on('error', () => {
      reason = 'The configured program could not be started.';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      handle.signal.removeEventListener('abort', cancel);
      // A background child must not outlive the supervised command and its repository lock.
      kill('SIGKILL');
      resolve({
        status: !reason && code === 0 ? 'succeeded' : 'failed',
        message:
          reason || (code === 0 ? 'Command completed.' : `Command exited with status ${code ?? 'unknown'}.`),
        output,
      });
    });
    if (handle.signal.aborted) cancel();
  });
}
