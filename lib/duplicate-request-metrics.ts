import { env, waitUntil } from 'cloudflare:workers';

import { portalDuplicateRequestStatsTableSql } from '@/db/schema';

export const duplicateRequestSources = [
  'flow_command',
  'file_upload',
  'admin_partner_registration',
] as const;
export const duplicateRequestOutcomes = [
  'safe_retry',
  'request_key_conflict',
  'existing_record_blocked',
  'unkeyed_request',
] as const;

export type DuplicateRequestSource = (typeof duplicateRequestSources)[number];
export type DuplicateRequestOutcome = (typeof duplicateRequestOutcomes)[number];
export type DuplicateRequestMetric = {
  source: DuplicateRequestSource;
  outcome: DuplicateRequestOutcome;
  occurredAt?: string;
};
export type DuplicateRequestSummary = {
  windowDays: number;
  totalSafeRetries: number;
  totalRequestKeyConflicts: number;
  totalExistingRecordBlocks: number;
  unkeyedUploadRequests: number;
  rows: Array<{
    source: DuplicateRequestSource;
    outcome: DuplicateRequestOutcome;
    count: number;
  }>;
};

type SummaryRow = {
  source: DuplicateRequestSource;
  outcome: DuplicateRequestOutcome;
  event_count: number;
};

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('DB binding is not configured.');
  return binding;
}

function koreanDate(iso: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time))
    throw new Error('Invalid duplicate-request metric timestamp.');
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isSource(value: string): value is DuplicateRequestSource {
  return duplicateRequestSources.some((source) => source === value);
}

function isOutcome(value: string): value is DuplicateRequestOutcome {
  return duplicateRequestOutcomes.some((outcome) => outcome === value);
}

export async function recordDuplicateRequestMetric(
  metric: DuplicateRequestMetric,
) {
  if (!isSource(metric.source) || !isOutcome(metric.outcome))
    throw new Error('Invalid duplicate-request metric dimension.');
  const occurredAt = metric.occurredAt ?? new Date().toISOString();
  const db = database();
  // Observability availability must never become a dependency of business data.
  await db.prepare(portalDuplicateRequestStatsTableSql).run();
  await db
    .prepare(`
      INSERT INTO portal_duplicate_request_stats
        (bucket_date, source, outcome, event_count)
      VALUES (?1, ?2, ?3, 1)
      ON CONFLICT(bucket_date, source, outcome) DO UPDATE SET
        event_count = portal_duplicate_request_stats.event_count + 1
    `)
    .bind(koreanDate(occurredAt), metric.source, metric.outcome)
    .run();
  return true;
}

/** Schedule aggregate writes without changing the business response. */
export function scheduleDuplicateRequestMetric(metric: DuplicateRequestMetric) {
  try {
    waitUntil(
      recordDuplicateRequestMetric(metric).catch((error) => {
        console.error(
          'Failed to record duplicate-request metric',
          error instanceof Error ? error.name : 'unknown',
        );
      }),
    );
  } catch {
    // The original success or failure response always wins over telemetry.
  }
}

export async function readDuplicateRequestSummary(
  windowDays = 7,
  now = new Date().toISOString(),
): Promise<DuplicateRequestSummary> {
  const boundedDays = Math.min(30, Math.max(1, Math.trunc(windowDays)));
  const cutoffTime =
    new Date(now).getTime() - (boundedDays - 1) * 24 * 60 * 60 * 1000;
  const cutoffDate = koreanDate(new Date(cutoffTime).toISOString());
  const currentDate = koreanDate(now);
  const db = database();
  await db.prepare(portalDuplicateRequestStatsTableSql).run();
  const result = await db
    .prepare(`
      SELECT source, outcome, SUM(event_count) AS event_count
      FROM portal_duplicate_request_stats
      WHERE bucket_date BETWEEN ?1 AND ?2
      GROUP BY source, outcome
      ORDER BY source, outcome
    `)
    .bind(cutoffDate, currentDate)
    .all<SummaryRow>();
  const rows = result.results.map((row) => ({
    source: row.source,
    outcome: row.outcome,
    count: Number(row.event_count),
  }));
  const total = (outcome: DuplicateRequestOutcome) =>
    rows
      .filter((row) => row.outcome === outcome)
      .reduce((sum, row) => sum + row.count, 0);
  return {
    windowDays: boundedDays,
    totalSafeRetries: total('safe_retry'),
    totalRequestKeyConflicts: total('request_key_conflict'),
    totalExistingRecordBlocks: total('existing_record_blocked'),
    unkeyedUploadRequests: rows
      .filter(
        (row) =>
          row.source === 'file_upload' && row.outcome === 'unkeyed_request',
      )
      .reduce((sum, row) => sum + row.count, 0),
    rows,
  };
}
