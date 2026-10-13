// Disposable, loopback-only PostgreSQL. Never accepts an existing DB URL.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  access,
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { createSupabaseDatabaseClient } from '../lib/supabase-postgres-client.ts';

const run = promisify(execFile);
export async function nativePostgresFixture() {
  const bin = process.env.PARTNER_HUB_TEST_POSTGRES_BIN;
  assert.ok(
    bin,
    'Set PARTNER_HUB_TEST_POSTGRES_BIN to an existing PostgreSQL 17 bin directory.',
  );
  const exe = (name) =>
    join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  for (const name of ['initdb', 'pg_ctl', 'postgres']) await access(exe(name));
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'partner-hub-pg-test-'));
  const data = join(directory, 'data');
  const marker = randomBytes(24).toString('hex');
  await writeFile(join(directory, 'test-owner'), marker, { flag: 'wx' });
  const password = randomBytes(32).toString('hex');
  const passwordPath = join(directory, 'synthetic-password');
  await writeFile(passwordPath, `${password}\n`, { flag: 'wx', mode: 0o600 });
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(PG|SUPABASE_|PARTNER_HUB_|ANTHROPIC_|DATABASE_URL|DB_URL)/.test(
          key,
        ),
    ),
  );
  const options = {
    env: environment,
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  };
  const clients = [];
  const errorCodes = [];
  let startupAttempted = false;
  async function close() {
    await Promise.allSettled(
      clients.map((client) => client.end({ timeout: 3 })),
    );
    if (startupAttempted) {
      let running = true;
      try {
        await run(exe('pg_ctl'), ['-D', data, 'status'], options);
      } catch (error) {
        // Exit 3 means this exact data directory has no running server.
        if (error.code !== 3) throw error;
        running = false;
      }
      if (running)
        await run(
          exe('pg_ctl'),
          ['-D', data, '-w', '-t', '15', '-m', 'fast', 'stop'],
          options,
        );
      startupAttempted = false;
    }
    // Only remove this fixture's freshly generated, marked directory after stop.
    const actual = await realpath(directory);
    assert.equal(dirname(actual), parent);
    assert.equal(actual, resolve(directory));
    assert.equal(await readFile(join(actual, 'test-owner'), 'utf8'), marker);
    await rm(actual, { recursive: true });
  }
  try {
    await run(
      exe('initdb'),
      [
        '-D',
        data,
        '-U',
        'partner_hub_test',
        '--pwfile',
        passwordPath,
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
        // This disposable fixture tests transactions, not crash durability.
        '--no-sync',
      ],
      options,
    );
    const openssl =
      process.platform === 'win32'
        ? 'C:/Program Files/Git/usr/bin/openssl.exe'
        : 'openssl';
    await run(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        join(data, 'server.key'),
        '-out',
        join(data, 'server.crt'),
        '-subj',
        '/CN=Partner Hub synthetic database',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      options,
    );
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    await appendFile(
      join(data, 'postgresql.conf'),
      `\nlisten_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories=''\nmax_connections=12\nssl=on\nfsync=off\n`,
    );
    startupAttempted = true;
    await run(
      exe('pg_ctl'),
      [
        '-D',
        data,
        '-l',
        join(directory, 'synthetic-server.log'),
        '-w',
        '-t',
        '20',
        'start',
      ],
      options,
    );
    const url = `postgresql://partner_hub_test:${password}@127.0.0.1:${port}/postgres`;
    const admin = postgres(url, {
      max: 1,
      prepare: false,
      ssl: 'require',
      onnotice: false,
      types: { bigint: postgres.BigInt },
    });
    clients.push(admin);
    assert.equal(
      (await admin`SELECT host(inet_server_addr()) AS address`)[0].address,
      '127.0.0.1',
    );
    await admin.unsafe(
      'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    );
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(migrations))
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort()) {
      await admin.unsafe(await readFile(new URL(name, migrations), 'utf8'));
    }
    async function connection() {
      /** @type {ReturnType<typeof postgres> | undefined} */
      let client;
      const db = createSupabaseDatabaseClient(url, (localUrl, settings) => {
        assert.equal(new URL(localUrl).hostname, '127.0.0.1');
        client = postgres(localUrl, settings);
        clients.push(client);
        return {
          unsafe: client.unsafe.bind(client),
          async begin(callback) {
            try {
              return await client.begin(callback);
            } catch (error) {
              errorCodes.push(error.code);
              throw error;
            }
          },
        };
      });
      assert.ok(client);
      const pid = Number((await client`SELECT pg_backend_pid() AS pid`)[0].pid);
      return { db, client, pid };
    }
    return { admin, connection, close, errorCodes };
  } catch (error) {
    await close();
    throw error;
  }
}
