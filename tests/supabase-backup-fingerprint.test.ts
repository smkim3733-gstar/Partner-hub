import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { postgresFixture } from './supabase-postgres-fixture';
import {
  compareSupabaseFingerprints,
  fingerprintSupabaseDatabase,
} from '../scripts/supabase-backup-fingerprint.mjs';

async function fingerprint(engine: PGlite, options = {}, reverseRows = false) {
  return engine.transaction(async (transaction) => {
    await transaction.exec(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle = 'ISO, MDY';
      SET LOCAL IntervalStyle = 'postgres'; SET LOCAL extra_float_digits = 3;
      SET LOCAL bytea_output = 'hex'; SET LOCAL search_path = pg_catalog;`);
    return fingerprintSupabaseDatabase({
      async unsafe(query: string, parameters: unknown[] = []) {
        const result = await transaction.query(query, parameters);
        return reverseRows && query.includes(' AS encoded_row FROM ')
          ? result.rows.reverse() : result.rows;
      },
    }, options);
  });
}

void test('backup fingerprint covers all 19 migrations and detects table data, RLS, ACL, trigger and routine drift', async (t) => {
  const f = await postgresFixture({ flowRoot: true });
  t.after(f.close);
  const before = await fingerprint(f.engine);
  assert.equal(before.tableCount, 38);
  assert.equal(before.tables.length, 38);
  assert.equal(before.totalRows, 0);
  assert.equal(before.ownershipNormalized, false);
  assert.ok(before.categories.constraints.count > 50);
  assert.ok(before.categories.indexes.count > 30);
  assert.ok(before.categories.functions.count > 30);
  assert.ok(before.categories.triggers.count > 5);
  assert.ok(before.categories.acl.count > 100);
  assert.equal(before.categories.policies.count, 0);
  assert.deepEqual(compareSupabaseFingerprints(before, await fingerprint(f.engine)), {
    equal: true, differences: [],
  });

  await f.engine.query(`INSERT INTO partner_hub.schema_migrations (sequence, name, sha256)
    VALUES (19, 'Synthetic fixture migration', $1)`, ['a'.repeat(64)]);
  const inserted = await fingerprint(f.engine);
  assert.equal(inserted.totalRows, 1);
  assert.deepEqual(compareSupabaseFingerprints(before, inserted), {
    equal: false,
    differences: [{ kind: 'table-content', table: 'schema_migrations' }],
  });

  await f.engine.exec(`ALTER TABLE partner_hub.portal_state DISABLE ROW LEVEL SECURITY;
    GRANT SELECT ON partner_hub.portal_state TO anon;
    ALTER TABLE partner_hub.storage_object_versions DISABLE TRIGGER storage_object_versions_immutable;
    CREATE OR REPLACE FUNCTION partner_hub.reject_storage_version_mutation()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
      AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_CHANGED_TRIGGER'; END; $$;`);
  const drift = compareSupabaseFingerprints(inserted, await fingerprint(f.engine));
  assert.equal(drift.equal, false);
  for (const category of ['tables', 'acl', 'effectivePrivileges', 'triggers', 'functions']) {
    assert.ok(drift.differences.some((difference: { category?: string }) => difference.category === category), category);
  }
});

void test('backup rows preserve bigint, raw JSON spelling, NULL, duplicate multiplicity and order independence without exposing values', async (t) => {
  const engine = await PGlite.create();
  t.after(() => engine.close());
  await engine.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA partner_hub;
    CREATE TABLE partner_hub.probe (large bigint, raw_text text, raw_json json, optional text);`);
  const raw = '{ "a":1, "a":2, "large":9007199254740993, "token":"synthetic-secret-only" }';
  await engine.query(`INSERT INTO partner_hub.probe VALUES (9007199254740993, $1::text, $1::text::json, NULL),
    (9007199254740993, $1::text, $1::text::json, NULL), (9007199254740992, $1::text, $1::text::json, 'null')`, [raw]);
  const options = { expectedTableCount: 1 };
  const before = await fingerprint(engine, options);
  const reversed = await fingerprint(engine, options, true);
  assert.deepEqual(compareSupabaseFingerprints(before, reversed), { equal: true, differences: [] });
  assert.equal(before.totalRows, 3);
  assert.doesNotMatch(JSON.stringify(before), /synthetic-secret-only|9007199254740993/);

  await engine.exec('UPDATE partner_hub.probe SET large = 9007199254740992 WHERE large = 9007199254740993');
  const changedBigint = await fingerprint(engine, options);
  assert.notEqual(before.contentSha256, changedBigint.contentSha256);
  await engine.query('UPDATE partner_hub.probe SET raw_json = $1::json', [raw.replaceAll(' ', '')]);
  const changedJsonWhitespace = await fingerprint(engine, options);
  assert.notEqual(changedBigint.contentSha256, changedJsonWhitespace.contentSha256);
  await engine.exec(`UPDATE partner_hub.probe SET optional = 'null' WHERE optional IS NULL`);
  const changedNull = await fingerprint(engine, options);
  assert.notEqual(changedJsonWhitespace.contentSha256, changedNull.contentSha256);
  await engine.exec('DELETE FROM partner_hub.probe WHERE ctid = (SELECT ctid FROM partner_hub.probe LIMIT 1)');
  const removedDuplicate = await fingerprint(engine, options);
  assert.equal(removedDuplicate.totalRows, 2);
  assert.notEqual(changedNull.contentSha256, removedDuplicate.contentSha256);

  await assert.rejects(fingerprint(engine, { ...options, maxRowsPerTable: 1 }), /data-row-limit/);
  await assert.rejects(fingerprint(engine, { ...options, maxTotalBytes: 1 }), /data-byte-limit/);
  await assert.rejects(fingerprint(engine, { ...options, maxRowBytes: 1 }), /data-byte-limit/);
  await assert.rejects(fingerprint(engine, { ...options, maxCatalogRows: 1 }), /catalog-row-limit/);
  await assert.rejects(fingerprint(engine, { ...options, maxCatalogBytes: 1 }), /fingerprint-byte-limit/);
  await assert.rejects(fingerprint(engine, { expectedTableCount: 38 }), /unexpected-table-inventory/);
  await engine.exec('CREATE SEQUENCE partner_hub.unsupported_sequence');
  await assert.rejects(fingerprint(engine, options), /unsupported-schema-object/);
});

void test('backup verifier requires snapshot/canonical settings and redacts executor errors', async (t) => {
  const engine = await PGlite.create();
  t.after(() => engine.close());
  const unsafe = async (query: string, parameters: unknown[] = []) => (await engine.query(query, parameters)).rows;
  await assert.rejects(fingerprintSupabaseDatabase({ unsafe }), /snapshot-transaction-required/);
  await assert.rejects(engine.transaction(async (transaction) => {
    await transaction.exec(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
      SET LOCAL TIME ZONE 'Asia/Seoul';`);
    return fingerprintSupabaseDatabase({
      unsafe: async (query: string, parameters: unknown[] = []) => (await transaction.query(query, parameters)).rows,
    });
  }), /canonical-settings-required/);
  await assert.rejects(fingerprintSupabaseDatabase({
    unsafe: async () => { throw new Error('postgres://secret-value synthetic-secret-row'); },
  }), (error: Error) => {
    assert.equal(error.message, 'fingerprint-query-failed');
    assert.doesNotMatch(String(error.stack), /secret-value|synthetic-secret-row/);
    assert.equal(error.cause, undefined);
    return true;
  });
  await assert.rejects(fingerprintSupabaseDatabase({ unsafe }, { schema: 'partner_hub; SELECT secret' }), /invalid-schema/);
  assert.throws(() => compareSupabaseFingerprints({}, {}), /invalid-fingerprint/);
});
