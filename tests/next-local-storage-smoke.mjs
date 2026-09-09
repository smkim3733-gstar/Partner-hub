// Real Next dev + isolated persistent workerd D1/R2. Synthetic data only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer, createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createNextLocalPlatform } from '../dev/next-local/bindings.ts';
import { portalStateId } from '../db/schema.ts';
import { emptyPortalStateBaseline } from '../lib/pilot-readiness.ts';
import { hashPassword } from '../lib/password-crypto.ts';
import { defaultPartnerPermissions } from '../lib/partner-registration.ts';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email.ts';
import {
  nextTransferCaseId,
  runNextFlowTransferChecks,
} from './next-flow-transfer-smoke.mjs';
import {
  directCompanyUpload,
  requestFileTransfer,
} from '../lib/file-transfer-client.ts';
import {
  provisionStandaloneAdmin,
  issueStandaloneAdminSession,
} from '../lib/standalone-admin-store.ts';

assert.ok(
  !['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_ID'].some(
    (key) => key in process.env,
  ),
);
process.env.NODE_ENV = 'development';
process.env.PARTNER_HUB_LOCAL_STORAGE = '1';
const httpDatabase = process.argv.includes('--d1-http');
const fileHttp = process.argv.includes('--file-http');
const httpBucket = process.argv.includes('--r2-http');
process.env.PARTNER_HUB_LOCAL_R2_HTTP = httpBucket ? '1' : '0';
process.env.PARTNER_HUB_LOCAL_FILE_HTTP = '0';
process.env.PARTNER_HUB_LOCAL_D1_HTTP = httpDatabase ? '1' : '0';
process.env.PARTNER_HUB_LOCAL_STORAGE_NAME = `test-${randomUUID().slice(0, 8)}`;
process.env.NEXT_TELEMETRY_DISABLED = '1';
const require = createRequire(import.meta.url);
const password = `Synthetic-${randomUUID()}!`;
const adminPassword = `Synthetic-admin-${randomUUID()}!`;
const email = 'next-runtime@example.test';
const memberId = `partner-${randomUUID()}`;
const fileText =
  'Synthetic Next.js migration fixture. No customer information.';
let platform = await createNextLocalPlatform();
try {
  const count = await platform.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM next_local_migrations',
  ).first();
  assert.equal(count.count, 100);
  assert.equal(
    (
      await platform.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM next_local_migrations WHERE name LIKE 'next/%'",
      ).first()
    ).count,
    1,
  );
  assert.equal(
    (
      await platform.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM standalone_admin_accounts',
      ).first()
    ).count,
    0,
  );
  await provisionStandaloneAdmin(platform.env.DB, {
    email: PORTAL_OWNER_EMAIL,
    password: adminPassword,
  });
  await assert.rejects(
    provisionStandaloneAdmin(platform.env.DB, {
      email: PORTAL_OWNER_EMAIL,
      password: `Never-overwrite-${randomUUID()}`,
    }),
  );
  const state = {
    ...emptyPortalStateBaseline(),
    cases: [
      {
        id: nextTransferCaseId,
        company: '합성 FLOW 기업',
        trainee: 'Next 테스트 파트너',
        partnerMemberId: memberId,
      },
    ],
    members: [
      {
        id: memberId,
        name: 'Next 테스트 파트너',
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
  await platform.env.DB.batch([
    platform.env.DB.prepare(
      'UPDATE portal_state SET payload = ?1, updated_at = ?2 WHERE id = ?3',
    ).bind(JSON.stringify(state), now, portalStateId),
    platform.env.DB.prepare(
      'INSERT INTO portal_password_accounts (member_id, email, password_hash, credential_version, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
    ).bind(memberId, email, hashPassword(password), randomUUID(), now),
  ]);
  await platform.env.AI_SOURCE_FILES.put(
    'company-source/migration-fixture',
    fileText,
    {
      httpMetadata: { contentType: 'text/plain' },
    },
  );
} finally {
  await platform.dispose();
}
console.log(
  'PASS 99 existing + 1 local migration, isolated admin/partner fixtures, no automatic admin and no credential overwrite.',
);

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) =>
  probe.close((error) => (error ? reject(error) : resolve())),
);
const baseUrl = `http://127.0.0.1:${port}`;
process.env.PARTNER_HUB_LOCAL_FILE_HTTP = fileHttp ? '1' : '0';
process.env.PARTNER_HUB_LOCAL_APP_ORIGIN = baseUrl;
let child;
let exited;
let logs = '';
async function start() {
  logs = '';
  child = spawn(
    process.execPath,
    [
      require.resolve('next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  exited = new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      logs = (logs + chunk.toString()).slice(-16_000);
    });
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null) throw new Error(`Next dev exited: ${logs}`);
    if (logs.includes('Ready in')) return;
    await delay(250);
  }
  throw new Error(`Next dev startup timed out: ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // Next dev has a child compiler server. Terminate only this test's process tree.
  let killResult = 'SIGTERM';
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const [code] = await Promise.race([
      once(killer, 'exit'),
      delay(10000, ['timeout'], { ref: false }),
    ]);
    // taskkill can report a nonzero code when a descendant exits during its
    // tree walk. The child exit event and owned listener are authoritative.
    // A genuinely denied kill still fails the bounded checks below.
    killResult = `taskkill exit ${code}`;
  } else child.kill('SIGTERM');
  if (
    (await Promise.race([exited, delay(10000, 'timeout', { ref: false })])) ===
    'timeout'
  )
    throw new Error(
      `Test Next process ${child.pid} did not exit within 10 seconds (${killResult}).`,
    );
  await delay(500);
  const listening = await new Promise((resolve) => {
    const socket = createConnection({
      host: '127.0.0.1',
      port: Number(new URL(baseUrl).port),
    });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(2000, () => finish(true));
  });
  if (listening)
    throw new Error(
      `Test Next listener remains open after PID ${child.pid} exited (${killResult}).`,
    );
  if (killResult !== 'SIGTERM' && killResult !== 'taskkill exit 0')
    console.log(
      `PASS owned Next PID and listener closed despite ${killResult}.`,
    );
}
async function request(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
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
let cookie;
let uploadedId;
let adminCookie;
let expiredAdminCookie;
let directGrant;
try {
  await start();
  assert.equal((await request('/api/state')).status, 401);
  assert.equal(
    (
      await request('/api/state', {
        headers: {
          'oai-authenticated-user-id': 'forged-owner',
          'oai-authenticated-user-email': PORTAL_OWNER_EMAIL,
        },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await jsonPost(
        '/api/auth/login',
        { email, password },
        undefined,
        'https://wrong-origin.example',
      )
    ).status,
    403,
  );
  const login = await jsonPost('/api/auth/login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(await login.clone().json()));
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^keve_local_session=[a-f0-9]{64}$/);
  const state = await request('/api/state', { headers: { cookie } });
  assert.equal(state.status, 200);
  const stateBody = await state.json();
  assert.equal(stateBody.currentUser.role, 'trainee');
  assert.equal(stateBody.currentUser.memberId, memberId);
  assert.equal(
    (await request('/api/admin/file-inventory', { headers: { cookie } }))
      .status,
    403,
  );
  assert.equal(
    (await request('/api/application-draft', { headers: { cookie } })).status,
    200,
  );
  console.log(
    'PASS real Next password session, state/draft read, anonymous/forged-header/origin/admin denials.',
  );

  const signup = {
    email: 'next-pending@example.test',
    password,
    name: '가입검증',
    phone: '01012345678',
    affiliation: '합성 테스트',
    consent: true,
  };
  const register = await jsonPost('/api/auth/register', signup);
  assert.equal(
    register.status,
    201,
    JSON.stringify(await register.clone().json()),
  );
  assert.equal((await jsonPost('/api/auth/login', signup)).status, 403);
  console.log(
    'PASS new registration persists as pending; no automatic approval or admin account.',
  );

  const form = new FormData();
  form.set(
    'file',
    new File([fileText], 'synthetic-transcript.txt', { type: 'text/plain' }),
  );
  form.set('company', '합성 검증기업');
  form.set('title', 'Next 저장소 검증');
  form.set('category', '상담녹취');
  form.set('consent', 'confirmed');
  form.set('recordingConsent', 'confirmed');
  const upload = await request('/api/files', {
    method: 'POST',
    headers: { cookie, origin: baseUrl },
    body: form,
  });
  assert.equal(upload.status, 201, JSON.stringify(await upload.clone().json()));
  uploadedId = (await upload.json()).file.id;
  const download = await request(`/api/files/${uploadedId}`, {
    headers: { cookie },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), fileText);
  assert.equal((await request(`/api/files/${uploadedId}`)).status, 401);
  console.log(
    'PASS Next multipart upload and authenticated R2 download; anonymous file denied.',
  );
  if (fileHttp) {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(
      globalThis,
      'location',
    );
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL(baseUrl),
    });
    const metadataRequests = [];
    const byteRequests = [];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input, baseUrl);
      const headers = new Headers(options.headers);
      headers.set('origin', baseUrl);
      if (url.origin === baseUrl) {
        headers.set('cookie', cookie);
        assert.equal(url.pathname, '/api/file-transfers');
        assert.equal(typeof options.body, 'string');
        assert.ok(Buffer.byteLength(options.body) < 16_384);
        metadataRequests.push(url.pathname);
      } else {
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(url.search, '');
        assert.equal(headers.has('cookie'), false);
        byteRequests.push(url.pathname);
      }
      return originalFetch(url, { ...options, headers });
    };
    try {
      const largeBytes = new TextEncoder().encode(
        '%PDF-1.4\n' + 'Synthetic fixture. '.repeat(340_000) + '\n%%EOF',
      );
      const largeForm = new FormData();
      largeForm.set(
        'file',
        new File([largeBytes], 'synthetic-large.pdf', {
          type: 'application/pdf',
        }),
      );
      largeForm.set('company', '합성 검증기업');
      largeForm.set('title', 'Next 직접 전송');
      largeForm.set('category', '기타자료');
      largeForm.set('consent', 'confirmed');
      const key = randomUUID().replaceAll('-', '').repeat(2);
      const uploadDirect = await directCompanyUpload(largeForm, key);
      assert.equal(
        uploadDirect.status,
        201,
        JSON.stringify(await uploadDirect.clone().json()),
      );
      const saved = (await uploadDirect.json()).file;
      const retry = await directCompanyUpload(largeForm, key);
      assert.equal(
        retry.status,
        201,
        JSON.stringify(await retry.clone().json()),
      );
      assert.equal((await retry.json()).file.id, saved.id);
      directGrant = await requestFileTransfer({
        kind: 'company-download',
        fileId: saved.id,
      });
      const largeDownload = await originalFetch(directGrant.url, {
        headers: {
          origin: baseUrl,
          authorization: `Bearer ${directGrant.token}`,
        },
      });
      assert.equal(largeDownload.status, 200);
      assert.deepEqual(
        new Uint8Array(await largeDownload.arrayBuffer()),
        largeBytes,
      );
      assert.equal(metadataRequests.length, 3);
      assert.equal(byteRequests.length, 2);
      console.log(
        'PASS real Next issues small encrypted grants; >6MB upload/download bypass Next; browser client omits cookies and reuses stable receipt.',
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocation)
        Object.defineProperty(globalThis, 'location', originalLocation);
      else delete globalThis.location;
    }
    assert.equal(
      (
        await jsonPost('/api/file-transfers', {
          kind: 'company-download',
          fileId: uploadedId,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await jsonPost(
          '/api/file-transfers',
          { kind: 'company-download', fileId: uploadedId },
          cookie,
          'https://evil.invalid',
        )
      ).status,
      403,
    );
    console.log(
      'PASS Next transfer issuance rejects anonymous and wrong-origin requests.',
    );
  }

  const adminCredentials = {
    email: PORTAL_OWNER_EMAIL,
    password: adminPassword,
  };
  const badAdmin = await jsonPost(
    '/api/auth/login',
    { ...adminCredentials, password: 'wrong synthetic admin secret' },
    cookie,
  );
  assert.equal(badAdmin.status, 401);
  assert.equal(badAdmin.headers.get('set-cookie'), null);
  assert.equal(
    (await request('/api/state', { headers: { cookie } })).status,
    200,
  );
  const adminLogin = await jsonPost(
    '/api/auth/login',
    adminCredentials,
    cookie,
  );
  assert.equal(
    adminLogin.status,
    200,
    JSON.stringify(await adminLogin.clone().json()),
  );
  assert.match(
    adminLogin.headers.get('set-cookie'),
    /HttpOnly; SameSite=Strict; Max-Age=3600/,
  );
  adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  if (directGrant) {
    const revoked = await fetch(directGrant.url, {
      headers: {
        origin: baseUrl,
        authorization: `Bearer ${directGrant.token}`,
      },
    });
    assert.equal(revoked.status, 401);
    console.log(
      'PASS previously-issued direct transfer revoked after Next account switch.',
    );
  }
  assert.notEqual(adminCookie, cookie);
  assert.equal(
    (await request('/api/state', { headers: { cookie } })).status,
    401,
  );
  const adminState = await request('/api/state', {
    headers: { cookie: adminCookie },
  });
  assert.equal(adminState.status, 200);
  const adminUser = (await adminState.json()).currentUser;
  assert.equal(adminUser.role, 'admin');
  assert.equal(adminUser.authMethod, 'password');
  assert.equal(adminUser.id, 'standalone:primary-admin');
  assert.equal(
    (
      await request('/api/admin/file-inventory', {
        headers: { cookie: adminCookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request('/api/state', {
        headers: { cookie: `${adminCookie}; ${adminCookie}` },
      })
    ).status,
    401,
  );
  const linkBody = { memberId, confirmed: true };
  assert.equal(
    (
      await jsonPost(
        '/api/admin/partners/password-link',
        linkBody,
        adminCookie,
        'https://wrong-origin.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await jsonPost(
        '/api/admin/partners/password-link',
        linkBody,
        adminCookie,
        '',
      )
    ).status,
    403,
  );
  assert.equal(
    (await jsonPost('/api/admin/partners/password-link', linkBody, adminCookie))
      .status,
    201,
  );
  const rotatedAdmin = await jsonPost(
    '/api/auth/login',
    adminCredentials,
    adminCookie,
  );
  assert.equal(rotatedAdmin.status, 200);
  const previousAdmin = adminCookie;
  adminCookie = rotatedAdmin.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await request('/api/state', { headers: { cookie: previousAdmin } }))
      .status,
    401,
  );
  const backToPartner = await jsonPost(
    '/api/auth/login',
    { email, password },
    adminCookie,
  );
  assert.equal(backToPartner.status, 200);
  cookie = backToPartner.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await request('/api/state', { headers: { cookie: adminCookie } })).status,
    401,
  );
  assert.equal(
    (await request('/api/admin/file-inventory', { headers: { cookie } }))
      .status,
    403,
  );
  // A separate browser's admin session remains independent of the partner cookie.
  const independentAdmin = await jsonPost('/api/auth/login', adminCredentials);
  assert.equal(independentAdmin.status, 200);
  adminCookie = independentAdmin.headers.get('set-cookie').split(';')[0];
  console.log(
    'PASS admin credential login, one-hour cookie, admin read/write, CSRF/duplicate-cookie denial and cross-role session rotation.',
  );

  if (fileHttp)
    await runNextFlowTransferChecks({
      baseUrl,
      request,
      jsonPost,
      partnerCookie: cookie,
      adminCookie,
      inventoryOnly: process.argv.includes('--inventory-only'),
    });

  await stop();
  platform = await createNextLocalPlatform();
  try {
    assert.equal(
      await (
        await platform.env.AI_SOURCE_FILES.get(
          'company-source/migration-fixture',
        )
      ).text(),
      fileText,
    );
    assert.equal(
      (
        await platform.env.DB.prepare(
          'SELECT COUNT(*) AS count FROM next_local_migrations',
        ).first()
      ).count,
      100,
    );
    const expiredToken = await issueStandaloneAdminSession(
      platform.env.DB,
      PORTAL_OWNER_EMAIL,
      adminPassword,
      null,
    );
    assert.ok(expiredToken);
    const { tokenHash } = await import('../lib/password-crypto.ts');
    await platform.env.DB.prepare(
      'UPDATE standalone_admin_sessions SET issued_at = ?1, expires_at = ?2 WHERE token_hash = ?3',
    )
      .bind(Date.now() - 7200000, Date.now() - 3600000, tokenHash(expiredToken))
      .run();
    expiredAdminCookie = `keve_local_session=${expiredToken}`;
  } finally {
    await platform.dispose();
  }
  await start();
  assert.equal(
    (
      await request('/api/admin/file-inventory', {
        headers: { cookie: adminCookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/state', { headers: { cookie: expiredAdminCookie } }))
      .status,
    401,
  );
  const adminLogout = await jsonPost('/api/auth/logout', {}, adminCookie);
  assert.equal(adminLogout.status, 200);
  assert.match(adminLogout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(
    (await request('/api/state', { headers: { cookie: adminCookie } })).status,
    401,
  );
  assert.equal(
    (await request('/api/state', { headers: { cookie } })).status,
    200,
  );
  assert.equal(
    await (
      await request(`/api/files/${uploadedId}`, { headers: { cookie } })
    ).text(),
    fileText,
  );
  assert.equal((await jsonPost('/api/auth/logout', {}, cookie)).status, 200);
  assert.equal(
    (await request('/api/state', { headers: { cookie } })).status,
    401,
  );
  console.log(
    'PASS restart retains DB/admin/partner sessions/files; expired admin denied; both logouts revoke stored sessions.',
  );
  // Four prior owner attempts above; the shared account budget is eight / 15 min.
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await jsonPost('/api/auth/login', {
      email: PORTAL_OWNER_EMAIL,
      password: 'incorrect synthetic administrator secret',
    });
    assert.equal(response.status, attempt < 4 ? 401 : 429);
    assert.equal(response.headers.get('set-cookie'), null);
    if (attempt === 4) assert.equal(response.headers.get('retry-after'), '900');
  }
  console.log(
    'PASS administrator login shares durable brute-force protection; exhausted budget returns 429.',
  );
  console.log(
    `Next local storage smoke passed (${httpDatabase ? 'authenticated D1 HTTP' : 'native D1'} + ${httpBucket ? 'authenticated R2 HTTP' : 'native R2'}). Production data and paid AI were not used.`,
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  try {
    await stop();
  } catch (error) {
    // Report the owned PID and fail instead of hanging forever on denied cleanup.
    // Never fall back to killing unrelated node/workerd processes.
    console.error(error);
    child?.unref();
    child?.stdout.destroy();
    child?.stderr.destroy();
    process.exitCode = 1;
  }
}
