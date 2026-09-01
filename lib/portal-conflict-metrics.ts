import { env, waitUntil } from 'cloudflare:workers';

import {
  portalConflictReceiptsExpiryIndexSql,
  portalConflictReceiptsTableSql,
  portalConflictRecoveryStatsTableSql,
  portalSaveConflictStatsTableSql,
} from '@/db/schema';
import {
  PORTAL_CONFLICT_RECEIPT_PATTERN,
  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
} from '@/lib/portal-conflict-receipt';

export {
  PORTAL_CONFLICT_RECEIPT_HEADER,
  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
} from '@/lib/portal-conflict-receipt';

const DURATION_DISCLOSURE_THRESHOLD = 5;

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

type RecoverableKind = Exclude<PortalConflictKind, 'capacity'>;
type ConflictMetric = {
  source: PortalConflictSource;
  kind: PortalConflictKind;
  actorRole: PortalConflictActorRole;
  occurredAt?: string;
};
type ConflictRow = {
  bucket_date: string;
  source: PortalConflictSource;
  kind: RecoverableKind;
  actor_role: PortalConflictActorRole;
  conflict_count: number;
  last_conflict_at: string;
};
type ReceiptRow = {
  bucket_date: string;
  source: PortalConflictSource;
  kind: RecoverableKind;
  actor_role: PortalConflictActorRole;
  started_at: string;
};
type RecoveryRow = {
  bucket_date: string;
  source: PortalConflictSource;
  kind: RecoverableKind;
  actor_role: PortalConflictActorRole;
  issued_count: number;
  recovered_count: number;
  under_1m_count: number;
  under_5m_count: number;
  under_30m_count: number;
  under_2h_count: number;
  under_24h_count: number;
};
export type PortalRecoveryDurationBuckets = {
  under1Minute: number;
  oneTo5Minutes: number;
  fiveTo30Minutes: number;
  thirtyMinutesTo2Hours: number;
  twoTo24Hours: number;
};
export type PortalSaveConflictSummary = {
  windowDays: number;
  total: number;
  lastConflictAt: string | null;
  rows: Array<{
    date: string;
    source: PortalConflictSource;
    kind: RecoverableKind;
    actorRole: PortalConflictActorRole;
    count: number;
    lastConflictAt: string;
  }>;
  recovery: {
    disclosureThreshold: number;
    rows: Array<{
      source: PortalConflictSource;
      kind: RecoverableKind;
      actorRole: PortalConflictActorRole;
      clientCoverage: 'in_memory_ui' | 'api_response_only';
      issued: number;
      recovered: number;
      recoveryRatePercent: number;
      durationBuckets: PortalRecoveryDurationBuckets | null;
    }>;
  };
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

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function ensureRecoveryTables(db: D1Database) {
  await db.prepare(portalConflictReceiptsTableSql).run();
  await db.prepare(portalConflictReceiptsExpiryIndexSql).run();
  await db.prepare(portalConflictRecoveryStatsTableSql).run();
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

/** Schedule conflict counts without changing the original conflict response. */
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

/** Persist the hash and issued denominator before exposing a raw bearer receipt. */
export async function issuePortalConflictReceipt(
  metric: ConflictMetric,
): Promise<string | null> {
  if (metric.kind === 'capacity') return null;
  const startedAt = metric.occurredAt ?? new Date().toISOString();
  const startedTime = new Date(startedAt).getTime();
  if (!Number.isFinite(startedTime)) throw new Error('Invalid conflict timestamp.');
  const token = randomToken();
  const hash = await tokenHash(token);
  const bucketDate = koreanDate(startedAt);
  const expiresAt = startedTime + PORTAL_CONFLICT_RECEIPT_TTL_SECONDS * 1000;
  const db = database();
  await ensureRecoveryTables(db);
  await db.batch([
    db
      .prepare(`
        INSERT INTO portal_conflict_receipts
          (token_hash, bucket_date, source, kind, actor_role, started_at, expires_at, claimed_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
      `)
      .bind(
        hash,
        bucketDate,
        metric.source,
        metric.kind,
        metric.actorRole,
        startedAt,
        expiresAt,
      ),
    db
      .prepare(`
        INSERT INTO portal_conflict_recovery_stats
          (bucket_date, source, kind, actor_role, issued_count, recovered_count,
           under_1m_count, under_5m_count, under_30m_count, under_2h_count,
           under_24h_count)
        VALUES (?1, ?2, ?3, ?4, 1, 0, 0, 0, 0, 0, 0)
        ON CONFLICT(bucket_date, source, kind, actor_role) DO UPDATE SET
          issued_count = portal_conflict_recovery_stats.issued_count + 1
      `)
      .bind(
        bucketDate,
        metric.source,
        metric.kind,
        metric.actorRole,
      ),
    db
      .prepare(
        'DELETE FROM portal_conflict_receipts WHERE expires_at <= ?1 AND token_hash <> ?2',
      )
      .bind(startedTime, hash),
  ]);
  return token;
}

function durationColumn(elapsedSeconds: number) {
  if (elapsedSeconds < 60) return 'under_1m_count';
  if (elapsedSeconds < 5 * 60) return 'under_5m_count';
  if (elapsedSeconds < 30 * 60) return 'under_30m_count';
  if (elapsedSeconds < 2 * 60 * 60) return 'under_2h_count';
  return 'under_24h_count';
}

export async function consumePortalConflictReceipt({
  token,
  source,
  actorRole,
  occurredAt,
}: {
  token: string;
  source: PortalConflictSource;
  actorRole: PortalConflictActorRole;
  occurredAt?: string;
}) {
  if (!PORTAL_CONFLICT_RECEIPT_PATTERN.test(token)) return false;
  const recoveredAt = occurredAt ?? new Date().toISOString();
  const recoveredTime = new Date(recoveredAt).getTime();
  if (!Number.isFinite(recoveredTime)) throw new Error('Invalid recovery timestamp.');
  const hash = await tokenHash(token);
  const db = database();
  await ensureRecoveryTables(db);
  const claimed = await db
    .prepare(`
      UPDATE portal_conflict_receipts
      SET claimed_at = ?1
      WHERE token_hash = ?2 AND source = ?3 AND actor_role = ?4
        AND claimed_at IS NULL AND expires_at > ?5
      RETURNING bucket_date, source, kind, actor_role, started_at
    `)
    .bind(recoveredAt, hash, source, actorRole, recoveredTime)
    .first<ReceiptRow>();
  if (!claimed) {
    await db
      .prepare('DELETE FROM portal_conflict_receipts WHERE expires_at <= ?1')
      .bind(recoveredTime)
      .run();
    return false;
  }
  const elapsedSeconds = Math.max(
    0,
    Math.floor((recoveredTime - new Date(claimed.started_at).getTime()) / 1000),
  );
  const bucketColumn = durationColumn(elapsedSeconds);
  await db.batch([
    db
      .prepare(`
        INSERT INTO portal_conflict_recovery_stats
          (bucket_date, source, kind, actor_role, issued_count, recovered_count,
           under_1m_count, under_5m_count, under_30m_count, under_2h_count,
           under_24h_count)
        VALUES (?1, ?2, ?3, ?4, 0, 1,
          ${bucketColumn === 'under_1m_count' ? 1 : 0},
          ${bucketColumn === 'under_5m_count' ? 1 : 0},
          ${bucketColumn === 'under_30m_count' ? 1 : 0},
          ${bucketColumn === 'under_2h_count' ? 1 : 0},
          ${bucketColumn === 'under_24h_count' ? 1 : 0})
        ON CONFLICT(bucket_date, source, kind, actor_role) DO UPDATE SET
          recovered_count = portal_conflict_recovery_stats.recovered_count + 1,
          ${bucketColumn} = portal_conflict_recovery_stats.${bucketColumn} + 1
      `)
      .bind(
        claimed.bucket_date,
        claimed.source,
        claimed.kind,
        claimed.actor_role,
      ),
    db
      .prepare('DELETE FROM portal_conflict_receipts WHERE token_hash = ?1')
      .bind(hash),
    db
      .prepare('DELETE FROM portal_conflict_receipts WHERE expires_at <= ?1')
      .bind(recoveredTime),
  ]);
  return true;
}

/** Schedule receipt consumption only after the business request has succeeded. */
export function schedulePortalConflictRecovery(input: {
  token: string | null;
  source: PortalConflictSource;
  actorRole: PortalConflictActorRole;
}) {
  if (!input.token || !PORTAL_CONFLICT_RECEIPT_PATTERN.test(input.token)) return;
  try {
    waitUntil(
      consumePortalConflictReceipt({
        token: input.token,
        source: input.source,
        actorRole: input.actorRole,
      }).catch((error) => {
        console.error(
          'Failed to record portal conflict recovery',
          error instanceof Error ? error.name : 'unknown',
        );
      }),
    );
  } catch {
    // Recovery telemetry must never alter a successful business response.
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
  await ensureRecoveryTables(db);
  const [conflicts, recoveries] = await Promise.all([
    db
      .prepare(`
        SELECT bucket_date, source, kind, actor_role, conflict_count, last_conflict_at
        FROM portal_save_conflict_stats
        WHERE bucket_date BETWEEN ?1 AND ?2
        ORDER BY last_conflict_at DESC
      `)
      .bind(cutoffDate, currentDate)
      .all<ConflictRow>(),
    db
      .prepare(`
        SELECT bucket_date, source, kind, actor_role, issued_count, recovered_count,
          under_1m_count, under_5m_count, under_30m_count, under_2h_count,
          under_24h_count
        FROM portal_conflict_recovery_stats
        WHERE bucket_date BETWEEN ?1 AND ?2
      `)
      .bind(cutoffDate, currentDate)
      .all<RecoveryRow>(),
  ]);
  const rows = conflicts.results.map((row) => ({
    date: row.bucket_date,
    source: row.source,
    kind: row.kind,
    actorRole: row.actor_role,
    count: Number(row.conflict_count),
    lastConflictAt: row.last_conflict_at,
  }));
  const grouped = new Map<string, RecoveryRow>();
  for (const row of recoveries.results) {
    const key = `${row.source}\u0000${row.kind}\u0000${row.actor_role}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...row });
      continue;
    }
    current.issued_count = Number(current.issued_count) + Number(row.issued_count);
    current.recovered_count =
      Number(current.recovered_count) + Number(row.recovered_count);
    current.under_1m_count =
      Number(current.under_1m_count) + Number(row.under_1m_count);
    current.under_5m_count =
      Number(current.under_5m_count) + Number(row.under_5m_count);
    current.under_30m_count =
      Number(current.under_30m_count) + Number(row.under_30m_count);
    current.under_2h_count =
      Number(current.under_2h_count) + Number(row.under_2h_count);
    current.under_24h_count =
      Number(current.under_24h_count) + Number(row.under_24h_count);
  }
  return {
    windowDays: boundedDays,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    lastConflictAt: rows[0]?.lastConflictAt ?? null,
    rows,
    recovery: {
      disclosureThreshold: DURATION_DISCLOSURE_THRESHOLD,
      rows: Array.from(grouped.values()).map((row) => {
        const issued = Number(row.issued_count);
        const recovered = Number(row.recovered_count);
        return {
          source: row.source,
          kind: row.kind,
          actorRole: row.actor_role,
          clientCoverage:
            row.source === 'public_registration'
              ? ('api_response_only' as const)
              : ('in_memory_ui' as const),
          issued,
          recovered,
          recoveryRatePercent:
            issued > 0 ? Math.round((recovered / issued) * 1000) / 10 : 0,
          durationBuckets:
            recovered >= DURATION_DISCLOSURE_THRESHOLD
              ? {
                  under1Minute: Number(row.under_1m_count),
                  oneTo5Minutes: Number(row.under_5m_count),
                  fiveTo30Minutes: Number(row.under_30m_count),
                  thirtyMinutesTo2Hours: Number(row.under_2h_count),
                  twoTo24Hours: Number(row.under_24h_count),
                }
              : null,
        };
      }),
    },
  };
}
