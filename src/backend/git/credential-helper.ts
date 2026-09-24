import { connect } from 'node:net';

/** Standalone Node entry point, compiled alongside main. Git alone reads this stdout. */
async function main() {
  // Never approve/store a token in another credential manager, or erase the application's account.
  if (process.argv[2] !== 'get') return;
  const address = process.env.GW_CREDENTIAL_SOCKET;
  const nonce = process.env.GW_CREDENTIAL_NONCE;
  if (!address || !nonce) return;
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 8192) return;
  }
  const fields = new Map<string, string>();
  for (const line of input.split('\n')) {
    if (!line) continue;
    const index = line.indexOf('=');
    if (index < 1) return;
    const key = line.slice(0, index);
    // Git may send repeated capability[] / wwwauth[] fields. This helper implements only
    // username/password; ignore extensions without weakening duplicate context-field validation.
    if (!['protocol', 'host', 'path', 'username'].includes(key)) continue;
    if (fields.has(key)) return;
    fields.set(key, line.slice(index + 1));
  }
  const context = {
    protocol: fields.get('protocol'),
    host: fields.get('host'),
    path: fields.get('path') ?? '',
    username: fields.get('username') ?? '',
  };
  if (context.protocol !== 'https') return;
  await new Promise<void>((resolve) => {
    const socket = connect(address);
    let response = '';
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('connect', () => socket.write(`${JSON.stringify({ nonce, context })}\n`));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.length > 8192) socket.destroy();
    });
    socket.on('close', () => {
      try {
        const credential: unknown = JSON.parse(response);
        if (
          typeof credential === 'object' &&
          credential !== null &&
          'username' in credential &&
          typeof credential.username === 'string' &&
          /^[A-Za-z0-9_.-]{1,100}$/u.test(credential.username) &&
          'password' in credential &&
          typeof credential.password === 'string' &&
          /^[\x21-\x7e]{10,4096}$/u.test(credential.password)
        ) {
          process.stdout.write(`username=${credential.username}\npassword=${credential.password}\n\n`);
        } else {
          process.stdout.write('quit=true\n\n');
        }
      } catch {
        process.stdout.write('quit=true\n\n');
      }
      resolve();
    });
  });
}
void main().catch(() => {
  process.exitCode = 1;
});
