import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { env } from 'cloudflare:workers';
import { portalPasswordSchemaSql } from '../db/schema';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { tokenHash, verifyPassword } from '../lib/password-crypto';
import { sessionCookie } from '../lib/password-store';
import {
  provisionStandaloneAdmin,
  issueStandaloneAdminSession,
  readStandaloneAdminIdentity,
  standaloneAdminRevocations,
  standaloneAdminLifetimeSeconds,
} from '../lib/standalone-admin-store';
import {
  loginStandaloneAdmin,
  standaloneAdminIdentity,
  standaloneAdminRevocationStatements,
} from '../lib/platform-admin-auth';
import { failNextDatabaseBatch } from './runtime-mock.mjs';

const db = (env as unknown as { DB: D1Database }).DB;
const password = 'Synthetic test-only administrator secret!';
const migration = readFileSync(
  new URL(
    '../dev/next-local/migrations/0001_standalone_admin.sql',
    import.meta.url,
  ),
  'utf8',
);
beforeEach(async () => {
  await db.batch([
    ...[
      'standalone_admin_audit',
      'standalone_admin_sessions',
      'standalone_admin_accounts',
    ].map((name) => db.prepare(`DROP TABLE IF EXISTS ${name}`)),
    ...migration
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
    ...portalPasswordSchemaSql.map((sql) => db.prepare(sql)),
    db.prepare('DELETE FROM portal_password_sessions'),
  ]);
});
const provision = () =>
  provisionStandaloneAdmin(db, { email: PORTAL_OWNER_EMAIL, password });
const login = (prior: string | null = null) =>
  issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, password, prior);
async function count(table: string) {
  return (await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>())!.count;
}

void test('local admin never bootstraps from email or login alone', async () => {
  assert.equal(await login(), null);
  assert.equal(await count('standalone_admin_accounts'), 0);
  assert.equal(await count('standalone_admin_sessions'), 0);
});
void test('provisioning rejects other emails and weak passwords without writing', async () => {
  await assert.rejects(
    provisionStandaloneAdmin(db, { email: 'outsider@example.test', password }),
  );
  await assert.rejects(
    provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password: 'short',
    }),
  );
  assert.equal(await count('standalone_admin_accounts'), 0);
});
void test('provisioning hashes credentials and concurrent re-provision cannot overwrite them', async () => {
  const results = await Promise.allSettled([provision(), provision()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const row = await db
    .prepare('SELECT password_hash FROM standalone_admin_accounts')
    .first<{ password_hash: string }>();
  assert.ok(verifyPassword(password, row!.password_hash));
  assert.notEqual(row!.password_hash, password);
  assert.equal(await count('standalone_admin_accounts'), 1);
  assert.equal(await count('standalone_admin_audit'), 1);
  await assert.rejects(
    provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password: 'Different synthetic-only secret!',
    }),
  );
  assert.ok(await login());
});
void test('remote admin provisioning uses the production display name and retains no-overwrite protection', async () => {
  await provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL,
    password,
    deployment: 'remote',
  });
  const token = await login();
  assert.equal(
    (await readStandaloneAdminIdentity(db, token))?.displayName,
    '대표 관리자',
  );
  await assert.rejects(
    provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password: 'Different synthetic-only secret!',
      deployment: 'remote',
    }),
    /기존 자격증명은 변경하지 않았습니다/,
  );
  assert.ok(await login());
});
void test('wrong email/password and disabled admin cannot obtain a session', async () => {
  await provision();
  assert.equal(
    await issueStandaloneAdminSession(
      db,
      PORTAL_OWNER_EMAIL,
      'incorrect test password',
      null,
    ),
    null,
  );
  assert.equal(
    await issueStandaloneAdminSession(db, 'other@example.test', password, null),
    null,
  );
  await db.prepare('UPDATE standalone_admin_accounts SET active = 0').run();
  assert.equal(await login(), null);
  assert.equal(await count('standalone_admin_sessions'), 0);
});
void test('admin token is opaque, hashed in DB, limited to one hour and rotated on login', async () => {
  await provision();
  const first = (await login())!;
  assert.match(first, /^[a-f0-9]{64}$/);
  const session = await db
    .prepare(
      'SELECT token_hash, issued_at, expires_at FROM standalone_admin_sessions',
    )
    .first<{ token_hash: string; issued_at: number; expires_at: number }>();
  assert.equal(session!.token_hash, tokenHash(first));
  assert.equal(
    session!.expires_at - session!.issued_at,
    standaloneAdminLifetimeSeconds * 1000,
  );
  const identity = await readStandaloneAdminIdentity(db, first);
  assert.equal(identity?.id, 'primary-admin');
  assert.equal(identity?.email, PORTAL_OWNER_EMAIL);
  const second = (await login(first))!;
  assert.notEqual(first, second);
  assert.equal(await readStandaloneAdminIdentity(db, first), null);
  assert.ok(await readStandaloneAdminIdentity(db, second));
});
void test('expired, future, malformed and duplicate-cookie sentinel tokens never authorize', async () => {
  await provision();
  const token = (await login())!;
  await db
    .prepare(
      'UPDATE standalone_admin_sessions SET issued_at = ?1, expires_at = ?2',
    )
    .bind(Date.now() - 7200000, Date.now() - 3600000)
    .run();
  assert.equal(await readStandaloneAdminIdentity(db, token), null);
  await db
    .prepare(
      'UPDATE standalone_admin_sessions SET issued_at = ?1, expires_at = ?2',
    )
    .bind(Date.now() + 3600000, Date.now() + 7200000)
    .run();
  assert.equal(await readStandaloneAdminIdentity(db, token), null);
  for (const invalid of [
    null,
    '',
    '!',
    'a'.repeat(63),
    'A'.repeat(64),
    'a'.repeat(8193),
  ])
    assert.equal(await readStandaloneAdminIdentity(db, invalid), null);
});
void test('disabled or rotated credentials invalidate existing admin sessions', async () => {
  await provision();
  const token = (await login())!;
  await db.prepare('UPDATE standalone_admin_accounts SET active = 0').run();
  assert.equal(await readStandaloneAdminIdentity(db, token), null);
  await db
    .prepare(
      "UPDATE standalone_admin_accounts SET active = 1, credential_version = 'rotated'",
    )
    .run();
  assert.equal(await readStandaloneAdminIdentity(db, token), null);
});
void test('admin revocation deletes DB session and records no bearer secret', async () => {
  await provision();
  const token = (await login())!;
  await db.batch(standaloneAdminRevocations(db, token));
  assert.equal(await readStandaloneAdminIdentity(db, token), null);
  const audit = await db
    .prepare('SELECT * FROM standalone_admin_audit')
    .all<{ action: string }>();
  assert.deepEqual(
    audit.results.map((r) => r.action),
    ['provision', 'login', 'logout'],
  );
  assert.ok(!JSON.stringify(audit).includes(token));
  assert.ok(!JSON.stringify(audit).includes(password));
});
void test('provision/session batch failures roll back atomically', async () => {
  failNextDatabaseBatch('standalone_admin_audit');
  await assert.rejects(provision());
  assert.equal(await count('standalone_admin_accounts'), 0);
  await provision();
  const prior = (await login())!;
  failNextDatabaseBatch('standalone_admin_audit');
  await assert.rejects(login(prior));
  assert.equal(await count('standalone_admin_sessions'), 1);
  assert.ok(await readStandaloneAdminIdentity(db, prior));
});
void test('credential change racing login cannot issue or revoke a session', async () => {
  await provision();
  const racingDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          await db
            .prepare(
              "UPDATE standalone_admin_accounts SET credential_version = 'changed-during-login'",
            )
            .run();
          return db.batch(statements);
        };
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(
    await issueStandaloneAdminSession(
      racingDb,
      PORTAL_OWNER_EMAIL,
      password,
      null,
    ),
    null,
  );
  assert.equal(await count('standalone_admin_sessions'), 0);
  assert.equal(await count('standalone_admin_audit'), 1);
});
void test('Sites/default platform hooks remain disabled even with owner headers', async () => {
  await provision();
  const token = (await login())!;
  const request = new Request('https://example.test/api/state', {
    headers: {
      cookie: `__Host-keve_session=${token}`,
      'oai-authenticated-user-email': PORTAL_OWNER_EMAIL,
    },
  });
  assert.equal(await standaloneAdminIdentity(request), null);
  assert.equal(
    await loginStandaloneAdmin(request, PORTAL_OWNER_EMAIL, password),
    null,
  );
  assert.deepEqual(
    standaloneAdminRevocationStatements(db, token, 'logout'),
    [],
  );
});
void test('admin cookie lifetime does not change existing partner cookie policy', () => {
  const request = new Request('https://example.test');
  assert.match(
    sessionCookie(request, 'synthetic', false, 3600),
    /HttpOnly; SameSite=Strict; Max-Age=3600; Secure$/,
  );
  assert.match(sessionCookie(request, 'synthetic'), /Max-Age=43200; Secure$/);
  assert.match(
    sessionCookie(request, '', true, 3600),
    /__Host-keve_session=;.*Max-Age=0; Secure$/,
  );
});
void test('admin setup CLI refuses noninteractive input and password arguments', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/admin-next-local.mjs', '--password'],
    { encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /대화형 로컬 터미널/);
  assert.ok(!result.stdout.includes('설정 완료'));
});
