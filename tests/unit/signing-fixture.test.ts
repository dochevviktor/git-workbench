import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { signingFixture } from '../signing-fixture';
import { testPlatform } from '../platform';

it.skipIf(!testPlatform.gpg || !testPlatform.posix)(
  'creates and uses GPG agent sockets when the inherited temporary path is too long',
  async ({ signal }) => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-long-gpg-'));
    const temporary = join(root, 'é'.repeat(50));
    await mkdir(temporary);
    vi.stubEnv('TMPDIR', temporary);
    let fixture: Awaited<ReturnType<typeof signingFixture>> | undefined;
    try {
      fixture = await signingFixture({ signal });
      expect(Buffer.byteLength(join(fixture.gnupg, 'S.gpg-agent.browser'))).toBeLessThan(104);
      await fixture.run('commit', '--allow-empty', '--gpg-sign', '-qm', 'Short socket path');
      await fixture.run('verify-commit', 'HEAD');
    } finally {
      await fixture?.cleanup();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
