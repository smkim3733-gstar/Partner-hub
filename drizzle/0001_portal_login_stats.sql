CREATE TABLE IF NOT EXISTS portal_login_stats (
  member_id TEXT PRIMARY KEY NOT NULL,
  last_login_at TEXT NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 1
);
