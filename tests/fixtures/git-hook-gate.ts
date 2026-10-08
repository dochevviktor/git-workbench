#!/usr/bin/env node
/** Hold only an explicit mutation's Git hook; routine Git reads use the native executable. */
import { access, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const gate = process.env.GIT_WORKBENCH_TEST_GIT_GATE;
if (!gate) throw new Error('The fixture hook needs its test gate.');
if (
  await access(gate).then(
    () => true,
    () => false,
  )
) {
  await writeFile(`${gate}.waiting`, 'hook:waiting');
  const deadline = Date.now() + 60_000;
  while (
    await access(gate).then(
      () => true,
      () => false,
    )
  ) {
    if (Date.now() > deadline) throw new Error('The test did not release its Git hook.');
    await setTimeout(10);
  }
}
