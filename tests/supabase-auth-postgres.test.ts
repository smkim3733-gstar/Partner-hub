import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { postgresFixture } from './supabase-postgres-fixture';
import { isPostgresDatabase } from '../lib/database-dialect';
import { passwordSchemaStatements } from '../lib/password-schema';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { tokenHash } from '../lib/password-crypto';
import {
  provisionStandaloneAdmin,
  issueStandaloneAdminSession,
  readStandaloneAdminIdentity,
  standaloneAdminRevocations,
} from '../lib/standalone-admin-store';
import { recoverStandaloneAdmin, AdminRecoveryError } from '../lib/standalone-admin-recovery';
import { portalMemberExistsSql } from '../lib/portal-member-sql';

const oldPassword = 'Synthetic PostgreSQL administrator password!';
const newPassword = 'Synthetic PostgreSQL replacement password!';

void test('real PostgreSQL migrations, scalar values, isolation and schema guards', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  assert.equal(isPostgresDatabase(f.db), true);
  assert.equal((await f.db.batch<{ ready: number }>(passwordSchemaStatements(f.db)))[0].results[0].ready, 1);
  assert.equal(await f.db.prepare('SHOW transaction_isolation').first('transaction_isolation'), 'serializable');
  assert.equal(await f.db.prepare('SELECT 1788950935000::bigint AS value').first('value'), 1788950935000);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM standalone_admin_accounts').first('n'), 0);
  await assert.rejects(f.db.prepare('SELECT 9007199254740992::bigint AS value').first(), /INVALID_OPERATION/);
  await f.engine.exec('ALTER TABLE partner_hub.portal_password_accounts DISABLE ROW LEVEL SECURITY');
  await assert.rejects(f.db.batch(passwordSchemaStatements(f.db)), /OPERATION_FAILED/);
});

void test('real PostgreSQL authentication tables deny browser roles and keep recovery audit append-only', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const privileges = await f.engine.query<{ browser_access: boolean; unsafe_table: boolean }>(`
    SELECT has_schema_privilege('anon', 'partner_hub', 'USAGE')
      OR has_schema_privilege('authenticated', 'partner_hub', 'USAGE') AS browser_access,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'partner_hub' AND c.relkind = 'r' AND
          (NOT c.relrowsecurity OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
           OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))) AS unsafe_table`);
  assert.deepEqual(privileges.rows, [{ browser_access: false, unsafe_table: false }]);
  await f.engine.exec('SET ROLE service_role');
  assert.equal((await f.db.batch(passwordSchemaStatements(f.db)))[0].success, true);
  await provisionStandaloneAdmin(f.db, { email: PORTAL_OWNER_EMAIL, password: oldPassword });
  await f.engine.exec('RESET ROLE');
  await f.engine.exec('SET ROLE anon');
  await assert.rejects(f.engine.query('SELECT * FROM partner_hub.standalone_admin_accounts'), /permission denied/);
  await f.engine.exec('RESET ROLE');
});

void test('real PostgreSQL independent admin provision, login, rotation, expiry and logout', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const db = f.db;
  assert.equal(await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, oldPassword, null), null);
  await provisionStandaloneAdmin(db, { email: PORTAL_OWNER_EMAIL, password: oldPassword, deployment: 'remote' });
  await assert.rejects(provisionStandaloneAdmin(db, { email: PORTAL_OWNER_EMAIL, password: oldPassword }), /이미 설정/);
  assert.equal(await issueStandaloneAdminSession(db, 'other@example.test', oldPassword, null), null);
  assert.equal(await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, 'wrong password', null), null);
  const first = (await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, oldPassword, null))!;
  assert.ok(first);
  assert.deepEqual(await readStandaloneAdminIdentity(db, first), {
    id: 'primary-admin', email: PORTAL_OWNER_EMAIL, displayName: '대표 관리자',
  });
  const second = (await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, oldPassword, first))!;
  assert.ok(second);
  assert.equal(await readStandaloneAdminIdentity(db, first), null);
  assert.ok(await readStandaloneAdminIdentity(db, second));
  await db.batch(standaloneAdminRevocations(db, second));
  assert.equal(await readStandaloneAdminIdentity(db, second), null);
  const expired = (await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, oldPassword, null))!;
  await db.prepare('UPDATE standalone_admin_sessions SET issued_at = ?1, expires_at = ?2 WHERE token_hash = ?3')
    .bind(Date.now() - 7200000, Date.now() - 3600000, tokenHash(expired)).run();
  assert.equal(await readStandaloneAdminIdentity(db, expired), null);
});

void test('real PostgreSQL initial remote admin accepts 14 characters without changing local policy or overwriting credentials', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const db = f.db;
  const password = 'Ab9!cdAb9!cdXy';
  for (const deployment of [undefined, 'local'] as const) {
    await assert.rejects(provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL, password, deployment,
    }), /15~128/);
  }
  await assert.rejects(provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL, password: password.slice(0, -1), deployment: 'remote',
  }), /14~128/);
  await assert.rejects(provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL, password: 'a'.repeat(14), deployment: 'remote',
  }), /반복 문자/);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM standalone_admin_accounts').first('n'), 0);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM standalone_admin_audit').first('n'), 0);

  await provisionStandaloneAdmin(db, { email: PORTAL_OWNER_EMAIL, password, deployment: 'remote' });
  const account = await db.prepare('SELECT * FROM standalone_admin_accounts').first();
  await assert.rejects(provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL, password: newPassword, deployment: 'remote',
  }), /이미 설정/);
  assert.deepEqual(await db.prepare('SELECT * FROM standalone_admin_accounts').first(), account);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM standalone_admin_accounts').first('n'), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM standalone_admin_audit WHERE action = 'provision'").first('n'), 1);
  assert.equal(await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, newPassword, null), null);
  const token = await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, password, null);
  assert.ok(token);
  assert.deepEqual(await readStandaloneAdminIdentity(db, token), {
    id: 'primary-admin', email: PORTAL_OWNER_EMAIL, displayName: '대표 관리자',
  });
});

void test('real PostgreSQL admin recovery rotates atomically and rollback preserves credentials and sessions', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const db = f.db;
  await provisionStandaloneAdmin(db, { email: PORTAL_OWNER_EMAIL, password: oldPassword });
  const first = (await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, oldPassword, null))!;
  const version = (await db.prepare('SELECT credential_version FROM standalone_admin_accounts').first<string>('credential_version'))!;
  const input = { email: PORTAL_OWNER_EMAIL, password: newPassword, expectedCredentialVersion: version,
    recoveryId: randomUUID(), reason: 'lost-password' as const };
  assert.equal((await recoverStandaloneAdmin(db, input)).revokedSessions, 1);
  assert.equal(await readStandaloneAdminIdentity(db, first), null);
  assert.equal(await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, oldPassword, null), null);
  const current = (await issueStandaloneAdminSession(db, PORTAL_OWNER_EMAIL, newPassword, null))!;
  const before = await db.prepare('SELECT * FROM standalone_admin_accounts').first<Record<string, string>>();
  await assert.rejects(recoverStandaloneAdmin(db, input), AdminRecoveryError);
  // Duplicate audit ID fails the final statement, after UPDATE and DELETE ran.
  await assert.rejects(recoverStandaloneAdmin(db, { ...input,
    expectedCredentialVersion: before!.credential_version,
    password: 'Synthetic PostgreSQL third password!',
  }), /OPERATION_FAILED/);
  assert.deepEqual(await db.prepare('SELECT * FROM standalone_admin_accounts').first(), before);
  assert.ok(await readStandaloneAdminIdentity(db, current));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM standalone_admin_recovery_audit').first('n'), 1);
  await assert.rejects(db.prepare("UPDATE standalone_admin_recovery_audit SET reason = 'rotation'").run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare('DELETE FROM standalone_admin_recovery_audit').run(), /OPERATION_FAILED/);
});

void test('real PostgreSQL storage rollback probe leaves zero test rows', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  await f.engine.exec(await readFile(new URL('./supabase-storage-rollback.sql', import.meta.url), 'utf8'));
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM storage_object_heads').first('n'), 0);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM storage_object_versions').first('n'), 0);
});

void test('real PostgreSQL remote authentication rollback probe leaves zero test accounts and portal rows', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  await f.engine.exec(await readFile(new URL('./supabase-auth-rollback.sql', import.meta.url), 'utf8'));
  for (const table of ['standalone_admin_accounts', 'standalone_admin_sessions', 'standalone_admin_recovery_audit', 'portal_state', 'portal_login_stats'])
    assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
});

void test('real PostgreSQL portal root rejects malformed JSON, excess UTF-8 bytes, invalid dates and deletion', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const save = (payload: string, time = '2026-09-09T00:00:00.000Z') => f.db
    .prepare('INSERT INTO portal_state (id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    .bind('keve-partner-hub', payload, time).run();
  const exact = '{ "members" : [] }';
  await save(exact);
  for (const invalid of ['{bad', '[]', 'null', '"string"', JSON.stringify({ text: '가'.repeat(300000) })])
    await assert.rejects(save(invalid), /OPERATION_FAILED/);
  for (const invalid of ['2026-02-30T00:00:00.000Z', '2026-09-09T24:00:00.000Z', '2026-09-09T00:00:00Z'])
    await assert.rejects(save('{}', invalid), /OPERATION_FAILED/);
  assert.equal(await f.db.prepare('SELECT payload FROM portal_state').first('payload'), exact);
  await assert.rejects(f.db.prepare('DELETE FROM portal_state').run(), /OPERATION_FAILED/);
  await assert.rejects(f.db.prepare("UPDATE portal_state SET id = 'other'").run(), /OPERATION_FAILED/);
  assert.equal(await f.db.prepare('SELECT partner_hub.assert_portal_schema() AS ready').first('ready'), 1);
  await f.engine.exec('ALTER TABLE partner_hub.portal_state DISABLE TRIGGER portal_state_no_delete');
  await assert.rejects(f.db.prepare('SELECT partner_hub.assert_portal_schema() AS ready').first(), /OPERATION_FAILED/);
});

void test('real PostgreSQL membership predicates reject duplicates, malformed identity types and suspended status', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const valid = { id: 'member', email: ' MEMBER@EXAMPLE.TEST ', status: '활성' };
  async function check(members: unknown, status: 'active' | 'not-suspended' = 'active') {
    await f.db.prepare(`INSERT INTO portal_state (id, payload, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`).bind(
      'keve-partner-hub', JSON.stringify({ members }), '2026-09-09T00:00:00.000Z').run();
    return f.db.prepare(`SELECT 1 AS allowed WHERE ${portalMemberExistsSql(f.db, {
      state: '?1', member: '?2', email: '?3', status,
    })}`).bind('keve-partner-hub', 'member', 'member@example.test').first('allowed');
  }
  assert.equal(await check([valid]), 1);
  for (const members of [[valid, valid], [{ ...valid, status: '정지' }], [{ ...valid, id: 4 }],
    [{ ...valid, status: 1 }], [{ ...valid, email: 2 }], [{ ...valid, email: 'different@example.test' }],
    null, {}, 'members', []]) assert.equal(await check(members), null);
  assert.equal(await check([{ ...valid, status: '승인대기' }]), null);
  assert.equal(await check([{ ...valid, status: '승인대기' }], 'not-suspended'), 1);
  assert.equal(await check([{ ...valid, status: '정지' }], 'not-suspended'), null);
});

void test('real PostgreSQL login counters preserve the 30-minute window and immutable identity', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  await f.db.prepare('INSERT INTO portal_login_stats VALUES (?1, ?2, 1)').bind('member', '2026-09-09T00:00:00.000Z').run();
  for (const query of [
    "UPDATE portal_login_stats SET member_id = 'other'",
    'UPDATE portal_login_stats SET login_count = 2',
    "UPDATE portal_login_stats SET last_login_at = '2026-09-08T00:00:00.000Z'",
    "UPDATE portal_login_stats SET login_count = 3, last_login_at = '2026-09-09T00:30:00.000Z'",
    "INSERT INTO portal_login_stats VALUES ('new', '2026-09-09T00:00:00.000Z', 2)",
  ]) await assert.rejects(f.db.prepare(query).run(), /OPERATION_FAILED/);
  await f.db.prepare("UPDATE portal_login_stats SET login_count = 2, last_login_at = '2026-09-09T00:30:00.000Z'").run();
  assert.equal(await f.db.prepare('SELECT login_count FROM portal_login_stats').first('login_count'), 2);
});
