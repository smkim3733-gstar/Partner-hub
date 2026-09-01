import { env, waitUntil } from 'cloudflare:workers';

import { portalPasswordLinkStatsTableSql } from '@/db/schema';

export type PasswordLinkMetric = {
  issued?: number;
  activeReplacement?: number;
  expiredAtReissue?: number;
  redeemed?: number;
  observedExpiredAttempt?: number;
  occurredAt?: string;
};

type PasswordLinkStatsRow = {
  issued_count: number;
  active_replacement_count: number;
  expired_at_reissue_count: number;
  redeemed_count: number;
  observed_expired_attempt_count: number;
};

export type PasswordLinkSummary = {
  windowDays: number;
  issued: number;
  activeReplacements: number;
  expiredAtReissue: number;
  redeemed: number;
  observedExpiredAttempts: number;
};

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('DB binding is not configured.');
  return binding;
}

function koreanDate(iso: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) throw new Error('Invalid password-link metric timestamp.');
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function count(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
}

export async function recordPasswordLinkMetric(metric: PasswordLinkMetric) {
  const values = {
    issued: count(metric.issued),
    activeReplacement: count(metric.activeReplacement),
    expiredAtReissue: count(metric.expiredAtReissue),
    redeemed: count(metric.redeemed),
    observedExpiredAttempt: count(metric.observedExpiredAttempt),
  };
  if (!Object.values(values).some(Boolean)) return false;
  const occurredAt = metric.occurredAt ?? new Date().toISOString();
  const db = database();
  // This DDL intentionally lives only in the metric path. Authentication schema
  // setup must never depend on observability availability.
  await db.prepare(portalPasswordLinkStatsTableSql).run();
  await db
    .prepare(`
      INSERT INTO portal_password_link_stats
        (bucket_date, issued_count, active_replacement_count,
         expired_at_reissue_count, redeemed_count, observed_expired_attempt_count)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(bucket_date) DO UPDATE SET
        issued_count = portal_password_link_stats.issued_count + excluded.issued_count,
        active_replacement_count = portal_password_link_stats.active_replacement_count + excluded.active_replacement_count,
        expired_at_reissue_count = portal_password_link_stats.expired_at_reissue_count + excluded.expired_at_reissue_count,
        redeemed_count = portal_password_link_stats.redeemed_count + excluded.redeemed_count,
        observed_expired_attempt_count = portal_password_link_stats.observed_expired_attempt_count + excluded.observed_expired_attempt_count
    `)
    .bind(
      koreanDate(occurredAt),
      values.issued,
      values.activeReplacement,
      values.expiredAtReissue,
      values.redeemed,
      values.observedExpiredAttempt,
    )
    .run();
  return true;
}

/** Schedule aggregate writes without changing any credential response. */
export function schedulePasswordLinkMetric(metric: PasswordLinkMetric) {
  try {
    waitUntil(
      recordPasswordLinkMetric(metric).catch((error) => {
        console.error(
          'Failed to record password-link metric',
          error instanceof Error ? error.name : 'unknown',
        );
      }),
    );
  } catch {
    // Credential success and generic link errors always win over telemetry.
  }
}

export async function readPasswordLinkSummary(
  windowDays = 7,
  now = new Date().toISOString(),
): Promise<PasswordLinkSummary> {
  const boundedDays = Math.min(30, Math.max(1, Math.trunc(windowDays)));
  const cutoffTime =
    new Date(now).getTime() - (boundedDays - 1) * 24 * 60 * 60 * 1000;
  const cutoffDate = koreanDate(new Date(cutoffTime).toISOString());
  const currentDate = koreanDate(now);
  const db = database();
  await db.prepare(portalPasswordLinkStatsTableSql).run();
  const row = await db
    .prepare(`
      SELECT
        COALESCE(SUM(issued_count), 0) AS issued_count,
        COALESCE(SUM(active_replacement_count), 0) AS active_replacement_count,
        COALESCE(SUM(expired_at_reissue_count), 0) AS expired_at_reissue_count,
        COALESCE(SUM(redeemed_count), 0) AS redeemed_count,
        COALESCE(SUM(observed_expired_attempt_count), 0) AS observed_expired_attempt_count
      FROM portal_password_link_stats
      WHERE bucket_date BETWEEN ?1 AND ?2
    `)
    .bind(cutoffDate, currentDate)
    .first<PasswordLinkStatsRow>();
  return {
    windowDays: boundedDays,
    issued: Number(row?.issued_count ?? 0),
    activeReplacements: Number(row?.active_replacement_count ?? 0),
    expiredAtReissue: Number(row?.expired_at_reissue_count ?? 0),
    redeemed: Number(row?.redeemed_count ?? 0),
    observedExpiredAttempts: Number(row?.observed_expired_attempt_count ?? 0),
  };
}
