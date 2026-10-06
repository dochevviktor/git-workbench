import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCustomCommand } from '../../src/backend/commands/custom-command-service';
import { programInvocation, selectedEnvironment } from '../../src/backend/processes/platform-process';
import { runAgent } from '../../src/backend/ai/agent-provider';
import { GitRunner } from '../../src/backend/git/runner';
import { processState, testPlatform } from '../platform';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(['command', 'agent', 'git'] as const)(
  'cancels the %s process tree before releasing the request',
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-process-tree-'));
    roots.push(root);
    const marker = join(root, 'child');
    const controller = new AbortController();
    const args = [resolve('tests/fixtures/operation-process.ts'), 'tree', marker];
    const result =
      kind === 'command'
        ? runCustomCommand(
            {
              token: 'test',
              name: 'Test',
              cwd: root,
              action: { kind: 'process', executable: process.execPath, args },
              variables: {},
            },
            { signal: controller.signal, appendOutput: () => undefined, setProgress: () => undefined },
            async () => undefined,
          )
        : (kind === 'git'
            ? new GitRunner({ executable: process.execPath }).run(args, {
                cwd: root,
                signal: controller.signal,
              })
            : runAgent(process.execPath, args, root, selectedEnvironment(['PATH']), '', controller.signal)
          ).catch((error: Error) => error);
    let pid = 0;
    try {
      await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).not.toBe('');
      pid = Number(await readFile(marker, 'utf8'));
    } finally {
      controller.abort();
    }
    const finished = await result;
    if (kind === 'command')
      expect(finished).toMatchObject({ status: 'failed', message: expect.stringContaining('Cancelled') });
    else expect(finished).toMatchObject({ message: expect.stringContaining('cancelled') });
    if (testPlatform.windows) expect(await processState(pid)).toBe('gone');
    else await expect.poll(() => processState(pid)).toMatch(/^(?:Z|gone)$/u);
  },
);

it.skipIf(!testPlatform.windows)(
  'rejects implicit batch execution instead of interpreting argument metacharacters',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-no-shell-'));
    roots.push(root);
    const batch = join(root, 'fake.cmd');
    await writeFile(batch, '@echo off\r\n');
    await expect(programInvocation(batch, ['&', '%PATH%', 'a"b'])).rejects.toThrow(
      'explicitly configured interpreter',
    );
    expect(selectedEnvironment(['PATH'])).toMatchObject({
      SystemRoot: expect.any(String),
      USERPROFILE: expect.any(String),
    });
    expect(
      Object.keys(selectedEnvironment(['PATH'])).filter((key) => key.toLowerCase() === 'path'),
    ).toHaveLength(1);
  },
);
