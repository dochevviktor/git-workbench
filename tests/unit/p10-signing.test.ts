import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { signingFixture } from '../signing-fixture';
import { testPlatform } from '../platform';
import { commitChanges, readCommitContext } from '../../src/backend/repositories/commit-service';
import {
  readSigningSettings,
  setSigningKey,
  verifySignature,
} from '../../src/backend/repositories/signing-service';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
describe.skipIf(!testPlatform.gpg)('P10 signing completion', () => {
  it.skipIf(!testPlatform.posix)(
    'uses the native GPG agent with a protected key and keeps pinentry cancellation outside application output',
    async () => {
      const f = await signingFixture({ protected: true });
      cleanup.push(f.cleanup);
      const killAgent = () =>
        promisify(execFile)('gpgconf', ['--homedir', f.gnupg, '--kill', 'gpg-agent'], { env: f.env });
      await writeFile(join(f.cwd, 'file'), 'protected content\n');
      await f.run('add', '.');
      const perform = async (signal?: AbortSignal) => {
        const input = {
          repositoryId: f.repositoryId,
          cwd: f.cwd,
          gitDir: join(f.cwd, '.git'),
          head: { state: 'branch' as const, name: 'main', commit: await f.run('rev-parse', 'HEAD') },
        };
        return commitChanges(f.git, {
          ...input,
          subject: 'Protected signature',
          body: '',
          amend: false,
          skipHooks: false,
          signing: 'gpg',
          snapshot: (await readCommitContext(f.git, input)).snapshot,
          ...(signal ? { signal } : {}),
        });
      };
      await killAgent();
      const result = await perform();
      expect(result).toMatchObject({ status: 'committed', output: '' });
      expect(await readFile(join(f.gnupg, 'pinentry-started'), 'utf8')).toBe('started');
      expect(
        await verifySignature(f.git, f.cwd, {
          id: f.repositoryId,
          kind: 'commit',
          objectId: await f.run('rev-parse', 'HEAD'),
        }),
      ).toMatchObject({ status: 'valid' });
      await writeFile(join(f.cwd, 'file'), 'retained staged content\n');
      await f.run('add', '.');
      const head = await f.run('rev-parse', 'HEAD'),
        tree = await f.run('write-tree');
      await killAgent();
      await writeFile(join(f.gnupg, 'pinentry-mode'), 'cancel');
      expect(await perform()).toMatchObject({ status: 'failed', reason: 'signing', output: '' });
      expect(await f.run('rev-parse', 'HEAD')).toBe(head);
      expect(await f.run('write-tree')).toBe(tree);
      await killAgent();
      await writeFile(join(f.gnupg, 'pinentry-mode'), 'wait');
      await rm(join(f.gnupg, 'pinentry-started'), { force: true });
      const abort = new AbortController();
      const pending = perform(abort.signal);
      const rejected = expect(pending).rejects.toThrow('cancelled');
      try {
        await expect.poll(() => readFile(join(f.gnupg, 'pinentry-started'), 'utf8')).toBe('started');
      } finally {
        abort.abort();
      }
      await rejected;
      await killAgent();
      expect(await f.run('rev-parse', 'HEAD')).toBe(head);
      expect(await f.run('write-tree')).toBe(tree);
    },
  );
  it('saves commit/tag defaults atomically with inheritance, lock failures and actual signed Git-default output', async () => {
    const f = await signingFixture();
    cleanup.push(f.cleanup);
    await f.run('config', 'other.preserve', 'unchanged');
    let settings = await readSigningSettings(f.git, f.cwd, f.repositoryId);
    settings = await setSigningKey(f.git, f.cwd, {
      id: f.repositoryId,
      snapshot: settings.snapshot,
      key: f.fingerprint,
      commits: true,
      tags: true,
    });
    expect(settings).toMatchObject({ commits: true, tags: true, localCommits: true, localTags: true });
    await f.run('commit', '--allow-empty', '-qm', 'Default signing');
    await f.run('tag', '-am', 'Default tag', 'default-tag');
    await f.run('verify-commit', 'HEAD');
    await f.run('verify-tag', 'default-tag');
    const before = await readFile(join(f.cwd, '.git', 'config'));
    await writeFile(join(f.cwd, '.git', 'config.lock'), 'external');
    await expect(
      setSigningKey(f.git, f.cwd, {
        id: f.repositoryId,
        snapshot: settings.snapshot,
        key: null,
        commits: false,
        tags: false,
      }),
    ).rejects.toThrow();
    expect(await readFile(join(f.cwd, '.git', 'config'))).toEqual(before);
    await rm(join(f.cwd, '.git', 'config.lock'));
    settings = await setSigningKey(f.git, f.cwd, {
      id: f.repositoryId,
      snapshot: settings.snapshot,
      key: f.fingerprint,
      commits: null,
      tags: null,
    });
    expect(settings).toMatchObject({ commits: false, tags: false, localCommits: null, localTags: null });
    expect(await f.run('config', 'other.preserve')).toBe('unchanged');
  });
});
