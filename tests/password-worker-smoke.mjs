// Isolated workerd + real D1 smoke test. No live database, user account, email or paid AI is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const wrangler = require.resolve('wrangler');
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [wrangler] }),
);
const { build } = require(require.resolve('esbuild', { paths: [wrangler] }));
const bundle = await build({
  stdin: {
    contents: `
import { registerPassword, loginPassword, logoutPassword, setupPassword, createPasswordLink } from '@/lib/password-handlers';
import { GET as getState, PUT as saveState } from '@/app/api/state/route';
import { POST as registerChatGPT } from '@/app/api/register/route';
import { POST as createPartner } from '@/app/api/admin/partners/route';
import { GET as getFlow, POST as postFlow } from '@/app/api/consulting-flow/[caseId]/route';
import { GET as getFlowFile } from '@/app/api/consulting-flow/[caseId]/files/[fileId]/route';
import { GET as getFile, DELETE as deleteFile } from '@/app/api/files/[id]/route';
import { POST as uploadFile } from '@/app/api/files/route';
import { GET as intakeFiles } from '@/app/api/consulting-flow/[caseId]/intake-files/route';
import { GET as getDraft, PUT as saveDraft, DELETE as deleteDraft } from '@/app/api/application-draft/route';
import { GET as getInventory } from '@/app/api/admin/file-inventory/route';
import { GET as getInventoryPresence } from '@/app/api/admin/file-inventory/[id]/presence/route';
import { GET as previewRecovery, POST as recoverOriginal } from '@/app/api/admin/file-inventory/[id]/recovery/route';
export default { async fetch(request) {
  const pathname = new URL(request.url).pathname;
  const routes = { 'POST /signup': registerPassword, 'POST /login': loginPassword, 'POST /logout': logoutPassword, 'POST /setup': setupPassword, 'POST /issue': createPasswordLink, 'POST /chatgpt-register': registerChatGPT, 'GET /state': getState, 'PUT /save': saveState, 'POST /partners': createPartner, 'POST /files': uploadFile, 'GET /draft': getDraft, 'PUT /draft': saveDraft, 'DELETE /draft': deleteDraft };
  if (pathname === '/inventory' && request.method === 'GET') return getInventory(request);
  if (pathname.startsWith('/recovery/') && ['GET', 'POST'].includes(request.method)) return (request.method === 'GET' ? previewRecovery : recoverOriginal)(request, { params: Promise.resolve({ id: pathname.slice(10) }) });
  if (pathname.startsWith('/inventory/') && request.method === 'GET') return getInventoryPresence(request, { params: Promise.resolve({ id: pathname.slice(11) }) });
  if (pathname.startsWith('/flow-file/') && request.method === 'GET') {
    const [caseId, fileId] = pathname.slice(11).split('/');
    return getFlowFile(request, { params: Promise.resolve({ caseId, fileId }) });
  }
  if (pathname.startsWith('/flow/') && ['GET', 'POST'].includes(request.method)) return (request.method === 'GET' ? getFlow : postFlow)(request, { params: Promise.resolve({ caseId: pathname.slice(6) }) });
  if (pathname.startsWith('/intake/') && request.method === 'GET') return intakeFiles(request, { params: Promise.resolve({ caseId: pathname.slice(8) }) });
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
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'partner-hub-test',
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
  }),
);
const origin = 'https://password-runtime.example.invalid';
const email = 'runtime-synthetic@example.invalid';
const password = 'isolated runtime test secret 123!';
const ownerHeaders = {
  'oai-authenticated-user-id': 'synthetic-owner',
  'oai-authenticated-user-email': 'smkim3733@gmail.com',
};
const checks = [];
async function sha256(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : value,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
async function call(
  route,
  body,
  headers = {},
  method = body === undefined ? 'GET' : 'POST',
) {
  if (route === '/save' && body && !headers['if-match']) {
    const baseline = await mf.dispatchFetch(`${origin}/state`, { headers });
    if (baseline.ok)
      headers = {
        ...headers,
        'if-match': `"${(await baseline.json()).stateRevision}"`,
      };
  }
  return mf.dispatchFetch(`${origin}${route}`, {
    method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function callFlowFile(route, payload, file, headers = {}) {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  form.set('file', file);
  const multipart = new Response(form);
  return mf.dispatchFetch(`${origin}${route}`, {
    method: 'POST',
    headers: {
      origin,
      ...headers,
      'content-type': multipart.headers.get('content-type'),
    },
    body: await multipart.arrayBuffer(),
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
function assertPrivateAuthResponse(response) {
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0',
  );
  assert.equal(response.headers.get('expires'), '0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
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
  const peerRegistration = {
    name: '가상 런타임파트너',
    phone: '010-0000-0001',
    affiliation: '가상 다른소속',
    email: 'peer-runtime@example.invalid',
    memberType: '기타',
    confirmed: true,
    requestId: 'runtime-peer-register-001',
  };
  const peerResponse = await expect(
    await call('/partners', peerRegistration, ownerHeaders),
    201,
    'owner directly registers a distinct same-name partner',
  );
  const peerId = (await peerResponse.json()).member.id;
  const ownerBinding = await db
    .prepare(`SELECT subject_id, user_key
      FROM portal_chatgpt_identity_bindings WHERE subject_type = 'owner'`)
    .first();
  assert.equal(ownerBinding.subject_id, 'primary');
  assert.equal(
    ownerBinding.user_key,
    await sha256(`chatgpt-user:${ownerHeaders['oai-authenticated-user-id']}`),
  );
  assert.notEqual(
    ownerBinding.user_key,
    ownerHeaders['oai-authenticated-user-id'],
  );
  checks.push('owner access stores only a hashed stable ChatGPT identity');
  const originBaseline = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  await expect(
    await mf.dispatchFetch(`${origin}/save`, {
      method: 'PUT',
      headers: {
        ...ownerHeaders,
        'content-type': 'application/json',
        'if-match': `"${originBaseline.stateRevision}"`,
      },
      body: JSON.stringify({ state: originBaseline.state }),
    }),
    403,
    'missing Origin cannot mutate state through ChatGPT authentication',
  );
  await expect(
    await call('/state', undefined, {
      'oai-authenticated-user-id': 'synthetic-recycled-owner',
      'oai-authenticated-user-email':
        ownerHeaders['oai-authenticated-user-email'],
    }),
    403,
    'recycled owner email cannot inherit administrator access',
  );
  await expect(
    await call('/state', undefined, {
      ...ownerHeaders,
      'oai-authenticated-user-email': 'changed-owner@example.invalid',
    }),
    200,
    'stable owner identity survives a provider email change',
  );
  await expect(
    await call(
      '/chatgpt-register',
      {
        name: '가상 대표 중복가입',
        phone: '010-0000-0002',
        affiliation: '가상 대표소속',
        email: 'changed-owner@example.invalid',
      },
      {
        ...ownerHeaders,
        'oai-authenticated-user-email': 'changed-owner@example.invalid',
      },
    ),
    409,
    'owner stable identity cannot also bind to a partner account',
  );
  await db
    .prepare(
      "DELETE FROM portal_chatgpt_identity_bindings WHERE subject_type = 'owner'",
    )
    .run();
  const ownerRaceResponses = await Promise.all([
    call('/state', undefined, {
      'oai-authenticated-user-id': 'synthetic-owner-race-a',
      'oai-authenticated-user-email':
        ownerHeaders['oai-authenticated-user-email'],
    }),
    call('/state', undefined, {
      'oai-authenticated-user-id': 'synthetic-owner-race-b',
      'oai-authenticated-user-email':
        ownerHeaders['oai-authenticated-user-email'],
    }),
  ]);
  assert.deepEqual(
    ownerRaceResponses.map((response) => response.status).sort(),
    [200, 403],
  );
  checks.push(
    'concurrent first owner claims authorize exactly one stable identity',
  );
  await db
    .prepare(
      "DELETE FROM portal_chatgpt_identity_bindings WHERE subject_type = 'owner'",
    )
    .run();
  await expect(
    await call('/state', undefined, ownerHeaders),
    200,
    'original owner identity is restored after the synthetic claim race',
  );
  const reservedOwnerState = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  reservedOwnerState.state.members[0].email =
    ownerHeaders['oai-authenticated-user-email'];
  await expect(
    await call(
      '/save',
      { state: reservedOwnerState.state },
      ownerHeaders,
      'PUT',
    ),
    403,
    'administrator cannot assign the owner email to a partner',
  );
  const peerRetry = await expect(
    await call('/partners', peerRegistration, ownerHeaders),
    200,
    'owner direct-registration retry reuses the existing account',
  );
  assert.equal((await peerRetry.json()).replayed, true);
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
  state.tasks = [
    {
      id: 'runtime-own-task',
      company: '가상 본인기업',
      title: '본인 업무',
      kind: '내부업무',
      assignee: '가상 런타임파트너',
      due: '오늘',
      dueState: 'today',
      status: '대기',
      priority: '보통',
      related: '격리 검사',
      partnerMemberId: memberId,
    },
    {
      id: 'runtime-peer-task',
      company: '가상 타인기업',
      title: '타인 업무',
      kind: '내부업무',
      assignee: '가상 런타임파트너',
      due: '오늘',
      dueState: 'today',
      status: '대기',
      priority: '보통',
      related: '격리 검사',
      partnerMemberId: peerId,
    },
    {
      id: 'runtime-owner-task',
      company: '내부 운영',
      title: '대표 업무',
      kind: '내부업무',
      assignee: '김성민 대표',
      due: '오늘',
      dueState: 'today',
      status: '대기',
      priority: '보통',
      related: '격리 검사',
      partnerMemberId: '',
    },
    {
      id: 'runtime-linked-task',
      company: '가상 본인기업',
      title: '진행 연결 업무',
      kind: '내부업무',
      assignee: '가상 런타임파트너',
      due: '오늘',
      dueState: 'today',
      status: '진행',
      priority: '보통',
      related: '격리 검사',
      caseId: 'runtime-own',
    },
  ];
  state.schedule = [
    {
      id: 'runtime-schedule',
      date: '09.05',
      weekday: '토',
      company: '가상 타인기업',
      assignedTrainee: '가상 런타임파트너',
      partnerMemberId: peerId,
      shareMode: 'all_with_assignee',
      source: 'partner',
      time: '10:00',
      end: '11:00',
      service: '가상 런타임상담',
      method: '화상',
      status: '확정',
      tone: 'green',
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
  assert.doesNotMatch(setCookie, /Domain=/i);
  assertPrivateAuthResponse(signed);
  let cookie = setCookie.split(';')[0];
  const response = await expect(
    await call('/state', undefined, { cookie }),
    200,
    'cookie-only state access without ChatGPT headers',
  );
  const visible = await response.json();
  assert.equal(visible.currentUser.authMethod, 'password');
  assert.equal(visible.currentUser.role, 'trainee');
  assert.equal(visible.currentUser.permissions.quoteContract, false);
  assert.equal(Object.hasOwn(visible, 'applicationFunnel'), false);
  assert.equal(Object.hasOwn(visible, 'duplicateRequests'), false);
  assert.equal(Object.hasOwn(visible, 'jointAnalysisConfirmation'), false);
  assert.equal(Object.hasOwn(visible, 'documentReviewWait'), false);
  assert.equal(Object.hasOwn(visible, 'supportRequests'), false);
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
  assertPrivateAuthResponse(response);
  assert.deepEqual(
    visible.state.tasks.map((task) => task.id),
    ['runtime-own-task', 'runtime-linked-task'],
  );
  await expect(
    await call('/state', undefined, { cookie }),
    200,
    'same partner session can refresh state without a new access count',
  );
  let loginStat = await db
    .prepare(
      'SELECT last_login_at, login_count FROM portal_login_stats WHERE member_id = ?1',
    )
    .bind(memberId)
    .first();
  assert.equal(loginStat.login_count, 1);
  await db
    .prepare(
      'UPDATE portal_login_stats SET last_login_at = ?1 WHERE member_id = ?2',
    )
    .bind('2000-01-01T00:00:00.000Z', memberId)
    .run();
  await expect(
    await call('/state', undefined, { cookie }),
    200,
    'partner access after idle window starts one new session',
  );
  loginStat = await db
    .prepare(
      'SELECT last_login_at, login_count FROM portal_login_stats WHERE member_id = ?1',
    )
    .bind(memberId)
    .first();
  assert.equal(loginStat.login_count, 2);
  assert.notEqual(loginStat.last_login_at, '2000-01-01T00:00:00.000Z');
  await db
    .prepare(`CREATE TRIGGER synthetic_login_stats_failure
      BEFORE UPDATE ON portal_login_stats
      BEGIN SELECT RAISE(FAIL, 'synthetic login telemetry failure'); END`)
    .run();
  await expect(
    await call('/state', undefined, { cookie }),
    200,
    'login telemetry failure does not block authorized state access',
  );
  await db.prepare('DROP TRIGGER synthetic_login_stats_failure').run();
  const runtimeDraft = {
    companyName: '가상 임시기업',
    applicantName: '가상 런타임파트너',
    applicantType: '한기평 컨설턴트',
    partnerMemberId: memberId,
    selectedServices: ['정책자금'],
    step: 2,
    hasLocalAttachments: true,
    details: {
      version: 1,
      relationship: '직접 상담 중',
      collaborator: '',
      message: '작성 중',
      registrationNumber: '123-',
      representative: '',
      companyType: '법인사업자',
      business: '',
      location: '',
      contactName: '',
      contactPhone: '',
      requestedStart: '',
      urgency: '일반',
      requestBackground: '',
    },
  };
  const draftId = 'runtime-private-draft';
  const savedDraft = await expect(
    await call(
      '/draft',
      {
        revision: 0,
        draftId,
        expectedUserId: visible.currentUser.id,
        draft: runtimeDraft,
      },
      { cookie },
      'PUT',
    ),
    200,
    'cookie account privately saves a partial application draft',
  );
  assert.equal(
    (await savedDraft.json()).draft.details.registrationNumber,
    '123-',
  );
  assert.equal(
    (await (await call('/draft', undefined, { cookie })).json()).draft
      .hasLocalAttachments,
    true,
  );
  assert.equal(
    (await (await call('/draft', undefined, ownerHeaders)).json()).draft,
    null,
  );
  checks.push('another account cannot retrieve the private application draft');
  const changes = await Promise.all([
    call(
      '/draft',
      {
        revision: 1,
        draftId,
        expectedUserId: visible.currentUser.id,
        draft: { ...runtimeDraft, companyName: '가상 변경 A' },
      },
      { cookie },
      'PUT',
    ),
    call(
      '/draft',
      {
        revision: 1,
        draftId,
        expectedUserId: visible.currentUser.id,
        draft: { ...runtimeDraft, companyName: '가상 변경 B' },
      },
      { cookie },
      'PUT',
    ),
  ]);
  assert.deepEqual(
    changes.map((item) => item.status).sort((a, b) => a - b),
    [200, 409],
  );
  checks.push(
    'same-account draft edits from two windows cannot overwrite each other',
  );
  const draftRevision = (
    await (await call('/draft', undefined, { cookie })).json()
  ).revision;
  const submittedDraftState = (
    await (await call('/state', undefined, { cookie })).json()
  ).state;
  submittedDraftState.cases.push({
    id: `case-draft-${draftId}`,
    applicationDraftRevision: draftRevision,
    company: '가상 임시기업',
    service: '정책자금',
    trainee: '가상 런타임파트너',
    partnerMemberId: memberId,
  });
  await expect(
    await call('/save', { state: submittedDraftState }, { cookie }, 'PUT'),
    200,
    'draft uses a stable case ID for final submission',
  );
  const submittedPartnerState = await (
    await call('/state', undefined, { cookie })
  ).json();
  const submittedCase = submittedPartnerState.state.cases.find(
    (item) => item.id === `case-draft-${draftId}`,
  );
  assert.equal(submittedCase.submissionTrackingVersion, 1);
  assert.match(
    submittedCase.submittedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.equal(submittedCase.pipelineLifecycleVersion, 1);
  assert.equal(submittedCase.pipelineLifecycleStatus, 'active');
  assert.equal(submittedCase.pipelineHighestStage, '접수');
  assert.equal(submittedCase.pipelineStageSource, 'manual_reported');
  assert.equal(
    Object.hasOwn(submittedPartnerState, 'applicationFunnel'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedPartnerState, 'duplicateRequests'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedPartnerState, 'jointAnalysisConfirmation'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedPartnerState, 'documentReviewWait'),
    false,
  );
  assert.equal(Object.hasOwn(submittedPartnerState, 'supportRequests'), false);
  assert.equal(Object.hasOwn(submittedPartnerState, 'pipelineDropoff'), false);
  const submittedOwnerState = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  assert.equal(submittedOwnerState.applicationFunnel.trackedApplications, 1);
  assert.equal(submittedOwnerState.applicationFunnel.flowStarted, 0);
  assert.equal(submittedOwnerState.duplicateRequests.windowDays, 7);
  assert.equal(
    submittedOwnerState.jointAnalysisConfirmation.flowsWithFirstReport,
    0,
  );
  assert.equal(submittedOwnerState.documentReviewWait.requestsCreated, 0);
  assert.equal(submittedOwnerState.supportRequests.trackedRequests, 0);
  assert.equal(submittedOwnerState.pipelineDropoff.trackedCases, 1);
  assert.equal(submittedOwnerState.pipelineDropoff.manualReported.cases, 1);
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'applicationFunnel'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'duplicateRequests'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'jointAnalysisConfirmation'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'documentReviewWait'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'supportRequests'),
    false,
  );
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'pipelineDropoff'),
    false,
  );
  submittedCase.pipelineLifecycleStatus = 'discontinued';
  await expect(
    await call(
      '/save',
      { state: submittedPartnerState.state },
      { cookie },
      'PUT',
    ),
    200,
    'partner cannot create a pipeline discontinuation event',
  );
  const protectedPipelineCase = (
    await (await call('/state', undefined, { cookie })).json()
  ).state.cases.find((item) => item.id === `case-draft-${draftId}`);
  assert.equal(protectedPipelineCase.pipelineLifecycleStatus, 'active');
  checks.push(
    'server stamps application submission time and exposes only aggregate funnel data to the administrator',
  );
  assert.equal(
    (await (await call('/draft', undefined, { cookie })).json())
      .submittedCaseId,
    `case-draft-${draftId}`,
  );
  await expect(
    await call(
      '/draft',
      {
        revision: draftRevision,
        draftId,
        expectedUserId: visible.currentUser.id,
      },
      { cookie },
      'DELETE',
    ),
    200,
    'draft cleanup preserves its submitted case',
  );
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
  const staleBaseline = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  const firstWindow = structuredClone(staleBaseline.state);
  firstWindow.consultationNumber += 1;
  await expect(
    await call(
      '/save',
      { state: firstWindow },
      { ...ownerHeaders, 'if-match': `"${staleBaseline.stateRevision}"` },
      'PUT',
    ),
    200,
    'first browser window saves against its current revision',
  );
  const staleWindow = structuredClone(staleBaseline.state);
  staleWindow.tasks.push({
    ...staleWindow.tasks[2],
    id: 'stale-window-task',
    title: '오래된 창 업무',
  });
  const staleResponse = await expect(
    await call(
      '/save',
      { state: staleWindow },
      { ...ownerHeaders, 'if-match': `"${staleBaseline.stateRevision}"` },
      'PUT',
    ),
    409,
    'stale browser window cannot replace a newer portal state',
  );
  const stalePayload = await staleResponse.json();
  assert.match(stalePayload.recoveryReceipt, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(stalePayload.recoveryReceiptExpiresInSeconds, 86_400);
  const receiptRecord = await db
    .prepare(
      `SELECT token_hash, source, kind, actor_role, started_at, expires_at
       FROM portal_conflict_receipts WHERE source = 'state_save'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .first();
  assert.match(receiptRecord.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(receiptRecord.token_hash, stalePayload.recoveryReceipt);
  assert.deepEqual(Object.keys(receiptRecord).sort(), [
    'actor_role',
    'expires_at',
    'kind',
    'source',
    'started_at',
    'token_hash',
  ]);
  checks.push('native D1 stores only the anonymous conflict receipt hash');
  const conflictRecoveryBaseline = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  const receiptRecoveredState = structuredClone(conflictRecoveryBaseline.state);
  receiptRecoveredState.tasks.push({
    ...receiptRecoveredState.tasks[2],
    id: 'recovered-window-task',
    title: '복구된 창 업무',
  });
  await expect(
    await call(
      '/save',
      { state: receiptRecoveredState },
      {
        ...ownerHeaders,
        'if-match': `"${conflictRecoveryBaseline.stateRevision}"`,
        'x-portal-conflict-receipt': stalePayload.recoveryReceipt,
      },
      'PUT',
    ),
    200,
    'same-route successful retry presents the conflict receipt',
  );
  assert.equal(
    (
      await db
        .prepare(
          `SELECT SUM(recovered_count) AS count
           FROM portal_conflict_recovery_stats
           WHERE source = 'state_save' AND actor_role = 'admin'`,
        )
        .first()
    ).count,
    1,
  );
  const receiptReplayBaseline = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  await expect(
    await call(
      '/save',
      { state: receiptReplayBaseline.state },
      {
        ...ownerHeaders,
        'if-match': `"${receiptReplayBaseline.stateRevision}"`,
        'x-portal-conflict-receipt': stalePayload.recoveryReceipt,
      },
      'PUT',
    ),
    200,
    'used conflict receipt cannot disrupt a later successful save',
  );
  assert.equal(
    (
      await db
        .prepare(
          `SELECT SUM(recovered_count) AS count
           FROM portal_conflict_recovery_stats
           WHERE source = 'state_save' AND actor_role = 'admin'`,
        )
        .first()
    ).count,
    1,
  );
  checks.push('native D1 conflict receipt is counted exactly once');
  assert.ok(
    !(
      await db.prepare('SELECT payload FROM portal_state').first()
    ).payload.includes('stale-window-task'),
  );
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

  async function uploadSource(
    headers,
    partnerMemberId,
    caseId,
    sourceText = 'SYNTHETIC_NEW_ACCOUNT_FILE',
    reportedContentType = 'text/plain',
    fileName = 'synthetic.txt',
  ) {
    const form = new FormData();
    form.set(
      'file',
      new File([sourceText], fileName, {
        type: reportedContentType,
      }),
    );
    form.set('company', '가상 본인기업');
    form.set('title', '새 담당계정 자료');
    form.set('category', '기타자료');
    form.set('assignedTrainee', '가상 런타임파트너');
    form.set('consent', 'confirmed');
    if (partnerMemberId !== undefined)
      form.set('partnerMemberId', partnerMemberId);
    if (caseId !== undefined) form.set('caseId', caseId);
    const multipart = new Response(form);
    return mf.dispatchFetch(`${origin}/files`, {
      method: 'POST',
      headers: {
        origin,
        ...headers,
        'content-type': multipart.headers.get('content-type'),
      },
      body: await multipart.arrayBuffer(),
    });
  }
  const normalizedFile = (
    await (
      await expect(
        await uploadSource(
          {
            cookie,
            'idempotency-key': 'worker-upload-mime-normalization',
          },
          memberId,
          undefined,
          'SYNTHETIC_MIME_NORMALIZATION',
          'text/html',
        ),
        201,
        'browser MIME is normalized before private storage',
      )
    ).json()
  ).file;
  assert.equal(normalizedFile.contentType, 'text/plain');
  assert.equal(
    (await bucket.head(`company-source/${normalizedFile.id}`)).httpMetadata
      .contentType,
    'text/plain',
  );
  assert.equal(
    (
      await db
        .prepare('SELECT content_type FROM company_file_objects WHERE id = ?1')
        .bind(normalizedFile.id)
        .first()
    ).content_type,
    'text/plain',
  );
  checks.push('registry MIME is identical across response, native D1 and R2');
  const bridgeCaseId = 'runtime-upload-key-migration';
  const bridgeText = 'SYNTHETIC_UPLOAD_KEY_MIGRATION';
  const bridgeFileName = '한글자료.txt'.normalize('NFC');
  const bridgeLegacyFileName = bridgeFileName.normalize('NFD');
  const bridgeBytes = new TextEncoder().encode(bridgeText);
  const bridgeBytesDigest = await sha256(bridgeBytes);
  const bridgeKeyFor = (fileName, contentType) =>
    sha256(
      JSON.stringify([
        'company-upload-v1',
        bridgeCaseId,
        fileName,
        contentType,
        bridgeBytes.byteLength,
        '가상 본인기업',
        '새 담당계정 자료',
        '기타자료',
        memberId,
        '',
        bridgeBytesDigest,
      ]),
    );
  const bridgeLegacyKey = await bridgeKeyFor(
    bridgeLegacyFileName,
    'text/plain',
  );
  const bridgeCurrentKey = await bridgeKeyFor(bridgeFileName, 'text/plain');
  const bridgeLegacyFingerprint = await sha256(
    JSON.stringify({
      originalName: bridgeFileName,
      company: '가상 본인기업',
      title: '새 담당계정 자료',
      category: '기타자료',
      assignedTrainee: '가상 런타임파트너',
      partnerMemberId: memberId,
      caseId: bridgeCaseId,
      contentType: 'text/plain',
      sizeBytes: bridgeBytes.byteLength,
    }) + bridgeBytesDigest,
  );
  await db
    .prepare(`INSERT INTO company_file_upload_requests
      (owner_key, request_key, fingerprint, file_id, created_at, status)
      VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`)
    .bind(
      `member:${memberId}`,
      bridgeLegacyKey,
      bridgeLegacyFingerprint,
      'runtime-upload-key-migration-file',
      new Date().toISOString(),
    )
    .run();
  const bridgedFile = (
    await (
      await expect(
        await uploadSource(
          { cookie, 'idempotency-key': bridgeCurrentKey },
          memberId,
          bridgeCaseId,
          bridgeText,
          'text/plain',
          bridgeLegacyFileName,
        ),
        201,
        'normalized application filename key resumes previous native D1 ledger',
      )
    ).json()
  ).file;
  assert.equal(bridgedFile.id, 'runtime-upload-key-migration-file');
  assert.equal(
    await db
      .prepare(
        'SELECT request_key FROM company_file_upload_requests WHERE owner_key = ?1 AND request_key = ?2',
      )
      .bind(`member:${memberId}`, bridgeLegacyKey)
      .first(),
    null,
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT status FROM company_file_upload_requests WHERE owner_key = ?1 AND request_key = ?2',
        )
        .bind(`member:${memberId}`, bridgeCurrentKey)
        .first()
    ).status,
    'ready',
  );
  checks.push(
    'application filename key migration preserves one native R2 object',
  );
  const retryHeaders = {
    cookie,
    'idempotency-key': 'worker-upload-response-retry',
  };
  const retryFile = (
    await (
      await expect(
        await uploadSource(retryHeaders, memberId, 'runtime-own'),
        201,
        'idempotent upload creates a private original',
      )
    ).json()
  ).file;
  const recoveredFile = (
    await (
      await expect(
        await uploadSource(retryHeaders, memberId, 'runtime-own'),
        201,
        'lost upload response recovers the existing file ID',
      )
    ).json()
  ).file;
  assert.deepEqual(recoveredFile, retryFile);
  const concurrentHeaders = {
    cookie,
    'idempotency-key': 'worker-concurrent-upload',
  };
  const concurrentFiles = await Promise.all([
    uploadSource(concurrentHeaders, memberId),
    uploadSource(concurrentHeaders, memberId),
  ]);
  assert.deepEqual(
    concurrentFiles.map((r) => r.status),
    [201, 201],
  );
  assert.equal(
    (await concurrentFiles[0].json()).file.id,
    (await concurrentFiles[1].json()).file.id,
  );
  checks.push('concurrent native D1/R2 uploads converge on one original');
  await expect(
    await uploadSource(
      retryHeaders,
      memberId,
      'runtime-own',
      'CHANGED_ORIGINAL',
    ),
    409,
    'same request key cannot replace original bytes',
  );
  await expect(
    await call(`/files/${retryFile.id}`, undefined, { cookie }, 'DELETE'),
    204,
    'authorized deletion tombstones the original',
  );
  await expect(
    await uploadSource(retryHeaders, memberId, 'runtime-own'),
    409,
    'deleted original cannot be recreated by a delayed upload retry',
  );
  assert.equal(await bucket.get(`company-source/${retryFile.id}`), null);
  checks.push('deleted original stays absent from private R2');
  const linked = await expect(
    await uploadSource({ cookie }, peerId),
    201,
    'multipart upload binds same-name file to authenticated account',
  );
  const linkedFile = (await linked.json()).file;
  await expect(
    await call('/inventory'),
    401,
    'anonymous inventory access is denied',
  );
  await expect(
    await call('/inventory', undefined, { cookie }),
    403,
    'partner inventory access is denied even with file permission',
  );
  const inventory = await (
    await expect(
      await call('/inventory?status=all', undefined, ownerHeaders),
      200,
      'administrator reads bounded private inventory metadata',
    )
  ).json();
  assert.ok(
    inventory.items.some(
      (item) => item.id === linkedFile.id && item.status === 'unlinked',
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(inventory),
    /storage_key|fingerprint|request_key|company-source\//,
  );
  await expect(
    await call(`/inventory/${linkedFile.id}`, undefined, { cookie }),
    403,
    'partner cannot probe inventory object presence',
  );
  const inventoryPresence = await (
    await expect(
      await call(`/inventory/${linkedFile.id}`, undefined, ownerHeaders),
      200,
      'administrator checks native R2 head without reading original bytes',
    )
  ).json();
  assert.equal(inventoryPresence.exists, true);
  assert.equal(inventoryPresence.sizeMatches, true);
  await db
    .prepare(
      "INSERT INTO company_file_upload_requests (owner_key, request_key, fingerprint, file_id, created_at, status) VALUES (?1, 'worker-inventory-request', 'private-fingerprint', 'worker-inventory-pending', ?2, 'pending')",
    )
    .bind(`member:${memberId}`, new Date().toISOString())
    .run();
  await bucket.put(
    'company-source/worker-inventory-pending',
    'SYNTHETIC_PENDING_BYTES',
  );
  const pendingInventory = await (
    await call('/inventory?status=pending', undefined, ownerHeaders)
  ).json();
  assert.ok(
    pendingInventory.items.some(
      (item) =>
        item.id === 'worker-inventory-pending' && item.fileName === null,
    ),
  );
  const pendingPresence = await (
    await expect(
      await call(
        '/inventory/worker-inventory-pending',
        undefined,
        ownerHeaders,
      ),
      200,
      'pending-only ledger original can be checked without invented metadata',
    )
  ).json();
  assert.equal(pendingPresence.exists, true);
  assert.equal(pendingPresence.expectedSizeBytes, null);
  assert.equal(linkedFile.partnerMemberId, memberId);
  assert.equal(
    (
      await db
        .prepare(
          'SELECT partner_member_id FROM company_file_assignments WHERE file_id = ?1',
        )
        .bind(linkedFile.id)
        .first()
    ).partner_member_id,
    memberId,
  );
  const linkedDownload = await expect(
    await call(`/files/${linkedFile.id}`, undefined, { cookie }),
    200,
    'same-name uploader downloads their new file',
  );
  assert.equal(
    linkedDownload.headers.get('content-disposition'),
    "attachment; filename*=UTF-8''synthetic.txt",
  );
  assert.equal(linkedDownload.headers.get('content-type'), 'text/plain');
  const peerHeaders = {
    'oai-authenticated-user-id': 'synthetic-peer',
    'oai-authenticated-user-email': 'peer-runtime@example.invalid',
  };
  await expect(
    await call(`/files/${linkedFile.id}`, undefined, peerHeaders),
    403,
    'other same-name account cannot download new ID-linked file',
  );
  await expect(
    await call(`/files/${linkedFile.id}`, undefined, peerHeaders, 'DELETE'),
    403,
    'other same-name account cannot delete new ID-linked file',
  );
  await expect(
    await uploadSource(ownerHeaders),
    400,
    'ambiguous administrator name requires explicit account selection',
  );
  await expect(
    await uploadSource(ownerHeaders, 'nonexistent-member'),
    400,
    'invalid administrator file account is rejected',
  );
  const adminCreated = await expect(
    await uploadSource(ownerHeaders, memberId),
    201,
    'administrator explicitly assigns a same-name account',
  );
  const adminFile = (await adminCreated.json()).file;
  await expect(
    await call(`/files/${adminFile.id}`, undefined, { cookie }),
    200,
    'selected partner downloads administrator-uploaded file',
  );
  const adminOnly = await expect(
    await uploadSource(ownerHeaders, ''),
    201,
    'explicit administrator-only file is stored with no partner grant',
  );
  const adminOnlyFile = (await adminOnly.json()).file;
  await expect(
    await call(`/files/${adminOnlyFile.id}`, undefined, { cookie }),
    403,
    'administrator-only file rejects name-based partner access',
  );
  await expect(
    await call(`/files/${linkedFile.id}`, undefined, { cookie }, 'DELETE'),
    204,
    'uploader can delete their own ID-linked file',
  );
  assert.equal(
    await db
      .prepare(
        'SELECT file_id FROM company_file_assignments WHERE file_id = ?1',
      )
      .bind(linkedFile.id)
      .first(),
    null,
  );
  assert.equal(await bucket.get(`company-source/${linkedFile.id}`), null);
  const repeatA = await expect(
    await uploadSource({ cookie }, memberId, 'runtime-repeat-a'),
    201,
    'first repeated application file stores its proposed case ID',
  );
  const repeatB = await expect(
    await uploadSource({ cookie }, memberId, 'runtime-repeat-b'),
    201,
    'second repeated application file stores a distinct case ID',
  );
  const repeatFileA = (await repeatA.json()).file;
  const repeatFileB = (await repeatB.json()).file;
  const repeatState = (
    await (await call('/state', undefined, { cookie })).json()
  ).state;
  const applicationDetails = {
    version: 1,
    relationship: '기존 고객',
    collaborator: '가상 협업 메모',
    message: '가상 전달사항',
    registrationNumber: '0000000000',
    representative: '가상 대표',
    companyType: '법인사업자',
    business: '가상 제조',
    location: '가상시',
    contactName: '가상 담당',
    contactPhone: '010-0000-0000',
    requestedStart: '2026-09-01',
    urgency: '긴급',
    requestBackground: '가상 요청 배경',
  };
  for (const file of [repeatFileA, repeatFileB]) {
    repeatState.cases.push({
      id: file.caseId,
      company: '가상 본인기업',
      trainee: '가상 런타임파트너',
      partnerMemberId: memberId,
      service: '정책자금',
      applicationDetails,
    });
    repeatState.companyDocuments.push({
      id: `doc-${file.id}`,
      company: '가상 본인기업',
      title: `가상 반복 신청자료 ${file.id}`,
      category: '기타자료',
      status: '제출완료',
      assignedTrainee: file.assignedTrainee,
      submittedBy: file.assignedTrainee,
      updatedAt: '방금 전',
      version: '-',
      sensitive: false,
      partnerMemberId: memberId,
      caseId: file.caseId,
      storageFileId: file.id,
      fileName: file.fileName,
      fileSize: file.sizeBytes,
    });
    repeatState.timeline.push({
      caseId: file.caseId,
      date: '2026-08-31',
      title: '협업신청 접수',
      detail: file.caseId,
      type: '접수',
      tone: 'navy',
    });
  }
  await expect(
    await call('/save', { state: repeatState }, { cookie }, 'PUT'),
    200,
    'same-company cases, timelines and attachments persist together',
  );
  const repeatReload = (
    await (await call('/state', undefined, { cookie })).json()
  ).state;
  assert.ok(repeatReload.cases.some((item) => item.id === 'runtime-repeat-a'));
  assert.ok(repeatReload.cases.some((item) => item.id === 'runtime-repeat-b'));
  assert.deepEqual(
    repeatReload.cases.find((item) => item.id === 'runtime-repeat-a')
      .applicationDetails,
    applicationDetails,
  );
  checks.push(
    'all submitted company and request fields survive a real D1 reload',
  );
  const invalidApplicationState = structuredClone(repeatState);
  invalidApplicationState.cases.find(
    (item) => item.id === 'runtime-repeat-a',
  ).applicationDetails.requestBackground = '';
  const beforeInvalidDetails = (
    await db.prepare('SELECT payload FROM portal_state').first()
  ).payload;
  await expect(
    await call('/save', { state: invalidApplicationState }, { cookie }, 'PUT'),
    400,
    'invalid application details are rejected before writing',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    beforeInvalidDetails,
  );
  assert.deepEqual(
    repeatReload.companyDocuments.map((item) => item.caseId).sort(),
    ['runtime-repeat-a', 'runtime-repeat-b'],
  );
  const repeatIdentity = (
    await (await call('/state', undefined, { cookie })).json()
  ).currentUser.id;
  await expect(
    await call(
      '/save',
      { state: repeatState, expectedUserId: repeatIdentity },
      { cookie },
      'PUT',
    ),
    200,
    'retry after an uncertain response keeps the original application and uploaded file IDs',
  );
  const retried = (await (await call('/state', undefined, { cookie })).json())
    .state;
  for (const field of ['cases', 'timeline', 'companyDocuments'])
    assert.deepEqual(retried[field], repeatReload[field]);
  const beforeWrongIdentity = (
    await db.prepare('SELECT payload FROM portal_state').first()
  ).payload;
  await expect(
    await call(
      '/save',
      { state: repeatState, expectedUserId: repeatIdentity },
      ownerHeaders,
      'PUT',
    ),
    403,
    'a different authenticated account cannot resume the original page save',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    beforeWrongIdentity,
  );
  const intakeA = await expect(
    await call('/intake/runtime-repeat-a', undefined, ownerHeaders),
    200,
    'administrator lists sources for the first repeat application',
  );
  const intakeIdsA = (await intakeA.json()).files.map((file) => file.id);
  assert.ok(intakeIdsA.includes(repeatFileA.id));
  assert.ok(!intakeIdsA.includes(repeatFileB.id));
  await expect(
    await call(
      `/intake/runtime-repeat-a?fileId=${repeatFileB.id}`,
      undefined,
      ownerHeaders,
    ),
    404,
    'source from another same-company application cannot be imported',
  );
  await expect(
    await call(
      `/intake/runtime-repeat-a?fileId=${repeatFileA.id}`,
      undefined,
      ownerHeaders,
    ),
    200,
    'source from the matching application remains usable',
  );
  await expect(
    await uploadSource({ cookie }, memberId, 'runtime-peer'),
    403,
    'upload cannot link a new private source to another account case',
  );
  const legacyV115UserKey = await sha256(
    'chatgpt-user:legacy-v115-migration-user',
  );
  await db
    .prepare(`INSERT INTO portal_chatgpt_member_bindings
      (member_id, user_key, created_at, updated_at)
      VALUES ('legacy-v115-member', ?1, ?2, ?2)`)
    .bind(legacyV115UserKey, new Date().toISOString())
    .run();
  // Reapply every migration with existing legacy, account and case-linked rows in place.
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
  assert.equal(
    (
      await db
        .prepare(
          'SELECT partner_member_id FROM company_file_assignments WHERE file_id = ?1',
        )
        .bind(adminFile.id)
        .first()
    ).partner_member_id,
    memberId,
  );
  assert.ok(await bucket.get('synthetic-private-file'));
  assert.equal(
    (
      await db
        .prepare(
          'SELECT case_id FROM company_file_case_links WHERE file_id = ?1',
        )
        .bind(repeatFileA.id)
        .first()
    ).case_id,
    'runtime-repeat-a',
  );
  assert.equal(
    await db
      .prepare('SELECT file_id FROM company_file_case_links WHERE file_id = ?1')
      .bind('runtime-private-file')
      .first(),
    null,
  );
  assert.equal(
    await db
      .prepare(
        'SELECT file_id FROM company_file_assignments WHERE file_id = ?1',
      )
      .bind('runtime-private-file')
      .first(),
    null,
  );
  const migratedV115Binding = await db
    .prepare(`SELECT subject_type, subject_id, user_key
      FROM portal_chatgpt_identity_bindings WHERE user_key = ?1`)
    .bind(legacyV115UserKey)
    .first();
  assert.equal(migratedV115Binding.subject_type, 'member');
  assert.equal(migratedV115Binding.subject_id, 'legacy-v115-member');
  checks.push(
    'version 115 member bindings migrate into the unified identity table',
  );
  checks.push(
    'migration replay preserves ID assignment and leaves legacy file ownership untouched',
  );

  const recoverySource = (
    await (
      await expect(
        await uploadSource(
          { cookie, 'idempotency-key': 'worker-recovery-request-0001' },
          memberId,
          'runtime-own',
        ),
        201,
        'upload keeps the proposed case link before recovery',
      )
    ).json()
  ).file;
  const recoveryPath = `/recovery/${recoverySource.id}`;
  await expect(
    await call(recoveryPath),
    401,
    'anonymous original recovery preview is denied',
  );
  await expect(
    await call(recoveryPath, undefined, { cookie }),
    403,
    'partner original recovery preview is denied',
  );
  const recoveryPreview = await (
    await expect(
      await call(recoveryPath, undefined, ownerHeaders),
      200,
      'administrator previews an original against its recorded existing case',
    )
  ).json();
  const recoveryBaseline = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  const recoveryBody = {
    ...recoveryPreview,
    expectedUserId: recoveryBaseline.currentUser.id,
    requestId: 'native-recovery-confirmation-0001',
    confirmed: true,
    reason: '가상 원본과 기업 및 담당 계정 대조 완료',
  };
  await expect(
    await call(recoveryPath, recoveryBody, { cookie }),
    403,
    'partner cannot confirm recovery',
  );
  await expect(
    await call(
      recoveryPath,
      { ...recoveryBody, caseId: 'runtime-peer' },
      ownerHeaders,
    ),
    409,
    'recovery cannot move an original to a different case',
  );
  await expect(
    await call(recoveryPath, recoveryBody, ownerHeaders),
    200,
    'native D1 atomically saves recovered document and timeline',
  );
  const replayRecovery = await (
    await expect(
      await call(recoveryPath, recoveryBody, ownerHeaders),
      200,
      'same recovery confirmation is idempotent after the response',
    )
  ).json();
  assert.equal(replayRecovery.alreadyLinked, true);
  const recoveredState = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  );
  assert.equal(
    recoveredState.companyDocuments.filter(
      (item) => item.storageFileId === recoverySource.id,
    ).length,
    1,
  );
  assert.equal(
    recoveredState.timeline.filter(
      (item) => item.recoveryFileId === recoverySource.id,
    ).length,
    1,
  );
  assert.equal(
    await (await bucket.get(`company-source/${recoverySource.id}`)).text(),
    'SYNTHETIC_NEW_ACCOUNT_FILE',
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT partner_member_id FROM company_file_assignments WHERE file_id = ?1',
        )
        .bind(recoverySource.id)
        .first()
    ).partner_member_id,
    memberId,
  );
  checks.push(
    'native recovery preserves original bytes and partner ownership with one document and audit',
  );
  await expect(
    await call(
      '/save',
      { state: recoveryBaseline.state },
      { ...ownerHeaders, 'if-match': `"${recoveryPreview.stateRevision}"` },
      'PUT',
    ),
    409,
    'older state cannot overwrite a recovered document',
  );

  for (const { roleName, headers } of [
    { roleName: 'administrator', headers: ownerHeaders },
    { roleName: 'partner', headers: { cookie } },
  ]) {
    const beforeProofEdit = (
      await (await call('/state', undefined, headers)).json()
    ).state;
    const forgedProof = structuredClone(beforeProofEdit);
    forgedProof.companyDocuments.find(
      (item) => item.storageFileId === recoverySource.id,
    ).recovery.reason = 'forged reason';
    forgedProof.timeline.find(
      (item) => item.recoveryFileId === recoverySource.id,
    ).detail = 'forged event';
    await expect(
      await call('/save', { state: forgedProof }, headers, 'PUT'),
      409,
      `${roleName} cannot rewrite server recovery evidence through state save`,
    );
    const normalReview = structuredClone(beforeProofEdit);
    normalReview.companyDocuments.find(
      (item) => item.storageFileId === recoverySource.id,
    ).status = roleName === 'administrator' ? '보완필요' : '검토완료';
    await expect(
      await call('/save', { state: normalReview }, headers, 'PUT'),
      200,
      `${roleName} can still update review status of a recovered document`,
    );
  }
  const fakeProofState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  fakeProofState.timeline.push({
    id: 'fake-recovery-event',
    caseId: 'runtime-own',
    date: '2026-08-31T02:00:00Z',
    title: '위조 확인',
    detail: '위조 회수 기록',
    type: '서류',
    tone: 'blue',
    recoveryFileId: 'fake-file',
  });
  await expect(
    await call('/save', { state: fakeProofState }, ownerHeaders, 'PUT'),
    409,
    'ordinary state saves cannot invent a new recovery audit event',
  );
  await expect(
    await call(recoveryPath, recoveryBody, ownerHeaders),
    200,
    'protected proof remains valid for the original idempotent recovery request',
  );

  const renameState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  renameState.members.find((member) => member.id === memberId).name =
    '가상 변경이름';
  await expect(
    await call('/save', { state: renameState }, ownerHeaders, 'PUT'),
    200,
    'administrator renames partner without reassigning tasks',
  );
  const renamedTasks = await expect(
    await call('/state', undefined, { cookie }),
    200,
    'existing cookie still receives account-assigned tasks after rename',
  );
  const renamedVisible = await renamedTasks.json();
  assert.deepEqual(
    renamedVisible.state.tasks.map((task) => task.id),
    ['runtime-own-task', 'runtime-linked-task'],
  );
  assert.equal(renamedVisible.currentUser.memberName, '가상 변경이름');
  renamedVisible.state.tasks.find(
    (task) => task.id === 'runtime-linked-task',
  ).status = '완료';
  await expect(
    await call('/save', { state: renamedVisible.state }, { cookie }, 'PUT'),
    200,
    'partner completes a case-linked follow-up without a legacy assignee name',
  );
  const taskSaved = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  assert.equal(
    taskSaved.tasks.find((task) => task.id === 'runtime-linked-task').status,
    '완료',
  );
  assert.equal(
    taskSaved.tasks.find((task) => task.id === 'runtime-peer-task').status,
    '대기',
  );
  assert.equal(
    taskSaved.tasks.find((task) => task.id === 'runtime-owner-task').status,
    '대기',
  );

  const nativeFlow = (
    await (await call('/flow/runtime-own', undefined, ownerHeaders)).json()
  ).flow;
  const nativeCommand = {
    revision: nativeFlow.revision,
    commandId: 'native-flow-report-retry',
    command: {
      type: 'save_report',
      stage: 1,
      body: '격리 런타임에서 확인하는 가상 보고서입니다. 실제 기업자료나 외부 AI 처리를 사용하지 않습니다. '.repeat(
        4,
      ),
    },
  };
  const nativeSaved = await expect(
    await call('/flow/runtime-own', nativeCommand, ownerHeaders),
    200,
    'FLOW report commits with native D1 authorization guard',
  );
  const nativeSavedFlow = (await nativeSaved.json()).flow;
  const nativeRetry = await expect(
    await call('/flow/runtime-own', nativeCommand, ownerHeaders),
    200,
    'identical FLOW retry reuses its native receipt',
  );
  const nativeRetried = await nativeRetry.json();
  assert.equal(nativeRetried.duplicate, true);
  assert.equal(
    nativeRetried.flow.reports.length,
    nativeSavedFlow.reports.length,
  );
  assert.equal(nativeRetried.flow.commandReceipts, undefined);
  checks.push(
    'FLOW retry does not duplicate reports or expose internal receipts',
  );
  await expect(
    await call(
      '/flow/runtime-own',
      {
        ...nativeCommand,
        command: {
          ...nativeCommand.command,
          body: nativeCommand.command.body + '변경',
        },
      },
      ownerHeaders,
    ),
    409,
    'same FLOW request ID rejects changed report contents',
  );
  await expect(
    await call('/flow/runtime-own', nativeCommand, { cookie }),
    403,
    'partner cannot reuse an administrator FLOW receipt',
  );
  const beforeMimeFlow = (
    await (await call('/flow/runtime-own', undefined, ownerHeaders)).json()
  ).flow;
  const mimeCommand = {
    revision: beforeMimeFlow.revision,
    commandId: 'native-flow-mime-retry',
    command: {
      type: 'save_report',
      stage: 1,
      body: nativeCommand.command.body,
      fileConsent: true,
    },
  };
  const flowFileName = '분석자료.txt'.normalize('NFC');
  const mimeSaved = await expect(
    await callFlowFile(
      '/flow/runtime-own',
      mimeCommand,
      new File(['SYNTHETIC_FLOW_MIME'], flowFileName.normalize('NFD'), {
        type: 'text/html',
      }),
      ownerHeaders,
    ),
    200,
    'FLOW receipt normalizes filename and browser MIME in native D1',
  );
  const mimeSavedFlow = (await mimeSaved.json()).flow;
  assert.equal(mimeSavedFlow.files.at(-1).contentType, 'text/plain');
  const privateMimeFlow = JSON.parse(
    (
      await db
        .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
        .bind('runtime-own')
        .first()
    ).payload,
  );
  const privateMimeFile = privateMimeFlow.files.at(-1);
  assert.equal(
    (await bucket.head(privateMimeFile.key)).httpMetadata.contentType,
    'text/plain',
  );
  const flowFileBytes = new TextEncoder().encode('SYNTHETIC_FLOW_MIME');
  await bucket.put(
    privateMimeFile.key,
    flowFileBytes.subarray(0, flowFileBytes.byteLength - 1),
  );
  const corruptFlowDownload = await expect(
    await call(
      `/flow-file/runtime-own/${privateMimeFile.id}`,
      undefined,
      ownerHeaders,
    ),
    409,
    'FLOW attachment download rejects a native R2 body with the wrong size',
  );
  assertPrivateAuthResponse(corruptFlowDownload);
  assert.match((await corruptFlowDownload.json()).error, /보관 상태/);
  assert.equal(
    JSON.parse(
      (
        await db
          .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
          .bind('runtime-own')
          .first()
      ).payload,
    ).files.at(-1).size,
    flowFileBytes.byteLength,
  );
  checks.push('corrupt FLOW download denial preserves stored file size');
  await bucket.put(privateMimeFile.key, flowFileBytes, {
    httpMetadata: { contentType: 'text/plain' },
  });
  const restoredFlowDownload = await expect(
    await call(
      `/flow-file/runtime-own/${privateMimeFile.id}`,
      undefined,
      ownerHeaders,
    ),
    200,
    'FLOW attachment download resumes after native R2 size is restored',
  );
  assert.deepEqual(
    new Uint8Array(await restoredFlowDownload.arrayBuffer()),
    flowFileBytes,
  );
  const intactFlowPayload = (
    await db
      .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
      .bind('runtime-own')
      .first()
  ).payload;
  const mismatchedFlow = JSON.parse(intactFlowPayload);
  mismatchedFlow.partnerId = peerId;
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind(JSON.stringify(mismatchedFlow), 'runtime-own')
    .run();
  const mismatchedFlowRead = await expect(
    await call('/flow/runtime-own', undefined, peerHeaders),
    503,
    'FLOW detail rejects a native D1 row and payload identity mismatch before ACL',
  );
  assertPrivateAuthResponse(mismatchedFlowRead);
  assert.match((await mismatchedFlowRead.json()).error, /무결성/);
  const mismatchedDashboard = await expect(
    await call('/state', undefined, ownerHeaders),
    503,
    'FLOW dashboard rejects a native D1 row and projected payload identity mismatch',
  );
  assertPrivateAuthResponse(mismatchedDashboard);
  assert.match((await mismatchedDashboard.json()).error, /무결성/);
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind(intactFlowPayload, 'runtime-own')
    .run();
  await db
    .prepare('UPDATE consulting_flows SET updated_at = ?1 WHERE case_id = ?2')
    .bind('2020-01-01T00:00:00.000Z', 'runtime-own')
    .run();
  const mismatchedTimestampRead = await expect(
    await call('/flow/runtime-own', undefined, ownerHeaders),
    503,
    'FLOW detail rejects a native D1 row and payload timestamp mismatch',
  );
  assertPrivateAuthResponse(mismatchedTimestampRead);
  assert.match((await mismatchedTimestampRead.json()).error, /무결성/);
  const mismatchedTimestampDashboard = await expect(
    await call('/state', undefined, ownerHeaders),
    503,
    'FLOW dashboard rejects a native D1 row and projected payload timestamp mismatch',
  );
  assertPrivateAuthResponse(mismatchedTimestampDashboard);
  assert.match((await mismatchedTimestampDashboard.json()).error, /무결성/);
  await db
    .prepare('UPDATE consulting_flows SET updated_at = ?1 WHERE case_id = ?2')
    .bind(JSON.parse(intactFlowPayload).updatedAt, 'runtime-own')
    .run();
  const malformedFlowStructure = JSON.parse(intactFlowPayload);
  delete malformedFlowStructure.files;
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind(JSON.stringify(malformedFlowStructure), 'runtime-own')
    .run();
  const malformedStructureRead = await expect(
    await call('/flow/runtime-own', undefined, ownerHeaders),
    503,
    'FLOW detail rejects a native D1 payload missing a required collection',
  );
  assertPrivateAuthResponse(malformedStructureRead);
  assert.match((await malformedStructureRead.json()).error, /무결성/);
  const malformedStructureDashboard = await expect(
    await call('/state', undefined, ownerHeaders),
    503,
    'FLOW dashboard rejects malformed full structure before native SQLite projection',
  );
  assertPrivateAuthResponse(malformedStructureDashboard);
  assert.match((await malformedStructureDashboard.json()).error, /무결성/);
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind(intactFlowPayload, 'runtime-own')
    .run();
  await expect(
    await call('/flow/runtime-own', undefined, { cookie }),
    200,
    'FLOW detail resumes after the native D1 payload identity is restored',
  );
  checks.push(
    'FLOW D1 row identity, timestamp and required structure guard detail ACL and dashboard projection',
  );
  assert.deepEqual(
    Object.keys(privateMimeFlow.commandReceipts[mimeCommand.commandId]).sort(),
    ['actorKey', 'fingerprint'],
  );
  const mimeRetry = await expect(
    await callFlowFile(
      '/flow/runtime-own',
      mimeCommand,
      new File(['SYNTHETIC_FLOW_MIME'], flowFileName, {
        type: 'application/x-alternate-text',
      }),
      ownerHeaders,
    ),
    200,
    'FLOW retry ignores canonical filename form and browser MIME for identical native content',
  );
  assert.equal((await mimeRetry.json()).duplicate, true);
  const nativeAnalysis = {
    revision: mimeSavedFlow.revision,
    commandId: 'native-flow-partner-analysis',
    command: {
      type: 'confirm_analysis',
      reportId: mimeSavedFlow.reports.at(-1).id,
    },
  };
  await expect(
    await call('/flow/runtime-own', nativeAnalysis, { cookie }),
    200,
    'assigned active partner confirms their own analysis',
  );
  await expect(
    await call('/flow/runtime-own', nativeAnalysis, { cookie }),
    200,
    'partner analysis confirmation retry remains idempotent',
  );
  const supportDraft = await (
    await call('/state', undefined, { cookie })
  ).json();
  supportDraft.state.tasks.unshift({
    id: 'runtime-support-request',
    company: '위조된 고객사',
    title: '격리 저장 확인 지원 요청',
    kind: '지원요청',
    supportCategory: 'save_sync',
    supportOpenedAt: '2099-01-01T00:00:00.000Z',
    supportResolvedAt: '2099-01-01T00:00:00.000Z',
    supportResolvedByRole: 'admin',
    supportCycle: 99,
    assignee: '가상 변경이름',
    partnerMemberId: memberId,
    due: '미정',
    dueState: 'upcoming',
    status: '완료',
    priority: '보통',
    related: '직접 등록',
  });
  await expect(
    await call('/save', { state: supportDraft.state }, { cookie }, 'PUT'),
    200,
    'partner creates a server-timed synthetic support request',
  );
  const partnerSupportState = await (
    await call('/state', undefined, { cookie })
  ).json();
  const partnerSupport = partnerSupportState.state.tasks.find(
    (task) => task.id === 'runtime-support-request',
  );
  assert.equal(partnerSupport.company, '파트너 허브 지원');
  assert.equal(partnerSupport.status, '대기');
  assert.equal(partnerSupport.supportOrigin, 'partner_self_service');
  assert.equal(partnerSupport.supportCycle, 1);
  assert.match(partnerSupport.supportOpenedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(partnerSupport.supportResolvedAt, undefined);

  const ownerSupportState = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  ownerSupportState.state.tasks.find(
    (task) => task.id === 'runtime-support-request',
  ).status = '진행';
  await expect(
    await call(
      '/save',
      { state: ownerSupportState.state },
      ownerHeaders,
      'PUT',
    ),
    200,
    'administrator acknowledges the synthetic support request',
  );
  const ownerSupportProgress = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  const acknowledgedSupport = ownerSupportProgress.state.tasks.find(
    (task) => task.id === 'runtime-support-request',
  );
  assert.match(
    acknowledgedSupport.supportAcknowledgedAt,
    /^\d{4}-\d{2}-\d{2}T/,
  );
  acknowledgedSupport.status = '완료';
  await expect(
    await call(
      '/save',
      { state: ownerSupportProgress.state },
      ownerHeaders,
      'PUT',
    ),
    200,
    'administrator resolves the synthetic support request',
  );
  const trackedCaseId = `case-draft-${draftId}`;
  const trackedFlowInitial = (
    await (await call(`/flow/${trackedCaseId}`, undefined, ownerHeaders)).json()
  ).flow;
  const trackedFlowCommand = {
    revision: trackedFlowInitial.revision,
    commandId: 'native-tracked-flow-report',
    command: {
      type: 'save_report',
      stage: 1,
      body: '명시적 진행 중단 검증을 위한 가상 보고서입니다. 실제 자료나 외부 처리를 사용하지 않습니다. '.repeat(
        4,
      ),
    },
  };
  await expect(
    await call(`/flow/${trackedCaseId}`, trackedFlowCommand, ownerHeaders),
    200,
    'tracked application enters a server-verified FLOW stage',
  );
  const ownerDropoffState = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  const trackedDropoffCase = ownerDropoffState.state.cases.find(
    (item) => item.id === trackedCaseId,
  );
  assert.equal(trackedDropoffCase.flowManaged, true);
  assert.equal(trackedDropoffCase.stage, '기업진단');
  trackedDropoffCase.pipelineLifecycleStatus = 'discontinued';
  await expect(
    await call(
      '/save',
      { state: ownerDropoffState.state },
      ownerHeaders,
      'PUT',
    ),
    200,
    'administrator explicitly discontinues the tracked FLOW case',
  );
  const closedDropoffState = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  const closedDropoffCase = closedDropoffState.state.cases.find(
    (item) => item.id === trackedCaseId,
  );
  assert.equal(closedDropoffCase.pipelineLifecycleStatus, 'discontinued');
  assert.equal(closedDropoffCase.pipelineHighestStage, '기업진단');
  assert.equal(closedDropoffCase.pipelineStageSource, 'flow_verified');
  assert.equal(closedDropoffCase.pipelineDiscontinuedStage, '기업진단');
  assert.match(closedDropoffCase.pipelineDiscontinuedAt, /^\d{4}-\d{2}-\d{2}T/);
  await expect(
    await call(`/flow/${trackedCaseId}`, trackedFlowCommand, ownerHeaders),
    409,
    'discontinued tracked FLOW rejects even an identical command retry',
  );
  const metricFlowRow = await db
    .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
    .bind('runtime-own')
    .first();
  const metricFlow = JSON.parse(metricFlowRow.payload);
  metricFlow.requests.push({
    id: 'synthetic-review-wait',
    title: '가상 검토 대기',
    required: true,
    channel: '기타',
    recipient: '가상 담당',
    dueDate: '',
    status: 'received',
    fileId: 'synthetic-requested-document',
    note: '',
    createdAt: '2026-08-31T00:00:00.000Z',
    receivedAt: '2026-08-31T00:00:00.000Z',
  });
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind(JSON.stringify(metricFlow), 'runtime-own')
    .run();

  const suspensionFile = (
    await (
      await expect(
        await uploadSource({ cookie }, memberId),
        201,
        'create synthetic original for suspension and legacy deletion checks',
      )
    ).json()
  ).file;
  await db
    .prepare(`INSERT INTO company_file_upload_requests
    (owner_key, request_key, fingerprint, file_id, created_at, status)
    VALUES (?1, 'native-pending-delete', 'synthetic', 'native-pending-delete', ?2, 'pending')`)
    .bind(`member:${memberId}`, new Date().toISOString())
    .run();
  await bucket.put(
    'company-source/native-pending-delete',
    'SYNTHETIC_PENDING_ORIGINAL',
  );
  await expect(
    await call('/files/native-pending-delete', undefined, { cookie }, 'DELETE'),
    409,
    'pending upload cannot report deletion success before its commit',
  );
  assert.ok(await bucket.get('company-source/native-pending-delete'));
  checks.push('conflicted pending deletion preserves the synthetic original');

  const preSuspensionLink = await expect(
    await call('/issue', { memberId, confirmed: true }, ownerHeaders),
    201,
    'owner issues synthetic setup link before suspension',
  );
  const preSuspensionToken = (await preSuspensionLink.json()).path.split(
    '#token=',
  )[1];

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
    401,
    'suspension revokes an already issued password session',
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_sessions WHERE member_id = ?1',
        )
        .bind(memberId)
        .first()
    ).total,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_links WHERE member_id = ?1',
        )
        .bind(memberId)
        .first()
    ).total,
    0,
  );
  await expect(
    await call(
      '/chatgpt-register',
      {
        name: '가상 런타임파트너',
        phone: '010-0000-0000',
        affiliation: '가상 검증소속',
        email,
      },
      {
        'oai-authenticated-user-id': 'synthetic-suspended-partner',
        'oai-authenticated-user-email': email,
      },
    ),
    403,
    'ChatGPT self-registration cannot reopen a suspended account',
  );
  assert.equal(
    JSON.parse(
      (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    ).members.find((member) => member.id === memberId).status,
    '정지',
  );
  await expect(
    await call('/flow/runtime-own', nativeAnalysis, { cookie }),
    401,
    'revoked suspension session denies even an identical previously successful FLOW command',
  );
  await expect(
    await uploadSource({ cookie }, memberId),
    401,
    'revoked suspension session cannot upload a file',
  );
  await expect(
    await call(`/files/${suspensionFile.id}`, undefined, { cookie }),
    401,
    'revoked suspension session cannot download an original',
  );
  await expect(
    await call(`/files/${suspensionFile.id}`, undefined, { cookie }, 'DELETE'),
    401,
    'revoked suspension session cannot delete an original',
  );
  assert.ok(await bucket.get(`company-source/${suspensionFile.id}`));
  assert.ok(
    await db
      .prepare('SELECT id FROM company_file_objects WHERE id = ?1')
      .bind(suspensionFile.id)
      .first(),
  );
  checks.push('suspension denial preserves native R2 bytes and D1 metadata');
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
    await call('/state', undefined, { cookie }),
    401,
    'reactivation cannot revive the pre-suspension session',
  );
  await expect(
    await call('/setup', { token: preSuspensionToken, password }),
    400,
    'reactivation cannot revive the pre-suspension setup link',
  );
  const resumedLogin = await expect(
    await call('/login', { email, password }),
    200,
    'reactivated partner signs in through a new session',
  );
  cookie = resumedLogin.headers.get('set-cookie').split(';')[0];
  checks.push(
    'member status transition atomically revokes sessions and setup links',
  );
  // Convert only this isolated fixture to the pre-ledger legacy shape.
  await db
    .prepare('DELETE FROM company_file_upload_requests WHERE file_id = ?1')
    .bind(suspensionFile.id)
    .run();
  await expect(
    await call(`/files/${suspensionFile.id}`, undefined, { cookie }, 'DELETE'),
    204,
    'legacy explicit deletion creates a durable tombstone in native D1',
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT status FROM company_file_upload_requests WHERE file_id = ?1',
        )
        .bind(suspensionFile.id)
        .first()
    ).status,
    'deleted',
  );
  assert.equal(await bucket.get(`company-source/${suspensionFile.id}`), null);
  checks.push(
    'legacy deletion retains its tombstone after removing synthetic bytes',
  );
  await expect(
    await call('/issue', { memberId, confirmed: true }, { cookie }),
    403,
    'partner cannot reset other accounts',
  );
  const partnerStateBeforeReset = await (
    await call('/state', undefined, { cookie })
  ).json();
  assert.equal(Object.hasOwn(partnerStateBeforeReset, 'passwordLinks'), false);
  checks.push('password-link summary is absent from the partner response');
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
  const passwordLinkStats = await db
    .prepare(`SELECT issued_count, active_replacement_count,
      expired_at_reissue_count, redeemed_count, observed_expired_attempt_count
      FROM portal_password_link_stats`)
    .first();
  assert.deepEqual(passwordLinkStats, {
    issued_count: 2,
    active_replacement_count: 0,
    expired_at_reissue_count: 0,
    redeemed_count: 1,
    observed_expired_attempt_count: 0,
  });
  const passwordLinkColumns = (
    await db.prepare('PRAGMA table_info(portal_password_link_stats)').all()
  ).results.map((column) => column.name);
  assert.deepEqual(passwordLinkColumns, [
    'bucket_date',
    'issued_count',
    'active_replacement_count',
    'expired_at_reissue_count',
    'redeemed_count',
    'observed_expired_attempt_count',
  ]);
  const ownerStateAfterReset = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  assert.equal(ownerStateAfterReset.passwordLinks.issued, 2);
  assert.equal(ownerStateAfterReset.passwordLinks.redeemed, 1);
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'passwordLinks'),
    false,
  );
  const duplicateRequestColumns = (
    await db.prepare('PRAGMA table_info(portal_duplicate_request_stats)').all()
  ).results.map((column) => column.name);
  assert.deepEqual(duplicateRequestColumns, [
    'bucket_date',
    'source',
    'outcome',
    'event_count',
  ]);
  assert.ok(ownerStateAfterReset.duplicateRequests.totalSafeRetries >= 4);
  assert.ok(
    ownerStateAfterReset.duplicateRequests.totalRequestKeyConflicts >= 3,
  );
  assert.ok(ownerStateAfterReset.duplicateRequests.unkeyedUploadRequests >= 1);
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'duplicateRequests'),
    false,
  );
  assert.ok(
    ownerStateAfterReset.jointAnalysisConfirmation.partnerFirstPending >= 1,
  );
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'jointAnalysisConfirmation'),
    false,
  );
  assert.ok(ownerStateAfterReset.documentReviewWait.requestsCreated >= 1);
  assert.ok(ownerStateAfterReset.documentReviewWait.pendingReview >= 1);
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'documentReviewWait'),
    false,
  );
  assert.ok(ownerStateAfterReset.supportRequests.adminResolved >= 1);
  assert.equal(ownerStateAfterReset.supportRequests.requesterClosed, 0);
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'supportRequests'),
    false,
  );
  assert.equal(ownerStateAfterReset.pipelineDropoff.trackedCases, 1);
  assert.equal(ownerStateAfterReset.pipelineDropoff.discontinuedCases, 1);
  assert.equal(ownerStateAfterReset.pipelineDropoff.flowVerified.cases, 1);
  assert.equal(ownerStateAfterReset.pipelineDropoff.manualReported.cases, 0);
  assert.equal(
    ownerStateAfterReset.pipelineDropoff.observationStatus,
    'observed',
  );
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'pipelineDropoff'),
    false,
  );
  checks.push(
    'native D1 exposes privacy-minimized password-link and duplicate-request totals to the administrator only',
  );
  checks.push(
    'native D1 exposes only current joint-analysis confirmation intervals to the administrator',
  );
  checks.push(
    'native D1 exposes only current document review wait aggregates to the administrator',
  );
  checks.push(
    'native state protects support request actors and exposes only administrator aggregates',
  );
  checks.push(
    'native state separates server-verified pipeline discontinuation aggregates and blocks closed FLOW writes',
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
  const chatGPTSignup = {
    name: '가상 ChatGPT 가입자',
    phone: '010-0000-0099',
    affiliation: '가상 검증소속',
    email: 'chatgpt-runtime@example.invalid',
  };
  const chatGPTHeaders = {
    'oai-authenticated-user-id': 'synthetic-chatgpt-register-user',
    'oai-authenticated-user-email': chatGPTSignup.email,
  };
  await expect(
    await call('/chatgpt-register', chatGPTSignup, chatGPTHeaders),
    200,
    'native ChatGPT self-registration creates one pending account',
  );
  await db.prepare('DELETE FROM portal_auth_limits').run();
  const chatGPTRevision = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  ).membersRevision;
  for (let attempt = 0; attempt < 8; attempt++)
    assert.equal(
      (
        await call('/chatgpt-register', chatGPTSignup, {
          ...chatGPTHeaders,
          'cf-connecting-ip': `198.51.100.${attempt + 1}`,
        })
      ).status,
      200,
    );
  const chatGPTLimited = await expect(
    await call('/chatgpt-register', chatGPTSignup, {
      ...chatGPTHeaders,
      'cf-connecting-ip': '198.51.100.9',
    }),
    429,
    'stable ChatGPT identity limits registration across changing client IPs',
  );
  assert.equal(chatGPTLimited.headers.get('retry-after'), '900');
  const chatGPTState = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  );
  assert.equal(chatGPTState.membersRevision, chatGPTRevision);
  assert.equal(
    chatGPTState.members.filter(
      (member) => member.email === chatGPTSignup.email,
    ).length,
    1,
  );
  checks.push('identical ChatGPT registration retries do not rewrite state');
  const chatGPTOwnedMember = chatGPTState.members.find(
    (member) => member.email === chatGPTSignup.email,
  );
  const chatGPTBinding = await db
    .prepare(`SELECT subject_id, user_key
      FROM portal_chatgpt_identity_bindings
      WHERE subject_type = 'member' AND subject_id = ?1`)
    .bind(chatGPTOwnedMember.id)
    .first();
  assert.equal(chatGPTBinding.subject_id, chatGPTOwnedMember.id);
  assert.equal(
    chatGPTBinding.user_key,
    await sha256(`chatgpt-user:${chatGPTHeaders['oai-authenticated-user-id']}`),
  );
  assert.notEqual(
    chatGPTBinding.user_key,
    chatGPTHeaders['oai-authenticated-user-id'],
  );
  checks.push(
    'ChatGPT registration stores only a hashed stable identity binding',
  );
  await db
    .prepare(`INSERT INTO portal_password_accounts
      (member_id, email, password_hash, credential_version, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
    .bind(
      chatGPTOwnedMember.id,
      chatGPTSignup.email,
      'synthetic-chatgpt-owned-hash',
      'synthetic-chatgpt-owned-version',
      new Date().toISOString(),
    )
    .run();
  await db.prepare('DELETE FROM portal_auth_limits').run();
  await expect(
    await call('/chatgpt-register', chatGPTSignup, chatGPTHeaders),
    200,
    'ChatGPT retry accepts the pending member own credential',
  );
  assert.equal(
    JSON.parse(
      (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    ).membersRevision,
    chatGPTRevision,
  );
  checks.push('owned credential ChatGPT retry remains a no-op');
  const activatedChatGPTState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  const activatedChatGPTMember = activatedChatGPTState.members.find(
    (member) => member.id === chatGPTOwnedMember.id,
  );
  activatedChatGPTMember.status = '활성';
  activatedChatGPTMember.memberType = '기타';
  await expect(
    await call('/save', { state: activatedChatGPTState }, ownerHeaders, 'PUT'),
    200,
    'owner activates the identity-bound ChatGPT member',
  );
  await expect(
    await call('/state', undefined, {
      'oai-authenticated-user-id': 'synthetic-recycled-chatgpt-user',
      'oai-authenticated-user-email': chatGPTSignup.email,
    }),
    403,
    'recycled email cannot transfer an existing ChatGPT member binding',
  );
  await expect(
    await call('/state', undefined, {
      ...chatGPTHeaders,
      'oai-authenticated-user-email': 'changed-chatgpt-runtime@example.invalid',
    }),
    200,
    'bound ChatGPT identity survives a provider email change',
  );

  const ambiguousLegacyEmail = 'ambiguous-legacy-runtime@example.invalid';
  const stateBeforeAmbiguousLegacyEmail = await db
    .prepare('SELECT payload, updated_at FROM portal_state')
    .first();
  const ambiguousLegacyState = JSON.parse(
    stateBeforeAmbiguousLegacyEmail.payload,
  );
  const ambiguousLegacyTemplate = ambiguousLegacyState.members.find(
    (member) => member.id === peerId,
  );
  ambiguousLegacyState.members.push(
    {
      ...ambiguousLegacyTemplate,
      id: 'ambiguous-legacy-runtime-a',
      email: ambiguousLegacyEmail,
      status: '승인대기',
    },
    {
      ...ambiguousLegacyTemplate,
      id: 'ambiguous-legacy-runtime-b',
      email: ambiguousLegacyEmail,
      status: '활성',
    },
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(ambiguousLegacyState), new Date().toISOString())
    .run();
  const ambiguousLegacyUserId = 'synthetic-ambiguous-legacy-user';
  await expect(
    await call('/state', undefined, {
      'oai-authenticated-user-id': ambiguousLegacyUserId,
      'oai-authenticated-user-email': ambiguousLegacyEmail,
    }),
    403,
    'ambiguous legacy email cannot claim a ChatGPT identity binding',
  );
  await expect(
    await call(
      '/chatgpt-register',
      {
        name: '가상 중복가입 파트너',
        phone: '010-0000-0097',
        affiliation: '가상 중복가입 소속',
        email: ambiguousLegacyEmail,
      },
      {
        'oai-authenticated-user-id': ambiguousLegacyUserId,
        'oai-authenticated-user-email': ambiguousLegacyEmail,
      },
    ),
    409,
    'ambiguous legacy email cannot choose a ChatGPT registration account',
  );
  assert.equal(
    await db
      .prepare(
        'SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE user_key = ?1',
      )
      .bind(await sha256(`chatgpt-user:${ambiguousLegacyUserId}`))
      .first(),
    null,
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();

  const cleanMemberIdState = JSON.parse(
    stateBeforeAmbiguousLegacyEmail.payload,
  );
  const passwordMember = cleanMemberIdState.members.find(
    (member) => member.id === memberId,
  );
  const peerMember = cleanMemberIdState.members.find(
    (member) => member.id === peerId,
  );
  const validOperationalRecords = {
    tasks: {
      id: 'operational-task-runtime',
      company: '가상 런타임기업',
      title: '가상 런타임업무',
      kind: '내부업무',
      assignee: passwordMember.name,
      due: '기한 확인',
      dueState: 'upcoming',
      status: '대기',
      priority: '보통',
      related: '격리 검사',
    },
    companyDocuments: {
      id: 'operational-document-runtime',
      company: '가상 런타임기업',
      title: '가상 런타임자료',
      category: '기타자료',
      status: '요청중',
      assignedTrainee: passwordMember.name,
      submittedBy: passwordMember.name,
      updatedAt: '방금 전',
      version: '-',
      sensitive: false,
    },
    schedule: {
      id: 'operational-schedule-runtime',
      date: '09.05',
      weekday: '토',
      time: '10:00',
      end: '11:00',
      company: '가상 런타임기업',
      service: '가상 런타임상담',
      method: '화상',
      status: '확정',
      tone: 'green',
      source: 'partner',
      shareMode: 'all_with_assignee',
    },
  };
  const validStoredDocument = {
    ...validOperationalRecords.companyDocuments,
    status: '제출완료',
    storageFileId: 'stored-file-runtime',
    fileName: 'source.pdf',
    fileSize: 1_024,
  };
  for (const field of ['members', 'cases']) {
    const nonObjectIncomingState = structuredClone(cleanMemberIdState);
    nonObjectIncomingState[field] = [null];
    await expect(
      await call(
        '/save',
        { state: nonObjectIncomingState },
        ownerHeaders,
        'PUT',
      ),
      403,
      `generic owner state save rejects a non-object ${field} entry`,
    );
  }
  const blankCaseIdState = structuredClone(cleanMemberIdState);
  blankCaseIdState.cases[0].id = ' ';
  await expect(
    await call('/save', { state: blankCaseIdState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save rejects a blank case ID',
  );
  const duplicateCaseIdState = structuredClone(cleanMemberIdState);
  duplicateCaseIdState.cases.push({
    ...duplicateCaseIdState.cases[0],
    company: '가상 사건ID 충돌기업',
  });
  await expect(
    await call('/save', { state: duplicateCaseIdState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save rejects a duplicate case ID',
  );
  for (const [mutate, label] of [
    [
      (state) => {
        state.cases[0].company = ' ';
      },
      'blank case company',
    ],
    [
      (state) => {
        state.cases[0].trainee = '가상 런타임파트너 ';
      },
      'padded case trainee',
    ],
    [
      (state) => {
        state.cases[0].partnerMemberId = 'missing-runtime-member';
      },
      'orphaned case assignment',
    ],
    [
      (state) => {
        state.cases[0].partnerMemberId = null;
      },
      'non-string case assignment',
    ],
  ]) {
    const invalidCaseState = structuredClone(cleanMemberIdState);
    mutate(invalidCaseState);
    await expect(
      await call('/save', { state: invalidCaseState }, ownerHeaders, 'PUT'),
      403,
      `generic owner state save rejects ${String(label)}`,
    );
  }
  for (const [field, label] of [
    ['tasks', 'task'],
    ['companyDocuments', 'document'],
    ['schedule', 'schedule'],
  ]) {
    const blankRecordIdState = structuredClone(cleanMemberIdState);
    blankRecordIdState[field] = [{ id: ' ' }];
    await expect(
      await call('/save', { state: blankRecordIdState }, ownerHeaders, 'PUT'),
      403,
      `generic owner state save rejects a blank ${label} ID`,
    );
    const duplicateRecordIdState = structuredClone(cleanMemberIdState);
    duplicateRecordIdState[field] = [
      { id: 'collision-record-runtime' },
      { id: 'collision-record-runtime' },
    ];
    await expect(
      await call(
        '/save',
        { state: duplicateRecordIdState },
        ownerHeaders,
        'PUT',
      ),
      403,
      `generic owner state save rejects a duplicate ${label} ID`,
    );
  }
  for (const { field, record, label } of [
    {
      field: 'tasks',
      record: { ...validOperationalRecords.tasks, title: ' ' },
      label: 'blank task title',
    },
    {
      field: 'tasks',
      record: { ...validOperationalRecords.tasks, status: '보류' },
      label: 'unsupported task status',
    },
    {
      field: 'companyDocuments',
      record: { ...validOperationalRecords.companyDocuments, version: '' },
      label: 'blank document version',
    },
    {
      field: 'companyDocuments',
      record: {
        ...validOperationalRecords.companyDocuments,
        category: '미분류',
      },
      label: 'unsupported document category',
    },
    {
      field: 'schedule',
      record: { ...validOperationalRecords.schedule, service: '' },
      label: 'blank schedule service',
    },
    {
      field: 'schedule',
      record: { ...validOperationalRecords.schedule, shareMode: 'public' },
      label: 'unsupported schedule share mode',
    },
  ]) {
    const invalidOperationalState = structuredClone(cleanMemberIdState);
    invalidOperationalState[field] = [record];
    await expect(
      await call(
        '/save',
        { state: invalidOperationalState },
        ownerHeaders,
        'PUT',
      ),
      403,
      `generic owner state save rejects ${label}`,
    );
  }
  for (const { records, label } of [
    {
      records: [{ ...validStoredDocument, storageFileId: 'bad' }],
      label: 'malformed document original ID',
    },
    {
      records: [{ ...validStoredDocument, fileName: undefined }],
      label: 'incomplete document original metadata',
    },
    {
      records: [
        {
          ...validOperationalRecords.companyDocuments,
          fileName: '../source.pdf',
        },
      ],
      label: 'unsafe legacy document filename',
    },
    {
      records: [
        { ...validOperationalRecords.companyDocuments, fileSize: 1_024 },
      ],
      label: 'document file size without an original ID',
    },
    {
      records: [{ ...validStoredDocument, fileSize: 0 }],
      label: 'invalid document original size',
    },
    {
      records: [
        validStoredDocument,
        { ...validStoredDocument, id: 'duplicate-original-runtime' },
      ],
      label: 'duplicate document original link',
    },
  ]) {
    const invalidFileMetadataState = structuredClone(cleanMemberIdState);
    invalidFileMetadataState.companyDocuments = records;
    await expect(
      await call(
        '/save',
        { state: invalidFileMetadataState },
        ownerHeaders,
        'PUT',
      ),
      403,
      `generic owner state save rejects ${label}`,
    );
  }
  const provenanceBytes = new TextEncoder().encode(
    'SYNTHETIC_WORKER_PROVENANCE',
  );
  const provenanceDocument = (fileId, overrides = {}) => ({
    ...validStoredDocument,
    id: `document-${fileId}`,
    company: '가상 본인기업',
    title: '격리 원본 대조',
    category: '기타자료',
    assignedTrainee: passwordMember.name,
    partnerMemberId: memberId,
    caseId: 'runtime-own',
    storageFileId: fileId,
    fileName: 'source.txt',
    fileSize: provenanceBytes.byteLength,
    sensitive: false,
    ...overrides,
  });
  async function seedProvenanceFile({
    fileId,
    status = 'ready',
    includeObject = true,
    objectSize = provenanceBytes.byteLength,
    includeUploadRequest = true,
  }) {
    await db
      .prepare(`INSERT INTO company_file_objects
        (id, storage_key, original_name, company, category, title,
         assigned_trainee, uploaded_by_user_id, uploaded_by_email,
         content_type, size_bytes, created_at)
        VALUES (?1, ?2, 'source.txt', '가상 본인기업', '기타자료',
          '격리 원본 대조', ?3, ?4, ?5, 'text/plain', ?6, ?7)`)
      .bind(
        fileId,
        `company-source/${fileId}`,
        passwordMember.name,
        memberId,
        passwordMember.email,
        provenanceBytes.byteLength,
        new Date().toISOString(),
      )
      .run();
    await db
      .prepare(
        'INSERT INTO company_file_assignments (file_id, partner_member_id) VALUES (?1, ?2)',
      )
      .bind(fileId, memberId)
      .run();
    await db
      .prepare(
        'INSERT INTO company_file_case_links (file_id, case_id) VALUES (?1, ?2)',
      )
      .bind(fileId, 'runtime-own')
      .run();
    if (includeUploadRequest)
      await db
        .prepare(`INSERT INTO company_file_upload_requests
          (owner_key, request_key, fingerprint, file_id, created_at, status)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(
          `member:${memberId}`,
          `request-${fileId}`,
          `fingerprint-${fileId}`,
          fileId,
          new Date().toISOString(),
          status,
        )
        .run();
    if (includeObject)
      await bucket.put(`company-source/${fileId}`, new Uint8Array(objectSize));
  }
  const missingProvenanceState = structuredClone(cleanMemberIdState);
  missingProvenanceState.companyDocuments = [
    ...missingProvenanceState.companyDocuments,
    provenanceDocument('worker-provenance-missing'),
  ];
  await expect(
    await call('/save', { state: missingProvenanceState }, ownerHeaders, 'PUT'),
    409,
    'generic state save rejects a document original absent from the D1 ledger',
  );
  for (const { fileId, seedOptions, documentOverrides = {}, label } of [
    {
      fileId: 'worker-provenance-mismatch',
      seedOptions: {},
      documentOverrides: { fileName: 'other.txt' },
      label: 'D1 metadata mismatch',
    },
    {
      fileId: 'worker-provenance-pending',
      seedOptions: { status: 'pending' },
      label: 'pending upload ledger',
    },
    {
      fileId: 'worker-provenance-deleted',
      seedOptions: { status: 'deleted' },
      label: 'deleted upload ledger',
    },
    {
      fileId: 'worker-provenance-missing-r2',
      seedOptions: { includeObject: false },
      label: 'missing private R2 original',
    },
    {
      fileId: 'worker-provenance-wrong-r2-size',
      seedOptions: { objectSize: provenanceBytes.byteLength - 1 },
      label: 'size-mismatched private R2 original',
    },
  ]) {
    await seedProvenanceFile({ fileId, ...seedOptions });
    const invalidProvenanceState = structuredClone(cleanMemberIdState);
    invalidProvenanceState.companyDocuments = [
      ...invalidProvenanceState.companyDocuments,
      provenanceDocument(fileId, documentOverrides),
    ];
    await expect(
      await call(
        '/save',
        { state: invalidProvenanceState },
        ownerHeaders,
        'PUT',
      ),
      409,
      `generic state save rejects ${label}`,
    );
  }
  for (const { fileId, includeUploadRequest, label } of [
    {
      fileId: 'worker-provenance-ready',
      includeUploadRequest: true,
      label: 'ready D1/R2 original',
    },
    {
      fileId: 'worker-provenance-legacy',
      includeUploadRequest: false,
      label: 'intact legacy D1/R2 original',
    },
  ]) {
    await seedProvenanceFile({ fileId, includeUploadRequest });
    const validProvenanceState = structuredClone(cleanMemberIdState);
    validProvenanceState.companyDocuments = [
      ...validProvenanceState.companyDocuments,
      provenanceDocument(fileId),
    ];
    await expect(
      await call('/save', { state: validProvenanceState }, ownerHeaders, 'PUT'),
      200,
      `generic state save links ${label}`,
    );
    if (includeUploadRequest) {
      await expect(
        await call(`/files/${fileId}`, undefined, ownerHeaders, 'DELETE'),
        409,
        'linked portal document original cannot be deleted',
      );
      assert.ok(
        await db
          .prepare('SELECT id FROM company_file_objects WHERE id = ?1')
          .bind(fileId)
          .first(),
      );
      checks.push('linked deletion denial preserves native D1 metadata');
      assert.ok(await bucket.get(`company-source/${fileId}`));
      checks.push('linked deletion denial preserves native R2 bytes');
      await bucket.put(
        `company-source/${fileId}`,
        provenanceBytes.subarray(0, provenanceBytes.byteLength - 1),
      );
      const corruptedDownload = await expect(
        await call(`/files/${fileId}`, undefined, ownerHeaders),
        409,
        'download rejects a native R2 original with the wrong size',
      );
      assertPrivateAuthResponse(corruptedDownload);
      assert.match((await corruptedDownload.json()).error, /보관 상태/);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT size_bytes FROM company_file_objects WHERE id = ?1',
            )
            .bind(fileId)
            .first()
        ).size_bytes,
        provenanceBytes.byteLength,
      );
      checks.push('corrupt download denial preserves native D1 size metadata');
      await bucket.put(`company-source/${fileId}`, provenanceBytes);
      const restoredDownload = await expect(
        await call(`/files/${fileId}`, undefined, ownerHeaders),
        200,
        'download resumes after native R2 size is restored',
      );
      assert.deepEqual(
        new Uint8Array(await restoredDownload.arrayBuffer()),
        provenanceBytes,
      );
    }
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(JSON.stringify(cleanMemberIdState), new Date().toISOString())
      .run();
  }
  for (const [field, label] of [
    ['tasks', 'task'],
    ['companyDocuments', 'document'],
    ['schedule', 'schedule'],
  ]) {
    for (const { record, reason } of [
      {
        record: {
          ...validOperationalRecords[field],
          id: `invalid-${label}-case-runtime`,
          caseId: 'missing-runtime-case',
        },
        reason: 'unresolved case link',
      },
      {
        record: {
          ...validOperationalRecords[field],
          id: `invalid-${label}-member-runtime`,
          partnerMemberId: 'missing-runtime-member',
        },
        reason: 'unresolved member link',
      },
      {
        record: {
          ...validOperationalRecords[field],
          id: `invalid-${label}-conflict-runtime`,
          caseId: cleanMemberIdState.cases[0].id,
          partnerMemberId: peerId,
        },
        reason: 'conflicting case and member link',
      },
    ]) {
      const invalidRelatedState = structuredClone(cleanMemberIdState);
      invalidRelatedState[field] = [record];
      await expect(
        await call(
          '/save',
          { state: invalidRelatedState },
          ownerHeaders,
          'PUT',
        ),
        403,
        `generic owner state save rejects ${reason} on ${label}`,
      );
    }
  }
  const validTimelineRecord = {
    id: 'timeline-integrity-runtime',
    caseId: cleanMemberIdState.cases[0].id,
    date: '방금 전',
    title: '가상 무결성 점검',
    detail: '가상 타임라인 기록',
    type: '진행',
    tone: 'blue',
  };
  for (const { records, label } of [
    {
      records: [{ ...validTimelineRecord, title: ' ' }],
      label: 'blank timeline title',
    },
    {
      records: [{ ...validTimelineRecord, caseId: 'missing-runtime-case' }],
      label: 'unresolved timeline case link',
    },
    {
      records: [{ ...validTimelineRecord, id: null }],
      label: 'non-string timeline stable ID',
    },
    {
      records: [
        validTimelineRecord,
        { ...validTimelineRecord, caseId: cleanMemberIdState.cases.at(-1).id },
      ],
      label: 'duplicate timeline stable ID',
    },
  ]) {
    const invalidTimelineState = structuredClone(cleanMemberIdState);
    invalidTimelineState.timeline = records;
    await expect(
      await call('/save', { state: invalidTimelineState }, ownerHeaders, 'PUT'),
      403,
      `generic owner state save rejects ${label}`,
    );
  }
  for (const [mutate, label] of [
    [
      (state) => {
        state.version = 2;
      },
      'unsupported state version',
    ],
    [
      (state) => {
        state.consultationNumber = -1;
      },
      'negative consultation counter',
    ],
    [
      (state) => {
        state.membersRevision = 1.5;
      },
      'fractional member revision',
    ],
    [
      (state) => {
        state.diagnosisAssessments = [null];
      },
      'non-object diagnosis record',
    ],
    [
      (state) => {
        state.diagnosisAssessments = [
          { id: 'diagnosis-collision-runtime' },
          { id: 'diagnosis-collision-runtime' },
        ];
      },
      'duplicate diagnosis ID',
    ],
  ]) {
    const invalidMetadataState = structuredClone(cleanMemberIdState);
    mutate(invalidMetadataState);
    await expect(
      await call('/save', { state: invalidMetadataState }, ownerHeaders, 'PUT'),
      403,
      `generic owner state save rejects ${String(label)}`,
    );
  }
  const validDiagnosisAssessment = {
    id: 'diagnosis-integrity-runtime',
    caseId: cleanMemberIdState.cases[0].id,
    company: cleanMemberIdState.cases[0].company,
    identityStatus: '일치',
    hasConsultationEvidence: true,
    privacyMasked: true,
    personalDataConsent: true,
    thirdPartyAiConsent: true,
    transcriptConsent: true,
    level: 'A',
    decision: '1차 초안 생성 가능',
    status: '사전점검 완료',
    updatedAt: '가상 판정 완료',
  };
  for (const { assessment, label } of [
    {
      assessment: { ...validDiagnosisAssessment, thirdPartyAiConsent: 'true' },
      label: 'non-boolean diagnosis consent',
    },
    {
      assessment: { ...validDiagnosisAssessment, decision: 'AI 처리 중단' },
      label: 'inconsistent diagnosis decision',
    },
    {
      assessment: {
        ...validDiagnosisAssessment,
        caseId: 'unknown-case-runtime',
      },
      label: 'unlinked diagnosis case',
    },
  ]) {
    const invalidDiagnosisState = structuredClone(cleanMemberIdState);
    invalidDiagnosisState.diagnosisAssessments = [assessment];
    await expect(
      await call(
        '/save',
        { state: invalidDiagnosisState },
        ownerHeaders,
        'PUT',
      ),
      403,
      `generic owner state save rejects ${label}`,
    );
  }
  const protectedFileMetadataState = structuredClone(cleanMemberIdState);
  protectedFileMetadataState.companyDocuments = [validStoredDocument];
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(protectedFileMetadataState), new Date().toISOString())
    .run();
  for (const { records, label } of [
    {
      records: [],
      label: 'removing existing document original metadata',
    },
    {
      records: [{ ...validStoredDocument, fileName: 'replacement.pdf' }],
      label: 'changing an existing document original filename',
    },
    {
      records: [
        { ...validStoredDocument, storageFileId: 'stored-file-replacement' },
      ],
      label: 'replacing an existing document original ID',
    },
  ]) {
    const changedFileMetadataState = structuredClone(
      protectedFileMetadataState,
    );
    changedFileMetadataState.companyDocuments = records;
    await expect(
      await call(
        '/save',
        { state: changedFileMetadataState },
        ownerHeaders,
        'PUT',
      ),
      409,
      `generic owner state save rejects ${label}`,
    );
  }
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(cleanMemberIdState), new Date().toISOString())
    .run();
  const structuralLogin = await expect(
    await call('/login', { email, password: `${password} new` }),
    200,
    'structural corruption test creates a password session',
  );
  const structuralCookie = structuralLogin.headers
    .get('set-cookie')
    .split(';')[0];
  for (const { records, label } of [
    {
      records: [{ ...validStoredDocument, storageFileId: 'bad' }],
      label: 'malformed document original ID',
    },
    {
      records: [
        { ...validOperationalRecords.companyDocuments, fileSize: 1_024 },
      ],
      label: 'document file size without an original ID',
    },
    {
      records: [
        validStoredDocument,
        { ...validStoredDocument, id: 'stored-duplicate-original-runtime' },
      ],
      label: 'duplicate document original link',
    },
  ]) {
    const invalidStoredFileMetadataState = structuredClone(cleanMemberIdState);
    invalidStoredFileMetadataState.companyDocuments = records;
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(
        JSON.stringify(invalidStoredFileMetadataState),
        new Date().toISOString(),
      )
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored ${label} blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored ${label} blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored ${label} blocks generic repair writes`,
    );
  }
  for (const { field, record, label } of [
    {
      field: 'tasks',
      record: { ...validOperationalRecords.tasks, dueState: 'later' },
      label: 'unsupported task due state',
    },
    {
      field: 'companyDocuments',
      record: {
        ...validOperationalRecords.companyDocuments,
        sensitive: 'true',
      },
      label: 'non-boolean document sensitivity',
    },
    {
      field: 'schedule',
      record: { ...validOperationalRecords.schedule, source: 'external' },
      label: 'unsupported schedule source',
    },
  ]) {
    const invalidStoredOperationalState = structuredClone(cleanMemberIdState);
    invalidStoredOperationalState[field] = [record];
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(
        JSON.stringify(invalidStoredOperationalState),
        new Date().toISOString(),
      )
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored ${label} blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored ${label} blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored ${label} blocks generic repair writes`,
    );
  }
  for (const [mutate, label] of [
    [
      (state) => {
        state.version = 2;
      },
      'unsupported state version',
    ],
    [
      (state) => {
        state.consultationNumber = -1;
      },
      'negative consultation counter',
    ],
    [
      (state) => {
        state.membersRevision = 1.5;
      },
      'fractional member revision',
    ],
    [
      (state) => {
        state.diagnosisAssessments = [null];
      },
      'non-object diagnosis record',
    ],
    [
      (state) => {
        state.diagnosisAssessments = [
          { id: 'diagnosis-collision-runtime' },
          { id: 'diagnosis-collision-runtime' },
        ];
      },
      'duplicate diagnosis ID',
    ],
  ]) {
    const invalidStoredState = structuredClone(cleanMemberIdState);
    mutate(invalidStoredState);
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(JSON.stringify(invalidStoredState), new Date().toISOString())
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored ${String(label)} blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored ${String(label)} blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored ${String(label)} blocks generic repair writes`,
    );
  }
  for (const { assessment, label } of [
    {
      assessment: { ...validDiagnosisAssessment, personalDataConsent: 1 },
      label: 'non-boolean diagnosis consent',
    },
    {
      assessment: {
        ...validDiagnosisAssessment,
        caseId: 'unknown-case-runtime',
      },
      label: 'unlinked diagnosis case',
    },
  ]) {
    const invalidStoredDiagnosisState = structuredClone(cleanMemberIdState);
    invalidStoredDiagnosisState.diagnosisAssessments = [assessment];
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(
        JSON.stringify(invalidStoredDiagnosisState),
        new Date().toISOString(),
      )
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored ${label} blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored ${label} blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored ${label} blocks generic repair writes`,
    );
  }
  for (const [mutate, label] of [
    [
      (state) => {
        state.cases[0].trainee = '';
      },
      'blank case trainee',
    ],
    [
      (state) => {
        state.cases[0].partnerMemberId = 'missing-runtime-member';
      },
      'orphaned case assignment',
    ],
  ]) {
    const invalidStoredCaseState = structuredClone(cleanMemberIdState);
    mutate(invalidStoredCaseState);
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(JSON.stringify(invalidStoredCaseState), new Date().toISOString())
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored ${String(label)} blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored ${String(label)} blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored ${String(label)} blocks generic repair writes`,
    );
  }
  for (const [field, label] of [
    ['tasks', 'task'],
    ['companyDocuments', 'document'],
    ['schedule', 'schedule'],
  ]) {
    const invalidStoredRelatedState = structuredClone(cleanMemberIdState);
    invalidStoredRelatedState[field] = [
      {
        ...validOperationalRecords[field],
        id: `stored-${label}-conflict-runtime`,
        caseId: cleanMemberIdState.cases[0].id,
        partnerMemberId: peerId,
      },
    ];
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(JSON.stringify(invalidStoredRelatedState), new Date().toISOString())
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored conflicting ${label} assignment blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored conflicting ${label} assignment blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored conflicting ${label} assignment blocks generic repair writes`,
    );
  }
  for (const { records, label } of [
    {
      records: [{ ...validTimelineRecord, detail: '' }],
      label: 'blank timeline detail',
    },
    {
      records: [{ ...validTimelineRecord, caseId: 'missing-runtime-case' }],
      label: 'unresolved timeline case link',
    },
    {
      records: [
        validTimelineRecord,
        { ...validTimelineRecord, caseId: cleanMemberIdState.cases.at(-1).id },
      ],
      label: 'duplicate timeline stable ID',
    },
  ]) {
    const invalidStoredTimelineState = structuredClone(cleanMemberIdState);
    invalidStoredTimelineState.timeline = records;
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(
        JSON.stringify(invalidStoredTimelineState),
        new Date().toISOString(),
      )
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored ${label} blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored ${label} blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored ${label} blocks generic repair writes`,
    );
  }
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();
  const nonObjectStoredState = structuredClone(cleanMemberIdState);
  nonObjectStoredState.cases = [null];
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(nonObjectStoredState), new Date().toISOString())
    .run();
  await expect(
    await call('/state', undefined, { cookie: structuralCookie }),
    403,
    'stored non-object record blocks password partner access',
  );
  await expect(
    await call('/state', undefined, ownerHeaders),
    503,
    'stored non-object record blocks administrator reads',
  );
  await expect(
    await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
    503,
    'stored non-object record blocks generic repair writes',
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();
  const duplicateCaseStoredState = structuredClone(cleanMemberIdState);
  duplicateCaseStoredState.cases = [
    {
      ...cleanMemberIdState.cases[0],
      id: 'collision-case-runtime',
      company: '가상 본인기업',
      trainee: passwordMember.name,
      partnerMemberId: memberId,
    },
    {
      ...cleanMemberIdState.cases[0],
      id: 'collision-case-runtime',
      company: '가상 타인기업',
      trainee: peerMember.name,
      partnerMemberId: peerId,
    },
  ];
  duplicateCaseStoredState.timeline = [
    {
      caseId: 'collision-case-runtime',
      date: '2026-09-05',
      title: '타인 비공개 진행',
      detail: '사건 ID 충돌로 노출되면 안 되는 기록',
    },
  ];
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(duplicateCaseStoredState), new Date().toISOString())
    .run();
  await expect(
    await call('/state', undefined, { cookie: structuralCookie }),
    403,
    'stored duplicate case ID blocks password partner projection',
  );
  await expect(
    await call('/state', undefined, ownerHeaders),
    503,
    'stored duplicate case ID blocks administrator reads',
  );
  await expect(
    await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
    503,
    'stored duplicate case ID blocks generic repair writes',
  );
  for (const [field, label] of [
    ['tasks', 'task'],
    ['companyDocuments', 'document'],
    ['schedule', 'schedule'],
  ]) {
    const duplicateStoredRecordState = structuredClone(cleanMemberIdState);
    duplicateStoredRecordState[field] = [
      { id: 'collision-record-runtime' },
      { id: 'collision-record-runtime' },
    ];
    await db
      .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
      .bind(
        JSON.stringify(duplicateStoredRecordState),
        new Date().toISOString(),
      )
      .run();
    await expect(
      await call('/state', undefined, { cookie: structuralCookie }),
      403,
      `stored duplicate ${label} ID blocks password partner access`,
    );
    await expect(
      await call('/state', undefined, ownerHeaders),
      503,
      `stored duplicate ${label} ID blocks administrator reads`,
    );
    await expect(
      await call('/save', { state: cleanMemberIdState }, ownerHeaders, 'PUT'),
      503,
      `stored duplicate ${label} ID blocks generic repair writes`,
    );
  }
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();
  await expect(
    await call('/logout', {}, { cookie: structuralCookie }),
    200,
    'structural corruption test session logout succeeds',
  );
  const malformedEmailSaveState = structuredClone(cleanMemberIdState);
  malformedEmailSaveState.members.find(
    (member) => member.id === memberId,
  ).email = null;
  await expect(
    await call(
      '/save',
      { state: malformedEmailSaveState },
      ownerHeaders,
      'PUT',
    ),
    403,
    'generic owner state save rejects a non-string member email',
  );
  const malformedNameState = structuredClone(cleanMemberIdState);
  malformedNameState.members.find((member) => member.id === memberId).name =
    null;
  malformedNameState.members.find(
    (member) => member.id === chatGPTOwnedMember.id,
  ).name = null;
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(malformedNameState), new Date().toISOString())
    .run();
  const malformedNameLogin = await expect(
    await call('/login', { email, password: `${password} new` }),
    200,
    'password login keeps credential checks separate from legacy display name',
  );
  const malformedNameCookie = malformedNameLogin.headers
    .get('set-cookie')
    .split(';')[0];
  await expect(
    await call('/state', undefined, { cookie: malformedNameCookie }),
    403,
    'password state rejects a non-string legacy member name',
  );
  await expect(
    await call('/state', undefined, chatGPTHeaders),
    403,
    'ChatGPT state rejects a non-string legacy member name',
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();
  await expect(
    await call('/logout', {}, { cookie: malformedNameCookie }),
    200,
    'legacy member name test session logout succeeds',
  );
  const malformedBoundEmailState = structuredClone(cleanMemberIdState);
  malformedBoundEmailState.members.find(
    (member) => member.id === chatGPTOwnedMember.id,
  ).email = null;
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(malformedBoundEmailState), new Date().toISOString())
    .run();
  await expect(
    await call('/state', undefined, {
      ...chatGPTHeaders,
      'oai-authenticated-user-email': 'changed-chatgpt-runtime@example.invalid',
    }),
    403,
    'bound ChatGPT state rejects a non-string legacy member email',
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();
  const malformedPermissionState = structuredClone(cleanMemberIdState);
  const malformedPermissions = {
    sharedSchedule: 'false',
    collaborationApply: 1,
    ownCases: 'true',
    fileUpload: {},
    quoteContract: 'allowed',
  };
  malformedPermissionState.members.find(
    (member) => member.id === memberId,
  ).permissions = structuredClone(malformedPermissions);
  malformedPermissionState.members.find(
    (member) => member.id === chatGPTOwnedMember.id,
  ).permissions = structuredClone(malformedPermissions);
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(malformedPermissionState), new Date().toISOString())
    .run();
  const malformedPasswordLogin = await expect(
    await call('/login', { email, password: `${password} new` }),
    200,
    'password login accepts a legacy account with malformed permissions',
  );
  const malformedPasswordCookie = malformedPasswordLogin.headers
    .get('set-cookie')
    .split(';')[0];
  const malformedPasswordView = await (
    await expect(
      await call('/state', undefined, { cookie: malformedPasswordCookie }),
      200,
      'password state denies malformed legacy permission values',
    )
  ).json();
  const malformedChatGPTView = await (
    await expect(
      await call('/state', undefined, chatGPTHeaders),
      200,
      'ChatGPT state denies malformed legacy permission values',
    )
  ).json();
  const deniedPermissions = {
    sharedSchedule: false,
    collaborationApply: false,
    ownCases: false,
    fileUpload: false,
    quoteContract: false,
  };
  assert.deepEqual(
    malformedPasswordView.currentUser.permissions,
    deniedPermissions,
  );
  assert.deepEqual(
    malformedPasswordView.state.members[0].permissions,
    deniedPermissions,
  );
  assert.deepEqual(
    malformedChatGPTView.currentUser.permissions,
    deniedPermissions,
  );
  assert.deepEqual(
    malformedChatGPTView.state.members[0].permissions,
    deniedPermissions,
  );
  checks.push(
    'native password and ChatGPT access fail closed on malformed legacy permissions',
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();
  await expect(
    await call('/logout', {}, { cookie: malformedPasswordCookie }),
    200,
    'legacy permission test session logout succeeds',
  );
  const protectedMemberFieldsState = structuredClone(cleanMemberIdState);
  const protectedPasswordMember = protectedMemberFieldsState.members.find(
    (member) => member.id === memberId,
  );
  Object.assign(protectedPasswordMember, {
    phone: '010-9999-9999',
    affiliation: '가상 위조 회원소속',
    cohort: '가상 위조 회원기수',
    role: '리더 파트너',
    companies: 999999,
    forgedRuntimeMemberField: '가상 위조 회원필드',
  });
  protectedPasswordMember.lastLoginAt = '2000-01-01T00:00:00.000Z';
  protectedPasswordMember.loginCount = 999999;
  protectedMemberFieldsState.members.find(
    (member) => member.id === peerId,
  ).registration = {
    method: 'self_password',
    requestId: 'forged-runtime-registration',
    createdAt: '2000-01-01T00:00:00.000Z',
    createdBy: 'forged-runtime@example.invalid',
  };
  await expect(
    await call(
      '/save',
      { state: protectedMemberFieldsState },
      ownerHeaders,
      'PUT',
    ),
    200,
    'generic owner state save preserves server-owned member audit fields',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    stateBeforeAmbiguousLegacyEmail.payload,
  );

  const invalidStatusSaveState = structuredClone(cleanMemberIdState);
  invalidStatusSaveState.members.find(
    (member) => member.id === memberId,
  ).status = '승인대기';
  await expect(
    await call('/save', { state: invalidStatusSaveState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save rejects an invalid account status transition',
  );
  const invalidPermissionSaveState = structuredClone(cleanMemberIdState);
  invalidPermissionSaveState.members.find(
    (member) => member.id === memberId,
  ).permissions.quoteContract = 'allowed';
  await expect(
    await call(
      '/save',
      { state: invalidPermissionSaveState },
      ownerHeaders,
      'PUT',
    ),
    403,
    'generic owner state save rejects malformed account permissions',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    stateBeforeAmbiguousLegacyEmail.payload,
  );

  const inventedIdSaveState = structuredClone(cleanMemberIdState);
  inventedIdSaveState.members.push({
    ...passwordMember,
    id: 'invented-state-runtime',
    email: 'invented-state-runtime@example.invalid',
  });
  await expect(
    await call('/save', { state: inventedIdSaveState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save cannot invent a partner account ID',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    stateBeforeAmbiguousLegacyEmail.payload,
  );

  const replacedIdSaveState = structuredClone(cleanMemberIdState);
  replacedIdSaveState.members.find((member) => member.id === memberId).id =
    'replaced-state-runtime';
  await expect(
    await call('/save', { state: replacedIdSaveState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save cannot replace a stable member ID',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    stateBeforeAmbiguousLegacyEmail.payload,
  );

  const duplicateIdSaveState = structuredClone(cleanMemberIdState);
  duplicateIdSaveState.members.push({
    ...passwordMember,
    email: 'duplicate-id-save-runtime@example.invalid',
  });
  await expect(
    await call('/save', { state: duplicateIdSaveState }, ownerHeaders, 'PUT'),
    403,
    'owner state save rejects a duplicate stable member ID',
  );
  assert.equal(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
    stateBeforeAmbiguousLegacyEmail.payload,
  );

  const duplicateIdEmail = 'duplicate-id-runtime@example.invalid';
  const duplicateIdRegistrationEmail =
    'duplicate-id-register-runtime@example.invalid';
  const duplicateIdLegacyState = structuredClone(cleanMemberIdState);
  duplicateIdLegacyState.members.push(
    {
      ...passwordMember,
      email: duplicateIdEmail,
      status: '활성',
    },
    {
      ...peerMember,
      email: duplicateIdRegistrationEmail,
      status: '승인대기',
    },
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(duplicateIdLegacyState), new Date().toISOString())
    .run();
  await expect(
    await call('/login', { email, password: `${password} new` }),
    403,
    'legacy duplicate member ID blocks password login',
  );
  await expect(
    await call('/issue', { memberId, confirmed: true }, ownerHeaders),
    400,
    'legacy duplicate member ID blocks setup-link issuance',
  );
  const duplicateIdUserId = 'synthetic-duplicate-id-user';
  await expect(
    await call('/state', undefined, {
      'oai-authenticated-user-id': duplicateIdUserId,
      'oai-authenticated-user-email': duplicateIdEmail,
    }),
    403,
    'legacy duplicate member ID blocks ChatGPT member access',
  );
  const duplicateIdRegisterUserId = 'synthetic-duplicate-id-register-user';
  await expect(
    await call(
      '/chatgpt-register',
      {
        name: '가상 중복ID 가입자',
        phone: '010-0000-0096',
        affiliation: '가상 중복ID 소속',
        email: duplicateIdRegistrationEmail,
      },
      {
        'oai-authenticated-user-id': duplicateIdRegisterUserId,
        'oai-authenticated-user-email': duplicateIdRegistrationEmail,
      },
    ),
    409,
    'legacy duplicate member ID blocks ChatGPT registration binding',
  );
  for (const userId of [duplicateIdUserId, duplicateIdRegisterUserId])
    assert.equal(
      await db
        .prepare(
          'SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE user_key = ?1',
        )
        .bind(await sha256(`chatgpt-user:${userId}`))
        .first(),
      null,
    );

  const missingIdState = structuredClone(cleanMemberIdState);
  missingIdState.members.find((member) => member.id === memberId).id = '';
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(JSON.stringify(missingIdState), new Date().toISOString())
    .run();
  const missingIdUserId = 'synthetic-missing-id-user';
  await expect(
    await call('/state', undefined, {
      'oai-authenticated-user-id': missingIdUserId,
      'oai-authenticated-user-email': email,
    }),
    403,
    'legacy missing member ID blocks ChatGPT member access',
  );
  assert.equal(
    await db
      .prepare(
        'SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE user_key = ?1',
      )
      .bind(await sha256(`chatgpt-user:${missingIdUserId}`))
      .first(),
    null,
  );
  await db
    .prepare('UPDATE portal_state SET payload = ?1, updated_at = ?2')
    .bind(
      stateBeforeAmbiguousLegacyEmail.payload,
      stateBeforeAmbiguousLegacyEmail.updated_at,
    )
    .run();

  const disposableEmail = 'disposable-runtime@example.invalid';
  const disposablePassword = 'disposable runtime test secret 123!';
  await expect(
    await call('/signup', {
      name: '가상 삭제검증 파트너',
      phone: '010-0000-0088',
      affiliation: '가상 삭제검증 소속',
      email: disposableEmail,
      password: disposablePassword,
      consent: true,
    }),
    201,
    'disposable password account registers for credential cleanup',
  );
  let disposableState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  const disposableMember = disposableState.members.find(
    (member) => member.email === disposableEmail,
  );
  disposableMember.status = '활성';
  disposableState.tasks.push({
    id: 'disposable-linked-task-runtime',
    company: '가상 삭제검증 소속',
    title: '가상 삭제 연결 검증업무',
    kind: '내부업무',
    assignee: disposableMember.name,
    due: '오늘',
    dueState: 'today',
    status: '대기',
    priority: '보통',
    related: '격리 검사',
    partnerMemberId: disposableMember.id,
  });
  await expect(
    await call('/save', { state: disposableState }, ownerHeaders, 'PUT'),
    200,
    'owner activates disposable credential account',
  );
  const activeDeletionState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  activeDeletionState.members = activeDeletionState.members.filter(
    (member) => member.id !== disposableMember.id,
  );
  await expect(
    await call('/save', { state: activeDeletionState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save cannot delete an active account',
  );
  const disposableChatGPTHeaders = {
    'oai-authenticated-user-id': 'synthetic-disposable-chatgpt-user',
    'oai-authenticated-user-email': disposableEmail,
  };
  await expect(
    await call('/state', undefined, disposableChatGPTHeaders),
    200,
    'legacy active member claims a stable ChatGPT identity binding',
  );
  await expect(
    await call('/login', {
      email: disposableEmail,
      password: disposablePassword,
    }),
    200,
    'disposable credential account signs in before deletion',
  );
  disposableState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  disposableState.members.find(
    (member) => member.id === disposableMember.id,
  ).status = '정지';
  await expect(
    await call('/save', { state: disposableState }, ownerHeaders, 'PUT'),
    200,
    'owner suspends disposable account before deletion',
  );
  assert.ok(
    await db
      .prepare(
        'SELECT member_id FROM portal_password_accounts WHERE member_id = ?1',
      )
      .bind(disposableMember.id)
      .first(),
  );
  checks.push('suspension preserves the reusable password credential');
  assert.ok(
    await db
      .prepare(
        "SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE subject_type = 'member' AND subject_id = ?1",
      )
      .bind(disposableMember.id)
      .first(),
  );
  checks.push('suspension preserves the stable ChatGPT identity binding');
  const linkedDeletionState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  linkedDeletionState.members = linkedDeletionState.members.filter(
    (member) => member.id !== disposableMember.id,
  );
  await expect(
    await call('/save', { state: linkedDeletionState }, ownerHeaders, 'PUT'),
    403,
    'generic owner state save cannot delete an account with assigned records',
  );
  const unlinkedDisposableState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  unlinkedDisposableState.tasks = unlinkedDisposableState.tasks.filter(
    (task) => task.id !== 'disposable-linked-task-runtime',
  );
  await expect(
    await call(
      '/save',
      { state: unlinkedDisposableState },
      ownerHeaders,
      'PUT',
    ),
    200,
    'owner removes the disposable account assignment before deletion',
  );
  disposableState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  disposableState.members = disposableState.members.filter(
    (member) => member.id !== disposableMember.id,
  );
  await expect(
    await call('/save', { state: disposableState }, ownerHeaders, 'PUT'),
    200,
    'owner deletes disposable account through the real state handler',
  );
  assert.equal(
    await db
      .prepare(
        'SELECT member_id FROM portal_password_accounts WHERE member_id = ?1',
      )
      .bind(disposableMember.id)
      .first(),
    null,
  );
  checks.push('member deletion atomically removes the password credential');
  assert.equal(
    await db
      .prepare(
        "SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE subject_type = 'member' AND subject_id = ?1",
      )
      .bind(disposableMember.id)
      .first(),
    null,
  );
  checks.push(
    'member deletion atomically removes the ChatGPT identity binding',
  );
  await expect(
    await call('/signup', {
      name: '가상 재등록 파트너',
      phone: '010-0000-0089',
      affiliation: '가상 재등록 소속',
      email: disposableEmail,
      password: disposablePassword,
      consent: true,
    }),
    201,
    'deleted account email can register without an orphan credential conflict',
  );
  const reservedCredentialEmail = 'detached-reserved-runtime@example.invalid';
  await db
    .prepare(`INSERT INTO portal_password_accounts
      (member_id, email, password_hash, credential_version, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
    .bind(
      'detached-runtime-member',
      reservedCredentialEmail,
      'synthetic-detached-runtime-hash',
      'synthetic-detached-runtime-version',
      new Date().toISOString(),
    )
    .run();
  await expect(
    await call(
      '/partners',
      {
        name: '가상 예약충돌 파트너',
        phone: '010-0000-0090',
        affiliation: '가상 예약충돌 소속',
        email: reservedCredentialEmail,
        memberType: '기타',
        confirmed: true,
        requestId: 'runtime-reserved-register-001',
      },
      ownerHeaders,
    ),
    409,
    'direct registration rejects a detached credential email',
  );
  const reservedState = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  reservedState.members.find((member) => member.id === peerId).email =
    reservedCredentialEmail;
  await expect(
    await call('/save', { state: reservedState }, ownerHeaders, 'PUT'),
    409,
    'member email change rejects a detached credential email',
  );
  const stateAfterReservationConflict = (
    await (await call('/state', undefined, ownerHeaders)).json()
  ).state;
  assert.equal(
    stateAfterReservationConflict.members.find((member) => member.id === peerId)
      .email,
    peerRegistration.email,
  );
  checks.push('credential email conflict leaves the member roster unchanged');
  assert.equal(
    (
      await db
        .prepare(
          'SELECT member_id FROM portal_password_accounts WHERE email = ?1',
        )
        .bind(reservedCredentialEmail)
        .first()
    ).member_id,
    'detached-runtime-member',
  );
  checks.push(
    'credential email conflict leaves the detached credential intact',
  );
  await db.prepare('DELETE FROM portal_auth_limits').run();
  const reservedChatGPTStateBefore = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  );
  await expect(
    await call(
      '/chatgpt-register',
      {
        name: '가상 ChatGPT 예약충돌',
        phone: '010-0000-0091',
        affiliation: '가상 예약충돌 소속',
        email: reservedCredentialEmail,
      },
      {
        'oai-authenticated-user-id': 'synthetic-chatgpt-reserved-user',
        'oai-authenticated-user-email': reservedCredentialEmail,
      },
    ),
    409,
    'ChatGPT registration rejects a detached credential email',
  );
  const reservedChatGPTStateAfter = JSON.parse(
    (await db.prepare('SELECT payload FROM portal_state').first()).payload,
  );
  assert.equal(
    reservedChatGPTStateAfter.membersRevision,
    reservedChatGPTStateBefore.membersRevision,
  );
  assert.equal(
    reservedChatGPTStateAfter.members.some(
      (member) => member.email === reservedCredentialEmail,
    ),
    false,
  );
  checks.push(
    'blocked ChatGPT credential collision leaves the roster unchanged',
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
