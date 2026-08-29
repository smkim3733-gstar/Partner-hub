export const portalStateTableSql = `
CREATE TABLE IF NOT EXISTS portal_state (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`;

export const portalLoginStatsTableSql = `
CREATE TABLE IF NOT EXISTS portal_login_stats (
  member_id TEXT PRIMARY KEY NOT NULL,
  last_login_at TEXT NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 1
)
`;

export const portalStateId = 'keve-partner-hub';
