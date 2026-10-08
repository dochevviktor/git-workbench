import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-ci-reports-'));
  roots.push(root);
  return root;
}

it('preserves a failed child exit status and captures its diagnostics without installing a sandbox locally', async () => {
  const root = await directory();
  await expect(
    execute(process.execPath, [resolve('scripts/ci-step.ts'), 'sandbox'], {
      env: {
        ...process.env,
        npm_execpath: 'unused-for-direct-node-step',
        CI_REPORT_DIR: root,
        GITHUB_ACTIONS: 'false',
      },
    }),
  ).rejects.toMatchObject({ code: 1 });
  expect(JSON.parse(await readFile(join(root, 'sandbox.step.json'), 'utf8'))).toMatchObject({
    name: 'sandbox',
    exitCode: 1,
  });
  expect(await readFile(join(root, 'sandbox.log'), 'utf8')).toContain('restricted to Linux GitHub Actions');
});

it('summarizes failed and skipped steps, unit failures, nested desktop failures and missing reports', async () => {
  const root = await directory();
  await writeFile(
    join(root, 'vitest.json'),
    JSON.stringify({
      numPassedTests: 4,
      numFailedTests: 1,
      numPendingTests: 2,
      testResults: [
        {
          name: 'unit.test.ts',
          assertionResults: [
            { fullName: 'unit failure', status: 'failed', failureMessages: ['expected rejection'] },
          ],
        },
      ],
    }),
  );
  await writeFile(
    join(root, 'playwright-desktop.json'),
    JSON.stringify({
      stats: { expected: 3, unexpected: 1, skipped: 1, flaky: 0 },
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: 'launch',
                  file: 'desktop.test.ts',
                  tests: [{ status: 'unexpected', results: [{ errors: [{ message: 'launch failed' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const summary = join(root, 'github-summary');
  await execute(process.execPath, [resolve('scripts/ci-report.ts')], {
    env: {
      ...process.env,
      CI_REPORT_DIR: root,
      GITHUB_STEP_SUMMARY: summary,
      CI_STEP_OUTCOMES: JSON.stringify({
        check: { outcome: 'failure' },
        build: { outcome: 'success' },
        'native-smoke': { outcome: 'skipped' },
      }),
      UNRELATED_SECRET: 'must_not_be_reported_34cd',
    },
  });
  expect(JSON.parse(await readFile(join(root, 'failures.json'), 'utf8'))).toEqual([
    { report: 'playwright-desktop.json', test: 'desktop.test.ts: launch', message: 'launch failed' },
    { report: 'vitest.json', test: 'unit failure', message: 'expected rejection' },
  ]);
  const text = await readFile(summary, 'utf8');
  expect(text).toContain('| check | failure |');
  expect(text).toContain('| native-smoke | skipped |');
  expect(text).toContain('4 passed, 1 failed, 2 skipped');
  expect(text).toContain('3 passed, 1 failed, 1 skipped');
  expect(text).toContain('A missing report');
  expect(await readFile(join(root, 'environment.json'), 'utf8')).not.toContain('must_not_be_reported');
});
