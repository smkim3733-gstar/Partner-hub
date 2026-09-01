import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';

import {
  readDuplicateRequestSummary,
  recordDuplicateRequestMetric,
} from '../lib/duplicate-request-metrics';

const database = (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await readDuplicateRequestSummary();
  await database.prepare('DELETE FROM portal_duplicate_request_stats').run();
});

void test('duplicate-request metrics aggregate bounded event dimensions without identifiers', async () => {
  for (const metric of [
    { source: 'flow_command', outcome: 'safe_retry' },
    { source: 'file_upload', outcome: 'safe_retry' },
    { source: 'file_upload', outcome: 'request_key_conflict' },
    {
      source: 'admin_partner_registration',
      outcome: 'existing_record_blocked',
    },
    { source: 'file_upload', outcome: 'unkeyed_request' },
  ] as const)
    await recordDuplicateRequestMetric({
      ...metric,
      occurredAt: '2026-09-01T01:00:00.000Z',
    });

  assert.deepEqual(
    await readDuplicateRequestSummary(7, '2026-09-01T03:00:00.000Z'),
    {
      windowDays: 7,
      totalSafeRetries: 2,
      totalRequestKeyConflicts: 1,
      totalExistingRecordBlocks: 1,
      unkeyedUploadRequests: 1,
      rows: [
        {
          source: 'admin_partner_registration',
          outcome: 'existing_record_blocked',
          count: 1,
        },
        { source: 'file_upload', outcome: 'request_key_conflict', count: 1 },
        { source: 'file_upload', outcome: 'safe_retry', count: 1 },
        { source: 'file_upload', outcome: 'unkeyed_request', count: 1 },
        { source: 'flow_command', outcome: 'safe_retry', count: 1 },
      ],
    },
  );

  const columns = await database
    .prepare('PRAGMA table_info(portal_duplicate_request_stats)')
    .all<{ name: string }>();
  assert.deepEqual(
    columns.results.map((column) => column.name),
    ['bucket_date', 'source', 'outcome', 'event_count'],
  );
});

void test('duplicate-request metrics use Korean dates and reject unknown dimensions', async () => {
  await recordDuplicateRequestMetric({
    source: 'flow_command',
    outcome: 'safe_retry',
    occurredAt: '2026-08-31T14:59:59.000Z',
  });
  await recordDuplicateRequestMetric({
    source: 'file_upload',
    outcome: 'unkeyed_request',
    occurredAt: '2026-08-31T15:00:00.000Z',
  });
  assert.deepEqual(
    await readDuplicateRequestSummary(1, '2026-09-01T03:00:00.000Z'),
    {
      windowDays: 1,
      totalSafeRetries: 0,
      totalRequestKeyConflicts: 0,
      totalExistingRecordBlocks: 0,
      unkeyedUploadRequests: 1,
      rows: [
        { source: 'file_upload', outcome: 'unkeyed_request', count: 1 },
      ],
    },
  );
  await assert.rejects(
    recordDuplicateRequestMetric({
      source: 'unknown' as never,
      outcome: 'safe_retry',
    }),
    /Invalid duplicate-request metric dimension/,
  );
});
