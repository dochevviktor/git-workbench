import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

/** Fixture repositories must not inherit the developer's line endings, signing or credential helpers. */
export function isolateTestGitConfiguration(): void {
  if (process.platform === 'win32') {
    // Use Git's bundled GPG/OpenSSL for local fixtures without modifying the user's PATH.
    const git = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8', windowsHide: true })
      .trim()
      .split(/\r?\n/u)[0];
    if (git) {
      const bin = join(dirname(git), '../usr/bin');
      if (existsSync(bin)) process.env.PATH = `${process.env.PATH}${delimiter}${bin}`;
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'workbench-test-config-'));
  const configuration = join(directory, 'gitconfig');
  writeFileSync(configuration, '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n', 'utf8');
  process.env.GIT_CONFIG_GLOBAL = configuration;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}
