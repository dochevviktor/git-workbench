#!/usr/bin/env node
/** Synthetic native-helper stand-in; never reads a real credential or opens a desktop window. */
import { writeFileSync } from 'node:fs';
const marker = process.env.GIT_WORKBENCH_ASKPASS_TEST_MARKER;
if (marker) writeFileSync(marker, 'invoked\n');
const prompt = process.argv.at(-1) ?? '';
process.stdout.write(prompt.startsWith('Username') ? 'fixture-user\n' : 'fixture-password\n');
