import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const limit = 4096;

function sameFile(expected: BigIntStats, actual: BigIntStats): boolean {
  return (
    actual.isFile() &&
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.size === actual.size &&
    expected.mtimeNs === actual.mtimeNs &&
    expected.ctimeNs === actual.ctimeNs
  );
}

/** O_NOFOLLOW is unavailable on Windows. Check the selected entry and opened identity on every OS. */
export async function readCredentialFile(path: string): Promise<string> {
  const selected = await lstat(path, { bigint: true });
  if (!selected.isFile() || selected.size < 1n || selected.size > BigInt(limit))
    throw new Error('Invalid credential file');
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  const buffer = Buffer.alloc(limit + 1);
  try {
    if (
      !sameFile(selected, await file.stat({ bigint: true })) ||
      !sameFile(selected, await lstat(path, { bigint: true }))
    )
      throw new Error('Credential file changed');
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (
      BigInt(bytesRead) !== selected.size ||
      !sameFile(selected, await file.stat({ bigint: true })) ||
      !sameFile(selected, await lstat(path, { bigint: true }))
    )
      throw new Error('Credential file changed');
    return buffer.subarray(0, bytesRead).toString('utf8').trim();
  } finally {
    buffer.fill(0);
    await file.close();
  }
}
