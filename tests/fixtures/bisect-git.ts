#!/usr/bin/env node
/** Hold only Bisect context reads, leaving real Git and the application's mutation guards intact. */
import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const args = process.argv.slice(2);
const executable = process.env.GIT_WORKBENCH_REAL_GIT;
const gate = process.env.GIT_WORKBENCH_BISECT_GATE;
if (!executable || !gate) throw new Error('The fixture needs real Git and a read gate.');
if (args.includes('for-each-ref') && args.includes('refs/bisect/')) {
  const deadline = Date.now() + 60_000;
  while (
    await access(gate).then(
      () => true,
      () => false,
    )
  ) {
    await writeFile(`${gate}.waiting`, 'bisect read waiting');
    if (Date.now() > deadline) throw new Error('The test did not release the Bisect read.');
    await setTimeout(20);
  }
}
const child = spawn(executable, args, { stdio: 'inherit' });
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
