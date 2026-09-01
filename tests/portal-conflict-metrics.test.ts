import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readPortalSaveConflictSummary,
  recordPortalSaveConflict,
  schedulePortalSaveConflict,
} from '../lib/portal-conflict-metrics';
import {
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
