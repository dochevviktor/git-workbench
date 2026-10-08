import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { prepareCiSandbox } from './ci-sandbox.ts';

const metadata = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const configuration = JSON.parse(await readFile('electron-builder.json', 'utf8')) as { productName: string };
if (!['win32', 'linux'].includes(process.platform))
  throw new Error('Package smoke verification currently supports Windows and Linux.');
let executable =
  process.argv[2] ??
  (process.platform === 'win32'
    ? resolve('release', 'win-unpacked', `${configuration.productName}.exe`)
    : resolve('release', `${configuration.productName}-${metadata.version}.AppImage`));
let extracted: string | undefined;
try {
  // The extracted helper also needs root ownership on runners without user namespaces.
  // Configure that exact helper while keeping the packaged application and sandbox assertions intact.
  if (
    process.platform === 'linux' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    executable.endsWith('.AppImage')
  ) {
    extracted = await mkdtemp(join(tmpdir(), 'workbench-package-'));
    await promisify(execFile)(resolve(executable), ['--appimage-extract'], {
      cwd: extracted,
      timeout: 60000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const app = join(extracted, 'squashfs-root');
    await prepareCiSandbox(join(app, 'chrome-sandbox'));
    executable = join(app, 'AppRun');
  }
  const child = spawn(
    process.execPath,
    [
      'node_modules/playwright/cli.js',
      'test',
      'tests/e2e/desktop.test.ts',
      'tests/e2e/reference-readiness.test.ts',
      'tests/e2e/sandbox.test.ts',
      'tests/e2e/p14-package.test.ts',
      'tests/e2e/p14-commit-refresh.test.ts',
      'tests/e2e/windows-native.test.ts',
      'tests/e2e/custom-commands.test.ts',
      'tests/e2e/external-tools.test.ts',
      'tests/e2e/p13-ai.test.ts',
      '--output=release/p14/package-verified',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_TEST_EXECUTABLE: executable, APPIMAGE_EXTRACT_AND_RUN: '1' },
    },
  );
  process.exitCode = await new Promise<number>((done) => {
    child.on('error', (error) => {
      console.error(error.message);
      done(1);
    });
    child.on('close', (code) => done(code ?? 1));
  });
} finally {
  if (extracted) await rm(extracted, { recursive: true, force: true });
}
