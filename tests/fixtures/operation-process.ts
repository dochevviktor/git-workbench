#!/usr/bin/env node
/** Disposable process-tree fixture. Invoked with Node; no user's Git hooks or repositories are used. */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const mode = process.argv[2] ?? (process.env.GIT_WORKBENCH_FIXTURE_WAIT_MARKER ? 'wait' : undefined);
const marker = process.argv[3] ?? process.env.GIT_WORKBENCH_FIXTURE_WAIT_MARKER;
if (mode === 'child') {
  process.on('SIGTERM', () => undefined);
  if (marker) writeFileSync(marker, String(process.pid));
  setInterval(() => undefined, 1000);
} else if (mode === 'tree') {
  spawn(process.execPath, [import.meta.filename, 'child', marker ?? ''], { stdio: 'ignore' });
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => undefined, 1000);
} else if (mode === 'wait') {
  process.on('SIGTERM', () => undefined);
  if (marker) writeFileSync(marker, String(process.pid));
  process.stdout.write('Waiting for cancellation.\n');
  setInterval(() => undefined, 1000);
} else if (mode === 'hook') {
  if (process.env.GIT_WORKBENCH_FIXTURE_MARKER)
    writeFileSync(process.env.GIT_WORKBENCH_FIXTURE_MARKER, 'ran');
} else if (mode === 'output') {
  process.stderr.write('x'.repeat(100_000));
} else if (mode === 'arguments') {
  process.stdout.write(JSON.stringify(process.argv.slice(3)));
} else if (mode === 'environment') {
  process.stdout.write(
    JSON.stringify(
      Object.fromEntries(process.argv.slice(3).map((name) => [name, process.env[name] ?? null])),
    ),
  );
}
