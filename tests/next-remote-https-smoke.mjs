// Real Next remote-mode runtime, native isolated D1/R2/Workers and verified TLS.
// Not a Vercel deployment, browser UI test or live-data migration.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { createRemoteHttpsFixture } from './remote-https-fixture.mjs';
import { ownedNextProcess, unusedLoopbackPort } from './owned-next-process.mjs';
import { portalStateId } from '../db/schema.ts';
import { emptyPortalStateBaseline } from '../lib/pilot-readiness.ts';
import { defaultPartnerPermissions } from '../lib/partner-registration.ts';
import { hashPassword } from '../lib/password-crypto.ts';
import { createD1HttpDatabase } from '../lib/d1-http-client.ts';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store.ts';
import { recoverStandaloneAdmin } from '../lib/standalone-admin-recovery.ts';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email.ts';
import { runNextAuthLimitChecks } from './next-auth-limit-smoke.mjs';
import {
  directCompanyUpload,
  requestFileTransfer,
} from '../lib/file-transfer-client.ts';
import {
  nextTransferCaseId,
  runNextFlowTransferChecks,
} from './next-flow-transfer-smoke.mjs';

for (const file of [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
]) {
  const exists = await access(file).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
  assert.equal(exists, false, `Refusing to load operator environment: ${file}`);
}
assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0', false);
const port = await unusedLoopbackPort();
const fixture = await createRemoteHttpsFixture(port);
const { db, environment, counts } = fixture;
const baseUrl = environment.PARTNER_HUB_APP_ORIGIN;
const originalTrust = getCACertificates('default');
setDefaultCACertificates([...originalTrust, fixture.cert]);
const childEnvironment = {
  ...process.env,
  ...environment,
  NODE_ENV: 'development',
  // Synthetic edge markers exercise the remote-only alias. No Vercel connection.
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_EXTRA_CA_CERTS: fixture.certPath,
  PARTNER_HUB_LOCAL_STORAGE: '0',
  PARTNER_HUB_LOCAL_D1_HTTP: '0',
  PARTNER_HUB_LOCAL_R2_HTTP: '0',
  PARTNER_HUB_LOCAL_FILE_HTTP: '0',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'false',
};
const args = [
  'dev',
  '--hostname',
  '127.0.0.1',
  '--port',
  String(port),
  '--experimental-https',
  '--experimental-https-key',
  fixture.keyPath,
  '--experimental-https-cert',
  fixture.certPath,
  // Next dev replaces NODE_EXTRA_CA_CERTS with this explicit CA for its child.
  '--experimental-https-ca',
  fixture.certPath,
];
let server;
let checks = 0;
const pass = (message) => {
  checks++;
  console.log(`PASS ${message}`);
};
const networkFetch = globalThis.fetch;
async function request(path, options = {}) {
  return networkFetch(new URL(path, baseUrl), {
    redirect: 'manual',
    signal: AbortSignal.timeout(90_000),
    ...options,
  });
}
async function jsonPost(path, body, cookie, origin = baseUrl) {
  return request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function expect(response, status) {
  assert.equal(
    response.status,
    status,
    (await response.clone().text()).slice(0, 2000),
  );
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  return response;
}
const email = 'remote-synthetic@example.test';
const memberId = 'remote-synthetic-partner';
const password = `Synthetic-partner-${randomUUID()}!`;
const adminPassword = `Synthetic-admin-${randomUUID()}!`;
const replacementPassword = `Synthetic-recovered-admin-${randomUUID()}!`;
function secureCookie(response, maxAge) {
  const header = response.headers.get('set-cookie');
  assert.match(
    header,
    /^__Host-keve_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict;/,
  );
  assert.ok(header.includes(`Max-Age=${maxAge}; Secure`));
  assert.doesNotMatch(header, /domain=/i);
  return header.split(';')[0];
}
try {
  const remoteDb = createD1HttpDatabase({
    origin: environment.PARTNER_HUB_D1_ORIGIN,
    secret: environment.PARTNER_HUB_D1_SECRET,
  });
  assert.equal(await remoteDb.prepare('SELECT 1 AS value').first('value'), 1);
  pass('verified TLS handshake and native D1 round trip before Next starts');
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM standalone_admin_accounts')
        .first()
    ).n,
    0,
  );
  const state = {
    ...emptyPortalStateBaseline(),
    cases: [
      {
        id: nextTransferCaseId,
        company: '합성 HTTPS 기업',
        trainee: 'HTTPS 검증 파트너',
        partnerMemberId: memberId,
      },
    ],
    members: [
      {
        id: memberId,
        name: 'HTTPS 검증 파트너',
        email,
        cohort: '',
        memberType: '기타',
        role: '일반 파트너',
        status: '활성',
        companies: 0,
        permissions: { ...defaultPartnerPermissions },
      },
    ],
  };
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        'INSERT INTO portal_state (payload,updated_at,id) VALUES (?1,?2,?3)',
      )
      .bind(JSON.stringify(state), now, portalStateId),
    db
      .prepare(
        'INSERT INTO portal_password_accounts (member_id,email,password_hash,credential_version,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)',
      )
      .bind(memberId, email, hashPassword(password), randomUUID(), now),
  ]);
  server = ownedNextProcess(args, childEnvironment, port);
  await server.ready();
  await runNextAuthLimitChecks({ db, request, baseUrl });
  pass(
    'native distributed auth limits: concurrent IP cap, separate clients, shared email, normalization, fallback and expiry (simulated Vercel edge)',
  );
  await expect(await request('/api/state'), 401);
  await expect(
    await request('/api/state', {
      headers: {
        'oai-authenticated-user-id': 'forged-owner',
        'oai-authenticated-user-email': PORTAL_OWNER_EMAIL,
        'x-forwarded-for': '198.51.100.10',
        'cf-connecting-ip': '198.51.100.11',
      },
    }),
    401,
  );
  await expect(
    await jsonPost('/api/auth/login', {
      email: PORTAL_OWNER_EMAIL,
      password: adminPassword,
    }),
    401,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM standalone_admin_accounts')
        .first()
    ).n,
    0,
  );
  pass(
    'empty standalone schema never bootstraps an administrator; forged Sites identity denied',
  );

  await provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL,
    password: adminPassword,
    deployment: 'remote',
  });
  await assert.rejects(
    provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password: `Not-a-replacement-${randomUUID()}`,
      deployment: 'remote',
    }),
  );
  await expect(
    await jsonPost(
      '/api/auth/login',
      { email, password },
      undefined,
      'https://wrong.invalid',
    ),
    403,
  );
  await expect(
    await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    403,
  );
  await expect(
    await request('/api/state', {
      headers: { 'sec-fetch-site': 'cross-site' },
    }),
    403,
  );
  const partnerLogin = await expect(
    await jsonPost('/api/auth/login', { email, password }),
    200,
  );
  const cookie = secureCookie(partnerLogin, 43200);
  const partnerState = await expect(
    await request('/api/state', { headers: { cookie } }),
    200,
  );
  assert.equal((await partnerState.json()).currentUser.memberId, memberId);
  await expect(
    await request('/api/admin/file-inventory', { headers: { cookie } }),
    403,
  );
  await expect(
    await request('/api/state', {
      headers: { cookie: `${cookie}; ${cookie}` },
    }),
    401,
  );
  pass(
    'HTTPS partner login, secure host-only cookie, CSRF and role/duplicate-cookie denials',
  );
  const adminLogin = await expect(
    await jsonPost('/api/auth/login', {
      email: PORTAL_OWNER_EMAIL,
      password: adminPassword,
    }),
    200,
  );
  let adminCookie = secureCookie(adminLogin, 3600);
  const adminState = await expect(
    await request('/api/state', { headers: { cookie: adminCookie } }),
    200,
  );
  const adminUser = (await adminState.json()).currentUser;
  assert.equal(adminUser.id, 'standalone:primary-admin');
  assert.equal(adminUser.role, 'admin');
  pass(
    'independent administrator credential and one-hour secure session over D1 HTTPS',
  );

  const bytes = new TextEncoder().encode(
    '%PDF-1.4\n' + 'Synthetic fixture. '.repeat(340_000) + '\n%%EOF',
  );
  assert.ok(bytes.length > 4.5 * 1024 * 1024);
  const form = new FormData();
  form.set(
    'file',
    new File([bytes], 'synthetic-https.pdf', { type: 'application/pdf' }),
  );
  form.set('company', '합성 HTTPS 기업');
  form.set('title', '독립 운영 전송 검증');
  form.set('category', '기타자료');
  form.set('consent', 'confirmed');
  await expect(
    await request('/api/files', {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
      body: form,
    }),
    400,
  );
  let saved;
  let downloadGrant;
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(baseUrl),
  });
  let metadataRequests = 0;
  let byteRequests = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, baseUrl);
    const headers = new Headers(options.headers);
    headers.set('origin', baseUrl);
    if (url.origin === baseUrl) {
      assert.equal(url.pathname, '/api/file-transfers');
      assert.equal(typeof options.body, 'string');
      assert.ok(Buffer.byteLength(options.body) < 16_384);
      headers.set('cookie', cookie);
      metadataRequests++;
    } else {
      assert.equal(url.origin, environment.PARTNER_HUB_FILE_ORIGIN);
      assert.equal(options.credentials, 'omit');
      assert.equal(headers.has('cookie'), false);
      byteRequests++;
    }
    return networkFetch(url, { ...options, headers });
  };
  try {
    const key = randomBytes(32).toString('hex');
    saved = (
      await (await expect(await directCompanyUpload(form, key), 201)).json()
    ).file;
    const replay = await expect(await directCompanyUpload(form, key), 201);
    assert.equal((await replay.json()).file.id, saved.id);
    downloadGrant = await requestFileTransfer({
      kind: 'company-download',
      fileId: saved.id,
    });
  } finally {
    globalThis.fetch = networkFetch;
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
    else delete globalThis.location;
  }
  assert.equal(metadataRequests, 3);
  assert.equal(byteRequests, 2);
  const download = await expect(
    await networkFetch(downloadGrant.url, {
      headers: {
        origin: baseUrl,
        authorization: `Bearer ${downloadGrant.token}`,
      },
      redirect: 'error',
    }),
    200,
  );
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal(download.headers.get('access-control-allow-origin'), baseUrl);
  await expect(
    await request(`/api/files/${saved.id}`, { headers: { cookie } }),
    400,
  );
  assert.equal(
    (
      await request(`/api/files/${saved.id}`, {
        method: 'HEAD',
        headers: { cookie },
      })
    ).status,
    400,
  );
  const inventory = await expect(
    await request('/api/admin/file-inventory?status=all', {
      headers: { cookie: adminCookie },
    }),
    200,
  );
  const inventoryBody = await inventory.json();
  assert.ok(JSON.stringify(inventoryBody).includes(saved.id));
  const item = inventoryBody.items.find(
    (item) => item.source === 'company' && item.integrityProof === 'sha256',
  );
  assert.ok(item);
  const presence = await expect(
    await request(
      `/api/admin/file-inventory/${encodeURIComponent(item.id)}/presence`,
      { headers: { cookie: adminCookie } },
    ),
    200,
  );
  const integrity = await presence.json();
  assert.equal(integrity.exists, true);
  assert.equal(integrity.sizeMatches, true);
  assert.equal(integrity.integrityMatches, true);
  assert.ok(
    counts.r2 > 0,
    'Admin inventory must query remote R2, not a local fallback.',
  );
  pass(
    'large private bytes bypass Next over TLS; retry receipt, native R2 inventory and legacy-byte route block',
  );

  await runNextFlowTransferChecks({
    baseUrl,
    request,
    jsonPost,
    partnerCookie: cookie,
    adminCookie,
    inventoryOnly: process.argv.includes('--inventory-only'),
  });
  pass(
    'shipped FLOW browser transport and independent administrator operate over HTTPS',
  );

  const adminGrant = await (
    await expect(
      await jsonPost(
        '/api/file-transfers',
        {
          kind: 'company-download',
          fileId: saved.id,
        },
        adminCookie,
      ),
      200,
    )
  ).json();
  const expectedCredentialVersion = await remoteDb
    .prepare('SELECT credential_version FROM standalone_admin_accounts')
    .first('credential_version');
  const recovery = await recoverStandaloneAdmin(remoteDb, {
    email: PORTAL_OWNER_EMAIL,
    password: replacementPassword,
    expectedCredentialVersion,
    recoveryId: randomUUID(),
    reason: 'lost-password',
  });
  assert.equal(recovery.revokedSessions, 1);
  await expect(
    await request('/api/state', { headers: { cookie: adminCookie } }),
    401,
  );
  await expect(
    await networkFetch(adminGrant.url, {
      headers: { origin: baseUrl, authorization: `Bearer ${adminGrant.token}` },
    }),
    401,
  );
  await expect(await request('/api/state', { headers: { cookie } }), 200);
  await expect(
    await jsonPost('/api/auth/login', {
      email: PORTAL_OWNER_EMAIL,
      password: adminPassword,
    }),
    401,
  );
  adminCookie = secureCookie(
    await expect(
      await jsonPost('/api/auth/login', {
        email: PORTAL_OWNER_EMAIL,
        password: replacementPassword,
      }),
      200,
    ),
    3600,
  );
  await assert.rejects(
    remoteDb.prepare('DELETE FROM standalone_admin_recovery_audit').run(),
  );
  const auditBeforeCheck = await remoteDb
    .prepare('SELECT * FROM standalone_admin_recovery_audit')
    .all();
  const accountBeforeCheck = await remoteDb
    .prepare('SELECT * FROM standalone_admin_accounts')
    .all();
  const cliCheck = await promisify(execFile)(
    process.execPath,
    ['scripts/recover-next-remote-admin.mjs', '--check'],
    {
      env: { ...childEnvironment, NODE_EXTRA_CA_CERTS: fixture.certPath },
      timeout: 30000,
      windowsHide: true,
    },
  );
  assert.match(cliCheck.stdout, /"writes":0/);
  assert.ok(cliCheck.stdout.includes(recovery.recoveryId));
  assert.equal(cliCheck.stderr, '');
  for (const secret of [
    adminPassword,
    replacementPassword,
    environment.PARTNER_HUB_D1_SECRET,
  ])
    assert.equal(cliCheck.stdout.includes(secret), false);
  assert.deepEqual(
    (
      await remoteDb
        .prepare('SELECT * FROM standalone_admin_recovery_audit')
        .all()
    ).results,
    auditBeforeCheck.results,
  );
  assert.deepEqual(
    (await remoteDb.prepare('SELECT * FROM standalone_admin_accounts').all())
      .results,
    accountBeforeCheck.results,
  );
  pass(
    'operator recovery over native D1 HTTPS revokes administrator sessions/file tickets, preserves partner access and locks its audit',
  );

  await expect(await jsonPost('/api/auth/logout', {}, cookie), 200);
  await expect(await request('/api/state', { headers: { cookie } }), 401);
  await expect(
    await networkFetch(downloadGrant.url, {
      headers: {
        origin: baseUrl,
        authorization: `Bearer ${downloadGrant.token}`,
      },
    }),
    401,
  );
  await expect(await jsonPost('/api/auth/logout', {}, adminCookie), 200);
  await expect(
    await request('/api/state', { headers: { cookie: adminCookie } }),
    401,
  );
  pass(
    'Next logout revokes both session roles and previously-issued native Worker tickets',
  );

  await server.stop();
  server = null;
  const before = { ...counts };
  server = ownedNextProcess(
    args,
    { ...childEnvironment, PARTNER_HUB_BACKEND_ENABLED: '0' },
    port,
  );
  await server.ready();
  const unavailable = await expect(await request('/api/state'), 503);
  assert.equal(
    (await unavailable.json()).code,
    'MIGRATION_BACKEND_NOT_CONFIGURED',
  );
  await expect(await jsonPost('/api/auth/login', { email, password }), 503);
  assert.deepEqual(
    counts,
    before,
    'Disabled remote backend must not contact storage.',
  );
  pass(
    'remote build mode with runtime opt-in disabled fails closed before any storage request',
  );
  assert.ok(counts.d1 > 0 && counts.r2 > 0 && counts.files > 0);
  assert.equal(counts.outbound, 0);
  assert.equal(counts.errors, 0);
  console.log(
    JSON.stringify({
      checks,
      transport: 'verified-https',
      runtime: 'real-next-dev/native-workers',
      ...counts,
      liveDataWrites: 0,
      deployments: 0,
      paidAiCalls: 0,
    }),
  );
} catch (error) {
  // Logs contain only synthetic targets; redact even synthetic credentials.
  let logs = server?.logs() ?? '';
  for (const secret of [
    ...Object.entries(environment)
      .filter(([key]) => key.endsWith('_SECRET'))
      .map(([, value]) => value),
    password,
    adminPassword,
    replacementPassword,
  ])
    logs = logs.replaceAll(secret, '[redacted]');
  console.error(logs);
  console.error(JSON.stringify({ fixtureCounts: counts }));
  throw error;
} finally {
  try {
    await server?.stop();
  } finally {
    setDefaultCACertificates(originalTrust);
    await fixture.dispose();
  }
}
