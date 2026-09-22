import { writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statisticsFixture } from '../statistics-fixture';
import { AiService } from '../../src/backend/ai/ai-service';
import { OpenAiProvider } from '../../src/backend/ai/openai-provider';
import { RepositoryService } from '../../src/backend/repositories/repository-service';
import { aiPreviewRequestSchema } from '../../src/common/ipc/ai';
import { requests } from '../../src/common/ipc/contracts';
import { canInvokeInspector } from '../../src/backend/electron/commit-inspector-policy';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture() {
  const f = await statisticsFixture();
  cleanup.push(f.cleanup);
  const keyPath = join(f.root, 'key.txt');
  const key = 'sk-test-not-a-real-api-key';
  await writeFile(keyPath, key);
  const generate = vi.fn(async () => 'Add a useful change\n\nExplain the change.');
  const service = new AiService({ generate });
  cleanup.push(async () => {
    service.disable();
  });
  await service.configure(1, 'test-model', async () => keyPath);
  return { ...f, key, keyPath, generate, service };
}
const staged = { id: 'test', target: { kind: 'staged' as const } };

describe('F37 explicit AI requests', () => {
  it('sends exactly the approved staged snapshot, excluding unstaged/untracked content; tokens are one-use and owner-bound', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'staged text\n');
    await f.run('add', '.');
    await writeFile(join(f.cwd, 'a.txt'), 'unstaged secret\n');
    await writeFile(join(f.cwd, 'untracked.txt'), 'untracked secret');
    const before = await f.run('ls-files', '--stage');
    const index = await readFile(join(f.cwd, '.git/index'));
    const preview = await f.service.preview(f.git, 1, f.cwd, staged);
    expect(await readFile(join(f.cwd, '.git/index'))).toEqual(index);
    expect(preview.material).toContain('+staged text');
    expect(preview.material).not.toMatch(/unstaged secret|untracked secret/u);
    expect(f.generate).not.toHaveBeenCalled();
    await expect(f.service.send(2, { id: staged.id, token: preview.token })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
    });
    await expect(f.service.send(1, { id: 'wrong', token: preview.token })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
    });
    await f.run('add', 'a.txt');
    await f.service.send(1, { id: staged.id, token: preview.token });
    expect(f.generate).toHaveBeenCalledWith(
      f.key,
      'test-model',
      preview.instructions,
      preview.material,
      expect.any(AbortSignal),
    );
    await expect(f.service.send(1, { id: staged.id, token: preview.token })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
    });
    // Reset only our disposable fixture's staged content, then prove preview did not write the index.
    expect(before).toContain('a.txt');
    expect(index.equals(await readFile(join(f.cwd, '.git/index')))).toBe(false);
    expect(await readFile(join(f.cwd, 'a.txt'), 'utf8')).toBe('unstaged secret\n');
  });

  it('pins branch/remote tips, supports endpoint and merge-base comparisons and leaves refs/index/worktree unchanged', async () => {
    const f = await fixture();
    await f.populate();
    const base = await f.run('rev-parse', 'HEAD~2');
    const head = await f.run('rev-parse', 'HEAD');
    const before = await f.run('show-ref');
    const index = await readFile(join(f.cwd, '.git/index'));
    for (const mergeBase of [false, true]) {
      const preview = await f.service.preview(f.git, 1, f.cwd, {
        id: 'test',
        target: { kind: 'range', base, head: 'refs/heads/main', mergeBase },
      });
      expect(preview.scope).toContain(head);
      expect(preview.scope).toContain(base);
      expect(preview.material).toContain('-one\n+two');
    }
    expect(await f.run('show-ref')).toBe(before);
    expect(await readFile(join(f.cwd, '.git/index'))).toEqual(index);
    expect(await f.run('status', '--porcelain')).toBe('');
    await expect(
      f.service.preview(f.git, 1, f.cwd, {
        id: 'test',
        target: { kind: 'range', base, head: 'refs/heads/main~1', mergeBase: false },
      }),
    ).rejects.toThrow();
  });

  it('rejects empty, oversized, invalid encoding and credential-bearing diffs without contacting a provider', async () => {
    const f = await fixture();
    await expect(f.service.preview(f.git, 1, f.cwd, staged)).rejects.toThrow('no changes');
    for (const content of ['x'.repeat(140000), Buffer.from([0xff, 0x0a]), f.key]) {
      await writeFile(join(f.cwd, 'a.txt'), content);
      await f.run('add', '.');
      await expect(f.service.preview(f.git, 1, f.cwd, staged)).rejects.toThrow();
    }
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('cancels generation and discards late results on disable, owner or repository close', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'test');
    await f.run('add', '.');
    for (const cancel of [
      () => f.service.cancel(1, 'test'),
      () => f.service.cancel(1),
      () => f.service.disable(),
    ]) {
      const preview = await f.service.preview(f.git, 1, f.cwd, staged);
      let complete!: (value: string) => void;
      f.generate.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const pending = f.service.send(1, { id: 'test', token: preview.token });
      f.service.cancel(2); // other owners cannot abort this request
      expect(f.generate.mock.calls.at(-1)?.length).toBe(5);
      cancel();
      complete('Late result');
      await expect(pending).rejects.toThrow('cancelled');
    }
    expect(f.service.settings().enabled).toBe(false);
  });

  it('rejects invalid key files, cancels a late native chooser and never persists credentials', async () => {
    const f = await fixture();
    const link = join(f.root, 'key-link');
    await symlink(f.keyPath, link);
    await expect(f.service.configure(1, 'model', async () => link)).rejects.toThrow('regular text file');
    let choose!: (path: string) => void;
    const pending = f.service.configure(
      1,
      'model',
      () =>
        new Promise((resolve) => {
          choose = resolve;
        }),
    );
    f.service.disable();
    choose(f.keyPath);
    await expect(pending).rejects.toThrow('cancelled');
    expect(new AiService().settings()).toEqual({
      enabled: false,
      model: null,
      provider: 'openai',
      storage: 'session',
    });
  });

  it('repository ownership, tab close and window disposal invalidate previews', async () => {
    const f = await fixture();
    await f.populate();
    await writeFile(join(f.cwd, 'a.txt'), 'test');
    await f.run('add', '.');
    const repositories = new RepositoryService({ storagePath: join(f.root, 'recent.json') });
    try {
      const opened = await repositories.open(1, f.cwd);
      await repositories.ai.configure(1, 'model', async () => f.keyPath);
      const request = { ...staged, id: opened.id };
      expect(() => repositories.previewAi(2, request)).toThrow('not open');
      const preview = await repositories.previewAi(1, request);
      await repositories.close(1, opened.id);
      await expect(repositories.ai.send(1, { id: opened.id, token: preview.token })).rejects.toThrow(
        'expired',
      );
      await repositories.open(1, f.cwd);
      const next = await repositories.previewAi(1, request);
      repositories.disposeWindow(1);
      await expect(repositories.ai.send(1, { id: opened.id, token: next.token })).rejects.toThrow('expired');
    } finally {
      repositories.dispose();
    }
  });

  it('has strict schemas and denies all AI channels to inspectors', () => {
    expect(aiPreviewRequestSchema.safeParse({ ...staged, key: 'secret' }).success).toBe(false);
    expect(
      aiPreviewRequestSchema.safeParse({
        id: 'x',
        target: { kind: 'range', base: '--help', head: 'HEAD', mergeBase: false },
      }).success,
    ).toBe(false);
    for (const kind of ['commit-details', 'file-history', 'blame'] as const)
      for (const contract of Object.values(requests).filter((entry) => entry.channel.startsWith('ai:')))
        expect(canInvokeInspector(kind, contract.channel, undefined)).toBe(false);
  });

  it('expires previews and disables external diff/textconv programs', async () => {
    const f = await fixture();
    await writeFile(join(f.cwd, 'a.txt'), 'one\n');
    await writeFile(join(f.cwd, '.gitattributes'), '*.txt diff=hostile\n');
    await f.commit('Initial', '2025-01-01T00:00:00Z');
    await f.run('config', 'diff.external', '/missing-program-that-must-not-run');
    await f.run('config', 'diff.hostile.textconv', '/missing-program-that-must-not-run');
    await writeFile(join(f.cwd, 'a.txt'), 'two\n');
    await f.run('add', '.');
    vi.useFakeTimers();
    const preview = await f.service.preview(f.git, 1, f.cwd, staged);
    expect(preview.material).toContain('-one\n+two');
    vi.advanceTimersByTime(600001);
    await expect(f.service.send(1, { id: 'test', token: preview.token })).rejects.toThrow('expired');
    expect(f.generate).not.toHaveBeenCalled();
  });
});

describe('OpenAI fixed API transport', () => {
  const signal = () => new AbortController().signal;
  const response = (text: string) => ({
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  });
  it('sends only the reviewed input, no tools, no storage; parses all message text and redacts keys', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response('key-secret result')));
    const provider = new OpenAiProvider(transport);
    expect(await provider.generate('key-secret', 'model', 'instructions', 'diff', signal())).toBe(
      '[redacted] result',
    );
    expect(transport.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
    const options = transport.mock.calls[0]?.[1];
    expect(options?.redirect).toBe('error');
    expect(JSON.parse(options?.body as string)).toEqual({
      model: 'model',
      instructions: 'instructions',
      input: 'diff',
      store: false,
      tools: [],
      max_output_tokens: 4096,
    });
  });
  it.each([401, 403, 429, 400, 404, 500, 302])(
    'sanitizes HTTP %s failures and never retries',
    async (status) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('secret provider body', { status }));
      const provider = new OpenAiProvider(transport);
      await expect(provider.generate('secret-key', 'model', 'p', 'd', signal())).rejects.toThrow();
      try {
        await provider.generate('secret-key', 'model', 'p', 'd', signal());
      } catch (error) {
        expect(String(error)).not.toContain('secret');
      }
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    { status: 'incomplete', output: [] },
    response(''),
    response('x'.repeat(33000)),
    { output_text: 'invalid' },
  ])('rejects incomplete or unsupported results', async (body) => {
    const provider = new OpenAiProvider(vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    await expect(provider.generate('secret', 'model', 'p', 'd', signal())).rejects.toThrow(
      'invalid or oversized',
    );
  });
  it('bounds response bytes and hides transport exceptions', async () => {
    for (const transport of [
      vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(524289))),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-key in diagnostic')),
    ]) {
      const provider = new OpenAiProvider(transport);
      await expect(provider.generate('secret-key', 'model', 'p', 'd', signal())).rejects.toThrow(
        'unavailable',
      );
    }
  });
});
