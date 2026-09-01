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
import { GET as getFlow, POST as postFlow } from '@/app/api/consulting-flow/[caseId]/route';
import { GET as getFile, DELETE as deleteFile } from '@/app/api/files/[id]/route';
import { POST as uploadFile } from '@/app/api/files/route';
import { GET as intakeFiles } from '@/app/api/consulting-flow/[caseId]/intake-files/route';
import { GET as getDraft, PUT as saveDraft, DELETE as deleteDraft } from '@/app/api/application-draft/route';
import { GET as getInventory } from '@/app/api/admin/file-inventory/route';
import { GET as getInventoryPresence } from '@/app/api/admin/file-inventory/[id]/presence/route';
import { GET as previewRecovery, POST as recoverOriginal } from '@/app/api/admin/file-inventory/[id]/recovery/route';
export default { async fetch(request) {
  const pathname = new URL(request.url).pathname;
  const routes = { 'POST /signup': registerPassword, 'POST /login': loginPassword, 'POST /logout': logoutPassword, 'POST /setup': setupPassword, 'POST /issue': createPasswordLink, 'GET /state': getState, 'PUT /save': saveState, 'POST /partners': createPartner, 'POST /files': uploadFile, 'GET /draft': getDraft, 'PUT /draft': saveDraft, 'DELETE /draft': deleteDraft };
  if (pathname === '/inventory' && request.method === 'GET') return getInventory(request);
  if (pathname.startsWith('/recovery/') && ['GET', 'POST'].includes(request.method)) return (request.method === 'GET' ? previewRecovery : recoverOriginal)(request, { params: Promise.resolve({ id: pathname.slice(10) }) });
  if (pathname.startsWith('/inventory/') && request.method === 'GET') return getInventoryPresence(request, { params: Promise.resolve({ id: pathname.slice(11) }) });
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
  state.tasks = [
    {
      id: 'runtime-own-task',
      title: '본인 업무',
      assignee: '가상 런타임파트너',
      partnerMemberId: memberId,
    },
    {
      id: 'runtime-peer-task',
      title: '타인 업무',
      assignee: '가상 런타임파트너',
      partnerMemberId: peerId,
    },
    {
      id: 'runtime-owner-task',
      title: '대표 업무',
      assignee: '김성민 대표',
      partnerMemberId: '',
    },
    {
      id: 'runtime-linked-task',
      title: '진행 연결 업무',
      caseId: 'runtime-own',
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
  assert.equal(Object.hasOwn(visible, 'applicationFunnel'), false);
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
  assert.deepEqual(
    visible.state.tasks.map((task) => task.id),
    ['runtime-own-task', 'runtime-linked-task'],
  );
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
  assert.equal(
    Object.hasOwn(submittedPartnerState, 'applicationFunnel'),
    false,
  );
  const submittedOwnerState = await (
    await call('/state', undefined, ownerHeaders)
  ).json();
  assert.equal(submittedOwnerState.applicationFunnel.trackedApplications, 1);
  assert.equal(submittedOwnerState.applicationFunnel.flowStarted, 0);
  assert.equal(
    Object.hasOwn(submittedOwnerState.state, 'applicationFunnel'),
    false,
  );
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
  staleWindow.tasks.push({ id: 'stale-window-task', status: '대기' });
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
    id: 'recovered-window-task',
    status: '대기',
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
  ) {
    const form = new FormData();
    form.set(
      'file',
      new File([sourceText], 'synthetic.txt', {
        type: 'text/plain',
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
  await expect(
    await call(`/files/${linkedFile.id}`, undefined, { cookie }),
    200,
    'same-name uploader downloads their new file',
  );
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
      assignedTrainee: file.assignedTrainee,
      partnerMemberId: memberId,
      caseId: file.caseId,
      storageFileId: file.id,
    });
    repeatState.timeline.push({
      caseId: file.caseId,
      date: '2026-08-31',
      title: '협업신청 접수',
      detail: file.caseId,
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
    undefined,
  );
  assert.equal(
    taskSaved.tasks.find((task) => task.id === 'runtime-owner-task').status,
    undefined,
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
  const nativeAnalysis = {
    revision: nativeSavedFlow.revision,
    commandId: 'native-flow-partner-analysis',
    command: {
      type: 'confirm_analysis',
      reportId: nativeSavedFlow.reports.at(-1).id,
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
  await expect(
    await call('/flow/runtime-own', nativeAnalysis, { cookie }),
    403,
    'suspension denies even an identical previously successful FLOW command',
  );
  await expect(
    await uploadSource({ cookie }, memberId),
    403,
    'suspended password session cannot upload a file',
  );
  await expect(
    await call(`/files/${suspensionFile.id}`, undefined, { cookie }),
    403,
    'suspended password session cannot download an original',
  );
  await expect(
    await call(`/files/${suspensionFile.id}`, undefined, { cookie }, 'DELETE'),
    403,
    'suspended password session cannot delete an original',
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
    issued_count: 1,
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
  assert.equal(ownerStateAfterReset.passwordLinks.issued, 1);
  assert.equal(ownerStateAfterReset.passwordLinks.redeemed, 1);
  assert.equal(
    Object.hasOwn(ownerStateAfterReset.state, 'passwordLinks'),
    false,
  );
  checks.push(
    'native D1 exposes privacy-minimized password-link totals to the administrator only',
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
