import test from 'node:test';
import assert from 'node:assert/strict';

import {
  consumePortalConflictReceipt,
  issuePortalConflictReceipt,
  readPortalSaveConflictSummary,
  recordPortalSaveConflict,
  schedulePortalSaveConflict,
} from '../lib/portal-conflict-metrics';
import {
  env,
  failNextWaitUntil,
  flushWaitUntil,
} from './runtime-mock.mjs';

void test('daily conflict metrics aggregate without identities and exclude capacity', async () => {
  const occurredAt = '2040-05-01T15:30:00.000Z';
  await recordPortalSaveConflict({
    source: 'state_save',
    kind: 'state_revision',
    actorRole: 'partner',
    occurredAt,
  });
  await recordPortalSaveConflict({
    source: 'state_save',
    kind: 'state_revision',
    actorRole: 'partner',
    occurredAt: '2040-05-01T16:00:00.000Z',
  });
  assert.equal(
    await recordPortalSaveConflict({
      source: 'state_save',
      kind: 'capacity',
      actorRole: 'admin',
      occurredAt,
    }),
    false,
  );

  const summary = await readPortalSaveConflictSummary(
    7,
    '2040-05-03T00:00:00.000Z',
  );
  const row = summary.rows.find(
    (item) =>
      item.source === 'state_save' &&
      item.kind === 'state_revision' &&
      item.actorRole === 'partner',
  );
  assert.equal(row?.date, '2040-05-02');
  assert.equal(row?.count, 2);
  assert.equal(JSON.stringify(summary).includes('"kind":"capacity"'), false);
  assert.equal(JSON.stringify(summary).includes('email'), false);
  assert.equal(JSON.stringify(summary).includes('company'), false);
});

void test('anonymous receipts store only hashes, enforce source and role, and are claimed once', async () => {
  const startedAt = '2040-07-01T01:00:00.000Z';
  const token = await issuePortalConflictReceipt({
    source: 'state_save',
    kind: 'state_revision',
    actorRole: 'partner',
    occurredAt: startedAt,
  });
  assert.match(token ?? '', /^[A-Za-z0-9_-]{43}$/);
  const stored = await env.DB.prepare(`
    SELECT token_hash, bucket_date, source, kind, actor_role, started_at, expires_at, claimed_at
    FROM portal_conflict_receipts WHERE started_at = ?1
  `)
    .bind(startedAt)
    .first();
  assert.ok(stored);
  assert.notEqual(stored.token_hash, token);
  assert.match(String(stored.token_hash), /^[a-f0-9]{64}$/);
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
  assert.equal(
    await consumePortalConflictReceipt({
      token: token!,
      source: 'public_registration',
      actorRole: 'partner',
      occurredAt: '2040-07-01T01:00:30.000Z',
    }),
    false,
  );
  assert.equal(
    await consumePortalConflictReceipt({
      token: token!,
      source: 'state_save',
      actorRole: 'admin',
      occurredAt: '2040-07-01T01:00:30.000Z',
    }),
    false,
  );
  assert.equal(
    await consumePortalConflictReceipt({
      token: token!,
      source: 'state_save',
      actorRole: 'partner',
      occurredAt: '2040-07-01T01:00:30.000Z',
    }),
    true,
  );
  assert.equal(
    await consumePortalConflictReceipt({
      token: token!,
      source: 'state_save',
      actorRole: 'partner',
      occurredAt: '2040-07-01T01:00:40.000Z',
    }),
    false,
  );
  assert.equal(
    await env.DB.prepare(
      'SELECT token_hash FROM portal_conflict_receipts WHERE started_at = ?1',
    )
      .bind(startedAt)
      .first(),
    null,
  );
  const summary = await readPortalSaveConflictSummary(
    1,
    '2040-07-01T12:00:00.000Z',
  );
  const recovery = summary.recovery.rows.find(
    (row) =>
      row.source === 'state_save' &&
      row.kind === 'state_revision' &&
      row.actorRole === 'partner',
  );
  assert.equal(recovery?.issued, 1);
  assert.equal(recovery?.recovered, 1);
  assert.equal(recovery?.recoveryRatePercent, 100);
  assert.equal(recovery?.durationBuckets, null);
});

void test('receipt expiry is exact at 24 hours and only expired anonymous rows are cleaned', async () => {
  const startedAt = '2040-08-01T00:00:00.000Z';
  const token = await issuePortalConflictReceipt({
    source: 'admin_partner_registration',
    kind: 'cas_exhausted',
    actorRole: 'admin',
    occurredAt: startedAt,
  });
  assert.equal(
    await consumePortalConflictReceipt({
      token: token!,
      source: 'admin_partner_registration',
      actorRole: 'admin',
      occurredAt: '2040-08-02T00:00:00.000Z',
    }),
    false,
  );
  assert.equal(
    await env.DB.prepare(
      'SELECT token_hash FROM portal_conflict_receipts WHERE started_at = ?1',
    )
      .bind(startedAt)
      .first(),
    null,
  );
  const summary = await readPortalSaveConflictSummary(
    2,
    '2040-08-02T00:00:00.000Z',
  );
  const recovery = summary.recovery.rows.find(
    (row) => row.source === 'admin_partner_registration',
  );
  assert.equal(recovery?.issued, 1);
  assert.equal(recovery?.recovered, 0);
});

void test('coarse duration buckets are withheld until five same-dimension recoveries', async () => {
  for (let index = 0; index < 5; index++) {
    const minute = String(index).padStart(2, '0');
    const token = await issuePortalConflictReceipt({
      source: 'admin_partner_registration',
      kind: 'member_revision',
      actorRole: 'admin',
      occurredAt: `2040-09-01T01:${minute}:00.000Z`,
    });
    assert.equal(
      await consumePortalConflictReceipt({
        token: token!,
        source: 'admin_partner_registration',
        actorRole: 'admin',
        occurredAt: `2040-09-01T01:${minute}:30.000Z`,
      }),
      true,
    );
  }
  const summary = await readPortalSaveConflictSummary(
    1,
    '2040-09-01T12:00:00.000Z',
  );
  const recovery = summary.recovery.rows.find(
    (row) =>
      row.source === 'admin_partner_registration' &&
      row.kind === 'member_revision',
  );
  assert.deepEqual(recovery?.durationBuckets, {
    under1Minute: 5,
    oneTo5Minutes: 0,
    fiveTo30Minutes: 0,
    thirtyMinutesTo2Hours: 0,
    twoTo24Hours: 0,
  });
});

void test('waitUntil scheduling is flushable and a scheduling failure never escapes', async () => {
  schedulePortalSaveConflict({
    source: 'public_registration',
    kind: 'cas_exhausted',
    actorRole: 'unauthenticated',
    occurredAt: '2040-06-01T01:00:00.000Z',
  });
  await flushWaitUntil();
  const summary = await readPortalSaveConflictSummary(
    1,
    '2040-06-01T12:00:00.000Z',
  );
  assert.equal(summary.total, 1);
  assert.equal(summary.rows[0]?.source, 'public_registration');

  failNextWaitUntil();
  assert.doesNotThrow(() =>
    schedulePortalSaveConflict({
      source: 'admin_partner_registration',
      kind: 'cas_exhausted',
      actorRole: 'admin',
    }),
  );
});
