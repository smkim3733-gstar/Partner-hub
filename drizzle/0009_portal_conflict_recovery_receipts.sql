CREATE TABLE IF NOT EXISTS portal_conflict_receipts (
  token_hash TEXT PRIMARY KEY NOT NULL,
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS portal_conflict_receipts_expiry_idx
ON portal_conflict_receipts (expires_at);

CREATE TABLE IF NOT EXISTS portal_conflict_recovery_stats (
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  issued_count INTEGER NOT NULL DEFAULT 0,
  recovered_count INTEGER NOT NULL DEFAULT 0,
  under_1m_count INTEGER NOT NULL DEFAULT 0,
  under_5m_count INTEGER NOT NULL DEFAULT 0,
  under_30m_count INTEGER NOT NULL DEFAULT 0,
  under_2h_count INTEGER NOT NULL DEFAULT 0,
  under_24h_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_date, source, kind, actor_role)
);
