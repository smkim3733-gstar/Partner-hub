CREATE TABLE vercel_blob_transfers (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL CHECK(length(session_hash) = 64),
  intent TEXT NOT NULL CHECK(json_valid(intent)),
  payload TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at = created_at + 600000)
);
CREATE INDEX vercel_blob_transfers_expiry ON vercel_blob_transfers(expires_at);
CREATE TRIGGER vercel_blob_transfers_immutable BEFORE UPDATE ON vercel_blob_transfers
BEGIN SELECT RAISE(ABORT, 'BLOB_TRANSFER_IMMUTABLE'); END;
