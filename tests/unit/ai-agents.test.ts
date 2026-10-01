import { access, copyFile, chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentProvider, runAgent, validateAiExecutable } from '../../src/backend/ai/agent-provider';
import { OllamaProvider } from '../../src/backend/ai/ollama-provider';

const cleanup: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function executable() {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-agent-test-'));
  cleanup.push(directory);
  const path = join(directory, 'agent.ts');
  await copyFile(resolve('tests/fixtures/ai-agent.ts'), path);
  await chmod(path, 0o700);
  return { path, directory };
}
const signal = () => new AbortController().signal;

describe('P13 fixed CLI adapters', () => {
  it.each(['claude', 'codex', 'cursor'] as const)(
    'runs %s outside the checkout with exact stdin, bounded text and no inherited secrets',
    async (agent) => {
      const { path } = await executable();
      vi.stubEnv('OPENAI_API_KEY', 'must-not-be-inherited');
      vi.stubEnv('NODE_OPTIONS', '--require=/must-not-load');
      const text = await new AgentProvider().generate(
        agent,
        path,
        'synthetic-key',
        'test',
        'Instructions',
        'untrusted $(exit) `command` diff',
        signal(),
      );
      const result = JSON.parse(text) as {
        args: string[];
        input: string;
        cwd: string;
        environment: string[];
        cursor: { permissions: { deny: string[] } } | null;
      };
      expect(result.input).toBe('Instructions\n\nuntrusted $(exit) `command` diff');
      expect(result.args.join(' ')).not.toContain('untrusted');
      expect(result.cwd).not.toBe(process.cwd());
      await expect(access(result.cwd)).rejects.toThrow(); // Temporary request data is removed.
      expect(result.environment).not.toContain('OPENAI_API_KEY');
      expect(result.environment).not.toContain('NODE_OPTIONS');
      if (agent === 'claude')
        expect(result.args).toEqual(
          expect.arrayContaining(['--tools', '', '--strict-mcp-config', '--no-session-persistence']),
        );
      if (agent === 'codex')
        expect(result.args).toEqual(
          expect.arrayContaining([
            '--ignore-user-config',
            '--ephemeral',
            'read-only',
            'features.shell_tool=false',
          ]),
        );
      if (agent === 'cursor')
        expect(result.cursor?.permissions.deny).toEqual(
          expect.arrayContaining(['Shell(*)', 'Read(/**)', 'Write(/**)', 'Mcp(*:*)']),
        );
    },
  );
  it.each(['fail', 'oversize', 'malformed', 'incomplete', 'tool'])(
    'rejects %s without exposing raw diagnostics or partial results',
    async (model) => {
      const { path } = await executable();
      await expect(
        new AgentProvider().generate('codex', path, '', model, 'Instructions', 'diff', signal()),
      ).rejects.toThrow(/agent|Codex/u);
    },
  );
  it('redacts explicitly configured credentials from an agent response', async () => {
    const { path } = await executable();
    expect(
      await new AgentProvider().generate(
        'cursor',
        path,
        'synthetic-key',
        'echo-key',
        'Instructions',
        'diff',
        signal(),
      ),
    ).toBe('[redacted]');
  });
  it('terminates an active process and rejects cancelled-before-start and missing tools', async () => {
    const { path, directory } = await executable();
    const controller = new AbortController();
    const result = runAgent(
      path,
      ['--model', 'wait'],
      directory,
      { PATH: process.env.PATH },
      'diff',
      controller.signal,
    );
    const rejected = expect(result).rejects.toThrow('cancelled');
    await vi.waitFor(async () => expect(await readdir(directory)).toContain('ready'));
    const pid = Number(await readFile(join(directory, 'ready'), 'utf8'));
    controller.abort();
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(runAgent(path, [], directory, {}, '', controller.signal)).rejects.toThrow('cancelled');
    await expect(validateAiExecutable('/missing-agent')).rejects.toThrow('installed');
    await expect(validateAiExecutable(directory)).rejects.toThrow('installed');
    await expect(validateAiExecutable('agent')).rejects.toThrow('installed');
  });
});

describe('P13 local Ollama adapter', () => {
  it('checks local metadata before sending material and requests no tools, streaming, or retained model', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ details: { family: 'llama' } }))
      .mockResolvedValueOnce(
        Response.json({ done: true, message: { role: 'assistant', content: 'Local draft' } }),
      );
    expect(
      await new OllamaProvider(transport).generate(
        '',
        'local-model',
        'Instructions',
        'private diff',
        signal(),
      ),
    ).toBe('Local draft');
    expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/api/show');
    expect(transport.mock.calls[0]?.[1]?.body).not.toContain('private diff');
    expect(transport.mock.calls[1]?.[0]).toBe('http://127.0.0.1:11434/api/chat');
    expect(transport.mock.calls[1]?.[1]?.redirect).toBe('error');
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toMatchObject({
      stream: false,
      tools: [],
      keep_alive: 0,
      options: { num_predict: 4096 },
    });
  });
  it.each([{ remote_model: 'model' }, { remote_host: 'https://remote.test' }])(
    'refuses cloud metadata before transmitting the diff',
    async (metadata) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));
      await expect(
        new OllamaProvider(transport).generate('', 'alias', '', 'secret diff', signal()),
      ).rejects.toThrow('locally installed');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    new Response('secret error', { status: 404 }),
    Response.json({ done: false, message: { content: 'partial' } }),
    new Response('x'.repeat(600000)),
  ])('rejects unavailable, incomplete and oversized responses', async (response) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(response);
    await expect(new OllamaProvider(transport).generate('', 'local', '', 'diff', signal())).rejects.toThrow(
      'Ollama is unavailable',
    );
  });
});
