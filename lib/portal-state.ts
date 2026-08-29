import { env } from 'cloudflare:workers';

import { portalLoginStatsTableSql, portalStateId, portalStateTableSql } from '@/db/schema';

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
  ]);
}

export async function readPortalState(): Promise<unknown> {
  const db = database();
  await ensurePortalTables(db);
  const row = await db
    .prepare('SELECT payload FROM portal_state WHERE id = ?1')
    .bind(portalStateId)
    .first<PortalStateRow>();

  return row ? JSON.parse(row.payload) : null;
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

export async function recordPortalLogin(memberId: string) {
  const db = database();
  await ensurePortalTables(db);
  const lastLoginAt = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO portal_login_stats (member_id, last_login_at, login_count)
      VALUES (?1, ?2, 1)
      ON CONFLICT(member_id) DO UPDATE SET
        last_login_at = excluded.last_login_at,
        login_count = portal_login_stats.login_count + 1
    `)
    .bind(memberId, lastLoginAt)
    .run();

  return lastLoginAt;
}

export async function readPortalLoginStats(): Promise<PortalLoginStat[]> {
  const db = database();
  await ensurePortalTables(db);
  const result = await db
    .prepare('SELECT member_id, last_login_at, login_count FROM portal_login_stats ORDER BY last_login_at DESC')
    .all<PortalLoginStatRow>();

  return result.results.map((row) => ({
    memberId: row.member_id,
    lastLoginAt: row.last_login_at,
    loginCount: row.login_count,
  }));
}
