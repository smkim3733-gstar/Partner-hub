import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPartnerRegistration } from '../components/admin-partner-registration';
import { POST as create } from '../app/api/admin/partners/route';
import { POST as selfRegister } from '../app/api/register/route';
import { GET as getState, PUT as save } from './state-request';
import {
  readPortalState,
  writePortalState,
  mutatePortalState,
} from '../lib/portal-state';
import {
  defaultPartnerPermissions,
  membersRevisionOf,
  sameMemberRecords,
  registrationFieldUpdate,
  validatePartnerRegistration,
  type PartnerRegistrationResult,
} from '../lib/partner-registration';
import { env } from 'cloudflare:workers';
import { readDuplicateRequestSummary } from '../lib/duplicate-request-metrics';
import { flushWaitUntil } from './runtime-mock.mjs';

const owner = 'seedy@sites.test';
void test('queued field updates retain captured input values after a controlled-input reset', () => {
  const input = { value: '010-0000-0000' };
  const phoneUpdate = registrationFieldUpdate('phone', input.value);
  input.value = 'new-partner@example.invalid';
  const emailUpdate = registrationFieldUpdate('email', input.value);
  input.value = '';
  const form = {
    name: '가상 파트너',
    phone: '',
    affiliation: '가상 검증소속',
    email: '',
    memberType: '한기평 컨설턴트' as const,
  };
  const result = emailUpdate(phoneUpdate(form));
  assert.equal(result.phone, '010-0000-0000');
  assert.equal(result.email, 'new-partner@example.invalid');
  assert.equal(result.name, form.name);
  assert.equal(form.phone, '');
});
const existingEmail = 'existing-partner@example.invalid';
let sequence = 0;
function body(extra: Record<string, unknown> = {}) {
  return {
    name: '가상 신규파트너',
    phone: '010-0000-0000',
    affiliation: '가상 검증소속',
    email: 'new-partner@example.invalid',
    memberType: '한기평 컨설턴트',
    confirmed: true,
    requestId: `test-partner-request-${++sequence}`,
    ...extra,
  };
}
function request(
  data: unknown,
  email = owner,
  path = '/api/admin/partners',
  method = 'POST',
  extraHeaders: Record<string, string> = {},
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...(email
        ? {
            'oai-authenticated-user-id': email,
            'oai-authenticated-user-email': email,
          }
        : {}),
      ...extraHeaders,
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(data) }),
  });
}
async function state() {
  return (await readPortalState()) as {
    members: PartnerRegistrationResult['members'];
    membersRevision?: number;
    tasks: unknown[];
    [key: string]: unknown;
  };
}
async function created(data = body()) {
  const response = await create(request(data));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as PartnerRegistrationResult;
}
beforeEach(async () => {
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    timeline: [],
    schedule: [],
    tasks: [{ id: 'preserved-task', assignee: '가상 기존파트너' }],
    companyDocuments: [],
    cases: [
      {
        id: 'private-existing',
        company: '가상 기존기업',
        trainee: '가상 기존파트너',
        partnerMemberId: 'existing-id',
      },
    ],
    members: [
      {
        id: 'existing-id',
        name: '가상 기존파트너',
        email: existingEmail,
        cohort: '',
        role: '일반 파트너',
        memberType: '타사 컨설턴트',
        status: '활성',
        companies: 0,
        permissions: { ...defaultPartnerPermissions },
      },
      {
        id: 'suspended-id',
        name: '가상 정지파트너',
        email: 'suspended@example.invalid',
        status: '정지',
        permissions: { ...defaultPartnerPermissions },
      },
    ],
  });
});

void test('direct-registration UI provides four empty labeled fields, four partner types and explicit activation confirmation', () => {
  const html = renderToStaticMarkup(
    createElement(AdminPartnerRegistration, {
      disabled: false,
      onRegistered: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /관리자 파트너 직접등록/);
  for (const key of ['name', 'phone', 'affiliation', 'email']) {
    assert.match(html, new RegExp(`for="partner-register-${key}"`));
    assert.match(html, new RegExp(`id="partner-register-${key}"`));
  }
  assert.equal((html.match(/<input[^>]*value=""/g) ?? []).length, 4);
  assert.equal((html.match(/<option(?: |>)/g) ?? []).length, 4);
  assert.match(html, /type="checkbox"/);
  assert.ok(!html.includes('checked=""'));
  assert.match(html, /관리자 권한과 견적·계약 열람 권한은 부여하지 않습니다/);
  assert.match(html, /파트너 등록·활성화/);
  const locked = renderToStaticMarkup(
    createElement(AdminPartnerRegistration, {
      disabled: true,
      onRegistered: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(locked, /기존 변경사항 저장이 완료되어야 등록할 수 있습니다/);
  assert.match(locked, /<button[^>]*disabled/);
});

void test('admin creates normalized active partner with least privilege, audit metadata and preserved state', async () => {
  const result = await created(
    body({
      name: ' 가상 신규파트너 ',
      email: ' NEW-PARTNER@EXAMPLE.INVALID ',
      role: 'admin',
      permissions: { quoteContract: true },
      status: '관리자',
    }),
  );
  assert.equal(result.member.name, '가상 신규파트너');
  assert.equal(result.member.email, 'new-partner@example.invalid');
  assert.equal(result.member.status, '활성');
  assert.equal(result.member.role, '일반 파트너');
  assert.deepEqual(result.member.permissions, defaultPartnerPermissions);
  assert.equal(result.member.registration?.createdBy, owner);
  assert.equal(result.member.registration?.method, 'admin');
  assert.equal(result.membersRevision, 1);
  assert.equal(result.members.length, 3);
  assert.equal(result.replayed, false);
  assert.equal((await state()).tasks.length, 1);
  const access = await getState(
    request(undefined, result.member.email, '/api/state', 'GET'),
  );
  assert.equal(access.status, 200);
  const payload = (await access.json()) as {
    currentUser: { role: string };
    state: { members: unknown[]; cases: unknown[] };
  };
  assert.equal(payload.currentUser.role, 'trainee');
  assert.equal(payload.state.members.length, 1);
  assert.equal(payload.state.cases.length, 0);
});

void test('only authenticated administrator may create; wrong origin and production local-owner identity blocked', async () => {
  for (const [email, status] of [
    ['', 401],
    [existingEmail, 403],
    ['suspended@example.invalid', 403],
    ['unknown@example.invalid', 403],
  ] as const) {
    assert.equal((await create(request(body(), email))).status, status);
  }
  assert.equal(
    (
      await create(
        request(body(), owner, undefined, undefined, {
          origin: 'https://unrelated.example.invalid',
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await create(
        request(body(), owner, undefined, undefined, {
          'sec-fetch-site': 'cross-site',
        }),
      )
    ).status,
    403,
  );
  const production = new Request(
    'https://portal.example.invalid/api/admin/partners',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'oai-authenticated-user-id': owner,
        'oai-authenticated-user-email': owner,
      },
      body: JSON.stringify(body()),
    },
  );
  assert.equal((await create(production)).status, 403);
  assert.equal((await state()).members.length, 2);
});

void test('all four fields, allowed partner type, confirmation and request id are required', async () => {
  for (const invalid of [
    { name: '' },
    { name: '잘못된\n이름' },
    { phone: '-------' },
    { affiliation: '' },
    { email: 'not-an-email' },
    { memberType: '관리자' },
    { confirmed: false },
    { requestId: 'short' },
  ]) {
    assert.equal(
      (await create(request(body(invalid)))).status,
      400,
      JSON.stringify(invalid),
    );
  }
  const checked = validatePartnerRegistration({});
  assert.equal(Object.keys(checked.errors).length, 6);
  assert.equal((await state()).members.length, 2);
});

void test('malformed JSON, non-object requests, oversized and non-JSON payloads never write', async () => {
  for (const value of [null, [], 'not-an-object'])
    assert.equal((await create(request(value))).status, 400);
  const malformed = new Request('http://localhost/api/admin/partners', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'oai-authenticated-user-id': owner,
      'oai-authenticated-user-email': owner,
    },
    body: '{',
  });
  assert.equal((await create(malformed)).status, 400);
  assert.equal(
    (
      await create(
        request(body(), owner, undefined, undefined, {
          'content-type': 'text/plain',
        }),
      )
    ).status,
    415,
  );
  assert.equal(
    (await create(request(body({ extra: 'x'.repeat(12_000) })))).status,
    413,
  );
  assert.equal((await state()).members.length, 2);
});

void test('case-insensitive duplicate, suspended account and owner address are rejected without changing existing permissions', async () => {
  for (const email of [
    existingEmail.toUpperCase(),
    'suspended@example.invalid',
    owner,
  ])
    assert.equal((await create(request(body({ email })))).status, 409);
  const current = await state();
  assert.equal(current.members.length, 2);
  assert.equal(current.members[1].status, '정지');
  assert.deepEqual(current.members[0].permissions, defaultPartnerPermissions);
});

void test('retry uses the same account; request id cannot be reused for different data', async () => {
  await readDuplicateRequestSummary();
  await (env as unknown as { DB: D1Database }).DB
    .prepare('DELETE FROM portal_duplicate_request_stats')
    .run();
  const data = body();
  const first = await created(data);
  const replay = await create(request(data));
  assert.equal(replay.status, 200);
  const second = (await replay.json()) as PartnerRegistrationResult;
  assert.equal(second.member.id, first.member.id);
  assert.equal(second.replayed, true);
  assert.equal(second.membersRevision, first.membersRevision);
  assert.equal(
    (await create(request({ ...data, phone: '010-1111-1111' }))).status,
    409,
  );
  assert.equal((await state()).members.length, 3);
  await flushWaitUntil();
  const summary = await readDuplicateRequestSummary();
  assert.equal(summary.totalSafeRetries, 1);
  assert.equal(summary.totalRequestKeyConflicts, 1);
});

void test('simultaneous independent creates preserve both; concurrent identical requests create only once', async () => {
  await readDuplicateRequestSummary();
  await (env as unknown as { DB: D1Database }).DB
    .prepare('DELETE FROM portal_duplicate_request_stats')
    .run();
  const results = await Promise.all([
    create(request(body({ email: 'first@example.invalid' }))),
    create(request(body({ email: 'second@example.invalid' }))),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    [201, 201],
  );
  assert.equal((await state()).members.length, 4);
  const identical = body({ email: 'third@example.invalid' });
  const repeats = await Promise.all([
    create(request(identical)),
    create(request(identical)),
  ]);
  assert.deepEqual(
    repeats.map((result) => result.status).sort((a, b) => a - b),
    [200, 201],
  );
  assert.equal((await state()).members.length, 5);
  assert.equal(membersRevisionOf(await state()), 3);
  await flushWaitUntil();
  assert.equal((await readDuplicateRequestSummary()).totalSafeRetries, 1);
});

void test('stale administrator autosave cannot erase a newly registered partner; fresh edits remain available', async () => {
  const stale = await state();
  const result = await created();
  const rejected = await save(
    request({ state: stale }, owner, '/api/state', 'PUT'),
  );
  assert.equal(rejected.status, 409);
  assert.equal((await state()).members.length, 3);
  const latest = await state();
  latest.members = latest.members.map((member) =>
    member.id === result.member.id
      ? { ...member, status: '정지' as const }
      : member,
  );
  const saved = await save(
    request({ state: latest }, owner, '/api/state', 'PUT'),
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(membersRevisionOf(await state()), 2);
  assert.equal(
    (await state()).members.find((member) => member.id === result.member.id)
      ?.status,
    '정지',
  );
});

void test('login statistics do not increment member revision; ordinary case/task saves keep registration metadata', async () => {
  await created();
  const current = await state();
  current.members[0].loginCount = 10;
  current.members[0].lastLoginAt = new Date().toISOString();
  current.tasks.push({ id: 'second-task', assignee: '가상 기존파트너' });
  const result = await save(
    request({ state: current }, owner, '/api/state', 'PUT'),
  );
  assert.equal(result.status, 200);
  assert.equal(membersRevisionOf(await state()), 1);
  assert.equal((await state()).members[2].registration?.method, 'admin');
  assert.ok(
    sameMemberRecords(
      [{ email: existingEmail }],
      [{ loginCount: 20, email: existingEmail }],
    ),
  );
});

void test('partner autosave cannot change membership, permissions or revision after administrator creation', async () => {
  const before = await state();
  await created();
  before.members = [
    {
      ...before.members[0],
      permissions: { ...defaultPartnerPermissions, quoteContract: true },
    },
  ];
  before.membersRevision = 999;
  const result = await save(
    request({ state: before }, existingEmail, '/api/state', 'PUT'),
  );
  assert.equal(result.status, 200);
  assert.equal((await state()).members.length, 3);
  assert.equal((await state()).members[0].permissions.quoteContract, false);
  assert.equal(membersRevisionOf(await state()), 1);
});

void test('public self registration still requires matching authenticated email and stays pending during concurrent admin creation', async () => {
  const signup = body({ email: 'self-signup@example.invalid' });
  assert.equal(
    (await selfRegister(request(signup, owner, '/api/register'))).status,
    403,
  );
  const results = await Promise.all([
    selfRegister(request(signup, signup.email, '/api/register')),
    create(request(body())),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 201],
  );
  const current = await state();
  assert.equal(current.members.length, 4);
  assert.equal(
    current.members.find((member) => member.email === signup.email)?.status,
    '승인대기',
  );
  assert.equal(membersRevisionOf(current), 2);
  assert.equal(
    (
      await selfRegister(
        request(body({ email: existingEmail }), existingEmail, '/api/register'),
      )
    ).status,
    409,
  );
});

void test('compare-and-swap retries against a concurrently modified non-member field', async () => {
  let attempts = 0;
  await mutatePortalState(async (raw) => {
    const current = raw as Record<string, unknown>;
    if (attempts++ === 0)
      await writePortalState({ ...current, externalFlag: 'preserve' });
    return { ...current, mutationFlag: true };
  });
  assert.equal(attempts, 2);
  assert.equal((await state()).externalFlag, 'preserve');
  assert.equal((await state()).mutationFlag, true);
});
