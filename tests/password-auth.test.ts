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
import { readPasswordAuthResponse } from '../lib/password-auth-response';
import { readPasswordLinkResponse } from '../lib/password-link-response';
import {
  readPasswordLinkSummary,
  recordPasswordLinkMetric,
} from '../lib/password-link-metrics';
import { portalPasswordSchemaSql, portalStateId } from '../db/schema';
import { failNextDatabaseStatement, flushWaitUntil } from './runtime-mock.mjs';

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
function statementSql(statement: D1PreparedStatement) {
  return (statement as unknown as { sql: string }).sql;
}
function assertPrivateAuthResponse(response: Response) {
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0',
  );
  assert.equal(response.headers.get('expires'), '0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
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
  const result = await readPasswordLinkResponse(response);
  return result.path.split('#token=')[1];
}
beforeEach(async () => {
  await flushWaitUntil();
  const db = await passwordDatabase();
  await db.batch(
    [
      'portal_password_accounts',
      'portal_chatgpt_identity_bindings',
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
void test('real password auth routes pass each client response guard', async () => {
  const registered = await signup(request(signupBody()));
  assert.deepEqual(await readPasswordAuthResponse(registered, 'register'), {
    message:
      '가입 신청이 접수되었습니다. 대표님이 연락처와 신청정보를 확인해 승인하면 이메일과 사이트 비밀번호로 로그인할 수 있습니다.',
  });
  await approve();
  const loggedInResponse = await login(request({ email, password }));
  assert.deepEqual(
    await readPasswordAuthResponse(loggedInResponse.clone(), 'login'),
    { ok: true },
  );
  const cookie = loggedInResponse.headers.get('set-cookie')!.split(';')[0];
  assert.deepEqual(
    await readPasswordAuthResponse(
      await logout(request({}, { cookie })),
      'logout',
    ),
    { ok: true },
  );

  const token = await link();
  const setupResponse = await setup(
    request({ token, password: 'another long synthetic secret 123!' }),
  );
  assert.deepEqual(await readPasswordAuthResponse(setupResponse, 'setup'), {
    message:
      '사이트 비밀번호가 설정되었습니다. 대표 승인 완료 계정은 이메일과 새 비밀번호로 로그인할 수 있습니다.',
  });
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
  assert.doesNotMatch(sessionCookie(request(), token), /Domain=/i);
  assertPrivateAuthResponse(response);
});
void test('administrator access binds the stable ChatGPT identity, rejects a recycled owner email and survives a provider email change', async () => {
  const initial = await getState(request(undefined, ownerHeaders));
  assert.equal(initial.status, 200, await initial.clone().text());
  const ownerBinding = await (
    await passwordDatabase()
  )
    .prepare(`SELECT subject_type, subject_id, user_key
      FROM portal_chatgpt_identity_bindings WHERE subject_type = 'owner'`)
    .first<{ subject_type: string; subject_id: string; user_key: string }>();
  assert.equal(ownerBinding?.subject_type, 'owner');
  assert.equal(ownerBinding?.subject_id, 'primary');
  assert.equal(
    ownerBinding?.user_key,
    tokenHash(`chatgpt-user:${ownerHeaders['oai-authenticated-user-id']}`),
  );
  assert.notEqual(
    ownerBinding?.user_key,
    ownerHeaders['oai-authenticated-user-id'],
  );

  const recycled = await getState(
    request(undefined, {
      'oai-authenticated-user-id': 'recycled-owner-user',
      'oai-authenticated-user-email': 'smkim3733@gmail.com',
    }),
  );
  assert.equal(recycled.status, 403, await recycled.clone().text());

  const changedEmail = await getState(
    request(undefined, {
      'oai-authenticated-user-id': ownerHeaders['oai-authenticated-user-id'],
      'oai-authenticated-user-email': 'changed-owner@example.invalid',
    }),
  );
  assert.equal(changedEmail.status, 200, await changedEmail.clone().text());
  assert.equal(
    ((await changedEmail.json()) as { currentUser: { role: string } })
      .currentUser.role,
    'admin',
  );
});
void test('administrator identity claim fails closed when binding storage fails', async () => {
  failNextDatabaseStatement('INSERT INTO portal_chatgpt_identity_bindings');
  const response = await getState(request(undefined, ownerHeaders));
  assert.equal(response.status, 500, await response.clone().text());
  assert.equal(
    await (
      await passwordDatabase()
    )
      .prepare(
        "SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE subject_type = 'owner'",
      )
      .first(),
    null,
  );
});
void test('administrator cannot assign a reserved owner email to a partner', async () => {
  for (const reservedOwnerEmail of [
    'smkim3733@gmail.com',
    'seedy@sites.test',
  ]) {
    const before = await state();
    const changed = structuredClone(before);
    changed.members[0].email = reservedOwnerEmail;
    const response = await saveState(
      request({ state: changed }, ownerHeaders, 'PUT'),
    );
    assert.equal(response.status, 403, await response.clone().text());
    assert.deepEqual(await state(), before);
  }
});
void test('administrator cannot save missing or duplicate stable member IDs', async () => {
  const before = await state();
  for (const changed of [
    {
      ...structuredClone(before),
      members: before.members.map((member, index) =>
        index === 0 ? { ...member, id: '' } : member,
      ),
    },
    {
      ...structuredClone(before),
      members: [
        ...before.members,
        {
          ...before.members[0],
          email: 'duplicate-id@example.invalid',
          name: '가상 중복ID 파트너',
        },
      ],
    },
  ]) {
    const response = await saveState(
      request({ state: changed }, ownerHeaders, 'PUT'),
    );
    assert.equal(response.status, 403, await response.clone().text());
    assert.deepEqual(await state(), before);
  }
});
void test('generic administrator state save cannot invent a partner account ID', async () => {
  const before = await state();
  const changed = structuredClone(before);
  changed.members.push({
    ...changed.members[0],
    id: 'forged-state-member',
    email: 'forged-state-member@example.invalid',
    name: '가상 위조 파트너',
  });

  const response = await saveState(
    request({ state: changed }, ownerHeaders, 'PUT'),
  );
  assert.equal(response.status, 403, await response.clone().text());
  assert.deepEqual(await state(), before);
});
void test('generic administrator state save cannot replace an existing stable member ID', async () => {
  const before = await state();
  const changed = structuredClone(before);
  changed.members[0].id = 'replaced-existing-member';

  const response = await saveState(
    request({ state: changed }, ownerHeaders, 'PUT'),
  );
  assert.equal(response.status, 403, await response.clone().text());
  assert.deepEqual(await state(), before);
});
void test('ChatGPT stable identity binding claims a legacy member, rejects a recycled email and accepts the bound user after an email change', async () => {
  const db = await passwordDatabase();
  const initial = await getState(
    request(undefined, {
      'oai-authenticated-user-id': 'test-bound-user',
      'oai-authenticated-user-email': 'existing@example.invalid',
    }),
  );
  assert.equal(initial.status, 200, await initial.clone().text());
  const binding = await db
    .prepare(`SELECT subject_id, user_key
      FROM portal_chatgpt_identity_bindings
      WHERE subject_type = 'member' AND subject_id = ?1`)
    .bind('existing')
    .first<{ subject_id: string; user_key: string }>();
  assert.equal(binding?.subject_id, 'existing');
  assert.equal(binding?.user_key, tokenHash('chatgpt-user:test-bound-user'));

  const recycled = await getState(
    request(undefined, {
      'oai-authenticated-user-id': 'different-user',
      'oai-authenticated-user-email': 'existing@example.invalid',
    }),
  );
  assert.equal(recycled.status, 403, await recycled.clone().text());
  const changedEmail = await getState(
    request(undefined, {
      'oai-authenticated-user-id': 'test-bound-user',
      'oai-authenticated-user-email': 'changed@example.invalid',
    }),
  );
  assert.equal(changedEmail.status, 200, await changedEmail.clone().text());
  assert.equal(
    ((await changedEmail.json()) as { currentUser: { memberId: string } })
      .currentUser.memberId,
    'existing',
  );
});
void test('unbound ChatGPT identity rejects a unique email whose legacy member ID is duplicated', async () => {
  const current = await state();
  current.members.push({
    ...current.members[0],
    email: 'duplicate-id-chatgpt@example.invalid',
    name: '가상 중복ID ChatGPT 파트너',
  });
  await writePortalState(current);
  const userId = 'duplicate-id-chatgpt-user';

  const response = await getState(
    request(undefined, {
      'oai-authenticated-user-id': userId,
      'oai-authenticated-user-email': 'duplicate-id-chatgpt@example.invalid',
    }),
  );
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(
    await (
      await passwordDatabase()
    )
      .prepare(
        'SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE user_key = ?1',
      )
      .bind(tokenHash(`chatgpt-user:${userId}`))
      .first(),
    null,
  );
});
void test('unbound ChatGPT identity rejects a legacy member without a stable ID', async () => {
  const current = await state();
  current.members[0].id = '';
  await writePortalState(current);
  const userId = 'missing-id-chatgpt-user';

  const response = await getState(
    request(undefined, {
      'oai-authenticated-user-id': userId,
      'oai-authenticated-user-email': current.members[0].email,
    }),
  );
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(
    await (
      await passwordDatabase()
    )
      .prepare(
        'SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE user_key = ?1',
      )
      .bind(tokenHash(`chatgpt-user:${userId}`))
      .first(),
    null,
  );
});
void test('bound ChatGPT identity rejects a legacy duplicate member ID', async () => {
  const headers = {
    'oai-authenticated-user-id': 'bound-duplicate-id-user',
    'oai-authenticated-user-email': 'existing@example.invalid',
  };
  await expectStatus(await getState(request(undefined, headers)), 200);
  const current = await state();
  current.members.push({
    ...current.members[0],
    email: 'bound-duplicate-id@example.invalid',
    name: '가상 결속후 중복ID 파트너',
  });
  await writePortalState(current);

  const response = await getState(request(undefined, headers));
  assert.equal(response.status, 403, await response.clone().text());
});
void test('unbound ChatGPT identity rejects an ambiguous legacy member email without creating a binding', async () => {
  const current = await state();
  current.members.push({
    ...current.members[0],
    id: 'duplicate-existing',
    name: '가상 중복이메일 파트너',
  });
  await writePortalState(current);

  const userId = 'ambiguous-legacy-user';
  const response = await getState(
    request(undefined, {
      'oai-authenticated-user-id': userId,
      'oai-authenticated-user-email': 'existing@example.invalid',
    }),
  );
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(
    await (
      await passwordDatabase()
    )
      .prepare(
        'SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE user_key = ?1',
      )
      .bind(tokenHash(`chatgpt-user:${userId}`))
      .first(),
    null,
  );
});
void test('legacy duplicate member ID blocks password login, session use and setup-link issuance', async () => {
  const cookie = await loggedIn();
  const current = await state();
  const member = current.members.find((item) => item.email === email)!;
  current.members.push({
    ...member,
    email: 'duplicate-id-password@example.invalid',
    name: '가상 중복ID 비밀번호 파트너',
  });
  await writePortalState(current);

  assert.equal((await login(request({ email, password }))).status, 403);
  assert.equal((await getState(request(undefined, { cookie }))).status, 403);
  assert.equal(
    (
      await issue(
        request({ memberId: member.id, confirmed: true }, ownerHeaders),
      )
    ).status,
    400,
  );
});
void test('ChatGPT identity binding survives suspension but is removed by an administrator email change', async () => {
  const db = await passwordDatabase();
  const headers = {
    'oai-authenticated-user-id': 'lifecycle-user',
    'oai-authenticated-user-email': 'existing@example.invalid',
  };
  await expectStatus(await getState(request(undefined, headers)), 200);

  const suspended = await state();
  suspended.members[0].status = '정지';
  await expectStatus(
    await saveState(request({ state: suspended }, ownerHeaders, 'PUT')),
    200,
  );
  assert.ok(
    await db
      .prepare(
        "SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE subject_type = 'member' AND subject_id = ?1",
      )
      .bind('existing')
      .first(),
  );

  const restored = await state();
  restored.members[0].status = '활성';
  await expectStatus(
    await saveState(request({ state: restored }, ownerHeaders, 'PUT')),
    200,
  );
  const changed = await state();
  changed.members[0].email = 'changed-binding@example.invalid';
  await expectStatus(
    await saveState(request({ state: changed }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal(
    await db
      .prepare(
        "SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE subject_type = 'member' AND subject_id = ?1",
      )
      .bind('existing')
      .first(),
    null,
  );
});
void test('member email change rolls back when ChatGPT identity binding revocation fails', async () => {
  const db = await passwordDatabase();
  await expectStatus(
    await getState(
      request(undefined, {
        'oai-authenticated-user-id': 'rollback-binding-user',
        'oai-authenticated-user-email': 'existing@example.invalid',
      }),
    ),
    200,
  );
  const before = await state();
  const changed = structuredClone(before);
  changed.members[0].email = 'rollback-binding@example.invalid';
  failNextDatabaseStatement('DELETE FROM portal_chatgpt_identity_bindings');
  assert.equal(
    (await saveState(request({ state: changed }, ownerHeaders, 'PUT'))).status,
    500,
  );
  const after = await state();
  assert.equal(after.members[0].email, 'existing@example.invalid');
  assert.equal(after.membersRevision, before.membersRevision);
  assert.ok(
    await db
      .prepare(
        "SELECT subject_id FROM portal_chatgpt_identity_bindings WHERE subject_type = 'member' AND subject_id = ?1",
      )
      .bind('existing')
      .first(),
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
  assertPrivateAuthResponse(absent);
  assert.deepEqual(await absent.json(), await wrong.json());
  for (let i = 0; i < 7; i++)
    assert.equal(
      (await login(request({ email, password: 'incorrect' }))).status,
      401,
    );
  const limited = await login(request({ email, password }));
  assert.equal(limited.status, 429);
  assertPrivateAuthResponse(limited);
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
    `${cookie}; other=${'x'.repeat(8_193)}`,
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
void test('login cannot commit a session after suspension wins the state race', async () => {
  await register();
  await approve();
  const memberId = (await state()).members[1].id;
  const db = await passwordDatabase();
  const batch = db.batch.bind(db);
  let once = true;
  db.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
    if (
      once &&
      statements.some((statement) =>
        statementSql(statement).includes(
          'INSERT INTO portal_password_sessions',
        ),
      )
    ) {
      once = false;
      const suspended = await state();
      suspended.members[1].status = '정지';
      await db
        .prepare(
          'UPDATE portal_state SET payload = ?1, updated_at = ?2 WHERE id = ?3',
        )
        .bind(
          JSON.stringify(suspended),
          new Date().toISOString(),
          portalStateId,
        )
        .run();
    }
    return batch<T>(statements);
  };
  try {
    assert.equal((await login(request({ email, password }))).status, 403);
  } finally {
    db.batch = batch;
  }
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_sessions WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    0,
  );
});
void test('stale setup-link issuance cannot delete a newer link after member email changes', async () => {
  const db = await passwordDatabase();
  const batch = db.batch.bind(db);
  const newerToken = 'a'.repeat(64);
  const changedEmail = 'changed@example.invalid';
  let once = true;
  db.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
    if (
      once &&
      statements.some((statement) =>
        statementSql(statement).includes('INSERT INTO portal_password_links'),
      )
    ) {
      once = false;
      const changed = await state();
      changed.members[0].email = changedEmail;
      await db
        .prepare(
          'UPDATE portal_state SET payload = ?1, updated_at = ?2 WHERE id = ?3',
        )
        .bind(JSON.stringify(changed), new Date().toISOString(), portalStateId)
        .run();
      await db
        .prepare(
          'INSERT INTO portal_password_links (token_hash, member_id, email, expires_at, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
        )
        .bind(
          tokenHash(newerToken),
          'existing',
          changedEmail,
          Date.now() + 30 * 60_000,
          'test-owner',
          new Date().toISOString(),
        )
        .run();
    }
    return batch<T>(statements);
  };
  try {
    assert.equal(
      (
        await issue(
          request({ memberId: 'existing', confirmed: true }, ownerHeaders),
        )
      ).status,
      409,
    );
  } finally {
    db.batch = batch;
  }
  const links = await database
    .prepare(
      'SELECT token_hash, email FROM portal_password_links WHERE member_id = ?1',
    )
    .bind('existing')
    .all<{ token_hash: string; email: string }>();
  assert.equal(links.results.length, 1);
  assert.equal(links.results[0]?.token_hash, tokenHash(newerToken));
  assert.equal(links.results[0]?.email, changedEmail);
});
void test('administrator status changes atomically revoke sessions and setup links so reactivation cannot revive them', async () => {
  const cookie = await loggedIn();
  const memberId = (await state()).members[1].id;
  const setupToken = await link(memberId);
  const suspended = await state();
  suspended.members[1].status = '정지';
  await expectStatus(
    await saveState(request({ state: suspended }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_sessions WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    0,
  );
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_links WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    0,
  );

  const restored = await state();
  restored.members[1].status = '활성';
  await expectStatus(
    await saveState(request({ state: restored }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal((await getState(request(undefined, { cookie }))).status, 401);
  assert.equal(
    (await setup(request({ token: setupToken, password: `${password} new` })))
      .status,
    400,
  );
  await expectStatus(await login(request({ email, password })), 200);
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_accounts WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    1,
  );
});
void test('approval preserves a pending account setup link while suspension remains revoking', async () => {
  const pending = await state();
  pending.members[0].status = '승인대기';
  await writePortalState(pending);
  const setupToken = await link('existing');
  const approved = await state();
  approved.members[0].status = '활성';
  await expectStatus(
    await saveState(request({ state: approved }, ownerHeaders, 'PUT')),
    200,
  );
  await expectStatus(
    await setup(request({ token: setupToken, password })),
    200,
  );
});
void test('email change and deletion atomically remove stale credentials while status changes preserve them', async () => {
  await loggedIn();
  const memberId = (await state()).members[1].id;
  const changedEmail = 'changed-login@example.invalid';
  const changed = await state();
  changed.members[1].email = changedEmail;
  await expectStatus(
    await saveState(request({ state: changed }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_accounts WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    0,
  );
  assert.equal((await login(request({ email, password }))).status, 401);

  const changedPassword = `${password} changed email`;
  const setupToken = await link(memberId);
  await expectStatus(
    await setup(request({ token: setupToken, password: changedPassword })),
    200,
  );
  await expectStatus(
    await login(request({ email: changedEmail, password: changedPassword })),
    200,
  );

  const suspended = await state();
  suspended.members[1].status = '정지';
  await expectStatus(
    await saveState(request({ state: suspended }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_accounts WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    1,
  );

  const removed = await state();
  removed.members = removed.members.filter((member) => member.id !== memberId);
  await expectStatus(
    await saveState(request({ state: removed }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_accounts WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    0,
  );
  assert.equal(
    (await register({ email: changedEmail, password: changedPassword })).status,
    201,
  );
});
void test('member email changes reject credentials reserved by a detached account', async () => {
  const db = await passwordDatabase();
  const reservedEmail = 'detached-reservation@example.invalid';
  await db
    .prepare(`INSERT INTO portal_password_accounts
      (member_id, email, password_hash, credential_version, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
    .bind(
      'deleted-detached-member',
      reservedEmail,
      hashPassword(password),
      'detached-credential-version',
      new Date().toISOString(),
    )
    .run();
  const changed = await state();
  changed.members[0].email = reservedEmail;
  const response = await saveState(
    request({ state: changed }, ownerHeaders, 'PUT'),
  );
  assert.equal(response.status, 409, await response.clone().text());
  assert.match(
    ((await response.json()) as { error: string }).error,
    /비밀번호 자격/,
  );
  assert.equal((await state()).members[0].email, 'existing@example.invalid');
  const resurrected = await state();
  resurrected.members.push({
    id: 'deleted-detached-member',
    name: '가상 재생성 파트너',
    email: reservedEmail,
    cohort: '',
    role: '일반 파트너',
    status: '활성',
    companies: 0,
    permissions: { ...defaultPartnerPermissions },
  });
  assert.equal(
    (await saveState(request({ state: resurrected }, ownerHeaders, 'PUT')))
      .status,
    403,
  );
  assert.equal((await state()).members.length, 1);
  assert.equal(
    (
      await db
        .prepare(
          'SELECT member_id FROM portal_password_accounts WHERE email = ?1',
        )
        .bind(reservedEmail)
        .first<{ member_id: string }>()
    )?.member_id,
    'deleted-detached-member',
  );
});
void test('member email changes may reconcile and remove a credential already owned by that member', async () => {
  const db = await passwordDatabase();
  const reconciledEmail = 'reconciled-owner@example.invalid';
  await db
    .prepare(`INSERT INTO portal_password_accounts
      (member_id, email, password_hash, credential_version, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
    .bind(
      'existing',
      reconciledEmail,
      hashPassword(password),
      'reconciled-credential-version',
      new Date().toISOString(),
    )
    .run();
  const changed = await state();
  changed.members[0].email = reconciledEmail;
  await expectStatus(
    await saveState(request({ state: changed }, ownerHeaders, 'PUT')),
    200,
  );
  assert.equal((await state()).members[0].email, reconciledEmail);
  assert.equal(
    (
      await db
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_accounts WHERE member_id = ?1',
        )
        .bind('existing')
        .first<{ total: number }>()
    )?.total,
    0,
  );
});
void test('member state write rolls back when password access revocation fails', async () => {
  const cookie = await loggedIn();
  const before = await state();
  const memberId = before.members[1].id;
  const suspended = structuredClone(before);
  suspended.members[1].status = '정지';
  failNextDatabaseStatement('DELETE FROM portal_password_sessions');
  assert.equal(
    (await saveState(request({ state: suspended }, ownerHeaders, 'PUT')))
      .status,
    500,
  );
  const after = await state();
  assert.equal(after.members[1].status, '활성');
  assert.equal(after.membersRevision, before.membersRevision);
  assert.equal(
    (
      await database
        .prepare(
          'SELECT COUNT(*) AS total FROM portal_password_sessions WHERE member_id = ?1',
        )
        .bind(memberId)
        .first<{ total: number }>()
    )?.total,
    1,
  );
  await expectStatus(await getState(request(undefined, { cookie })), 200);
});
void test('email change rolls back state and all access revocation when credential deletion fails', async () => {
  const cookie = await loggedIn();
  const memberId = (await state()).members[1].id;
  await link(memberId);
  const before = await state();
  const changed = structuredClone(before);
  changed.members[1].email = 'rollback-email@example.invalid';
  failNextDatabaseStatement('DELETE FROM portal_password_accounts');
  assert.equal(
    (await saveState(request({ state: changed }, ownerHeaders, 'PUT'))).status,
    500,
  );
  const after = await state();
  assert.equal(after.members[1].email, email);
  assert.equal(after.membersRevision, before.membersRevision);
  for (const table of [
    'portal_password_accounts',
    'portal_password_sessions',
    'portal_password_links',
  ])
    assert.equal(
      (
        await database
          .prepare(
            `SELECT COUNT(*) AS total FROM ${table} WHERE member_id = ?1`,
          )
          .bind(memberId)
          .first<{ total: number }>()
      )?.total,
      1,
    );
  await expectStatus(await getState(request(undefined, { cookie })), 200);
});
void test('logout revokes token and clears host cookie; replay is unauthorized', async () => {
  const cookie = await loggedIn();
  const response = await expectStatus(
    await logout(request({}, { cookie })),
    200,
  );
  assert.match(response.headers.get('set-cookie')!, /Max-Age=0/);
  assert.match(response.headers.get('set-cookie')!, /Secure/);
  assert.doesNotMatch(response.headers.get('set-cookie')!, /Domain=/i);
  assertPrivateAuthResponse(response);
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
  assert.equal(
    (await signup(request({}, { 'content-type': 'application/jsonx' }))).status,
    415,
  );
  assert.equal(
    (await signup(request({}, { 'content-length': 'invalid' }))).status,
    400,
  );
});
void test('ChatGPT and cookie-authenticated state and multipart writes require Origin', async () => {
  const ownerState = await state();
  assert.equal(
    (
      await saveState(
        new Request(`${origin}/test`, {
          method: 'PUT',
          headers: {
            ...ownerHeaders,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ state: ownerState }),
        }),
      )
    ).status,
    403,
  );
  const cookie = await loggedIn();
  assert.equal(
    (
      await saveState(
        new Request(`${origin}/test`, {
          method: 'PUT',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ state: await state() }),
        }),
      )
    ).status,
    403,
  );
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
    .prepare(
      'UPDATE portal_password_links SET expires_at = 0 WHERE token_hash = ?1',
    )
    .bind(tokenHash(second))
    .run();
  const expiredResponse = await setup(request({ token: second, password }));
  assert.equal(expiredResponse.status, 400);
  const expiredError = (await expiredResponse.json()) as { error: string };
  const unknownError = (await setup(
    request({ token: 'f'.repeat(64), password }),
  )) as Response;
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
  assert.equal(
    portalPasswordSchemaSql.join('\n').includes('portal_password_link_stats'),
    false,
  );
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
