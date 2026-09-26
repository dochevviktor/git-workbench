import { readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

// This executable is compiled with the application. Only main creates its private input file.
const planSchema = z.strictObject({
  version: z.literal(1),
  todo: z.string().max(8 * 1024 * 1024),
  updateRefs: z.array(z.string().startsWith('refs/heads/').max(4096)).max(10_000).optional(),
  replacements: z
    .array(
      z.strictObject({
        commitId: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
        lines: z.array(z.string().max(32_768)).max(8),
      }),
    )
    .max(500)
    .optional(),
});

async function main() {
  const [, , planPath, todoPath] = process.argv;
  if (planPath === '--append-message' && todoPath) {
    if ((await stat(todoPath)).size > 262_144) throw new Error('The message is too large.');
    const suffix = await readFile(todoPath, 'utf8');
    const options = { encoding: 'utf8' as const, timeout: 120_000, maxBuffer: 1024 * 1024 };
    const current = execFileSync('git', ['show', '-s', '--format=%B', 'HEAD'], options).trimEnd();
    execFileSync(
      'git',
      [
        'commit',
        '--amend',
        '--allow-empty',
        '--allow-empty-message',
        '--cleanup=verbatim',
        '--no-verify',
        '--file=-',
      ],
      { ...options, input: `${current}\n\n${suffix.trimEnd()}\n` },
    );
    return;
  }
  if (!planPath || !todoPath || (await stat(planPath)).size > 16 * 1024 * 1024)
    throw new Error('Invalid sequence editor input.');
  const plan = planSchema.parse(JSON.parse(await readFile(planPath, 'utf8')));
  let todo = plan.todo;
  if (plan.replacements) {
    if ((await stat(todoPath)).size > 8 * 1024 * 1024) throw new Error('The Git plan is too large.');
    const consumed = new Set<string>();
    const output: string[] = [];
    for (const line of (await readFile(todoPath, 'utf8')).split('\n')) {
      if (!line.trim() || line.startsWith('#')) {
        output.push(line);
        continue;
      }
      const match = /^(?:pick |merge -C )([a-f0-9]+)\b/u.exec(line);
      if (match?.[1]) {
        const row = plan.replacements.find((item) => item.commitId.startsWith(match[1]!));
        if (!row || consumed.has(row.commitId)) throw new Error('Git generated an unexpected commit.');
        consumed.add(row.commitId);
        output.push(...row.lines.map((replacement) => (replacement === '$MERGE' ? line : replacement)));
      } else if (line.startsWith('update-ref ')) {
        if (plan.updateRefs?.includes(line.slice('update-ref '.length).trim())) output.push(line);
      } else if (/^(?:label|reset) /u.test(line)) output.push(line);
      else throw new Error('Git generated an unsupported plan instruction.');
    }
    if (consumed.size !== plan.replacements.length) throw new Error('Git omitted a reviewed commit.');
    todo = output.join('\n');
  }
  await writeFile(todoPath, todo, 'utf8');
}

void main().catch(() => {
  process.stderr.write(
    'The reviewed rebase plan could not be installed. The original history is retained.\n',
  );
  process.exitCode = 1;
});
