import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Fixture repositories must not inherit the developer's line endings, signing or credential helpers. */
export function isolateTestGitConfiguration(): void {
  const directory = mkdtempSync(join(tmpdir(), 'workbench-test-config-'));
  const configuration = join(directory, 'gitconfig');
  writeFileSync(configuration, '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n', 'utf8');
  process.env.GIT_CONFIG_GLOBAL = configuration;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}
