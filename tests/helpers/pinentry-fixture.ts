#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Only copied into an isolated fixture GNUPGHOME. No application passphrase entry is introduced.
const directory = process.env.GNUPGHOME!;
const lines = createInterface({ input: process.stdin });
process.stdout.write('OK Fixture pinentry\n');
lines.on('line', (line) => {
  if (line === 'GETPIN') {
    writeFileSync(join(directory, 'pinentry-started'), 'started');
    const mode = readFileSync(join(directory, 'pinentry-mode'), 'utf8');
    if (mode === 'wait') return;
    if (mode === 'cancel') {
      process.stdout.write('ERR 83886179 Operation cancelled\n');
      return;
    }
    const pin = readFileSync(join(directory, 'fixture-passphrase'), 'utf8');
    process.stdout.write(
      `D ${pin.replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}\nOK\n`,
    );
  } else if (line === 'BYE') {
    process.stdout.write('OK\n');
    lines.close();
    process.exit(0);
  } else if (line.startsWith('GETINFO pid')) process.stdout.write(`D ${process.pid}\nOK\n`);
  else process.stdout.write('OK\n');
});
