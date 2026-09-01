import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { env } from 'cloudflare:workers';
import { POST as signup } from '../app/api/auth/register/route';
import { POST as login } from '../app/api/auth/login/route';
import { POST as logout } from '../app/api/auth/logout/route';
import { POST as setup } from '../app/api/auth/setup/route';
import { POST as issue } from '../app/api/admin/partners/password-link/route';
import { GET as getState, PUT as saveState } from './state-request';
import { GET as getFlow } from '../app/api/consulting-flow/[caseId]/route';
import { POST as upload } from '../app/api/files/route';
import {
  readPortalState,
  writePortalState,
  mutatePortalState,
} from '../lib/portal-state';
import { passwordDatabase, sessionCookie } from '../lib/password-store';
import {
  hashPassword,
  verifyPassword,
  tokenHash,
} from '../lib/password-crypto';
import { passwordProblem } from '../lib/password-policy';
import {
  defaultPartnerPermissions,
  type PartnerAccount,
} from '../lib/partner-registration';
import { PartnerAuthPanel } from '../components/partner-auth-panel';
import { PartnerPasswordLink } from '../components/partner-password-link';
import {
  readPasswordLinkSummary,
  recordPasswordLinkMetric,
} from '../lib/password-link-metrics';
import { portalPasswordSchemaSql } from '../db/schema';
import {
  failNextDatabaseStatement,
  flushWaitUntil,
} from './runtime-mock.mjs';

const origin = 'https://portal.example.invalid';
const database = (env as unknown as { DB: D1Database }).DB;
const email = 'synthetic-partner@example.invalid';
const password = 'test only long secret 123!';
const ownerHeaders = {
  'oai-authenticated-user-id': 'test-owner',
  'oai-authenticated-user-email': 'smkim3733@gmail.com',
};
function request(
  data?: unknown,
  headers: Record<string, string> = {},
  method = data === undefined ? 'GET' : 'POST',
) {
  return new Request(`${origin}/test`, {
    method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    ...(method === 'GET' || data === undefined
      ? {}
      : { body: JSON.stringify(data) }),
  });
}
const signupBody = (extra: Record<string, unknown> = {}) => ({
  name: '가상 검증파트너',
  phone: '010-0000-0000',
  affiliation: '가상 검증소속',
  email,
  password,
  consent: true,
  ...extra,
});
async function state() {
  return (await readPortalState()) as {
    members: PartnerAccount[];
    membersRevision: number;
    cases: Record<string, unknown>[];
    [key: string]: unknown;
  };
}
async function expectStatus(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
  return response;
}
async function register(extra: Record<string, unknown> = {}) {
  return expectStatus(await signup(request(signupBody(extra))), 201);
}
async function approve() {
  await mutatePortalState(async (raw) => ({
    ...(raw as object),
    members: (raw as Awaited<ReturnType<typeof state>>).members.map((m) =>
      m.email === email ? { ...m, status: '활성' } : m,
    ),
  }));
}
async function loggedIn() {
  await register();
  await approve();
  const response = await expectStatus(
    await login(request({ email, password })),
    200,
  );
  return response.headers.get('set-cookie')!.split(';')[0];
}
async function link(memberId = 'existing') {
  const response = await expectStatus(
    await issue(request({ memberId, confirmed: true }, ownerHeaders)),
    201,
  );
  const result = (await response.json()) as { path: string };
  return result.path.split('#token=')[1];
}
beforeEach(async () => {
  await flushWaitUntil();
  const db = await passwordDatabase();
  await db.batch(
    [
      'portal_password_accounts',
      'portal_password_sessions',
      'portal_password_links',
      'portal_auth_limits',
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  await readPasswordLinkSummary();
  await database.prepare('DELETE FROM portal_password_link_stats').run();
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    membersRevision: 4,
    timeline: [],
    schedule: [],
    tasks: [],
    companyDocuments: [],
    cases: [
      {
        id: 'other-case',
        company: '가상 비공개기업',
        trainee: '가상 기존파트너',
        partnerMemberId: 'existing',
      },
    ],
    members: [
      {
        id: 'existing',
        name: '가상 기존파트너',
        email: 'existing@example.invalid',
        role: '일반 파트너',
        status: '활성',
        cohort: '',
        companies: 1,
        permissions: { ...defaultPartnerPermissions },
      },
    ],
  });
});

void test('non-local credential endpoints require HTTPS, even with a matching Origin', async () => {
  const response = await signup(
    new Request('http://portal.example.invalid/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://portal.example.invalid',
        'content-type': 'application/json',
      },
      body: JSON.stringify(signupBody()),
    }),
  );
  assert.equal(response.status, 403);
  assert.equal((await state()).members.length, 1);
});

void test('signup UI has exactly five fields, username/new-password autocomplete and mailbox-password warning', () => {
  const html = renderToStaticMarkup(
    createElement(PartnerAuthPanel, { initialMode: 'signup' }),
  );
  for (const key of ['name', 'phone', 'affiliation', 'email', 'password'])
    assert.match(html, new RegExp(`name="${key}"`));
  assert.equal((html.match(/<input/g) ?? []).length, 6); // Five fields plus explicit consent, not an extra personal-data field.
  assert.match(html, /autoComplete="username"/i);
  assert.match(html, /autoComplete="new-password"/i);
  assert.match(html, /네이버·구글 메일 비밀번호가 아닙니다/);
  assert.match(html, /대표 승인 요청/);
  assert.doesNotMatch(html, /onPaste=|readonly="".*name="password"/i);
  const loginHtml = renderToStaticMarkup(createElement(PartnerAuthPanel));
  assert.match(loginHtml, /autoComplete="current-password"/i);
  assert.equal((loginHtml.match(/<input/g) ?? []).length, 2);
});
void test('admin reset UI requires explicit identity confirmation and does not auto-send email', () => {
  const html = renderToStaticMarkup(
    createElement(PartnerPasswordLink, {
      memberId: 'existing',
      email,
      disabled: false,
    }),
  );
  assert.match(html, /본인임을 확인했습니다/);
  assert.match(html, /30분 유효 일회용 링크/);
  assert.match(html, /<button[^>]*disabled/);
  assert.doesNotMatch(html, /checked=""/);
});
void test('password policy, unique salted scrypt hashes and exact password comparison', () => {
  assert.ok(passwordProblem('12345678'));
  assert.ok(passwordProblem('a'.repeat(16)));
  assert.ok(passwordProblem('가'.repeat(129)));
  assert.equal(passwordProblem('기억하기 쉬운 나만의 긴 문장 2026'), '');
  const one = hashPassword(password);
  const two = hashPassword(password);
  assert.notEqual(one, two);
  assert.ok(verifyPassword(password, one));
  assert.ok(!verifyPassword(`${password} `, one));
  assert.ok(!verifyPassword(password));
  assert.ok(!verifyPassword(password, 'scrypt$99999999$8$5$bad'));
});
void test('anonymous signup stores pending member, fixed minimum rights and only a salted hash outside state', async () => {
  await register({
    email: ` ${email.toUpperCase()} `,
    status: '활성',
    role: 'admin',
    memberType: '한기평 컨설턴트',
    permissions: { quoteContract: true },
  });
  const current = await state();
  const member = current.members[1];
  assert.equal(current.members.length, 2);
  assert.equal(current.membersRevision, 5);
  assert.equal(member.email, email);
  assert.equal(member.status, '승인대기');
  assert.equal(member.role, '일반 파트너');
  assert.equal(member.memberType, '기타');
  assert.deepEqual(member.permissions, defaultPartnerPermissions);
  assert.equal(member.registration?.method, 'self_password');
  assert.doesNotMatch(
    JSON.stringify(current),
    /password_hash|credential_version|test only long secret/,
  );
  const account = await database
    .prepare(
      'SELECT password_hash FROM portal_password_accounts WHERE email = ?1',
    )
    .bind(email)
    .first<{ password_hash: string }>();
  assert.ok(account);
  assert.ok(verifyPassword(password, account.password_hash));
  assert.notEqual(account.password_hash, password);
  assert.equal((await login(request({ email, password }))).status, 403);
  assert.equal((await getState(request())).status, 401);
});
void test('new signup cannot claim existing, pending, suspended, duplicate or owner emails', async () => {
  for (const status of ['활성', '정지', '승인대기']) {
    const current = await state();
    current.members[0].status = status as PartnerAccount['status'];
    await writePortalState(current);
    assert.equal(
      (await signup(request(signupBody({ email: 'EXISTING@example.invalid' }))))
        .status,
      409,
    );
  }
  for (const reserved of ['smkim3733@gmail.com', 'seedy@sites.test'])
    assert.equal(
      (await signup(request(signupBody({ email: reserved })))).status,
      409,
    );
  await register();
  assert.equal((await signup(request(signupBody()))).status, 409);
  assert.equal((await state()).members.length, 2);
});
void test('validation refuses missing consent, malformed email, blank contact and weak passwords', async () => {
  for (const extra of [
    { consent: false },
    { email: 'not-mail' },
    { name: '' },
    { phone: '' },
    { affiliation: '' },
    { password: 'short' },
  ])
    assert.equal((await signup(request(signupBody(extra)))).status, 400);
  assert.equal((await state()).members.length, 1);
});
void test('approval enables cookie-only login; session cannot elevate to mocked ChatGPT administrator', async () => {
  const cookie = await loggedIn();
  const response = await expectStatus(
    await getState(request(undefined, { cookie, ...ownerHeaders })),
    200,
  );
  const payload = (await response.json()) as {
    currentUser: { role: string; authMethod: string };
    state: { members: unknown[]; cases: unknown[] };
  };
  assert.equal(payload.currentUser.role, 'trainee');
  assert.equal(payload.currentUser.authMethod, 'password');
  assert.equal(payload.state.members.length, 1);
  assert.equal(payload.state.cases.length, 0);
  const token = cookie.split('=')[1];
  const stored = await database
    .prepare('SELECT token_hash FROM portal_password_sessions')
    .first<{ token_hash: string }>();
  assert.equal(stored?.token_hash, tokenHash(token));
  assert.notEqual(stored?.token_hash, token);
  assert.match(
    sessionCookie(request(), token),
    /^__Host-keve_session=.*HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/,
  );
});
void test('bad and nonexistent passwords return the same generic message; login rate limits expensive checks', async () => {
  await register();
  const absent = await login(
    request({ email: 'absent@example.invalid', password }),
  );
  const wrong = await login(
    request({ email, password: 'wrong password long enough' }),
  );
  assert.equal(absent.status, 401);
  assert.deepEqual(await absent.json(), await wrong.json());
  for (let i = 0; i < 7; i++)
    assert.equal(
      (await login(request({ email, password: 'incorrect' }))).status,
      401,
    );
  const limited = await login(request({ email, password }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '900');
});
void test('expiry, bad cookie and duplicate cookie never fall back to admin headers', async () => {
  const cookie = await loggedIn();
  await database
    .prepare('UPDATE portal_password_sessions SET expires_at = 0')
    .run();
  for (const value of [
    cookie,
    '__Host-keve_session=invalid',
    `${cookie}; ${cookie}`,
  ])
    assert.equal(
      (await getState(request(undefined, { cookie: value, ...ownerHeaders })))
        .status,
      401,
    );
});
void test('suspension, deletion and email change immediately block a session', async () => {
  const cookie = await loggedIn();
  const before = await state();
  for (const change of ['suspend', 'delete', 'email']) {
    const current = structuredClone(before);
    if (change === 'suspend') current.members[1].status = '정지';
    if (change === 'delete') current.members.splice(1, 1);
    if (change === 'email')
      current.members[1].email = 'changed@example.invalid';
    await writePortalState(current);
    assert.equal((await getState(request(undefined, { cookie }))).status, 403);
  }
});
void test('logout revokes token and clears host cookie; replay is unauthorized', async () => {
  const cookie = await loggedIn();
  const response = await expectStatus(
    await logout(request({}, { cookie })),
    200,
  );
  assert.match(response.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal((await getState(request(undefined, { cookie }))).status, 401);
});
void test('all public credential routes reject missing/cross-site Origin; oversized body and wrong content type refused', async () => {
  for (const handler of [signup, login, setup, logout, issue]) {
    assert.equal((await handler(request({}, { origin: '' }))).status, 403);
    assert.equal(
      (await handler(request({}, { origin: 'https://evil.example' }))).status,
      403,
    );
    assert.equal(
      (await handler(request({}, { 'sec-fetch-site': 'cross-site' }))).status,
      403,
    );
  }
  assert.equal(
    (await signup(request({ big: 'a'.repeat(13_000) }))).status,
    413,
  );
  assert.equal(
    (await signup(request({}, { 'content-type': 'text/plain' }))).status,
    415,
  );
});
void test('cookie-authenticated legacy state and multipart writes enforce Origin, including missing Origin', async () => {
  const cookie = await loggedIn();
  assert.equal(
    (
      await saveState(
        request({ state: await state() }, { cookie, origin: '' }, 'PUT'),
      )
    ).status,
    403,
  );
  assert.equal((await upload(request({}, { cookie, origin: '' }))).status, 403);
  const response = await getFlow(request(undefined, { cookie }), {
    params: Promise.resolve({ caseId: 'other-case' }),
  });
  assert.equal(response.status, 403);
});
void test('only admin can issue setup links and must confirm identity', async () => {
  assert.equal(
    (await issue(request({ memberId: 'existing', confirmed: true }))).status,
    401,
  );
  assert.equal(
    (await issue(request({ memberId: 'existing' }, ownerHeaders))).status,
    400,
  );
  const cookie = await loggedIn();
  assert.equal(
    (
      await issue(
        request({ memberId: 'existing', confirmed: true }, { cookie }),
      )
    ).status,
    403,
  );
});
void test('existing partner chooses their own password via hashed, one-time link and logs in without ChatGPT', async () => {
  const token = await link();
  const row = await database
    .prepare(
      'SELECT token_hash, expires_at, created_by FROM portal_password_links',
    )
    .first<{ token_hash: string; expires_at: number; created_by: string }>();
  assert.equal(row?.token_hash, tokenHash(token));
  assert.ok(row!.expires_at > Date.now() + 29 * 60_000);
  assert.equal(row?.created_by, 'test-owner');
  assert.doesNotMatch(JSON.stringify(await state()), new RegExp(token));
  await expectStatus(await setup(request({ token, password })), 200);
  assert.equal(
    (await setup(request({ token, password: `${password}2` }))).status,
    400,
  );
  await expectStatus(
    await login(request({ email: 'existing@example.invalid', password })),
    200,
  );
});
void test('password reset revokes old sessions and old password; replay cannot revoke a new session', async () => {
  const cookie = await loggedIn();
  const memberId = (await state()).members[1].id;
  const token = await link(memberId);
  const nextPassword = `${password} replacement`;
  await expectStatus(
    await setup(request({ token, password: nextPassword })),
    200,
  );
  assert.equal((await getState(request(undefined, { cookie }))).status, 401);
  assert.equal((await login(request({ email, password }))).status, 401);
  const response = await expectStatus(
    await login(request({ email, password: nextPassword })),
    200,
  );
  const nextCookie = response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await setup(request({ token, password }))).status, 400);
  assert.equal(
    (await getState(request(undefined, { cookie: nextCookie }))).status,
    200,
  );
});
void test('replacement link invalidates earlier link; expired/changed/suspended/deleted member cannot redeem', async () => {
  const first = await link();
  const second = await link();
  assert.equal((await setup(request({ token: first, password }))).status, 400);
  await database
    .prepare('UPDATE portal_password_links SET expires_at = 0')
    .run();
  assert.equal((await setup(request({ token: second, password }))).status, 400);
  const current = await state();
  for (const change of ['email', 'suspend', 'delete']) {
    await writePortalState(current);
    const token = await link();
    const changed = structuredClone(current);
    if (change === 'email')
      changed.members[0].email = 'changed@example.invalid';
    if (change === 'suspend') changed.members[0].status = '정지';
    if (change === 'delete') changed.members = [];
    await writePortalState(changed);
    assert.equal((await setup(request({ token, password }))).status, 400);
  }
});
void test('password-link operations record anonymous seven-day totals without changing link semantics', async () => {
  const first = await link();
  await flushWaitUntil();
  const second = await link();
  await flushWaitUntil();
  assert.equal((await setup(request({ token: first, password }))).status, 400);

  await database
    .prepare('UPDATE portal_password_links SET expires_at = 0 WHERE token_hash = ?1')
    .bind(tokenHash(second))
    .run();
  const expiredResponse = await setup(request({ token: second, password }));
  assert.equal(expiredResponse.status, 400);
  const expiredError = (await expiredResponse.json()) as { error: string };
  const unknownError = (await setup(request({ token: 'f'.repeat(64), password }))) as Response;
  assert.equal(unknownError.status, 400);
  assert.equal(
    ((await unknownError.json()) as { error: string }).error,
    expiredError.error,
  );
  await flushWaitUntil();

  const third = await link();
  await flushWaitUntil();
  await expectStatus(await setup(request({ token: third, password })), 200);
  await flushWaitUntil();

  assert.deepEqual(await readPasswordLinkSummary(), {
    windowDays: 7,
    issued: 3,
    activeReplacements: 1,
    expiredAtReissue: 1,
    redeemed: 1,
    observedExpiredAttempts: 1,
  });
  const columns = await database
    .prepare('PRAGMA table_info(portal_password_link_stats)')
    .all<{ name: string }>();
  assert.deepEqual(
    columns.results.map((column) => column.name),
    [
      'bucket_date',
      'issued_count',
      'active_replacement_count',
      'expired_at_reissue_count',
      'redeemed_count',
      'observed_expired_attempt_count',
    ],
  );
});
void test('password-link summary uses Korean date boundaries and stays outside credential schema', async () => {
  assert.equal(portalPasswordSchemaSql.join('\n').includes('portal_password_link_stats'), false);
  await recordPasswordLinkMetric({
    issued: 1,
    occurredAt: '2026-08-31T14:59:59.000Z',
  });
  await recordPasswordLinkMetric({
    redeemed: 1,
    occurredAt: '2026-08-31T15:00:00.000Z',
  });
  assert.deepEqual(
    await readPasswordLinkSummary(1, '2026-09-01T03:00:00.000Z'),
    {
      windowDays: 1,
      issued: 0,
      activeReplacements: 0,
      expiredAtReissue: 0,
      redeemed: 1,
      observedExpiredAttempts: 0,
    },
  );
});
void test('password-link metric DDL and scheduling failures cannot change issuance', async () => {
  failNextDatabaseStatement('SELECT expires_at, consumed_by');
  const classificationFailure = await issue(
    request({ memberId: 'existing', confirmed: true }, ownerHeaders),
  );
  assert.equal(
    classificationFailure.status,
    201,
    await classificationFailure.clone().text(),
  );
  await flushWaitUntil();
  failNextDatabaseStatement('portal_password_link_stats');
  const response = await issue(
    request({ memberId: 'existing', confirmed: true }, ownerHeaders),
  );
  assert.equal(response.status, 201, await response.clone().text());
  await flushWaitUntil();
});
void test('concurrent redemption succeeds once and preserves the winning password', async () => {
  const token = await link();
  const responses = await Promise.all([
    setup(request({ token, password })),
    setup(request({ token, password: `${password} alternative` })),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status).sort((a, b) => a - b),
    [200, 400],
  );
  const winningPassword =
    responses[0].status === 200 ? password : `${password} alternative`;
  assert.equal(
    (
      await login(
        request({
          email: 'existing@example.invalid',
          password: winningPassword,
        }),
      )
    ).status,
    200,
  );
});
void test('concurrent signups preserve both members and existing company data', async () => {
  const responses = await Promise.all([
    signup(request(signupBody())),
    signup(request(signupBody({ email: 'second@example.invalid' }))),
  ]);
  for (const response of responses) await expectStatus(response, 201);
  const current = await state();
  assert.equal(current.members.length, 3);
  assert.equal(current.membersRevision, 6);
  assert.equal(current.cases.length, 1);
  assert.equal(current.members[0].status, '활성');
});
void test('duplicate simultaneous signup creates one credential and one member', async () => {
  const responses = await Promise.all([
    signup(request(signupBody())),
    signup(request(signupBody())),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status).sort((a, b) => a - b),
    [201, 409],
  );
  assert.equal((await state()).members.length, 2);
  const accounts = await database
    .prepare('SELECT member_id FROM portal_password_accounts')
    .all();
  assert.equal(accounts.results.length, 1);
});
void test('D1 mock rolls back credential inserts when a later batch statement fails', async () => {
  await assert.rejects(
    database.batch([
      database.prepare(
        "INSERT INTO portal_auth_limits VALUES ('rollback-key',1,9999999999999)",
      ),
      database.prepare('INSERT INTO table_that_does_not_exist VALUES (1)'),
    ]),
  );
  assert.equal(
    await database
      .prepare(
        "SELECT * FROM portal_auth_limits WHERE key_hash = 'rollback-key'",
      )
      .first(),
    null,
  );
});
