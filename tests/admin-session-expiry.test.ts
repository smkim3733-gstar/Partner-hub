import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  postgresRuntimeFixture,
  postgresTestOrigin as origin,
} from './supabase-runtime-fixture';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import {
  provisionStandaloneAdmin,
  standaloneAdminLifetimeSeconds,
} from '../lib/standalone-admin-store';
import {
  ADMIN_SESSION_WARNING_MS,
  adminSessionDeadline,
  adminSessionNotice,
  readAdminSessionDeadline,
} from '../lib/admin-session-notice';
import { AdminSessionNotice } from '../components/admin-session-notice';
import { flushWaitUntil } from './runtime-mock.mjs';

const { writePortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { loginPassword, registerPassword } =
  await import('../lib/password-handlers');
const { GET: getState } = await import('../app/api/state/route');
const { GET: getAdminSession } =
  await import('../app/api/auth/admin-session/route');

void test('administrator login notice warns in the last ten minutes', () => {
  const now = 1_000_000_000_000;
  assert.deepEqual(adminSessionNotice(null, now), { kind: 'none' });
  assert.deepEqual(adminSessionNotice(now + 60 * 60 * 1000, now), {
    kind: 'none',
  });
  assert.deepEqual(adminSessionNotice(now + ADMIN_SESSION_WARNING_MS + 1, now), {
    kind: 'none',
  });
  assert.deepEqual(adminSessionNotice(now + ADMIN_SESSION_WARNING_MS, now), {
    kind: 'warning',
    minutesLeft: 10,
  });
  assert.deepEqual(adminSessionNotice(now + 4 * 60 * 1000 + 1, now), {
    kind: 'warning',
    minutesLeft: 5,
  });
  assert.deepEqual(adminSessionNotice(now + 1000, now), {
    kind: 'warning',
    minutesLeft: 1,
  });
  assert.deepEqual(adminSessionNotice(now, now), { kind: 'expired' });
  assert.deepEqual(adminSessionNotice(now - 1, now), { kind: 'expired' });
  assert.equal(adminSessionDeadline(3600, now), now + 3_600_000);
  assert.equal(adminSessionDeadline(0, now), now);
  for (const bad of [undefined, null, -1, 1.5, '3600', Number.NaN])
    assert.equal(adminSessionDeadline(bad, now), null);
});

void test('administrator login re-check reads only the session endpoint', async () => {
  const calls: string[] = [];
  const reply =
    (status: number, body: unknown): typeof fetch =>
    async (input) => {
      calls.push(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return new Response(JSON.stringify(body), { status });
    };
  assert.equal(
    await readAdminSessionDeadline(
      reply(200, { sessionExpiresInSeconds: 120 }),
      () => 5000,
    ),
    125_000,
  );
  assert.deepEqual(calls, ['/api/auth/admin-session']);
  assert.equal(
    await readAdminSessionDeadline(reply(401, { error: 'x' })),
    'signed-out',
  );
  assert.equal(
    await readAdminSessionDeadline(reply(403, { error: 'x' })),
    'signed-out',
  );
  assert.equal(await readAdminSessionDeadline(reply(500, {})), null);
  assert.equal(
    await readAdminSessionDeadline(reply(200, { sessionExpiresInSeconds: -5 })),
    null,
  );
  assert.equal(
    await readAdminSessionDeadline(async () => {
      throw new TypeError('offline');
    }),
    null,
  );
});

void test('administrator login notice tells how to keep on-screen work', () => {
  const render = (deadline: number | null) =>
    renderToStaticMarkup(createElement(AdminSessionNotice, { deadline }));
  assert.equal(render(null), '');
  assert.equal(render(Date.now() + 30 * 60 * 1000), '');
  const warning = render(Date.now() + 5 * 60 * 1000 - 1000);
  assert.match(warning, /role="status"/);
  assert.match(warning, /관리자 로그인이 약 5분 뒤 만료됩니다/);
  assert.match(warning, /href="\/account" target="_blank"/);
  const expired = render(Date.now() - 1000);
  assert.match(expired, /role="alert"/);
  assert.match(expired, /관리자 로그인이 만료되었습니다/);
  assert.match(expired, /새로고침하거나 닫지 마세요/);
  assert.match(expired, /화면에 그대로 남아 있습니다/);
});

function request(path: string, body?: unknown, cookie = '') {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

void test('server reports the administrator login time left, and only to the administrator', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    membersRevision: 0,
    members: [],
    timeline: [],
    tasks: [],
    schedule: [],
    cases: [],
    companyDocuments: [],
  });
  const password = 'Synthetic session expiry password!';
  await provisionStandaloneAdmin(f.db, {
    email: PORTAL_OWNER_EMAIL,
    password,
    deployment: 'remote',
  });
  const cookie = async (email: string) =>
    (await loginPassword(request('/api/auth/login', { email, password })))
      .headers.get('set-cookie')!
      .split(';')[0];
  const owner = await cookie(PORTAL_OWNER_EMAIL);
  const email = 'expiry-partner@example.invalid';
  await registerPassword(
    request('/api/auth/register', {
      name: '가상담당',
      phone: '010-0000-0000',
      affiliation: '가상',
      email,
      password,
      consent: true,
    }),
  );
  await mutatePortalState((raw) => {
    const state = raw as { members: Array<Record<string, unknown>> };
    return {
      ...state,
      members: state.members.map((member) => ({ ...member, status: '활성' })),
    };
  });
  const partner = await cookie(email);
  await flushWaitUntil();

  const within = (seconds: unknown) =>
    typeof seconds === 'number' &&
    seconds > standaloneAdminLifetimeSeconds - 120 &&
    seconds <= standaloneAdminLifetimeSeconds;

  const adminState = await getState(request('/api/state', undefined, owner));
  assert.equal(adminState.status, 200);
  const adminPayload = (await adminState.json()) as Record<string, unknown>;
  assert.ok(
    within(adminPayload.sessionExpiresInSeconds),
    String(adminPayload.sessionExpiresInSeconds),
  );
  assert.equal(
    Object.hasOwn(adminPayload.currentUser as object, 'sessionExpiresAt'),
    false,
  );

  const partnerState = await getState(
    request('/api/state', undefined, partner),
  );
  assert.equal(partnerState.status, 200);
  assert.equal(
    Object.hasOwn(
      (await partnerState.json()) as object,
      'sessionExpiresInSeconds',
    ),
    false,
  );

  const adminSession = await getAdminSession(
    request('/api/auth/admin-session', undefined, owner),
  );
  assert.equal(adminSession.status, 200);
  assert.match(adminSession.headers.get('cache-control') ?? '', /no-store/);
  const sessionPayload = (await adminSession.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sessionPayload), ['sessionExpiresInSeconds']);
  assert.ok(within(sessionPayload.sessionExpiresInSeconds));

  const cookieName = owner.slice(0, owner.indexOf('='));
  for (const sessionCookie of [
    partner,
    '',
    `${cookieName}=${'0'.repeat(64)}`,
    `${cookieName}=not-a-session`,
  ]) {
    const response = await getAdminSession(
      request('/api/auth/admin-session', undefined, sessionCookie),
    );
    assert.equal(response.status, 401, sessionCookie);
    assert.deepEqual(Object.keys((await response.json()) as object), [
      'error',
    ]);
  }

  // Once the hour is over the administrator is signed out everywhere.
  await f.db
    .prepare('UPDATE standalone_admin_sessions SET expires_at = issued_at + 1')
    .run();
  assert.equal(
    (
      await getAdminSession(
        request('/api/auth/admin-session', undefined, owner),
      )
    ).status,
    401,
  );
  assert.equal(
    (await getState(request('/api/state', undefined, owner))).status,
    401,
  );
});
