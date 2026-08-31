-- Additive only. Existing members, cases, files and provider authentication are retained.
CREATE TABLE IF NOT EXISTS portal_password_accounts (
    member_id TEXT PRIMARY KEY NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, credential_version TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS portal_password_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL, member_id TEXT NOT NULL,
    email TEXT NOT NULL, credential_version TEXT NOT NULL, expires_at INTEGER NOT NULL
  );

CREATE INDEX IF NOT EXISTS portal_password_sessions_member_idx ON portal_password_sessions(member_id);

CREATE TABLE IF NOT EXISTS portal_password_links (
    token_hash TEXT PRIMARY KEY NOT NULL, member_id TEXT NOT NULL, email TEXT NOT NULL,
    expires_at INTEGER NOT NULL, consumed_by TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS portal_password_links_member_idx ON portal_password_links(member_id);

CREATE TABLE IF NOT EXISTS portal_auth_limits (
    key_hash TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );

CREATE INDEX IF NOT EXISTS portal_auth_limits_expiry_idx ON portal_auth_limits(expires_at);
