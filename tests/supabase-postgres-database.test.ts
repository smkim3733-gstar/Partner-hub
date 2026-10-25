import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSupabasePostgresDatabase,
  serializableTransactionMode,
  transactionSettingsSql,
  type SupabasePostgresExecutor,
} from '../lib/supabase-postgres-database';

function result(
  rows: Record<string, unknown>[],
  command = 'SELECT',
  count = rows.length,
) {
  return Object.assign(rows, { command, count });
}

void test('PostgreSQL adapter translates numbered values and preserves one atomic batch', async () => {
  const observed: { sql: string; parameters: readonly unknown[] }[] = [];
  const modes: string[] = [];
  const executor: SupabasePostgresExecutor = {
    async unsafe(sql, parameters = []) {
      observed.push({ sql, parameters });
      if (sql.startsWith('SELECT'))
        return result([{ repeated: parameters[0], same: parameters[0] }]);
      return result([], 'UPDATE', 1);
    },
  };
  const db = createSupabasePostgresDatabase({
    ...executor,
    async begin(mode, callback) {
      modes.push(mode);
      return callback(executor);
    },
  });
  const results = await db.batch([
    db.prepare('UPDATE accounts SET value = ?1 WHERE id = ?2').bind('값', 7),
    db.prepare('SELECT ?1 AS repeated, ?1 AS same').bind(3),
  ]);
  assert.deepEqual(modes, [serializableTransactionMode]);
  assert.deepEqual(observed[0], { sql: transactionSettingsSql, parameters: [] });
  assert.deepEqual(observed[1], {
    sql: 'UPDATE accounts SET value = $1 WHERE id = $2',
    parameters: ['값', 7],
  });
  assert.equal(results[0].meta.changes, 1);
  assert.deepEqual(results[1].results, [{ repeated: 3, same: 3 }]);
});

void test('PostgreSQL adapter refuses SQLite dialect and unsafe binding shapes before network access', async () => {
  let calls = 0;
  const db = createSupabasePostgresDatabase({
    async unsafe() {
      calls++;
      return result([]);
    },
    async begin(_mode, callback) {
      return callback(this);
    },
  });
  for (const statement of [
    db.prepare("SELECT json_extract(payload, '$.id') FROM state"),
    db.prepare('SELECT value FROM state WHERE owner IS ?1').bind(null),
    db.prepare('SELECT ?2').bind('unused', 'used'),
    db.prepare("SELECT '?1' AS literal").bind('unused'),
    db.prepare('PRAGMA foreign_keys'),
  ])
    await assert.rejects(statement.all(), /SUPABASE_POSTGRES_INVALID_OPERATION/);
  assert.equal(calls, 0);
});

void test('PostgreSQL adapter keeps quoted question marks and fails closed on unknown outcomes', async () => {
  const observed: string[] = [];
  const db = createSupabasePostgresDatabase({
    async unsafe(sql) {
      observed.push(sql);
      if (sql === transactionSettingsSql) return result([]);
      throw new Error('provider detail');
    },
    async begin(_mode, callback) {
      return callback(this);
    },
  });
  await assert.rejects(
    db.prepare("SELECT '?1' AS literal, ?1 AS value").bind(1).all(),
    /SUPABASE_POSTGRES_OPERATION_FAILED_OR_OUTCOME_UNKNOWN/,
  );
  assert.equal(observed[1], "SELECT '?1' AS literal, $1 AS value");
});

void test('PostgreSQL adapter sends a whole batch before waiting for any reply', async () => {
  const issued: string[] = [];
  const replies: (() => void)[] = [];
  const executor: SupabasePostgresExecutor = {
    unsafe(sql) {
      issued.push(sql);
      return new Promise((resolve) =>
        replies.push(() => resolve(result([], 'UPDATE', 1))),
      );
    },
  };
  const db = createSupabasePostgresDatabase({
    ...executor,
    async begin(_mode, callback) {
      return callback(executor);
    },
  });
  const pending = db.batch([
    db.prepare('UPDATE accounts SET value = ?1').bind(1),
    db.prepare('UPDATE accounts SET value = ?1').bind(2),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  // Settings plus both statements are already on the wire, unanswered.
  assert.equal(issued.length, 3);
  for (const reply of replies) reply();
  assert.deepEqual(
    (await pending).map((r) => r.meta.changes),
    [1, 1],
  );
});
