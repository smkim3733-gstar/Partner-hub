import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { env } from 'cloudflare:workers';
import { postgresFixture } from './supabase-postgres-fixture';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import { flushWaitUntil } from './runtime-mock.mjs';

register('./supabase-auth-loader.mjs', import.meta.url);
const { registerPassword, loginPassword, logoutPassword, createPasswordLink, setupPassword } = await import('../lib/password-handlers');
const { readPortalState, writePortalState, mutatePortalState, recordPortalLogin, readPortalLoginStats } = await import('../lib/portal-state');
const { passwordIdentity, passwordAccessRevocationStatements } = await import('../lib/password-store');
const { requirePortalUser } = await import('../lib/portal-auth');
const { readPasswordLinkSummary } = await import('../lib/password-link-metrics');

const origin = 'https://postgres-auth.example.test';
const email = 'synthetic-partner@example.test';
const password = 'Map7!x'; // Synthetic six-character signup credential.
const adminPassword = 'Synthetic PostgreSQL owner password!';
function request(data: unknown, cookie = '') {
  return new Request(`${origin}/api/auth/test`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(data),
  });
}
async function responseStatus(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  return response;
}

void test('PostgreSQL password handlers preserve pending approval, role boundaries, one-time reset and revocation', async (t) => {
  const f = await postgresFixture();
  const runtime = env as unknown as { DB: D1Database };
  const oldDb = runtime.DB;
  const config = {
    PARTNER_HUB_NEXT_BACKEND: 'supabase-v1', PARTNER_HUB_BACKEND_ENABLED: '1', PARTNER_HUB_LOCAL_STORAGE: '0',
    PARTNER_HUB_APP_ORIGIN: origin, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:synthetic@aws-0-region.pooler.supabase.com:6543/postgres',
    SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(32)}`, SUPABASE_STORAGE_BUCKET: 'synthetic-private',
  };
  const previous = Object.keys(config).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, config);
  runtime.DB = f.db;
  t.after(async () => {
    await flushWaitUntil();
    runtime.DB = oldDb;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await f.close();
  });
  await writePortalState({ version: 1, consultationNumber: 0, membersRevision: 0,
    members: [], timeline: [], schedule: [], tasks: [], companyDocuments: [], cases: [] });
  await provisionStandaloneAdmin(f.db, { email: PORTAL_OWNER_EMAIL, password: adminPassword, deployment: 'remote' });
  const admin = await responseStatus(await loginPassword(request({ email: PORTAL_OWNER_EMAIL, password: adminPassword })), 200);
  const adminCookie = admin.headers.get('set-cookie')!.split(';')[0];
  assert.match(admin.headers.get('set-cookie')!, /^__Host-keve_session=.*;.*HttpOnly.*SameSite=Strict.*Secure/);
  const signup = { name: '가상 검증파트너', phone: '010-0000-0000', affiliation: '가상 소속', email, password, consent: true };
  await responseStatus(await registerPassword(request({ ...signup, password: password.slice(0, -1) })), 400);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM portal_password_accounts').first('n'), 0);
  assert.equal((await readPortalState() as { members: unknown[] }).members.length, 0);
  await responseStatus(await registerPassword(request(signup)), 201);
  await responseStatus(await registerPassword(request(signup)), 409);
  await responseStatus(await loginPassword(request({ email, password })), 403);
  const pending = await readPortalState() as { members: { id: string; status: string }[] };
  assert.equal(pending.members[0].status, '승인대기');
  const memberId = pending.members[0].id;
  await mutatePortalState((current) => {
    const state = current as typeof pending;
    return { ...state, members: state.members.map((member) => ({ ...member, status: '활성' })) };
  });
  const login = await responseStatus(await loginPassword(request({ email, password })), 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await passwordIdentity(request({}, cookie)))!.member_id, memberId);
  const forged = new Request(`${origin}/api/test`, { headers: {
    'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': PORTAL_OWNER_EMAIL,
  } });
  await assert.rejects(requirePortalUser(forged, await readPortalState()));
  await responseStatus(await createPasswordLink(request({ memberId, confirmed: true }, cookie)), 403);
  await responseStatus(await createPasswordLink(request({ memberId }, adminCookie)), 400);
  const issued = await responseStatus(await createPasswordLink(request({ memberId, confirmed: true }, adminCookie)), 201);
  const resetToken = ((await issued.json()) as { path: string }).path.split('#token=')[1];
  const replacement = 'Synthetic PostgreSQL replacement partner password!';
  const rejectedReset = await responseStatus(await setupPassword(request({ token: resetToken, password })), 400);
  assert.match((await rejectedReset.json() as { error: string }).error, /15~128/);
  assert.ok(await passwordIdentity(request({}, cookie)), 'rejected short reset must preserve the current session and one-time link');
  await responseStatus(await setupPassword(request({ token: resetToken, password: replacement })), 200);
  await assert.rejects(passwordIdentity(request({}, cookie)), { status: 401 });
  await responseStatus(await loginPassword(request({ email, password })), 401);
  const replacedLogin = await responseStatus(await loginPassword(request({ email, password: replacement })), 200);
  const replacedCookie = replacedLogin.headers.get('set-cookie')!.split(';')[0];
  await responseStatus(await setupPassword(request({ token: resetToken, password: 'Another synthetic password!' })), 400);
  assert.ok(await passwordIdentity(request({}, replacedCookie)), 'reset replay must not revoke winning session');
  await recordPortalLogin(memberId);
  await recordPortalLogin(memberId);
  assert.equal((await readPortalLoginStats())[0].loginCount, 1);
  await responseStatus(await logoutPassword(request({}, replacedCookie)), 200);
  await assert.rejects(passwordIdentity(request({}, replacedCookie)), { status: 401 });
  const priorState = await readPortalState() as typeof pending;
  const suspended = { ...priorState, members: priorState.members.map((member) => ({ ...member, status: '정지' })) };
  await mutatePortalState(() => suspended, undefined, (db, payload) =>
    passwordAccessRevocationStatements(db, {
      sessionMemberIds: [memberId], setupLinkMemberIds: [memberId],
      credentialMemberIds: [], chatGPTBindingMemberIds: [],
    }, payload));
  await responseStatus(await loginPassword(request({ email, password: replacement })), 403);
  await flushWaitUntil();
  const summary = await readPasswordLinkSummary();
  assert.equal(summary.issued, 1);
  assert.equal(summary.redeemed, 1);
});
