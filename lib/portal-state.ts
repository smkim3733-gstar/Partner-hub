import { env } from 'cloudflare:workers';

import {
  aiDiagnosisRunsCaseIndexSql,
  aiDiagnosisRunsTableSql,
  companyFileObjectsCompanyIndexSql,
  companyFileObjectsOwnerIndexSql,
  companyFileObjectsTableSql,
  portalLoginStatsTableSql,
  portalStateId,
  portalStateTableSql,
} from '@/db/schema';
import { PORTAL_STATE_LIMIT_BYTES } from '@/lib/pilot-readiness';
import type { PortalConflictKind } from '@/lib/portal-conflict-metrics';

type PortalStateRow = {
  payload: string;
};

export type PortalLoginStat = {
  memberId: string;
  lastLoginAt: string;
  loginCount: number;
};

type PortalLoginStatRow = {
  member_id: string;
  last_login_at: string;
  login_count: number;
};

const PORTAL_LOGIN_SESSION_IDLE_MS = 30 * 60_000;

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error('DB binding is not configured.');
  }
  return binding;
}

async function ensurePortalTables(db: D1Database) {
  await db.batch([
    db.prepare(portalStateTableSql),
    db.prepare(portalLoginStatsTableSql),
    db.prepare(companyFileObjectsTableSql),
    db.prepare(companyFileObjectsOwnerIndexSql),
    db.prepare(companyFileObjectsCompanyIndexSql),
    db.prepare(aiDiagnosisRunsTableSql),
    db.prepare(aiDiagnosisRunsCaseIndexSql),
  ]);
}

export async function readPortalState(): Promise<unknown> {
  return (await readPortalStateSnapshot()).state;
}

/** The exact stored payload is also usable as a conditional-write guard. */
export async function readPortalStateSnapshot() {
  const db = database();
  await ensurePortalTables(db);
  const row = await db
    .prepare('SELECT payload FROM portal_state WHERE id = ?1')
    .bind(portalStateId)
    .first<PortalStateRow>();

  return {
    state: row ? (JSON.parse(row.payload) as unknown) : null,
    payload: row?.payload ?? null,
  };
}

export async function writePortalState(state: unknown) {
  const db = database();
  await ensurePortalTables(db);
  const updatedAt = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO portal_state (id, payload, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `)
    .bind(portalStateId, JSON.stringify(state), updatedAt)
    .run();

  return updatedAt;
}

export class PortalStateConflict extends Error {
  constructor(
    message: string,
    public readonly kind: PortalConflictKind = 'other',
  ) {
    super(message);
    this.name = 'PortalStateConflict';
  }
}
export type PortalDraftGuard = {
  ownerKey: string;
  draftId: string;
  revision: number;
};

/** Retry against the latest state instead of replacing a concurrently saved member list. */
export async function mutatePortalState<T>(
  update: (current: unknown) => T | Promise<T>,
  requiredDraft?: () => PortalDraftGuard | null,
  writeEffects?: (
    db: D1Database,
    committedPayload: string,
  ) => D1PreparedStatement[],
) {
  const db = database();
  await ensurePortalTables(db);
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await db
      .prepare('SELECT payload FROM portal_state WHERE id = ?1')
      .bind(portalStateId)
      .first<PortalStateRow>();
    const state = await update(row ? JSON.parse(row.payload) : null);
    const payload = JSON.stringify(state);
    if (new TextEncoder().encode(payload).length > PORTAL_STATE_LIMIT_BYTES)
      throw new PortalStateConflict(
        '운영 데이터 저장 한도에 도달했습니다. 관리자 확인이 필요합니다.',
        'capacity',
      );
    const effects = writeEffects?.(db, payload) ?? [];
    if (payload === row?.payload) {
      if (effects.length > 0) await db.batch(effects);
      return { state, updatedAt: null };
    }
    const updatedAt = new Date().toISOString();
    const guard = requiredDraft?.();
    const write = guard
      ? db
          .prepare(
            row
              ? 'UPDATE portal_state SET payload = ?1, updated_at = ?2 WHERE id = ?3 AND payload = ?4 AND EXISTS (SELECT 1 FROM application_drafts WHERE owner_key = ?5 AND draft_id = ?6 AND revision = ?7 AND payload IS NOT NULL)'
              : 'INSERT INTO portal_state (payload, updated_at, id) SELECT ?1, ?2, ?3 WHERE ?4 IS NULL AND EXISTS (SELECT 1 FROM application_drafts WHERE owner_key = ?5 AND draft_id = ?6 AND revision = ?7 AND payload IS NOT NULL) ON CONFLICT(id) DO NOTHING',
          )
          .bind(
            payload,
            updatedAt,
            portalStateId,
            row?.payload ?? null,
            guard.ownerKey,
            guard.draftId,
            guard.revision,
          )
      : row
        ? db
            .prepare(
              'UPDATE portal_state SET payload = ?1, updated_at = ?2 WHERE id = ?3 AND payload = ?4',
            )
            .bind(payload, updatedAt, portalStateId, row.payload)
        : db
            .prepare(
              'INSERT INTO portal_state (id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING',
            )
            .bind(portalStateId, payload, updatedAt);
    const result =
      effects.length > 0
        ? (await db.batch([write, ...effects]))[0]
        : await write.run();
    if (result.meta.changes === 1) return { state, updatedAt };
  }
  throw new PortalStateConflict(
    '다른 창에서 먼저 저장했습니다. 최신 명단을 확인한 후 다시 시도해 주세요.',
    'cas_exhausted',
  );
}

export async function recordPortalLogin(memberId: string) {
  const db = database();
  await ensurePortalTables(db);
  const observedAt = Date.now();
  const lastLoginAt = new Date(observedAt).toISOString();
  const sessionCutoff = new Date(
    observedAt - PORTAL_LOGIN_SESSION_IDLE_MS,
  ).toISOString();
  await db
    .prepare(`
      INSERT INTO portal_login_stats (member_id, last_login_at, login_count)
      VALUES (?1, ?2, 1)
      ON CONFLICT(member_id) DO UPDATE SET
        last_login_at = CASE
          WHEN portal_login_stats.last_login_at < excluded.last_login_at
            THEN excluded.last_login_at
          ELSE portal_login_stats.last_login_at
        END,
        login_count = portal_login_stats.login_count + CASE
          WHEN portal_login_stats.last_login_at <= ?3 THEN 1
          ELSE 0
        END
    `)
    .bind(memberId, lastLoginAt, sessionCutoff)
    .run();

  return lastLoginAt;
}

export async function readPortalLoginStats(): Promise<PortalLoginStat[]> {
  const db = database();
  await ensurePortalTables(db);
  const result = await db
    .prepare(
      'SELECT member_id, last_login_at, login_count FROM portal_login_stats ORDER BY last_login_at DESC',
    )
    .all<PortalLoginStatRow>();

  return result.results.map((row) => ({
    memberId: row.member_id,
    lastLoginAt: row.last_login_at,
    loginCount: row.login_count,
  }));
}
