import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { handleFileTransfer } from '../../lib/file-transfer-gateway';
import { nextLocalStorageEnabled } from '../../lib/next-local-storage-policy.mjs';
import {
  assertTransferConfig,
  type FileTransferConfig,
} from '../../lib/file-transfer-ticket';

// Separate loopback byte transport, using exactly the native Worker's gateway
// and business dispatcher. Dynamic import avoids binding initialization cycles.
export async function createLocalFileHttpBridge() {
  if (!nextLocalStorageEnabled(process.env))
    throw new Error('Local file HTTP requires opted-in next dev.');
  const appOrigin = process.env.PARTNER_HUB_LOCAL_APP_ORIGIN ?? '';
  const app = new URL(appOrigin);
  if (
    app.protocol !== 'http:' ||
    app.hostname !== '127.0.0.1' ||
    app.origin !== appOrigin
  )
    throw new Error(
      'Local file transfer requires an explicit loopback Next origin.',
    );
  const config: FileTransferConfig = {
    appOrigin,
    transferOrigin: 'http://127.0.0.1:1',
    secret: Buffer.from(randomBytes(32)).toString('hex'),
    allowLoopback: true,
  };
  assertTransferConfig(config);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const request = new Request(config.transferOrigin + incoming.url, {
        method: incoming.method,
        headers,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? '')
          ? { body: Readable.toWeb(incoming), duplex: 'half' }
          : {}),
      } as RequestInit & { duplex?: 'half' });
      const response = await handleFileTransfer(
        request,
        config,
        async (forwarded, claims) => {
          const { dispatchFileTransfer } =
            await import('../../lib/file-transfer-dispatch');
          return dispatchFileTransfer(forwarded, claims);
        },
      );
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
        outgoing.writeHead(503, { 'cache-control': 'private, no-store' });
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
    throw new Error('Local file HTTP did not bind loopback.');
  config.transferOrigin = `http://127.0.0.1:${address.port}`;
  return {
    config,
    async dispose() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
