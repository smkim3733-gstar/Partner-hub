// Isolated workerd + real D1 smoke test. No live database, user account, email or paid AI is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
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
import { POST as createPartner } from '@/app/api/admin/partners/route';
import { GET as getFlow } from '@/app/api/consulting-flow/[caseId]/route';
import { GET as getFile, DELETE as deleteFile } from '@/app/api/files/[id]/route';
export default { async fetch(request) {
  const pathname = new URL(request.url).pathname;
  const routes = { 'POST /signup': registerPassword, 'POST /login': loginPassword, 'POST /logout': logoutPassword, 'POST /setup': setupPassword, 'POST /issue': createPasswordLink, 'GET /state': getState, 'PUT /save': saveState, 'POST /partners': createPartner };
  if (pathname.startsWith('/flow/') && request.method === 'GET') return getFlow(request, { params: Promise.resolve({ caseId: pathname.slice(6) }) });
  if (pathname.startsWith('/files/') && ['GET', 'DELETE'].includes(request.method)) return (request.method === 'GET' ? getFile : deleteFile)(request, { params: Promise.resolve({ id: pathname.slice(7) }) });
  const action = routes[request.method + ' ' + pathname];
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
let outboundRequests = 0;
const mf = new Miniflare({
  script: bundle.outputFiles[0].text,
  modules: true,
  compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  r2Buckets: ['AI_SOURCE_FILES'],
  outboundService: () => {
    outboundRequests++;
    throw new Error(
      'External requests are forbidden in the isolated partner pilot',
    );
  },
});
const origin = 'https://password-runtime.example.invalid';
const email = 'runtime-synthetic@example.invalid';
const password = 'isolated runtime test secret 123!';
const ownerHeaders = {
  'oai-authenticated-user-id': 'synthetic-owner',
  'oai-authenticated-user-email': 'smkim3733@gmail.com',
};
const checks = [];
async function call(
  route,
  body,
  headers = {},
  method = body === undefined ? 'GET' : 'POST',
) {
  return mf.dispatchFetch(`${origin}${route}`, {
    method,
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
  const migrations = (await readdir(path.join(project, 'drizzle')))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  for (let pass = 0; pass < 2; pass++) {
    for (const name of migrations) {
      const migration = await readFile(
        path.join(project, 'drizzle', name),
        'utf8',
      );
      for (const sql of migration
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    }
  }
  assert.deepEqual(
    JSON.parse(
      (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    ),
    seed,
  );
  checks.push(
    'all additive migrations can run twice without replacing existing state',
  );
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
  let state = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  );
  const account = await db
    .prepare('SELECT password_hash FROM portal_password_accounts')
    .first();
  assert.match(account.password_hash, /^scrypt\$16384\$8\$5\$/);
  assert.ok(!JSON.stringify(state).includes(password));
  const memberId = state.members[0].id;
  const peerResponse = await expect(
    await call(
      '/partners',
      {
        name: '가상 런타임파트너',
        phone: '010-0000-0001',
        affiliation: '가상 다른소속',
        email: 'peer-runtime@example.invalid',
        memberType: '기타',
        confirmed: true,
        requestId: 'runtime-peer-register-001',
      },
      ownerHeaders,
    ),
    201,
    'owner directly registers a distinct same-name partner',
  );
  const peerId = (await peerResponse.json()).member.id;
  state.members[0].status = '활성';
  await expect(
    await call('/save', { state }, ownerHeaders, 'PUT'),
    409,
    'stale administrator approval cannot erase another registration',
  );
  state = (await (await call('/state', undefined, ownerHeaders)).json()).state;
  state.members.find((member) => member.id === memberId).status = '활성';
  state.cases = [
    {
      id: 'runtime-own',
      company: '가상 본인기업',
      trainee: '가상 런타임파트너',
      partnerMemberId: memberId,
    },
    {
      id: 'runtime-peer',
      company: '가상 타인기업',
      trainee: '가상 런타임파트너',
      partnerMemberId: peerId,
    },
  ];
  state.schedule = [
    {
      id: 'runtime-schedule',
      company: '가상 타인기업',
      assignedTrainee: '가상 런타임파트너',
      partnerMemberId: peerId,
      shareMode: 'all_with_assignee',
      source: 'partner',
      time: '10:00',
      description: 'CONFIDENTIAL_PEER_MEETING',
    },
  ];
  await expect(
    await call('/save', { state }, ownerHeaders, 'PUT'),
    200,
    'owner approval and account-ID assignment through the real state handler',
  );
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
  const visible = await response.json();
  assert.equal(visible.currentUser.authMethod, 'password');
  assert.equal(visible.currentUser.role, 'trainee');
  assert.equal(visible.currentUser.permissions.quoteContract, false);
  assert.deepEqual(
    visible.state.cases.map((item) => item.id),
    ['runtime-own'],
  );
  assert.deepEqual(
    visible.state.members.map((item) => item.id),
    [memberId],
  );
  assert.doesNotMatch(
    JSON.stringify(visible),
    /CONFIDENTIAL_PEER_MEETING|가상 타인기업/,
  );
  checks.push(
    'cookie-only partner sees own assignment and masked shared schedule',
  );
  assert.match(response.headers.get('cache-control'), /no-store/);
  await expect(
    await call('/flow/runtime-own', undefined, { cookie }),
    200,
    'password partner opens their assigned consulting flow',
  );
  await expect(
    await call('/flow/runtime-peer', undefined, { cookie }),
    403,
    'same-name partner cannot open another account flow',
  );

  const beforeAttack = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  const attack = structuredClone(beforeAttack);
  attack.cases[1].partnerMemberId = memberId;
  attack.cases[1].company = 'FORGED_CASE';
  attack.members[0].status = '정지';
  await expect(
    await call('/save', { state: attack }, { cookie }, 'PUT'),
    200,
    'partner state writes pass through ownership filtering',
  );
  const afterAttack = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  assert.deepEqual(afterAttack.cases[1], beforeAttack.cases[1]);
  assert.equal(
    afterAttack.members.find((member) => member.id === memberId).status,
    '활성',
  );
  checks.push('forged case assignment and membership changes do not persist');

  const bucket = await mf.getR2Bucket('AI_SOURCE_FILES');
  await bucket.put('synthetic-private-file', 'SYNTHETIC_PRIVATE_CONTENT');
  await db
    .prepare(`INSERT INTO company_file_objects
    (id, storage_key, original_name, company, category, title, assigned_trainee, uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
    .bind(
      'runtime-private-file',
      'synthetic-private-file',
      'synthetic.txt',
      '가상 타인기업',
      '기타자료',
      '가상 자료',
      '가상 런타임파트너',
      `password:${peerId}`,
      'peer-runtime@example.invalid',
      'text/plain',
      25,
      new Date().toISOString(),
    )
    .run();
  await expect(
    await call('/files/runtime-private-file', undefined, { cookie }),
    403,
    'same-name legacy file download is denied',
  );
  await expect(
    await call('/files/runtime-private-file', undefined, { cookie }, 'DELETE'),
    403,
    'same-name legacy file deletion is denied',
  );
  await expect(
    await call('/files/runtime-private-file', undefined, ownerHeaders),
    200,
    'administrator retains access to ambiguous legacy files',
  );
  assert.ok(await bucket.get('synthetic-private-file'));
  checks.push('denied file deletion preserves the private R2 object');

  const suspended = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  suspended.members.find((member) => member.id === memberId).status = '정지';
  await expect(
    await call('/save', { state: suspended }, ownerHeaders, 'PUT'),
    200,
    'owner suspends partner through state handler',
  );
  await expect(
    await call('/state', undefined, { cookie }),
    403,
    'suspension blocks an already issued password session',
  );
  const restored = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  restored.members.find((member) => member.id === memberId).status = '활성';
  await expect(
    await call('/save', { state: restored }, ownerHeaders, 'PUT'),
    200,
    'owner restores synthetic partner for reset checks',
  );
  await expect(
    await call('/issue', { memberId, confirmed: true }, { cookie }),
    403,
    'partner cannot reset other accounts',
  );
  const issued = await expect(
    await call('/issue', { memberId, confirmed: true }, ownerHeaders),
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
  assert.equal(outboundRequests, 0);
  checks.push('no external network calls during the isolated pilot');
  console.log(
    JSON.stringify(
      {
        runtime: 'workerd + isolated D1/R2',
        checksPassed: checks.length,
        checks,
        liveWrites: 0,
        emailSends: 0,
        paidAIRequests: 0,
        outboundRequests,
      },
      null,
      2,
    ),
  );
} finally {
  await mf.dispose();
}
