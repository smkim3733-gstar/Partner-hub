-- Additive migration: preserves the existing portal and files.
CREATE TABLE IF NOT EXISTS consulting_flows (
  case_id TEXT PRIMARY KEY NOT NULL,
  partner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
