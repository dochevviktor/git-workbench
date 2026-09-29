#!/usr/bin/env node
/** Delay one real Git invocation at a controlled boundary in a disposable Electron fixture. */
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const args = process.argv.slice(2);
const executable = process.env.GIT_WORKBENCH_REAL_GIT;
const gate = process.env.GIT_WORKBENCH_TEST_GIT_GATE ?? '';
if (!executable || !gate) throw new Error('The fixture needs real Git and its test gate.');
const configuration = await readFile(gate, 'utf8').then(
  (value) => JSON.parse(value) as { command: string; argument?: string; phase: 'before' | 'after' },
  () => undefined,
);
const matches =
  configuration &&
  args.includes(configuration.command) &&
  (!configuration.argument || args.includes(configuration.argument));
async function waitAtGate() {
  await writeFile(`${gate}.waiting`, `${configuration!.command}:${configuration!.phase}`);
  const deadline = Date.now() + 20_000;
  while (
    await access(gate).then(
      () => true,
      () => false,
    )
  ) {
    if (Date.now() > deadline) throw new Error('The test did not release its Git gate.');
    await setTimeout(10);
  }
}
if (matches && configuration.phase === 'before') await waitAtGate();
const result = await new Promise<number>((resolve, reject) => {
  const child = spawn(executable, args, { stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code) => resolve(code ?? 1));
});
if (matches && configuration.phase === 'after' && result === 0) await waitAtGate();
process.exitCode = result;
