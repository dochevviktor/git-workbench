#!/usr/bin/env node
/** A real Git transport with one fixture repository's log reads delayed for UI generation tests. */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const executable = process.env.GIT_WORKBENCH_REAL_GIT;
if (!executable) throw new Error('The fixture needs the real Git executable.');
const delayed = process.cwd() === process.env.GIT_WORKBENCH_DELAY_REPOSITORY && args.includes('log');
if (delayed) {
  await writeFile(process.env.GIT_WORKBENCH_DELAY_MARKER!, 'log started');
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
const child = spawn(executable, args, { stdio: 'inherit' });
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
  if (delayed) void writeFile(`${process.env.GIT_WORKBENCH_DELAY_MARKER!}.done`, 'log completed');
});
