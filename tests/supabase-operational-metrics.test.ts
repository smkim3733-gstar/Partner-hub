import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { postgresRuntimeFixture } from './supabase-runtime-fixture';
import { flushWaitUntil } from './runtime-mock.mjs';
import {
  duplicateRequestSources,
  duplicateRequestOutcomes,
  recordDuplicateRequestMetric,
  readDuplicateRequestSummary,
  scheduleDuplicateRequestMetric,
} from '../lib/duplicate-request-metrics';
import {
  recordPortalSaveConflict,
  issuePortalConflictReceipt,
  consumePortalConflictReceipt,
  readPortalSaveConflictSummary,
  schedulePortalSaveConflict,
  schedulePortalConflictRecovery,
} from '../lib/portal-conflict-metrics';

const startedAt = '2040-05-01T15:00:00.000Z';
const now = (seconds: number) =>
  new Date(Date.parse(startedAt) + seconds * 1000).toISOString();
const metric = {
  source: 'state_save',
  kind: 'state_revision',
  actorRole: 'partner',
  occurredAt: startedAt,
} as const;
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const consume = (token: string, seconds: number) =>
  consumePortalConflictReceipt({
    token,
    source: metric.source,
    actorRole: metric.actorRole,
    occurredAt: now(seconds),
  });

void test('native metrics preserve count-only dimensions, Korean dates, bounded summaries and scheduling', async (t) => {
  const f = await postgresRuntimeFixture(t);
  await f.engine.exec('SET ROLE service_role');
  for (const source of duplicateRequestSources) {
    for (const outcome of duplicateRequestOutcomes) {
      await recordDuplicateRequestMetric({
        source,
        outcome,
        occurredAt: startedAt,
      });
      await recordDuplicateRequestMetric({
        source,
        outcome,
        occurredAt: now(-1),
      });
    }
  }
  scheduleDuplicateRequestMetric({
    source: 'flow_command',
    outcome: 'safe_retry',
    occurredAt: startedAt,
  });
  schedulePortalSaveConflict(metric);
  await recordPortalSaveConflict({ ...metric, occurredAt: now(60) });
  await flushWaitUntil();
  const duplicates = await readDuplicateRequestSummary(1, now(120));
  assert.equal(duplicates.rows.length, 12);
  assert.equal(duplicates.totalSafeRetries, 4);
  assert.equal(duplicates.totalRequestKeyConflicts, 3);
  assert.equal(duplicates.totalExistingRecordBlocks, 3);
  assert.equal(duplicates.unkeyedUploadRequests, 1);
  assert.equal(
    (await readDuplicateRequestSummary(100, now(120))).windowDays,
    30,
  );
  assert.equal((await readDuplicateRequestSummary(0, now(120))).windowDays, 1);
  const conflicts = await readPortalSaveConflictSummary(1, now(120));
  assert.equal(conflicts.total, 2);
  assert.equal(conflicts.rows[0].date, '2040-05-02');
  assert.equal(conflicts.lastConflictAt, now(60));
  assert.equal(
    await recordPortalSaveConflict({ ...metric, kind: 'capacity' }),
    false,
  );
  assert.equal(
    await issuePortalConflictReceipt({ ...metric, kind: 'capacity' }),
    null,
  );
  await assert.rejects(
    recordDuplicateRequestMetric({
      source: 'private-value' as never,
      outcome: 'safe_retry',
    }),
  );
  await assert.rejects(
    recordPortalSaveConflict({ ...metric, kind: 'private-value' as never }),
  );
  await assert.rejects(
    recordPortalSaveConflict({ ...metric, occurredAt: 'not-a-date' }),
  );
  assert.doesNotMatch(
    JSON.stringify({ duplicates, conflicts }),
    /token|email|company|caseId|fingerprint|storageKey|private-value/,
  );
});

void test('native receipts are hash-only, role/source-bound, single use, exact expiry and thresholded durations', async (t) => {
  const f = await postgresRuntimeFixture(t);
  await f.engine.exec('SET ROLE service_role');
  const token = (await issuePortalConflictReceipt(metric))!;
  const stored = await f.db
    .prepare('SELECT * FROM portal_conflict_receipts')
    .first<Record<string, unknown>>();
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored).sort(), [
    'actor_role',
    'bucket_date',
    'claimed_at',
    'expires_at',
    'kind',
    'source',
    'started_at',
    'token_hash',
  ]);
  assert.equal(stored.token_hash, hash(token));
  assert.equal(stored.expires_at, Date.parse(startedAt) + 86400000);
  assert.equal(stored.claimed_at, null);
  assert.equal(
    await consumePortalConflictReceipt({
      token,
      source: 'public_registration',
      actorRole: 'partner',
      occurredAt: now(1),
    }),
    false,
  );
  assert.equal(
    await consumePortalConflictReceipt({
      token,
      source: 'state_save',
      actorRole: 'admin',
      occurredAt: now(1),
    }),
    false,
  );
  assert.equal(await consume('invalid-token', 1), false);
  // PGlite is single-connection; simultaneous callers exercise replay handling,
  // not independent PostgreSQL sessions. Multi-session QA remains separate.
  assert.deepEqual(
    (await Promise.all([consume(token, 59.999), consume(token, 59.999)])).sort(
      (left, right) => Number(left) - Number(right),
    ),
    [false, true],
  );
  assert.equal(
    (await readPortalSaveConflictSummary(1, now(60))).recovery.rows[0]
      .durationBuckets,
    null,
  );
  for (const seconds of [60, 300, 1800, 7200]) {
    const next = (await issuePortalConflictReceipt(metric))!;
    assert.equal(await consume(next, seconds), true);
  }
  const recovery = (await readPortalSaveConflictSummary(1, now(7200))).recovery
    .rows[0];
  assert.equal(recovery.issued, 5);
  assert.equal(recovery.recovered, 5);
  assert.equal(recovery.recoveryRatePercent, 100);
  assert.deepEqual(recovery.durationBuckets, {
    under1Minute: 1,
    oneTo5Minutes: 1,
    fiveTo30Minutes: 1,
    thirtyMinutesTo2Hours: 1,
    twoTo24Hours: 1,
  });
  const expiring = (await issuePortalConflictReceipt(metric))!;
  const live = (await issuePortalConflictReceipt({
    ...metric,
    occurredAt: now(1),
  }))!;
  assert.equal(await consume(expiring, 86400), false);
  assert.equal(
    await f.db
      .prepare('SELECT token_hash FROM portal_conflict_receipts')
      .first('token_hash'),
    hash(live),
  );
  assert.equal(await consume(live, 86400), true);
  assert.equal(
    (await readPortalSaveConflictSummary(2, now(86400))).recovery.rows[0]
      .recovered,
    6,
  );
});

void test('native issue and consume failures roll back receipt and counters, preserving a safe retry', async (t) => {
  const f = await postgresRuntimeFixture(t);
  await f.engine
    .exec(`CREATE FUNCTION partner_hub.fail_synthetic_metric() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic failure, no real data'; END $$;
    CREATE TRIGGER synthetic_metric_failure BEFORE INSERT OR UPDATE ON partner_hub.portal_conflict_recovery_stats
    FOR EACH ROW EXECUTE FUNCTION partner_hub.fail_synthetic_metric();`);
  await assert.rejects(issuePortalConflictReceipt(metric), /OPERATION_FAILED/);
  assert.equal(
    await f.db
      .prepare('SELECT count(*) AS count FROM portal_conflict_receipts')
      .first('count'),
    0,
  );
  await f.engine.exec(
    'DROP TRIGGER synthetic_metric_failure ON partner_hub.portal_conflict_recovery_stats',
  );
  const token = (await issuePortalConflictReceipt(metric))!;
  await f.engine
    .exec(`CREATE TRIGGER synthetic_metric_failure BEFORE UPDATE ON partner_hub.portal_conflict_recovery_stats
    FOR EACH ROW EXECUTE FUNCTION partner_hub.fail_synthetic_metric()`);
  await assert.rejects(consume(token, 10), /OPERATION_FAILED/);
  assert.equal(
    await f.db
      .prepare('SELECT token_hash FROM portal_conflict_receipts')
      .first('token_hash'),
    hash(token),
  );
  assert.equal(
    (await readPortalSaveConflictSummary(1, now(10))).recovery.rows[0]
      .recovered,
    0,
  );
  await f.engine.exec(
    'DROP TRIGGER synthetic_metric_failure ON partner_hub.portal_conflict_recovery_stats',
  );
  assert.equal(await consume(token, 10), true);
  assert.equal(await consume(token, 11), false);
  const scheduled = (await issuePortalConflictReceipt({
    ...metric,
    occurredAt: new Date().toISOString(),
  }))!;
  schedulePortalConflictRecovery({
    token: scheduled,
    source: metric.source,
    actorRole: metric.actorRole,
  });
  await flushWaitUntil();
  assert.equal(
    await f.db
      .prepare('SELECT count(*) AS count FROM portal_conflict_receipts')
      .first('count'),
    0,
  );
});

void test('native metric schema is server-only, constraints reject invalid data, unavailable telemetry stays non-blocking', async (t) => {
  const f = await postgresRuntimeFixture(t);
  for (const role of ['anon', 'authenticated']) {
    await f.engine.exec(`SET ROLE ${role}`);
    await assert.rejects(
      f.engine.query('SELECT * FROM partner_hub.portal_conflict_receipts'),
      /permission denied/,
    );
    await assert.rejects(
      f.engine.query(
        "SELECT partner_hub.consume_portal_conflict_receipt(repeat('a',64),'state_save','partner',1)",
      ),
      /permission denied/,
    );
    await f.engine.exec('RESET ROLE');
  }
  await f.engine.exec('SET ROLE service_role');
  await assert.rejects(
    f.engine.query('TRUNCATE partner_hub.portal_duplicate_request_stats'),
    /permission denied/,
  );
  await assert.rejects(
    f.engine.query('DELETE FROM partner_hub.portal_conflict_recovery_stats'),
    /permission denied/,
  );
  await assert.rejects(
    f.engine.query(
      "INSERT INTO partner_hub.portal_duplicate_request_stats VALUES ('2040-02-30','flow_command','safe_retry',1)",
    ),
    /check constraint/,
  );
  await assert.rejects(
    f.engine.query(
      "INSERT INTO partner_hub.portal_conflict_recovery_stats VALUES ('2040-05-02','state_save','state_revision','partner',0,1,1,0,0,0,0)",
    ),
    /check constraint/,
  );
  await f.engine.exec(
    'RESET ROLE; ALTER TABLE partner_hub.portal_conflict_receipts DISABLE ROW LEVEL SECURITY',
  );
  await assert.rejects(readDuplicateRequestSummary(), /OPERATION_FAILED/);
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  assert.doesNotThrow(() =>
    scheduleDuplicateRequestMetric({
      source: 'flow_command',
      outcome: 'safe_retry',
    }),
  );
  assert.doesNotThrow(() => schedulePortalSaveConflict(metric));
  await flushWaitUntil();
  assert.equal(logged.length, 2);
  assert.ok(
    logged.every((entry) => entry.length === 2 && entry[1] === 'Error'),
  );
});

void test('native operational metrics rollback probe is executable and leaves all four tables empty', async (t) => {
  const f = await postgresRuntimeFixture(t);
  await f.engine.exec(
    await readFile(
      new URL('./supabase-metrics-rollback.sql', import.meta.url),
      'utf8',
    ),
  );
  for (const table of [
    'portal_duplicate_request_stats',
    'portal_save_conflict_stats',
    'portal_conflict_recovery_stats',
    'portal_conflict_receipts',
  ]) {
    assert.equal(
      await f.db
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .first('count'),
      0,
    );
  }
});
