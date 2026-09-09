import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { handleD1Bridge } from '../../infra/d1-bridge/worker';
import { createD1HttpDatabase } from '../../lib/d1-http-client';
import { nextLocalStorageEnabled } from '../../lib/next-local-storage-policy.mjs';

// Exercise the exact wire protocol from Next over loopback HTTP. The backing
// database is still isolated real local D1, never an externally configured URL.
export async function createLocalD1HttpBridge(db: D1Database) {
  if (!nextLocalStorageEnabled(process.env))
    throw new Error('Local D1 HTTP requires opted-in local next dev.');
  const secret = Buffer.from(randomBytes(32)).toString('hex');
  let origin = '';
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const response = await handleD1Bridge(
        new Request(origin + incoming.url, {
          method: incoming.method,
          headers,
          ...(!['GET', 'HEAD'].includes(incoming.method ?? '')
            ? { body: Readable.toWeb(incoming), duplex: 'half' }
            : {}),
        } as RequestInit & { duplex?: 'half' }),
        {
          DB: db,
          D1_BRIDGE_ENABLED: '1',
          D1_BRIDGE_SECRET: secret,
        },
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(502, { 'cache-control': 'no-store' });
      outgoing.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Local D1 HTTP did not bind loopback.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    db: createD1HttpDatabase({ origin, secret, allowLoopback: true }),
    async dispose() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
