// Isolated workerd + real D1 smoke test. No live database, user account, email or paid AI is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const wrangler = require.resolve('wrangler');
const { Miniflare } = require(
  require.resolve('miniflare', { paths: [wrangler] }),
);
const { build } = require(require.resolve('esbuild', { paths: [wrangler] }));
const bundle = await build({
  stdin: {
    contents: `
import { registerPassword, loginPassword, logoutPassword, setupPassword, createPasswordLink } from '@/lib/password-handlers';
import { GET as getState, PUT as saveState } from '@/app/api/state/route';
export default { async fetch(request) {
  const routes = { '/signup': registerPassword, '/login': loginPassword, '/logout': logoutPassword, '/setup': setupPassword, '/issue': createPasswordLink, '/state': getState, '/save': saveState };
  const action = routes[new URL(request.url).pathname];
  return action ? action(request) : new Response('Not found', {status:404});
} };`,
    resolveDir: project,
  },
  alias: { '@': project },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['cloudflare:workers', 'node:*'],
});
const mf = new Miniflare({
  script: bundle.outputFiles[0].text,
  modules: true,
  compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
});
const origin = 'https://password-runtime.example.invalid';
const email = 'runtime-synthetic@example.invalid';
const password = 'isolated runtime test secret 123!';
const ownerHeaders = {
  'oai-authenticated-user-id': 'synthetic-owner',
  'oai-authenticated-user-email': 'smkim3733@gmail.com',
};
const checks = [];
async function call(route, body, headers = {}) {
  return mf.dispatchFetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function expect(response, status, name) {
  assert.equal(
    response.status,
    status,
    `${name}: ${await response.clone().text()}`,
  );
  checks.push(name);
  return response;
}
try {
  const db = await mf.getD1Database('DB');
  await db
    .prepare(
      'CREATE TABLE portal_state (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
    )
    .run();
  const seed = {
    version: 1,
    consultationNumber: 0,
    membersRevision: 0,
    timeline: [],
    schedule: [],
    tasks: [],
    companyDocuments: [],
    cases: [],
    members: [],
  };
  await db
    .prepare('INSERT INTO portal_state VALUES (?1, ?2, ?3)')
    .bind('keve-partner-hub', JSON.stringify(seed), new Date().toISOString())
    .run();
  const migration = await readFile(
    path.join(project, 'drizzle/0003_partner_password_auth.sql'),
    'utf8',
  );
  for (const sql of migration
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  checks.push('additive migration on real D1');
  await expect(await call('/state'), 401, 'anonymous private-state denial');
  await expect(
    await call('/signup', {
      name: '가상 런타임파트너',
      phone: '010-0000-0000',
      affiliation: '가상 검증소속',
      email,
      password,
      consent: true,
    }),
    201,
    'native workerd scrypt signup',
  );
  await expect(
    await call('/login', { email, password }),
    403,
    'pending approval denied',
  );
  const state = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  );
  const account = await db
    .prepare('SELECT password_hash FROM portal_password_accounts')
    .first();
  assert.match(account.password_hash, /^scrypt\$16384\$8\$5\$/);
  assert.ok(!JSON.stringify(state).includes(password));
  state.members[0].status = '활성';
  await db
    .prepare('UPDATE portal_state SET payload = ?1')
    .bind(JSON.stringify(state))
    .run();
  const signed = await expect(
    await call('/login', { email, password }),
    200,
    'native workerd password verification',
  );
  const setCookie = signed.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  const cookie = setCookie.split(';')[0];
  const response = await expect(
    await call('/state', undefined, { cookie }),
    200,
    'cookie-only state access without ChatGPT headers',
  );
  assert.equal((await response.json()).currentUser.authMethod, 'password');
  assert.match(response.headers.get('cache-control'), /no-store/);
  await expect(
    await call(
      '/issue',
      { memberId: state.members[0].id, confirmed: true },
      { cookie },
    ),
    403,
    'partner cannot reset other accounts',
  );
  const issued = await expect(
    await call(
      '/issue',
      { memberId: state.members[0].id, confirmed: true },
      ownerHeaders,
    ),
    201,
    'owner-issued one-time setup link',
  );
  const token = (await issued.json()).path.split('#token=')[1];
  await expect(
    await call('/setup', { token, password: `${password} new` }),
    200,
    'native workerd reset with transactional D1 upsert',
  );
  await expect(
    await call('/state', undefined, { cookie, ...ownerHeaders }),
    401,
    'old session revoked without owner fallback',
  );
  await expect(
    await call('/setup', { token, password }),
    400,
    'one-time token replay denied',
  );
  const next = await expect(
    await call('/login', { email, password: `${password} new` }),
    200,
    'new password works',
  );
  const nextCookie = next.headers.get('set-cookie').split(';')[0];
  await expect(
    await call(
      '/logout',
      {},
      { cookie: nextCookie, origin: 'https://evil.example' },
    ),
    403,
    'cross-site logout denied',
  );
  await expect(
    await call('/logout', {}, { cookie: nextCookie }),
    200,
    'logout success',
  );
  await expect(
    await call('/state', undefined, { cookie: nextCookie }),
    401,
    'logged-out session cannot be replayed',
  );
  console.log(
    JSON.stringify(
      {
        runtime: 'workerd + isolated D1',
        checksPassed: checks.length,
        checks,
        liveWrites: 0,
        emailSends: 0,
        paidAIRequests: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await mf.dispose();
}
