import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface TestAssertion {
  fullName: string;
  status: string;
  failureMessages?: string[];
}
interface UnitReport {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: Array<{ name: string; assertionResults: TestAssertion[]; message?: string }>;
}
interface DesktopSuite {
  suites?: DesktopSuite[];
  specs?: Array<{
    title: string;
    file: string;
    tests: Array<{ status: string; results: Array<{ errors?: Array<{ message?: string }> }> }>;
  }>;
}
interface DesktopReport extends DesktopSuite {
  stats?: { expected: number; unexpected: number; skipped: number; flaky: number };
  errors?: Array<{ message?: string }>;
}

const directory = resolve(process.env.CI_REPORT_DIR ?? 'test-results/ci');
await mkdir(directory, { recursive: true });
const metadata = {
  os: process.platform,
  arch: process.arch,
  node: process.version,
  commit: process.env.GITHUB_SHA ?? null,
  run: process.env.GITHUB_RUN_ID ?? null,
  attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  image: process.env.ImageOS ?? null,
  imageVersion: process.env.ImageVersion ?? null,
};
const steps = JSON.parse(process.env.CI_STEP_OUTCOMES ?? '{}') as Record<string, { outcome?: string }>;
const statuses = Object.entries(steps).map(([name, step]) => ({ name, outcome: step.outcome ?? 'unknown' }));
await writeFile(join(directory, 'environment.json'), JSON.stringify(metadata, null, 2));
await writeFile(join(directory, 'steps.json'), JSON.stringify(statuses, null, 2));
const lines = [
  `# Validation: ${metadata.os} ${metadata.arch}`,
  '',
  `Node ${metadata.node}; commit ${metadata.commit ?? 'local'}.`,
  '',
  '| Step | Outcome |',
  '| --- | --- |',
  ...statuses.map((step) => `| ${step.name} | ${step.outcome} |`),
  '',
];
const failures: Array<{ report: string; test: string; message: string }> = [];
for (const name of (await readdir(directory)).sort()) {
  try {
    if (name === 'vitest.json') {
      const report = JSON.parse(await readFile(join(directory, name), 'utf8')) as UnitReport;
      lines.push(
        `Unit tests: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped.`,
        '',
      );
      for (const file of report.testResults) {
        for (const test of file.assertionResults)
          if (test.status === 'failed')
            failures.push({
              report: name,
              test: test.fullName,
              message: (test.failureMessages ?? []).join('\n'),
            });
        if (!file.assertionResults.length && file.message)
          failures.push({ report: name, test: file.name, message: file.message });
      }
    } else if (/^playwright-.*\.json$/u.test(name)) {
      const report = JSON.parse(await readFile(join(directory, name), 'utf8')) as DesktopReport;
      if (report.stats)
        lines.push(
          `${name}: ${report.stats.expected} passed, ${report.stats.unexpected} failed, ${report.stats.skipped} skipped, ${report.stats.flaky} flaky.`,
          '',
        );
      const visit = (suite: DesktopSuite) => {
        for (const spec of suite.specs ?? [])
          for (const test of spec.tests)
            if (test.status === 'unexpected')
              failures.push({
                report: name,
                test: `${spec.file}: ${spec.title}`,
                message: test.results
                  .flatMap((result) => result.errors?.map((error) => error.message ?? '') ?? [])
                  .join('\n'),
              });
        for (const child of suite.suites ?? []) visit(child);
      };
      visit(report);
      for (const error of report.errors ?? [])
        failures.push({ report: name, test: 'Runner error', message: error.message ?? '' });
    }
  } catch {
    lines.push(`Could not read ${name}; inspect its step log.`, '');
  }
}
await writeFile(join(directory, 'failures.json'), JSON.stringify(failures, null, 2));
if (failures.length)
  lines.push(
    '## Failures',
    '',
    ...failures.map((failure) => `- ${failure.test.replaceAll('\n', ' ')} (${failure.report})`),
    '',
  );
lines.push(
  'The artifact includes step logs, JSON/JUnit results and available desktop traces, error contexts and HTML reports. A missing report means the suite did not produce one; inspect the step outcome and log.',
  '',
);
const summary = lines.join('\n');
await writeFile(join(directory, 'summary.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
