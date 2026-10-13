import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test, type TestContext } from 'node:test';
import { env } from 'cloudflare:workers';
import { postgresFixture } from './supabase-postgres-fixture';

register('./supabase-auth-loader.mjs', import.meta.url);
const { serverRequestGate } =
  await import('../lib/platform-server-gate.supabase');
const { GET: readState } = await import('../app/api/state/route');
const origin = 'https://postgres-gate.example.test';
const token = 'a'.repeat(64);

function configure(t: TestContext) {
  const config = {
    PARTNER_HUB_NEXT_BACKEND: 'supabase-v1',
    PARTNER_HUB_BACKEND_ENABLED: '1',
    PARTNER_HUB_LOCAL_STORAGE: '0',
    PARTNER_HUB_APP_ORIGIN: origin,
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_DATABASE_URL:
      'postgresql://postgres.abcdefghijklmnopqrst:synthetic@aws-0-region.pooler.supabase.com:6543/postgres',
    SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(32)}`,
    SUPABASE_STORAGE_BUCKET: 'synthetic-private',
  };
  const previous = Object.keys(config).map(
    (key) => [key, process.env[key]] as const,
  );
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function request(
  path = '/api/state',
  headers: HeadersInit = {},
  method = 'GET',
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { origin, ...Object.fromEntries(new Headers(headers)) },
  });
}

void test('anonymous state reads return 401 without touching an unavailable database', async (t) => {
  configure(t);
  const runtime = env as unknown as { DB: D1Database };
  const previousDb = runtime.DB;
  const previousError = console.error;
  let databaseCalls = 0;
  const unavailable = () => {
    databaseCalls++;
    throw new Error('synthetic-database-unavailable');
  };
  runtime.DB = {
    prepare: unavailable,
    batch: unavailable,
    exec: unavailable,
  } as unknown as D1Database;
  console.error = () => {};
  t.after(() => {
    runtime.DB = previousDb;
    console.error = previousError;
  });
  const incoming = request();
  // Mirror the proxy's gate-then-handler dispatch with no external connections.
  const response = serverRequestGate(incoming) ?? (await readState(incoming));
  assert.equal(response.status, 401);
  assert.equal(databaseCalls, 0);
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0',
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

void test('missing and malformed secure cookies cannot reach private API handlers', (t) => {
  configure(t);
  for (const cookie of [
    '',
    '__Host-keve_session=',
    '__Host-keve_session=invalid',
    `__Host-keve_session=${'A'.repeat(64)}`,
    `__Host-keve_session=${token}; __Host-keve_session=${token}`,
    `keve_local_session=${token}`,
    `prefix__Host-keve_session=${token}`,
    `__Host-keve_session=${token}; oversized=${'x'.repeat(8192)}`,
  ]) {
    assert.equal(
      serverRequestGate(request('/api/state', { cookie }))?.status,
      401,
    );
  }
});

void test('private read and mutation routes require a session, including new routes by default', (t) => {
  configure(t);
  for (const path of [
    '/api/state',
    '/api/files',
    '/api/files/synthetic-file',
    '/api/file-transfers',
    '/api/blob-transfers',
    '/api/application-draft',
    '/api/admin/partners',
    '/api/admin/partners/password-link',
    '/api/admin/file-inventory',
    '/api/admin/file-inventory/synthetic/recovery',
    '/api/admin/file-inventory/synthetic/presence',
    '/api/ai-diagnosis/readiness',
    '/api/ai-diagnosis/step-zero',
    '/api/consulting-flow/synthetic',
    '/api/consulting-flow/synthetic/run',
    '/api/consulting-flow/synthetic/preflight',
    '/api/consulting-flow/synthetic/intake-files',
    '/api/consulting-flow/synthetic/files/synthetic',
    '/api/consulting-flow/synthetic/reports/synthetic',
    '/api/future-private-route',
  ]) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(
        serverRequestGate(request(path, {}, method))?.status,
        401,
        `${method} ${path}`,
      );
    }
  }
});

void test('only exact public authentication paths bypass the session prefilter', (t) => {
  configure(t);
  for (const path of [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/setup',
    '/api/auth/logout',
    '/api/register',
  ]) {
    assert.equal(
      serverRequestGate(request(`${path}?synthetic=1`, {}, 'POST')),
      null,
      path,
    );
  }
  for (const path of [
    '/api/auth/admin',
    '/api/auth/login-extra',
    '/api/auth/login/child',
    '/api/register/child',
    '/api/auth/Login',
    '/api/auth/%6cogin',
  ]) {
    assert.equal(
      serverRequestGate(request(path, {}, 'POST'))?.status,
      401,
      path,
    );
  }
});

void test('public auth routes still enforce origin and backend configuration checks', (t) => {
  configure(t);
  assert.equal(
    serverRequestGate(
      request(
        '/api/auth/login',
        { origin: 'https://attacker.invalid' },
        'POST',
      ),
    )?.status,
    403,
  );
  process.env.PARTNER_HUB_BACKEND_ENABLED = '0';
  assert.equal(
    serverRequestGate(request('/api/auth/login', {}, 'POST'))?.status,
    503,
  );
});

void test('origin rejection takes precedence over the session prefilter', (t) => {
  configure(t);
  assert.equal(
    serverRequestGate(
      request('/api/state', { origin: 'https://attacker.invalid' }),
    )?.status,
    403,
  );
  assert.equal(
    serverRequestGate(request('/api/state', { 'sec-fetch-site': 'cross-site' }))
      ?.status,
    403,
  );
  assert.equal(
    serverRequestGate(new Request(`${origin}/api/state`, { method: 'POST' }))
      ?.status,
    403,
  );
});

void test('legacy multipart uploads keep the existing file-transfer response', async (t) => {
  configure(t);
  const response = serverRequestGate(
    request(
      '/api/files',
      { 'content-type': 'multipart/form-data; boundary=synthetic' },
      'POST',
    ),
  );
  assert.equal(response?.status, 400);
  const result = (await response!.json()) as { code: string };
  assert.equal(result.code, 'FILE_TRANSFER_REQUIRED');
});

void test('forged Sites identity headers never bypass the secure cookie check', (t) => {
  configure(t);
  assert.equal(
    serverRequestGate(
      request('/api/state', {
        'oai-authenticated-user-email': 'synthetic-admin@example.invalid',
        'oai-authenticated-user-id': 'synthetic-admin',
      }),
    )?.status,
    401,
  );
});

void test('well-formed tokens still reach the handler for live authentication', async (t) => {
  configure(t);
  const fixture = await postgresFixture();
  const runtime = env as unknown as { DB: D1Database };
  const previousDb = runtime.DB;
  runtime.DB = fixture.db;
  t.after(async () => {
    runtime.DB = previousDb;
    await fixture.close();
  });
  const incoming = request('/api/state', {
    cookie: `__Host-keve_session=${token}`,
  });
  assert.equal(serverRequestGate(incoming), null);
  // No session exists in the isolated in-memory DB: shape alone grants no access.
  assert.equal((await readState(incoming)).status, 401);
});
