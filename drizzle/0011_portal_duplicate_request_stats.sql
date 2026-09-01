CREATE TABLE IF NOT EXISTS portal_duplicate_request_stats (
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('flow_command', 'file_upload', 'admin_partner_registration')),
  outcome TEXT NOT NULL CHECK (outcome IN ('safe_retry', 'request_key_conflict', 'existing_record_blocked', 'unkeyed_request')),
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 0),
  PRIMARY KEY (bucket_date, source, outcome)
);
