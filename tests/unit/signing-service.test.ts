import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signingFixture } from '../signing-fixture';
import { testPlatform, gpgHome } from '../platform';
import {
  readSigningSettings,
  setSigningKey,
  verifySignature,
  parseSignatureStatus,
} from '../../src/backend/repositories/signing-service';
import { commitChanges, readCommitContext } from '../../src/backend/repositories/commit-service';
import { applyReferenceAction, readReferenceContext } from '../../src/backend/repositories/reference-service';
import {
  repositorySigningSettingsRequestSchema,
  repositoryVerifySignatureRequestSchema,
} from '../../src/common/ipc/contracts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture() {
  const f = await signingFixture();
  cleanups.push(f.cleanup);
  return f;
}
async function input(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    cwd: f.cwd,
    gitDir: join(f.cwd, '.git'),
    repositoryId: f.repositoryId,
    head: { state: 'branch' as const, name: 'main', commit: await f.run('rev-parse', 'HEAD') },
  };
}

describe('F28 GPG signing', () => {
  it.skipIf(!testPlatform.gpg)(
    'signs and amends commits, verifies exact tag objects, detects tampering and missing keys',
    async () => {
      const f = await fixture();
      const unsigned = await f.run('rev-parse', 'HEAD');
      const verify = (objectId: string, kind: 'commit' | 'tag' = 'commit') =>
        verifySignature(f.git, f.cwd, { id: f.repositoryId, objectId, kind });
      expect((await verify(unsigned)).status).toBe('unsigned');
      await writeFile(join(f.cwd, 'file.txt'), 'signed content\n');
      await f.run('add', '.');
      let current = await input(f);
      let context = await readCommitContext(f.git, current);
      expect(
        await commitChanges(f.git, {
          ...current,
          subject: 'Signed commit',
          body: '',
          amend: false,
          snapshot: context.snapshot,
          skipHooks: false,
          signing: 'gpg',
        }),
      ).toMatchObject({ status: 'committed', output: '' });
      const signed = await f.run('rev-parse', 'HEAD');
      expect(await verify(signed)).toEqual({ status: 'valid', fingerprint: f.fingerprint });
      current = await input(f);
      context = await readCommitContext(f.git, current);
      expect(
        await commitChanges(f.git, {
          ...current,
          subject: 'Signed amend',
          body: '',
          amend: true,
          snapshot: context.snapshot,
          skipHooks: false,
          signing: 'gpg',
        }),
      ).toMatchObject({ status: 'committed', amended: true });
      expect((await verify(await f.run('rev-parse', 'HEAD'))).status).toBe('valid');
      current = await input(f);
      const refs = await readReferenceContext(f.git, { ...current, worktreePath: f.cwd });
      expect(
        await applyReferenceAction(f.git, {
          ...current,
          worktreePath: f.cwd,
          snapshot: refs.snapshot,
          action: {
            kind: 'create-tag',
            name: 'signed-tag',
            startPoint: { kind: 'commit', commitId: current.head.commit },
            message: '',
            signing: 'gpg',
          },
        }),
      ).toMatchObject({ status: 'applied', output: '' });
      const tag = await f.run('rev-parse', 'refs/tags/signed-tag');
      expect(await verify(tag, 'tag')).toEqual({ status: 'valid', fingerprint: f.fingerprint });
      await expect(verify(current.head.commit, 'tag')).rejects.toThrow('different type');
      const raw = await f.git.run(['cat-file', 'commit', signed], { cwd: f.cwd });
      const corrupt = (
        await f.git.run(['hash-object', '-w', '-t', 'commit', '--stdin'], {
          cwd: f.cwd,
          stdin: raw.stdout.replace('Signed commit', 'Altered commit'),
        })
      ).stdout.trim();
      expect((await verify(corrupt)).status).toBe('invalid');
      const emptyKeys = join(f.root, 'empty-keys');
      await mkdir(emptyKeys, { mode: 0o700 });
      const missing = {
        run: (args: readonly string[], options: Parameters<typeof f.git.run>[1]) =>
          f.git.run(args, { ...options, env: { GNUPGHOME: gpgHome(emptyKeys) } }),
      };
      expect(
        (await verifySignature(missing, f.cwd, { id: f.repositoryId, objectId: signed, kind: 'commit' }))
          .status,
      ).toBe('missing-key');
    },
  );

  it.skipIf(!testPlatform.gpg)(
    'reports unavailable signing keys without changing HEAD/index or disclosing signer output',
    async () => {
      const f = await fixture();
      await f.run('config', 'user.signingkey', '0'.repeat(40));
      await writeFile(join(f.cwd, 'file'), 'staged');
      await f.run('add', '.');
      const current = await input(f);
      const tree = await f.run('write-tree');
      const context = await readCommitContext(f.git, current);
      const request = {
        ...current,
        subject: 'Failure',
        body: '',
        amend: false,
        snapshot: context.snapshot,
        skipHooks: false,
        signing: 'gpg' as const,
      };
      expect(await commitChanges(f.git, request)).toMatchObject({
        status: 'failed',
        reason: 'signing',
        output: '',
        canSkipHooks: false,
      });
      expect(await f.run('rev-parse', 'HEAD')).toBe(current.head.commit);
      expect(await f.run('write-tree')).toBe(tree);
      const references = await readReferenceContext(f.git, { ...current, worktreePath: f.cwd });
      const tagRequest = {
        ...current,
        worktreePath: f.cwd,
        snapshot: references.snapshot,
        action: {
          kind: 'create-tag' as const,
          name: 'unavailable-key',
          startPoint: { kind: 'commit' as const, commitId: current.head.commit },
          message: '',
          signing: 'gpg' as const,
        },
      };
      expect(await applyReferenceAction(f.git, tagRequest)).toMatchObject({
        status: 'blocked',
        output: '',
        canForce: false,
      });
      expect(await f.run('tag', '--list')).toBe('');
      await f.run('config', 'tag.gpgsign', 'true');
      expect(
        await applyReferenceAction(f.git, {
          ...tagRequest,
          action: { ...tagRequest.action, signing: 'unsigned' },
        }),
      ).toMatchObject({ status: 'applied' });
      expect(
        await verifySignature(f.git, f.cwd, {
          id: f.repositoryId,
          kind: 'tag',
          objectId: await f.run('rev-parse', 'refs/tags/unavailable-key'),
        }),
      ).toMatchObject({ status: 'unsigned' });
      await f.run('config', 'commit.gpgsign', 'true');
      expect(await commitChanges(f.git, { ...request, signing: 'unsigned' })).toMatchObject({
        status: 'committed',
      });
      expect(
        (
          await verifySignature(f.git, f.cwd, {
            id: f.repositoryId,
            kind: 'commit',
            objectId: await f.run('rev-parse', 'HEAD'),
          })
        ).status,
      ).toBe('unsigned');
    },
  );

  it.skipIf(!testPlatform.gpg)('cancels a running signing process while preserving staged work', async () => {
    const f = await fixture();
    const program = join(f.root, 'waiting-signer.ts');
    const marker = join(f.root, 'started');
    await writeFile(
      program,
      `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'started');\nprocess.stderr.write('PRIVATE-PASSPHRASE');\nsetTimeout(() => {}, 120000);\n`,
    );
    await chmod(program, 0o700);
    await f.run('config', 'gpg.program', program);
    await writeFile(join(f.cwd, 'file'), 'staged');
    await f.run('add', '.');
    const current = await input(f);
    const context = await readCommitContext(f.git, current);
    const controller = new AbortController();
    const pending = commitChanges(f.git, {
      ...current,
      subject: 'Cancelled',
      body: '',
      amend: false,
      snapshot: context.snapshot,
      skipHooks: false,
      signing: 'gpg',
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow('cancelled');
    try {
      await expect.poll(() => readFile(marker, 'utf8')).toBe('started');
    } finally {
      controller.abort();
    }
    await rejected;
    expect(await f.run('rev-parse', 'HEAD')).toBe(current.head.commit);
    expect(await f.run('diff', '--cached', '--name-only')).toBe('file');
  });

  it.skipIf(!testPlatform.gpg)(
    'preserves config inheritance and linked-worktree scope, and rejects stale settings',
    async () => {
      const f = await fixture();
      const inherited = 'A'.repeat(40);
      await f.run('config', '--global', 'user.signingkey', inherited);
      await f.run('config', 'custom.untouched', 'keep');
      let settings = await readSigningSettings(f.git, f.cwd, f.repositoryId);
      await f.run('config', 'user.signingkey', 'B'.repeat(40));
      await expect(
        setSigningKey(f.git, f.cwd, { id: f.repositoryId, key: null, snapshot: settings.snapshot }),
      ).rejects.toThrow('changed');
      settings = await readSigningSettings(f.git, f.cwd, f.repositoryId);
      expect(
        await setSigningKey(f.git, f.cwd, { id: f.repositoryId, key: null, snapshot: settings.snapshot }),
      ).toMatchObject({ key: inherited, localKey: null });
      const linked = join(f.root, 'linked');
      await f.run('worktree', 'add', '-b', 'linked', linked);
      settings = await readSigningSettings(f.git, linked, f.repositoryId);
      await setSigningKey(f.git, linked, {
        id: f.repositoryId,
        key: f.fingerprint,
        snapshot: settings.snapshot,
      });
      expect(await f.run('config', '--local', 'user.signingkey')).toBe(f.fingerprint);
      expect(await f.run('config', 'custom.untouched')).toBe('keep');
      expect(await f.run('config', '--global', 'user.signingkey')).toBe(inherited);
      settings = await readSigningSettings(f.git, f.cwd, f.repositoryId);
      const before = await readFile(join(f.cwd, '.git', 'config'), 'utf8');
      await writeFile(join(f.cwd, '.git', 'config.lock'), 'external writer');
      await expect(
        setSigningKey(f.git, f.cwd, { id: f.repositoryId, key: inherited, snapshot: settings.snapshot }),
      ).rejects.toThrow();
      expect(await readFile(join(f.cwd, '.git', 'config'), 'utf8')).toBe(before);
    },
  );

  it('never labels expired, revoked, failed or untrusted signatures trusted and rejects unsafe inputs', () => {
    const valid = `[GNUPG:] VALIDSIG ${'A'.repeat(40)} 2026 1 0 4 0 22 8 00\n`;
    expect(parseSignatureStatus(valid, true).status).toBe('untrusted');
    expect(parseSignatureStatus(valid, false).status).toBe('unavailable');
    for (const [record, status] of [
      ['EXPKEYSIG', 'expired'],
      ['EXPSIG', 'expired'],
      ['REVKEYSIG', 'revoked'],
      ['BADSIG', 'invalid'],
    ] as const)
      expect(
        parseSignatureStatus(`${valid}[GNUPG:] ${record} key\n[GNUPG:] TRUST_ULTIMATE`, true).status,
      ).toBe(status);
    expect(
      repositorySigningSettingsRequestSchema.safeParse({
        id: `repo-${'a'.repeat(64)}`,
        key: '--exec=bad',
        snapshot: 'a'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      repositoryVerifySignatureRequestSchema.safeParse({
        id: `repo-${'a'.repeat(64)}`,
        objectId: 'HEAD^{commit}',
        kind: 'commit',
      }).success,
    ).toBe(false);
  });
});
