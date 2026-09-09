import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { env } from 'cloudflare:workers';
import { createD1HttpDatabase } from '../lib/d1-http-client';
import {
  D1HttpError,
  d1HttpPath,
  d1HttpLimits,
  readD1HttpJson,
} from '../lib/d1-http-protocol';
import {
  handleD1Bridge,
  type D1BridgeEnvironment,
} from '../infra/d1-bridge/worker';

const sqlite = (env as unknown as { DB: D1Database }).DB;
// The legacy unit mock omits results on writes. Native D1 always supplies [].
// Normalize only this fixture, keeping the production decoder strict.
const native = new Proxy(sqlite, {
  get(target, property, receiver) {
    if (property === 'batch')
      return async (statements: D1PreparedStatement[]) =>
        (await target.batch(statements)).map((result) => ({
          ...result,
          results: result.results ?? [],
        }));
    return Reflect.get(target, property, receiver);
  },
});
const secret = Buffer.from(randomBytes(32)).toString('hex');
const origin = 'https://isolated-d1.example.test';
const environment: D1BridgeEnvironment = {
  DB: native,
  D1_BRIDGE_ENABLED: '1',
  D1_BRIDGE_SECRET: secret,
};
const fetcher: typeof fetch = (input, init) =>
  handleD1Bridge(new Request(input, init), environment);
const remote = () => createD1HttpDatabase({ origin, secret, fetcher });
const query = {
  version: 1,
  statements: [{ sql: 'SELECT 1 AS value', params: [] }],
};
const request = (
  body: unknown = query,
  headers: Record<string, string> = {},
  path = d1HttpPath,
  method = 'POST',
) =>
  new Request(origin + path, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...headers,
    },
    ...(method !== 'GET' && method !== 'HEAD'
      ? { body: JSON.stringify(body) }
      : {}),
  });
const hasCode = (code: string) => (error: unknown) =>
  error instanceof D1HttpError && error.code === code && error.message === code;
beforeEach(async () => {
  await native.batch([
    native.prepare('DROP TABLE IF EXISTS bridge_fixture'),
    native.prepare(
      'CREATE TABLE bridge_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0)',
    ),
    native.prepare(
      "CREATE TRIGGER bridge_fixture_guard BEFORE UPDATE ON bridge_fixture WHEN NEW.value = 'forbidden' BEGIN SELECT RAISE(ABORT, 'private constraint detail'); END",
    ),
  ]);
});

void test('D1 HTTP preserves bound Unicode/null/numeric values, first/all/run and changes', async () => {
  const db = remote();
  const base = db.prepare(
    'INSERT INTO bridge_fixture (id, value) VALUES (?1, ?2)',
  );
  const result = await base.bind(1, '한글 "quoted"; -- not SQL').run();
  assert.equal(result.meta.changes, 1);
  await base.bind(2, 'second').run();
  const rows = await db
    .prepare('SELECT * FROM bridge_fixture ORDER BY id')
    .all<{ id: number; value: string }>();
  assert.equal(rows.results.length, 2);
  assert.equal(rows.results[0].value, '한글 "quoted"; -- not SQL');
  assert.equal(
    await db
      .prepare('SELECT value FROM bridge_fixture WHERE id = ?1')
      .bind(1)
      .first('value'),
    rows.results[0].value,
  );
  assert.equal(await db.prepare('SELECT NULL AS value').first('value'), null);
  assert.equal(
    await db.prepare('SELECT * FROM bridge_fixture WHERE id = 99').first(),
    null,
  );
  await assert.rejects(
    db.prepare('SELECT 1 AS value').first('missing'),
    hasCode('D1_HTTP_INVALID_INPUT'),
  );
});
void test('D1 HTTP preserves batch order and native atomic rollback', async () => {
  const db = remote();
  const results = await db.batch([
    db.prepare("INSERT INTO bridge_fixture (id, value) VALUES (1, 'initial')"),
    db.prepare("UPDATE bridge_fixture SET value = 'committed' WHERE id = 1"),
    db.prepare('SELECT value FROM bridge_fixture WHERE id = 1'),
  ]);
  assert.deepEqual(
    results.map((r) => r.meta.changes),
    [1, 1, 0],
  );
  assert.equal((results[2].results[0] as { value: string }).value, 'committed');
  await assert.rejects(
    db.batch([
      db.prepare(
        "UPDATE bridge_fixture SET value = 'must roll back' WHERE id = 1",
      ),
      db.prepare("UPDATE bridge_fixture SET value = 'forbidden' WHERE id = 1"),
    ]),
    hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(
    await db.prepare('SELECT value FROM bridge_fixture').first('value'),
    'committed',
  );
});
void test('D1 HTTP keeps compare-and-swap predicates and returned write counts', async () => {
  const db = remote();
  await db
    .prepare("INSERT INTO bridge_fixture (id, value) VALUES (1, 'initial')")
    .run();
  const writes = await Promise.all(
    ['left', 'right'].map((value) =>
      db
        .prepare(
          'UPDATE bridge_fixture SET value = ?1, version = version + 1 WHERE id = 1 AND version = 0',
        )
        .bind(value)
        .run(),
    ),
  );
  assert.deepEqual(
    writes.map((r) => r.meta.changes).sort((a, b) => a - b),
    [0, 1],
  );
});
void test('gateway is disabled without explicit opt-in and a valid secret', async () => {
  for (const settings of [
    {},
    { D1_BRIDGE_ENABLED: '1' },
    { D1_BRIDGE_ENABLED: '1', D1_BRIDGE_SECRET: 'short' },
  ]) {
    const response = await handleD1Bridge(request(), {
      DB: native,
      ...settings,
    });
    assert.equal(response.status, 503);
  }
});
void test('anonymous, forged Sites identity and wrong database credentials never reach SQL', async () => {
  const guarded = new Proxy(native, {
    get() {
      throw new Error('Must not reach database');
    },
  });
  for (const authorization of [
    '',
    'Bearer wrong',
    `Bearer ${'0'.repeat(64)}`,
    `Bearer ${secret}, Bearer ${secret}`,
  ]) {
    const response = await handleD1Bridge(
      request(query, {
        authorization,
        'oai-authenticated-user-email': 'smkim3733@gmail.com',
      }),
      { ...environment, DB: guarded },
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});
void test('database gateway refuses browser Origin and cookies even with valid service secret', async () => {
  for (const headers of [
    { origin: 'https://browser.example.test' },
    { cookie: 'keve_local_session=synthetic' },
  ] as Record<string, string>[])
    assert.equal(
      (await handleD1Bridge(request(query, headers), environment)).status,
      403,
    );
});
void test('gateway enforces route, method, JSON type and explicit body bounds', async () => {
  assert.equal(
    (await handleD1Bridge(request(query, {}, '/other'), environment)).status,
    404,
  );
  assert.equal(
    (
      await handleD1Bridge(
        request(query, {}, d1HttpPath + '?secret=no'),
        environment,
      )
    ).status,
    404,
  );
  assert.equal(
    (await handleD1Bridge(request(query, {}, d1HttpPath, 'GET'), environment))
      .status,
    405,
  );
  assert.equal(
    (
      await handleD1Bridge(
        request(query, { 'content-type': 'text/plain' }),
        environment,
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await handleD1Bridge(
        request(query, { 'content-encoding': 'gzip' }),
        environment,
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await handleD1Bridge(
        request(query, {
          'content-length': String(d1HttpLimits.requestBytes + 1),
        }),
        environment,
      )
    ).status,
    413,
  );
  for (const invalid of [
    null,
    [],
    {},
    { ...query, version: 2 },
    { ...query, extra: true },
    { version: 1, statements: [] },
  ])
    assert.equal(
      (await handleD1Bridge(request(invalid), environment)).status,
      400,
    );
});
void test('gateway rejects malformed SQL envelopes and untyped bind values', async () => {
  for (const statement of [
    { sql: '', params: [] },
    { sql: 'SELECT 1\0', params: [] },
    { sql: 'SELECT 1', params: {} },
    { sql: 'SELECT ?1', params: [{}] },
    { sql: 'SELECT ?1', params: [true] },
    { sql: 'SELECT 1', params: [], extra: 1 },
  ])
    assert.equal(
      (
        await handleD1Bridge(
          request({ version: 1, statements: [statement] }),
          environment,
        )
      ).status,
      400,
    );
});
void test('gateway error and cache policy do not expose SQL, parameters or schema errors', async () => {
  const response = await handleD1Bridge(
    request({
      version: 1,
      statements: [
        { sql: 'SELECT private-column FROM private-secret-table', params: [] },
      ],
    }),
    environment,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), {
    version: 1,
    ok: false,
    code: 'D1_HTTP_OUTCOME_UNKNOWN',
  });
});
void test('HTTP client rejects malformed endpoints and never sends secrets to cleartext remote hosts', () => {
  for (const unsafe of [
    'http://remote.example.test',
    'file:///tmp/db',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test?token=secret',
    'https://example.test#fragment',
    'not-a-url',
  ])
    assert.throws(
      () =>
        createD1HttpDatabase({ origin: unsafe, secret, allowLoopback: true }),
      hasCode('D1_HTTP_INVALID_INPUT'),
    );
  assert.throws(
    () => createD1HttpDatabase({ origin: 'http://127.0.0.1:1234', secret }),
    hasCode('D1_HTTP_INVALID_INPUT'),
  );
  assert.throws(
    () => createD1HttpDatabase({ origin, secret: 'short' }),
    hasCode('D1_HTTP_INVALID_INPUT'),
  );
});
void test('HTTP client denies foreign statements, unsupported APIs and lossy parameter coercion', () => {
  const db = remote();
  const other = remote();
  assert.throws(
    () => db.batch([other.prepare('SELECT 1')]),
    hasCode('D1_HTTP_INVALID_INPUT'),
  );
  assert.throws(() => db.withSession(), hasCode('D1_HTTP_UNSUPPORTED'));
  assert.throws(
    () => db.exec('SELECT 1; SELECT 2'),
    hasCode('D1_HTTP_UNSUPPORTED'),
  );
  assert.throws(
    () => db.prepare('SELECT 1').raw(),
    hasCode('D1_HTTP_UNSUPPORTED'),
  );
  for (const value of [
    undefined,
    NaN,
    Infinity,
    BigInt(1),
    true,
    {},
    [1, 2],
    new Uint8Array([1]),
  ])
    assert.throws(
      () => db.prepare('SELECT ?1').bind(value),
      hasCode('D1_HTTP_INVALID_INPUT'),
    );
});
void test('HTTP client uses no-store, no cookies and manual redirects', async () => {
  let calls = 0;
  const db = createD1HttpDatabase({
    origin,
    secret,
    fetcher: async (input, init) => {
      calls++;
      assert.equal(input, origin + d1HttpPath);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'manual');
      assert.equal(new Headers(init?.headers).get('cookie'), null);
      return new Response(null, {
        status: 307,
        headers: { location: 'https://attacker.example.test' },
      });
    },
  });
  await assert.rejects(
    db.prepare('SELECT 1').all(),
    hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(calls, 1);
});
void test('lost response after committed write is never automatically retried', async () => {
  let calls = 0;
  const db = createD1HttpDatabase({
    origin,
    secret,
    fetcher: async (input, init) => {
      calls++;
      await fetcher(input, init);
      throw new Error('Private transport detail with SQL or credentials');
    },
  });
  await assert.rejects(
    db
      .prepare("INSERT INTO bridge_fixture (id,value) VALUES (1,'committed')")
      .run(),
    hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(calls, 1);
  assert.equal(
    (await native
      .prepare('SELECT COUNT(*) AS n FROM bridge_fixture')
      .first<{ n: number }>())!.n,
    1,
  );
});
void test('timeout returns unknown outcome once and aborts the transport', async () => {
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  const db = createD1HttpDatabase({
    origin,
    secret,
    timeoutMs: 10,
    fetcher: (_input, init) => {
      calls++;
      signal = init?.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    db.prepare('SELECT 1').all(),
    hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(calls, 1);
  assert.equal(signal?.aborted, true);
});

void test('gateway binding failure after commit never promises rollback or retries', async () => {
  let calls = 0;
  const ambiguous = new Proxy(native, {
    get(target, property, receiver) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          calls++;
          await target.batch(statements);
          throw new Error('Synthetic binding response lost after commit');
        };
      return Reflect.get(target, property, receiver);
    },
  });
  const db = createD1HttpDatabase({
    origin,
    secret,
    fetcher: (input, init) =>
      handleD1Bridge(new Request(input, init), {
        ...environment,
        DB: ambiguous,
      }),
  });
  await assert.rejects(
    db
      .prepare("INSERT INTO bridge_fixture (id,value) VALUES (1,'committed')")
      .run(),
    hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(calls, 1);
  assert.equal(
    (await native
      .prepare('SELECT COUNT(*) AS n FROM bridge_fixture')
      .first<{ n: number }>())!.n,
    1,
  );
});
void test('malformed successful responses never become successful database writes', async () => {
  for (const body of [
    {},
    { version: 1, ok: true, results: [] },
    {
      version: 1,
      ok: true,
      results: [{ success: true, results: [], meta: {} }],
    },
    {
      version: 1,
      ok: true,
      results: [{ success: false, results: [], meta: { changes: 1 } }],
    },
    {
      version: 1,
      ok: true,
      results: [
        { success: true, results: [], meta: { changes: 1 }, error: 'private' },
      ],
    },
  ]) {
    const db = createD1HttpDatabase({
      origin,
      secret,
      fetcher: async () => Response.json(body),
    });
    await assert.rejects(
      db.prepare('SELECT 1').all(),
      hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
    );
  }
});
void test('streamed JSON decoding enforces actual bytes and valid UTF-8, without trusting Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(12));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readD1HttpJson(stream, 10),
    hasCode('D1_HTTP_INVALID_INPUT'),
  );
  assert.equal(cancelled, true);
  const invalid = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([34, 255, 34]));
      controller.close();
    },
  });
  await assert.rejects(
    readD1HttpJson(invalid, 10),
    hasCode('D1_HTTP_INVALID_INPUT'),
  );
});
void test('real Node HTTP fetch reaches the authenticated bridge and retains transaction semantics', async () => {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === 'string') headers.set(name, value);
      const response = await handleD1Bridge(
        new Request(`http://127.0.0.1${incoming.url}`, {
          method: incoming.method,
          headers,
          body: Readable.toWeb(incoming),
          duplex: 'half',
        } as RequestInit & { duplex: 'half' }),
        environment,
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500);
      outgoing.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const db = createD1HttpDatabase({
      origin: `http://127.0.0.1:${address.port}`,
      secret,
      allowLoopback: true,
    });
    assert.equal(
      await db
        .prepare('SELECT ?1 AS value')
        .bind('Node transport 검증')
        .first('value'),
      'Node transport 검증',
    );
    await assert.rejects(
      db.batch([
        db.prepare("INSERT INTO bridge_fixture (id,value) VALUES (1,'first')"),
        db.prepare(
          "INSERT INTO bridge_fixture (id,value) VALUES (1,'duplicate')",
        ),
      ]),
      hasCode('D1_HTTP_OUTCOME_UNKNOWN'),
    );
    assert.equal(
      await db.prepare('SELECT COUNT(*) AS n FROM bridge_fixture').first('n'),
      0,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
