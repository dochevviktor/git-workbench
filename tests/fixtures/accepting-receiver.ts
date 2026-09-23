#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
// Git hooks have extensionless names, so this fixture also uses the JavaScript-compatible TS subset.
writeFileSync('receiver.pid', String(process.pid));
process.stderr.write('P05 accepting receiver waiting\n');
process.stdin.resume();
setTimeout(() => process.exit(0), 30_000);
