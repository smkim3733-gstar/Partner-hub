-- Private per-account draft; existing portal records and files are unchanged.
CREATE TABLE IF NOT EXISTS application_drafts (
  owner_key TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  draft_id TEXT NOT NULL UNIQUE,
  payload TEXT,
  updated_at TEXT NOT NULL
);
