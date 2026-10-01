import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const metadata = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const configuration = JSON.parse(await readFile('electron-builder.json', 'utf8')) as { productName: string };
const executable =
  process.argv[2] ?? resolve('release', `${configuration.productName}-${metadata.version}.AppImage`);
const child = spawn(
  process.execPath,
  [
    'node_modules/playwright/cli.js',
    'test',
    'tests/e2e/desktop.test.ts',
    'tests/e2e/p14-package.test.ts',
    '--output=release/p14/package-verified',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_TEST_EXECUTABLE: executable, APPIMAGE_EXTRACT_AND_RUN: '1' },
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
