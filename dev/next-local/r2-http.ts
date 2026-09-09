import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { handleR2Bridge } from '../../infra/r2-bridge/worker';
import { createR2HttpBucket } from '../../lib/r2-http-client';
import { nextLocalStorageEnabled } from '../../lib/next-local-storage-policy.mjs';

// Exact production protocol, isolated native R2, random in-memory credential.
export async function createLocalR2HttpBridge(bucket: R2Bucket) {
  if (!nextLocalStorageEnabled(process.env))
    throw new Error('Local R2 HTTP requires opted-in local next dev.');
  const secret = Buffer.from(randomBytes(32)).toString('hex');
  let origin = '';
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const request = new Request(origin + incoming.url, {
        method: incoming.method,
        headers,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? '')
          ? { body: Readable.toWeb(incoming), duplex: 'half' }
          : {}),
      } as RequestInit & { duplex?: 'half' });
      const response = await handleR2Bridge(request, {
        AI_SOURCE_FILES: bucket,
        R2_BRIDGE_ENABLED: '1',
        R2_BRIDGE_SECRET: secret,
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) outgoing.end();
      else {
        const body = Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        );
        body.on('error', () => outgoing.destroy());
        outgoing.on('close', () => body.destroy());
        body.pipe(outgoing);
      }
    } catch {
      if (!outgoing.headersSent)
        outgoing.writeHead(502, { 'cache-control': 'private, no-store' });
      outgoing.end();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Local R2 HTTP did not bind loopback.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    bucket: createR2HttpBucket({ origin, secret, allowLoopback: true }),
    async dispose() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
