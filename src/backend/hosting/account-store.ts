import { open, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hostingAccountSchema } from '../../common/ipc/hosting';
import type { HostingAccount } from '../../common/ipc/hosting';
import { ExpectedBackendError } from '../errors';

export interface SecretEncryption {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
const entrySchema = z.strictObject({ account: hostingAccountSchema, secret: z.string().min(1).max(32768) });
const storeSchema = z.strictObject({ version: z.literal(1), entries: z.array(entrySchema).max(20) });
export type StoredAccount = z.infer<typeof entrySchema>;

/** Dedicated encrypted credential store; never an application preference or Git configuration. */
export class HostingAccountStore {
  constructor(
    private readonly path: string,
    private readonly encryption: SecretEncryption,
  ) {}
  available() {
    return this.encryption.available();
  }
  async load(): Promise<StoredAccount[]> {
    try {
      const file = await open(this.path, 'r');
      try {
        if ((await file.stat()).size > 1_048_576) throw new Error('Oversized store');
        const parsed = storeSchema.parse(JSON.parse(await file.readFile('utf8')));
        if (
          new Set(parsed.entries.map((entry) => entry.account.id)).size !== parsed.entries.length ||
          parsed.entries.some((entry) => entry.account.storage !== 'keyring')
        )
          throw new Error('Invalid store');
        return parsed.entries;
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'Saved hosting accounts could not be read. The credential file was left unchanged.',
      );
    }
  }
  seal(account: HostingAccount, token: string): StoredAccount {
    this.requireEncryption();
    try {
      return { account, secret: this.encryption.encrypt(token).toString('base64') };
    } catch {
      throw new ExpectedBackendError('UNAVAILABLE', 'The OS keyring could not save the credential.');
    }
  }
  unseal(entry: StoredAccount): string {
    this.requireEncryption();
    try {
      return this.encryption.decrypt(Buffer.from(entry.secret, 'base64'));
    } catch {
      throw new ExpectedBackendError('UNAVAILABLE', 'The OS keyring could not unlock this account.');
    }
  }
  async save(entries: StoredAccount[]) {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const data = JSON.stringify(storeSchema.parse({ version: 1, entries }));
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(data, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } catch {
      throw new ExpectedBackendError('UNAVAILABLE', 'Hosting account changes could not be saved.');
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  private requireEncryption() {
    if (!this.available())
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        'A secure OS keyring is unavailable. Unlock your keyring or use a session-only account.',
      );
  }
}
