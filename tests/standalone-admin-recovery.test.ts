import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { env } from 'cloudflare:workers';
import { portalPasswordSchemaSql } from '../db/schema';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { verifyPassword, tokenHash } from '../lib/password-crypto';
import {
  provisionStandaloneAdmin,
  issueStandaloneAdminSession,
  readStandaloneAdminIdentity,
} from '../lib/standalone-admin-store';
import {
  recoverStandaloneAdmin,
  AdminRecoveryError,
} from '../lib/standalone-admin-recovery';
import { failNextDatabaseStatement } from './runtime-mock.mjs';

const db = (env as unknown as { DB: D1Database }).DB;
const oldPassword = 'Synthetic old administrator password!';
const newPassword = 'Synthetic replacement administrator password!';
const schema = ['0001_admin.sql', '0002_admin_recovery.sql'].flatMap((file) =>
  // These two schema fixtures contain CREATE statements and simple triggers only.
  readFileSync(
    new URL(`../infra/standalone/migrations/${file}`, import.meta.url),
    'utf8',
  )
    .replace(/^--.*$/gm, '')
    .split(/;\s*(?=CREATE\s|$)/i)
    .map((sql) => sql.trim())
    .filter(Boolean),
);
assert.equal(schema.length, 7);
beforeEach(async () => {
  await db.batch([
    ...[
      'standalone_admin_recovery_audit',
      'standalone_admin_audit',
      'standalone_admin_sessions',
      'standalone_admin_accounts',
    ].map((table) => db.prepare(`DROP TABLE IF EXISTS ${table}`)),
    ...schema.map((sql) => db.prepare(sql)),
    ...portalPasswordSchemaSql.map((sql) => db.prepare(sql)),
    db.prepare('DELETE FROM portal_password_sessions'),
  ]);
});
const provision = () =>
  provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL,
    password: oldPassword,
    deployment: 'remote',
  });
const login = (password = oldPassword) =>
  issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, password, null);
const account = () =>
  db
    .prepare('SELECT * FROM standalone_admin_accounts')
    .first<Record<string, string | number>>();
async function input() {
  return {
    email: PORTAL_OWNER_EMAIL,
    password: newPassword,
    expectedCredentialVersion: String(
      (await account())?.credential_version ?? randomUUID(),
    ),
    recoveryId: randomUUID(),
    reason: 'lost-password' as const,
  };
}
async function auditCount() {
  return (await db
    .prepare('SELECT COUNT(*) AS n FROM standalone_admin_recovery_audit')
    .first<{ n: number }>())!.n;
}

void test('operator recovery never provisions a missing account', async () => {
  await assert.rejects(
    recoverStandaloneAdmin(db, await input()),
    (error) => error instanceof AdminRecoveryError && error.code === 'ACCOUNT',
  );
  assert.equal(await account(), null);
  assert.equal(await auditCount(), 0);
});
void test('recovery rejects invalid inputs, reused password and inactive accounts without writes', async () => {
  await provision();
  const before = await account();
  const base = await input();
  for (const override of [
    { email: 'other@example.test' },
    { password: 'short' },
    { recoveryId: 'invalid' },
    { expectedCredentialVersion: 'invalid' },
    { reason: 'unexpected' as typeof base.reason },
    { password: oldPassword },
  ])
    await assert.rejects(
      recoverStandaloneAdmin(db, { ...base, ...override }),
      AdminRecoveryError,
    );
  assert.deepEqual(await account(), before);
  await db.prepare('UPDATE standalone_admin_accounts SET active = 0').run();
  await assert.rejects(
    recoverStandaloneAdmin(db, base),
    (error) => error instanceof AdminRecoveryError && error.code === 'ACCOUNT',
  );
  assert.equal((await account())!.active, 0);
  assert.equal(await auditCount(), 0);
});
void test('recovery atomically rotates credentials, revokes every admin session and preserves partner state', async () => {
  await provision();
  const before = (await account())!;
  const tokens = [(await login())!, (await login())!];
  const partner = { token: 'a'.repeat(64), version: randomUUID() };
  await db
    .prepare(
      'INSERT INTO portal_password_sessions (token_hash,member_id,email,credential_version,expires_at) VALUES (?1,?2,?3,?4,?5)',
    )
    .bind(
      partner.token,
      'synthetic-partner',
      'partner@example.test',
      partner.version,
      Date.now() + 100000,
    )
    .run();
  const request = await input();
  const result = await recoverStandaloneAdmin(db, request);
  assert.equal(result.revokedSessions, 2);
  assert.equal(result.recoveryId, request.recoveryId);
  const after = (await account())!;
  for (const key of ['id', 'email', 'display_name', 'active', 'created_at'])
    assert.equal(after[key], before[key]);
  assert.notEqual(after.credential_version, before.credential_version);
  assert.ok(verifyPassword(newPassword, String(after.password_hash)));
  for (const token of tokens)
    assert.equal(await readStandaloneAdminIdentity(db, token), null);
  assert.equal(await login(), null);
  assert.ok(await login(newPassword));
  const partnerRow = await db
    .prepare('SELECT * FROM portal_password_sessions')
    .first<{ token_hash: string; credential_version: string }>();
  assert.equal(partnerRow!.token_hash, partner.token);
  assert.equal(partnerRow!.credential_version, partner.version);
  const audit = await db
    .prepare('SELECT * FROM standalone_admin_recovery_audit')
    .first<Record<string, string>>();
  assert.equal(
    audit!.previous_version_hash,
    tokenHash(String(before.credential_version)),
  );
  assert.equal(
    audit!.next_version_hash,
    tokenHash(String(after.credential_version)),
  );
  for (const secret of [
    oldPassword,
    newPassword,
    ...tokens,
    String(before.password_hash),
    String(after.password_hash),
  ])
    assert.equal(JSON.stringify(audit).includes(secret), false);
});
void test('recovery audit is append-only', async () => {
  await provision();
  await recoverStandaloneAdmin(db, await input());
  await assert.rejects(
    db
      .prepare("UPDATE standalone_admin_recovery_audit SET reason = 'rotation'")
      .run(),
    /immutable/,
  );
  await assert.rejects(
    db.prepare('DELETE FROM standalone_admin_recovery_audit').run(),
    /immutable/,
  );
  assert.equal(await auditCount(), 1);
});
void test('audit failure rolls back credential rotation and session revocation together', async () => {
  await provision();
  const token = (await login())!;
  const before = await account();
  failNextDatabaseStatement('INSERT INTO standalone_admin_recovery_audit');
  await assert.rejects(recoverStandaloneAdmin(db, await input()), /synthetic/);
  assert.deepEqual(await account(), before);
  assert.ok(await readStandaloneAdminIdentity(db, token));
  assert.equal(await auditCount(), 0);
});
void test('stale confirmations and concurrent recovery cannot overwrite the winning credentials', async () => {
  await provision();
  const base = await input();
  const result = await Promise.allSettled([
    recoverStandaloneAdmin(db, base),
    recoverStandaloneAdmin(db, {
      ...base,
      recoveryId: randomUUID(),
      password: 'Another synthetic competing password!',
    }),
  ]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(result.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(await auditCount(), 1);
  const before = await account();
  await assert.rejects(
    recoverStandaloneAdmin(db, base),
    (error) => error instanceof AdminRecoveryError && error.code === 'STALE',
  );
  assert.deepEqual(await account(), before);
});
void test('duplicate recovery receipt cannot commit another password or revoke new sessions', async () => {
  await provision();
  const first = await input();
  await recoverStandaloneAdmin(db, first);
  const token = (await login(newPassword))!;
  const before = await account();
  await assert.rejects(
    recoverStandaloneAdmin(db, {
      ...(await input()),
      recoveryId: first.recoveryId,
      password: 'Third synthetic administrator password!',
    }),
  );
  assert.deepEqual(await account(), before);
  assert.ok(await readStandaloneAdminIdentity(db, token));
  assert.equal(await auditCount(), 1);
});
void test('login verified before recovery cannot create a session afterward', async () => {
  await provision();
  const recovery = await input();
  const racingDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          await recoverStandaloneAdmin(db, recovery);
          return db.batch(statements);
        };
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(
    await issueStandaloneAdminSession(
      racingDb,
      PORTAL_OWNER_EMAIL,
      oldPassword,
      null,
    ),
    null,
  );
  assert.ok(await login(newPassword));
  assert.equal(await auditCount(), 1);
});
void test('recovery CLI refuses noninteractive/password arguments before reading backend credentials', () => {
  for (const args of [
    [],
    ['--password', 'do-not-print-synthetic'],
    ['--check', '--force'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['scripts/recover-next-remote-admin.mjs', ...args],
      {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /대화형/);
    assert.equal(result.stderr.includes('do-not-print-synthetic'), false);
  }
});
