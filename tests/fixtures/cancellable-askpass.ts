#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.GW_ASKPASS_PID!, String(process.pid));
setTimeout(() => process.exit(1), 30_000);
