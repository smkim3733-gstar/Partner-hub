import { env } from 'cloudflare:workers';

import { portalStateId, portalStateTableSql } from '@/db/schema';

type PortalStateRow = {
  payload: string;
};

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error('DB binding is not configured.');
  }
  return binding;
}

async function ensurePortalStateTable(db: D1Database) {
  await db.prepare(portalStateTableSql).run();
}

export async function readPortalState(): Promise<unknown> {
  const db = database();
  await ensurePortalStateTable(db);
  const row = await db
    .prepare('SELECT payload FROM portal_state WHERE id = ?1')
    .bind(portalStateId)
    .first<PortalStateRow>();

  return row ? JSON.parse(row.payload) : null;
}

export async function writePortalState(state: unknown) {
  const db = database();
  await ensurePortalStateTable(db);
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
