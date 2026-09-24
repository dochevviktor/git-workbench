import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

// Backend-only protocol used by the per-operation Git helper.
export const credentialContextSchema = z.strictObject({
  protocol: z.literal('https'),
  host: z
    .string()
    .max(260)
    .regex(/^(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::[0-9]{1,5})?$/u),
  path: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/u)
    .refine((path) => path.split('/').every((part) => !['.', '..'].includes(part))),
  username: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9_.-]*$/u),
});
export type GitCredentialContext = z.infer<typeof credentialContextSchema>;
export interface GitCredential {
  username: string;
  password: string;
}
export interface GitCredentialSource {
  available(): Promise<boolean>;
  scopes?(): Promise<string[]>;
  get(context: GitCredentialContext): Promise<GitCredential | null>;
}
export interface GitCredentialBridge {
  source: GitCredentialSource;
  executable: string;
  helperPath: string;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** A private, per-process channel. Neither argv, environment nor temporary files contain a token. */
export async function createCredentialBroker(bridge: GitCredentialBridge) {
  const scopes = (await bridge.source.scopes?.()) ?? ['https://github.com'];
  const directory = await mkdtemp(join(tmpdir(), 'gw-credentials-'));
  const nonce = randomBytes(32).toString('hex');
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\gw-${nonce}` : join(directory, 'socket');
  const sockets = new Set<Socket>();
  const secrets = new Set<string>();
  let closed = false;
  let failure: unknown;
  const server = createServer((socket) => {
    if (sockets.size >= 32) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(5000, () => socket.destroy());
    let input = '';
    let answered = false;
    socket.on('data', (chunk: Buffer) => {
      if (answered) return;
      input += chunk.toString('utf8');
      if (input.length > 8192) {
        socket.destroy();
        return;
      }
      if (!input.includes('\n')) return;
      answered = true;
      void (async () => {
        try {
          const request = z
            .strictObject({ nonce: z.literal(nonce), context: credentialContextSchema })
            .parse(JSON.parse(input));
          const destination = new URL(`https://${request.context.host}/${request.context.path}`);
          if (
            !scopes.some((scope) => {
              const server = new URL(scope);
              return (
                destination.origin === server.origin &&
                destination.pathname.startsWith(`${server.pathname.replace(/\/$/u, '')}/`)
              );
            })
          ) {
            socket.end('null\n');
            return;
          }
          const credential = await bridge.source.get(request.context);
          if (closed || socket.destroyed) return;
          if (credential) {
            secrets.add(credential.password);
            secrets.add(Buffer.from(`${credential.username}:${credential.password}`).toString('base64'));
          }
          socket.end(`${JSON.stringify(credential)}\n`);
        } catch (error) {
          failure = error;
          socket.end('null\n');
        }
      })();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const helper = `!ELECTRON_RUN_AS_NODE=1 ${quote(bridge.executable)} ${quote(bridge.helperPath)}`;
  return {
    args: scopes.flatMap((scope) => [
      '-c',
      `credential.${scope}.helper=`,
      '-c',
      `credential.${scope}.helper=${helper}`,
      '-c',
      `credential.${scope}.useHttpPath=true`,
      '-c',
      `credential.${scope}.username=`,
      // Do not follow a redirect with account credentials, including same-host path redirects.
      '-c',
      `http.${scope}.followRedirects=false`,
    ]),
    env: { GW_CREDENTIAL_SOCKET: address, GW_CREDENTIAL_NONCE: nonce },
    redact(value: string) {
      let result = value;
      for (const secret of secrets) result = result.replaceAll(secret, '<redacted>');
      return result;
    },
    retain(value: string) {
      let length = 0;
      for (const secret of secrets) {
        for (let i = Math.min(value.length, secret.length - 1); i > length; i--) {
          if (value.endsWith(secret.slice(0, i))) {
            length = i;
            break;
          }
        }
      }
      return length;
    },
    get failure() {
      return failure;
    },
    async close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
      secrets.clear();
    },
  };
}

/** Retain possible secret prefixes across progress chunks, including a split Authorization value. */
export function credentialProgress(
  redact: (value: string) => string,
  retain: (value: string) => number,
  emit?: (value: string) => void,
) {
  let pending = '';
  return {
    write(value: string) {
      pending = redact(pending + value);
      const length = pending.length - retain(pending);
      if (length > 0) {
        emit?.(pending.slice(0, length));
        pending = pending.slice(length);
      }
    },
    flush() {
      const value = redact(pending);
      const length = retain(value);
      emit?.(length ? `${value.slice(0, -length)}<redacted>` : value);
      pending = '';
    },
  };
}
