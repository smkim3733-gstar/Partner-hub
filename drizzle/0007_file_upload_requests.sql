-- Additive request ledger. Never delete these rows when deleting an original file.
CREATE TABLE IF NOT EXISTS company_file_upload_requests (
  owner_key TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'deleted')),
  PRIMARY KEY (owner_key, request_key)
);
