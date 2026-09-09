// Isolated native Workers behind loopback TLS. No credentials or live resources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  unlink,
  rmdir,
} from 'node:fs/promises';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fileTransferWorkerBundle } from '../scripts/file-transfer-worker-bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

export async function createRemoteHttpsFixture(appPort) {
  const work = path.join(root, 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(path.join(work, 'remote-https-'));
  const keyPath = path.join(directory, 'synthetic.key');
  const certPath = path.join(directory, 'synthetic.pem');
  const servers = [];
  let mf;
  const counts = { d1: 0, r2: 0, files: 0, outbound: 0, errors: 0 };
  async function dispose() {
    for (const { server } of servers) {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await mf?.dispose();
    // Exact generated files only; no recursive deletion or user paths.
    assert.equal(path.dirname(directory), work);
    for (const name of ['synthetic.key', 'synthetic.pem'])
      await unlink(path.join(directory, name)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await rmdir(directory);
  }
  try {
    const openssl =
      process.platform === 'win32'
        ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
        : 'openssl';
    execFileSync(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=Partner-hub synthetic loopback test',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 30_000 },
    );
    const cert = await readFile(certPath, 'utf8');
    const key = await readFile(keyPath, 'utf8');
    const services = {};
    for (const name of ['d1', 'r2', 'files']) {
      const entry = { server: null, origin: '', worker: null };
      const server = createServer({ key, cert }, async (incoming, outgoing) => {
        counts[name]++;
        try {
          assert.ok(entry.worker);
          assert.ok(
            incoming.url.startsWith('/') && !incoming.url.startsWith('//'),
          );
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(', ') : value,
              );
          const body = !['GET', 'HEAD'].includes(incoming.method)
            ? Readable.toWeb(incoming)
            : undefined;
          const response = await entry.worker.fetch(
            entry.origin + incoming.url,
            {
              method: incoming.method,
              headers,
              ...(body ? { body, duplex: 'half' } : {}),
              redirect: 'manual',
            },
          );
          outgoing.writeHead(
            response.status,
            Object.fromEntries(response.headers),
          );
          if (!response.body) outgoing.end();
          else {
            const stream = Readable.fromWeb(response.body);
            stream.on('error', () => outgoing.destroy());
            outgoing.on('close', () => stream.destroy());
            stream.pipe(outgoing);
          }
        } catch {
          counts.errors++;
          if (!outgoing.headersSent) outgoing.writeHead(502);
          outgoing.end();
        }
      });
      server.requestTimeout = 120_000;
      server.headersTimeout = 10_000;
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      entry.server = server;
      entry.origin = `https://127.0.0.1:${server.address().port}`;
      servers.push(entry);
      services[name] = entry;
    }
    const environment = {
      PARTNER_HUB_NEXT_BACKEND: 'cloudflare-http-v1',
      PARTNER_HUB_BACKEND_ENABLED: '1',
      PARTNER_HUB_APP_ORIGIN: `https://127.0.0.1:${appPort}`,
      PARTNER_HUB_D1_ORIGIN: services.d1.origin,
      PARTNER_HUB_D1_SECRET: randomBytes(32).toString('hex'),
      PARTNER_HUB_R2_ORIGIN: services.r2.origin,
      PARTNER_HUB_R2_SECRET: randomBytes(32).toString('hex'),
      PARTNER_HUB_FILE_ORIGIN: services.files.origin,
      PARTNER_HUB_FILE_SECRET: randomBytes(32).toString('hex'),
    };
    const wrangler = require.resolve('wrangler');
    const { unstable_splitSqlQuery } = require('wrangler');
    const { Miniflare, convertV4MiniflareOptions } = require(
      require.resolve('miniflare', { paths: [wrangler] }),
    );
    const { build } = require(
      require.resolve('esbuild', { paths: [wrangler] }),
    );
    const bundle = async (name) =>
      (
        await build({
          entryPoints: [path.join(root, `infra/${name}-bridge/worker.ts`)],
          bundle: true,
          write: false,
          format: 'esm',
          platform: 'node',
          target: 'es2022',
          external: ['node:*'],
        })
      ).outputFiles[0].text;
    const common = {
      modules: true,
      compatibilityDate: '2026-08-26',
      compatibilityFlags: ['nodejs_compat'],
      outboundService: () => {
        counts.outbound++;
        throw new Error('External calls forbidden.');
      },
    };
    const d1Databases = { DB: 'isolated-remote-https-db' };
    const r2Buckets = { AI_SOURCE_FILES: 'isolated-remote-https-r2' };
    mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            ...common,
            name: 'd1',
            script: await bundle('d1'),
            d1Databases,
            bindings: {
              D1_BRIDGE_ENABLED: '1',
              D1_BRIDGE_SECRET: environment.PARTNER_HUB_D1_SECRET,
            },
          },
          {
            ...common,
            name: 'r2',
            script: await bundle('r2'),
            r2Buckets,
            bindings: {
              R2_BRIDGE_ENABLED: '1',
              R2_BRIDGE_SECRET: environment.PARTNER_HUB_R2_SECRET,
            },
          },
          {
            ...common,
            name: 'files',
            script: await fileTransferWorkerBundle(),
            d1Databases,
            r2Buckets,
            bindings: {
              FILE_TRANSFER_ENABLED: '1',
              FILE_TRANSFER_APP_ORIGIN: environment.PARTNER_HUB_APP_ORIGIN,
              FILE_TRANSFER_ORIGIN: environment.PARTNER_HUB_FILE_ORIGIN,
              FILE_TRANSFER_SECRET: environment.PARTNER_HUB_FILE_SECRET,
            },
          },
        ],
      }),
    );
    for (const name of ['d1', 'r2', 'files'])
      services[name].worker = await mf.getWorker(name);
    const db = await mf.getD1Database('DB', 'd1');
    const bucket = await mf.getR2Bucket('AI_SOURCE_FILES', 'r2');
    let migrations = 0;
    for (const directory of ['drizzle', 'infra/standalone/migrations']) {
      for (const file of (await readdir(path.join(root, directory)))
        .filter((name) => /^\d+.*\.sql$/.test(name))
        .sort()) {
        const sql = await readFile(path.join(root, directory, file), 'utf8');
        await db.batch(
          unstable_splitSqlQuery(sql).map((sql) => db.prepare(sql)),
        );
        migrations++;
      }
    }
    assert.equal(migrations, 101);
    return {
      environment,
      db,
      bucket,
      counts,
      cert,
      certPath,
      keyPath,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
