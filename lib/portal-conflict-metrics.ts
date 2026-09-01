import { env, waitUntil } from 'cloudflare:workers';

import { portalSaveConflictStatsTableSql } from '@/db/schema';

export type PortalConflictKind =
  | 'member_revision'
  | 'state_revision'
  | 'recovery_proof'
  | 'cas_exhausted'
  | 'capacity'
  | 'other';
export type PortalConflictSource =
  | 'state_save'
  | 'public_registration'
  | 'admin_partner_registration';
export type PortalConflictActorRole =
  | 'admin'
  | 'partner'
  | 'unauthenticated';

type ConflictMetric = {
  source: PortalConflictSource;
  kind: PortalConflictKind;
  actorRole: PortalConflictActorRole;
  occurredAt?: string;
};
type ConflictRow = {
  bucket_date: string;
  source: PortalConflictSource;
  kind: Exclude<PortalConflictKind, 'capacity'>;
  actor_role: PortalConflictActorRole;
  conflict_count: number;
  last_conflict_at: string;
};
export type PortalSaveConflictSummary = {
  windowDays: number;
  total: number;
  lastConflictAt: string | null;
  rows: Array<{
    date: string;
    source: PortalConflictSource;
    kind: Exclude<PortalConflictKind, 'capacity'>;
    actorRole: PortalConflictActorRole;
    count: number;
    lastConflictAt: string;
  }>;
};

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('DB binding is not configured.');
  return binding;
}

function koreanDate(iso: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) throw new Error('Invalid conflict timestamp.');
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordPortalSaveConflict(metric: ConflictMetric) {
  if (metric.kind === 'capacity') return false;
  const occurredAt = metric.occurredAt ?? new Date().toISOString();
  const db = database();
  await db.prepare(portalSaveConflictStatsTableSql).run();
  await db
    .prepare(`
      INSERT INTO portal_save_conflict_stats
        (bucket_date, source, kind, actor_role, conflict_count, last_conflict_at)
      VALUES (?1, ?2, ?3, ?4, 1, ?5)
      ON CONFLICT(bucket_date, source, kind, actor_role) DO UPDATE SET
        conflict_count = portal_save_conflict_stats.conflict_count + 1,
        last_conflict_at = CASE
          WHEN excluded.last_conflict_at > portal_save_conflict_stats.last_conflict_at
          THEN excluded.last_conflict_at
          ELSE portal_save_conflict_stats.last_conflict_at
        END
    `)
    .bind(
      koreanDate(occurredAt),
      metric.source,
      metric.kind,
      metric.actorRole,
      occurredAt,
    )
    .run();
  return true;
}

/** Schedule metrics without changing the original conflict response. */
export function schedulePortalSaveConflict(metric: ConflictMetric) {
  if (metric.kind === 'capacity') return;
  try {
    waitUntil(
      recordPortalSaveConflict(metric).catch((error) => {
        console.error(
          'Failed to record portal save conflict',
          error instanceof Error ? error.name : 'unknown',
        );
      }),
    );
  } catch {
    // Tests or incomplete runtimes may not provide waitUntil. The 409 response wins.
  }
}

export async function readPortalSaveConflictSummary(
  windowDays = 7,
  now = new Date().toISOString(),
): Promise<PortalSaveConflictSummary> {
  const boundedDays = Math.min(30, Math.max(1, Math.trunc(windowDays)));
  const cutoffTime =
    new Date(now).getTime() - (boundedDays - 1) * 24 * 60 * 60 * 1000;
  const cutoffDate = koreanDate(new Date(cutoffTime).toISOString());
  const currentDate = koreanDate(now);
  const db = database();
  await db.prepare(portalSaveConflictStatsTableSql).run();
  const result = await db
    .prepare(`
      SELECT bucket_date, source, kind, actor_role, conflict_count, last_conflict_at
      FROM portal_save_conflict_stats
      WHERE bucket_date BETWEEN ?1 AND ?2
      ORDER BY last_conflict_at DESC
    `)
    .bind(cutoffDate, currentDate)
    .all<ConflictRow>();
  const rows = result.results.map((row) => ({
    date: row.bucket_date,
    source: row.source,
    kind: row.kind,
    actorRole: row.actor_role,
    count: Number(row.conflict_count),
    lastConflictAt: row.last_conflict_at,
  }));
  return {
    windowDays: boundedDays,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    lastConflictAt: rows[0]?.lastConflictAt ?? null,
    rows,
  };
}
