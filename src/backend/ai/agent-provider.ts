import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { aiProviderNames, aiResultSchema } from '../../common/ipc/ai';
import type { AiProviderId } from '../../common/ipc/ai';
import { ExpectedBackendError } from '../errors';
import { redactUrlCredentials } from '../git/runner';

type Agent = Extract<AiProviderId, 'claude' | 'codex' | 'cursor'>;

export async function validateAiExecutable(path: string): Promise<string> {
  try {
    if (process.platform === 'win32' || !isAbsolute(path)) throw new Error('Unsupported');
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isFile()) throw new Error('Not a file');
    await access(canonical, constants.X_OK);
    return canonical;
  } catch {
    throw new ExpectedBackendError(
      'UNAVAILABLE',
      'Select an installed, executable agent program. CLI adapters currently support Linux and macOS.',
    );
  }
}

/** Fixed adapters only. User input is stdin, never shell source or arbitrary process arguments. */
export class AgentProvider {
  async generate(
    agent: Agent,
    executable: string,
    key: string,
    model: string,
    instructions: string,
    material: string,
    signal: AbortSignal,
  ): Promise<string> {
    await validateAiExecutable(executable);
    const directory = await mkdtemp(join(tmpdir(), 'git-workbench-ai-'));
    try {
      const env: NodeJS.ProcessEnv = {};
      for (const name of [
        'PATH',
        'HOME',
        'USER',
        'LOGNAME',
        'LANG',
        'LC_ALL',
        'XDG_CONFIG_HOME',
        'XDG_DATA_HOME',
        'XDG_RUNTIME_DIR',
        'DBUS_SESSION_BUS_ADDRESS',
      ])
        if (process.env[name]) env[name] = process.env[name];
      env.NO_COLOR = '1';
      env.CI = '1';
      let args: string[];
      if (agent === 'claude') {
        args = [
          '--safe-mode',
          '--restricted',
          '--print',
          '--output-format',
          'json',
          '--model',
          model,
          '--tools',
          '',
          '--disallowedTools',
          'mcp__*',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
          '--setting-sources',
          '',
          '--settings',
          '{"disableAllHooks":true}',
          '--disable-slash-commands',
          '--no-session-persistence',
          '--permission-mode',
          'dontAsk',
          '--permission-prompts',
          'none',
          '--no-chrome',
        ];
        env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      } else if (agent === 'codex') {
        args = [
          'exec',
          '--ignore-user-config',
          '--ignore-rules',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--json',
          '--model',
          model,
          '-c',
          'approval_policy="never"',
          '-c',
          'web_search="disabled"',
          '-c',
          'project_doc_max_bytes=0',
          '-c',
          'tools.view_image=false',
          '-c',
          'apps._default.enabled=false',
          '-c',
          'mcp_servers={}',
          '-c',
          'features.shell_tool=false',
          '-c',
          'features.unified_exec=false',
          '-c',
          'features.browser_use=false',
          '-c',
          'features.browser_use_external=false',
          '-c',
          'features.computer_use=false',
          '-c',
          'features.image_generation=false',
          '-c',
          'features.code_mode_host=false',
          '-c',
          'features.daemon_auto_start=false',
          '-c',
          'features.multi_agent=false',
          '-c',
          'features.hooks=false',
          '-c',
          'features.memories=false',
          '-c',
          'features.plugins=false',
          '-c',
          'features.apps=false',
          '-c',
          'features.skill_search=false',
          '-c',
          'features.skip_host_skill_discovery=true',
          '-c',
          'features.skill_mcp_dependency_install=false',
          '-',
        ];
      } else {
        const config = join(directory, '.cursor');
        await mkdir(config);
        // Isolate the CLI configuration as well as its workspace. Native Cursor authentication is
        // deliberately not copied; its explicitly selected API key lives only in the child environment.
        env.CURSOR_CONFIG_DIR = config;
        env.CURSOR_API_KEY = key;
        const settings = {
          permissions: {
            allow: [],
            deny: ['Shell(*)', 'Read(**)', 'Read(/**)', 'Write(**)', 'Write(/**)', 'WebFetch(*)', 'Mcp(*:*)'],
          },
        };
        await writeFile(join(config, 'cli-config.json'), JSON.stringify(settings), { mode: 0o600 });
        await writeFile(join(config, 'cli.json'), JSON.stringify(settings), { mode: 0o600 });
        await writeFile(join(config, 'mcp.json'), '{"mcpServers":{}}', { mode: 0o600 });
        await writeFile(join(config, 'hooks.json'), '{"version":1,"hooks":{}}', { mode: 0o600 });
        args = [
          '--print',
          '--output-format',
          'json',
          '--mode',
          'ask',
          '--sandbox',
          'enabled',
          '--workspace',
          directory,
          '--trust',
          '--model',
          model,
        ];
      }
      const output = await runAgent(
        executable,
        args,
        directory,
        env,
        `${instructions}\n\n${material}`,
        signal,
      );
      let text: string;
      if (agent === 'codex') {
        const eventSchema = z.object({
          type: z.string(),
          item: z.object({ type: z.string(), text: z.string().optional() }).optional(),
        });
        const events = output
          .trim()
          .split('\n')
          .map((line) => eventSchema.parse(JSON.parse(line)));
        if (
          !events.some((event) => event.type === 'turn.completed') ||
          events.some((event) => event.type === 'turn.failed' || event.type === 'error')
        )
          throw new Error('Incomplete agent result');
        if (events.some((event) => event.item && !['agent_message', 'reasoning'].includes(event.item.type)))
          throw new Error('Unexpected agent tool use');
        text = events
          .filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')
          .map((event) => event.item!.text ?? '')
          .join('\n');
      } else {
        const result = z
          .object({
            type: z.literal('result'),
            subtype: z.literal('success'),
            is_error: z.literal(false).optional(),
            result: z.string(),
          })
          .parse(JSON.parse(output));
        text = result.result;
      }
      if (key) text = text.replaceAll(key, '[redacted]');
      return aiResultSchema.parse({ text: redactUrlCredentials(text).trim() }).text;
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        `${aiProviderNames[agent]} could not complete the request. Check the installed version, model and authentication. Raw agent diagnostics are withheld because they may contain credentials.`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

/** No logs or raw diagnostics. A child and its descendants cannot outlive this request. */
export function runAgent(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) return Promise.reject(new ExpectedBackendError('UNAVAILABLE', 'AI request cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (kind: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, kind);
        } catch {
          /* already gone */
        }
      }
    };
    const stop = (reason: string) => {
      if (failure) return;
      failure = reason;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 300);
    };
    const cancel = () => stop('The AI request was cancelled.');
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('The AI agent timed out.'), 120000);
    const accept = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) stop('The AI agent exceeded its output limit.');
      else if (stdout) chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => accept(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => accept(chunk, false));
    child.stdin.on('error', () => stop('The AI agent stopped accepting input.'));
    child.on('error', () => stop('The configured AI agent could not be started.'));
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', cancel);
      kill('SIGKILL');
      if (failure || code !== 0)
        reject(
          new ExpectedBackendError(
            'UNAVAILABLE',
            failure ||
              'The AI agent failed. Check its version, model and login in your terminal, then retry.',
          ),
        );
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    if (signal.aborted) cancel();
    else child.stdin.end(input);
  });
}
