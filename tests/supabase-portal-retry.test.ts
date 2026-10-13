import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { env } from 'cloudflare:workers';
import { postgresFixture } from './supabase-postgres-fixture';
import {
  mutatePortalState,
  readPortalState,
  writePortalState,
} from '../lib/portal-state';
import { SupabaseTransactionConflict } from '../lib/supabase-postgres-database';

async function fixture(t: TestContext) {
  const f = await postgresFixture();
  const runtime = env as unknown as { DB: D1Database };
  const previous = runtime.DB;
  runtime.DB = f.db;
  t.after(async () => {
    runtime.DB = previous;
    await f.close();
  });
  await writePortalState({ consultationNumber: 0 });
  return { db: f.db, batch: f.db.batch.bind(f.db) };
}
const increment = (raw: unknown) => ({
  consultationNumber:
    (raw as { consultationNumber: number }).consultationNumber + 1,
});
const effect = (db: D1Database) => [db.prepare('SELECT 1 AS ready')];

void test('portal serialization retry recomputes the state and effects after a competing commit', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  f.db.batch = async (statements) => {
    attempts++;
    if (attempts === 1) {
      await writePortalState({ consultationNumber: 100 });
      throw new SupabaseTransactionConflict();
    }
    return f.batch(statements);
  };
  const effects: number[] = [];
  await mutatePortalState(increment, undefined, (db, payload) => {
    effects.push(JSON.parse(payload).consultationNumber);
    return effect(db);
  });
  assert.deepEqual(effects, [1, 101]);
  assert.equal(attempts, 2);
  assert.deepEqual(await readPortalState(), { consultationNumber: 101 });
});

for (const unchanged of [false, true]) {
  void test(`portal serialization conflicts stop at four attempts (unchanged=${unchanged})`, async (t) => {
    const f = await fixture(t);
    let attempts = 0;
    f.db.batch = async () => {
      attempts++;
      throw new SupabaseTransactionConflict();
    };
    await assert.rejects(
      mutatePortalState(
        unchanged ? (state) => state : increment,
        undefined,
        effect,
      ),
      { kind: 'cas_exhausted' },
    );
    assert.equal(attempts, 4);
    assert.deepEqual(await readPortalState(), { consultationNumber: 0 });
  });
}

void test('portal never retries a commit whose response was lost', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  f.db.batch = async (statements) => {
    attempts++;
    await f.batch(statements);
    throw new Error('SUPABASE_POSTGRES_OPERATION_FAILED_OR_OUTCOME_UNKNOWN');
  };
  await assert.rejects(
    mutatePortalState(increment, undefined, effect),
    /OUTCOME_UNKNOWN/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(await readPortalState(), { consultationNumber: 1 });
});
