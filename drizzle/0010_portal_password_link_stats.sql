CREATE TABLE IF NOT EXISTS portal_password_link_stats (
  bucket_date TEXT PRIMARY KEY NOT NULL,
  issued_count INTEGER NOT NULL DEFAULT 0,
  active_replacement_count INTEGER NOT NULL DEFAULT 0,
  expired_at_reissue_count INTEGER NOT NULL DEFAULT 0,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  observed_expired_attempt_count INTEGER NOT NULL DEFAULT 0
);
