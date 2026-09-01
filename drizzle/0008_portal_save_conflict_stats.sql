CREATE TABLE IF NOT EXISTS portal_save_conflict_stats (
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  conflict_count INTEGER NOT NULL DEFAULT 1,
  last_conflict_at TEXT NOT NULL,
  PRIMARY KEY (bucket_date, source, kind, actor_role)
);
