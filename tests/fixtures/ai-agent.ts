#!/usr/bin/env node
// A deterministic stand-in for the public CLI contracts. Never contacts a provider.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
let input = '';
for await (const chunk of process.stdin) input += String(chunk);
if (model === 'wait') {
  process.on('SIGTERM', () => undefined);
  await writeFile(join(process.cwd(), 'ready'), String(process.pid));
  await new Promise(() => setInterval(() => undefined, 1000));
} else if (model === 'fail') {
  process.stderr.write('credential-that-must-not-reach-the-renderer');
  process.exitCode = 1;
} else if (model === 'oversize') {
  process.stdout.write('x'.repeat(600000));
} else if (model === 'malformed') {
  process.stdout.write('{invalid');
} else {
  const cursor = args.includes('--workspace');
  const record = {
    args,
    input,
    cwd: process.cwd(),
    environment: Object.keys(process.env),
    cursor: cursor
      ? (JSON.parse(await readFile(join(process.cwd(), '.cursor', 'cli.json'), 'utf8')) as unknown)
      : null,
  };
  const result =
    model === 'echo-key'
      ? process.env.CURSOR_API_KEY
      : model === 'ui-test'
        ? 'Draft from approved material'
        : JSON.stringify(record);
  if (args[0] === 'exec') {
    process.stdout.write(
      `${JSON.stringify({ type: 'item.completed', item: { type: model === 'tool' ? 'command_execution' : 'agent_message', text: result } })}\n`,
    );
    if (model !== 'incomplete') process.stdout.write('{"type":"turn.completed"}\n');
  } else
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result }));
}
