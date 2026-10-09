import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const commands: Record<string, string[]> = {
  install: ['ci'],
  capabilities: ['run', 'test:capabilities'],
  check: ['run', 'check'],
  build: ['run', 'build'],
  package: ['run', 'package'],
  sandbox: ['scripts/ci-sandbox.ts'],
  desktop: ['node_modules/playwright/cli.js', 'test'],
  'native-smoke': [
    'node_modules/playwright/cli.js',
    'test',
    'tests/e2e/desktop.test.ts',
    'tests/e2e/toolbar-accessibility.test.ts',
    'tests/e2e/history-menu-readiness.test.ts',
    'tests/e2e/diff-action-refresh.test.ts',
    'tests/e2e/reference-readiness.test.ts',
    'tests/e2e/sandbox.test.ts',
    'tests/e2e/window-lifecycle.test.ts',
    'tests/e2e/windows-native.test.ts',
  ],
  'package-smoke': ['run', 'test:package'],
};
const name = process.argv[2] ?? '';
const args = commands[name];
const npm = process.env.npm_execpath;
if (!args || !npm) throw new Error('Run npm run ci:step -- <known step>.');
const directory = resolve(process.env.CI_REPORT_DIR ?? 'test-results/ci');
await mkdir(directory, { recursive: true });
const log = createWriteStream(join(directory, `${name}.log`));
const startedAt = new Date().toISOString();
const started = Date.now();
const child = spawn(
  process.execPath,
  ['sandbox', 'desktop', 'native-smoke'].includes(name) ? args : [npm, ...args],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, CI_REPORT_DIR: directory, CI_REPORT_GROUP: name },
  },
);
child.stdout.on('data', (data: Buffer) => {
  process.stdout.write(data);
  log.write(data);
});
child.stderr.on('data', (data: Buffer) => {
  process.stderr.write(data);
  log.write(data);
});
const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((done) => {
  child.on('error', (error) => {
    log.write(`${error.message}\n`);
    console.error(error.message);
  });
  child.on('close', (exitCode, signal) => done({ exitCode, signal }));
});
await new Promise<void>((done, reject) => {
  log.on('error', reject);
  log.end(done);
});
await writeFile(
  join(directory, `${name}.step.json`),
  JSON.stringify(
    {
      name,
      startedAt,
      durationMs: Date.now() - started,
      ...result,
    },
    null,
    2,
  ),
);
process.exitCode = result.exitCode ?? 1;
