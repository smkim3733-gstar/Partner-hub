-- New standalone target database only. Never apply to the existing Sites DB.
-- Schema only: an operator provisions the first administrator separately.
CREATE TABLE standalone_admin_accounts (
  id TEXT PRIMARY KEY CHECK (id = 'primary-admin'),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 40),
  password_hash TEXT NOT NULL,
  credential_version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE standalone_admin_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  admin_id TEXT NOT NULL REFERENCES standalone_admin_accounts(id),
  credential_version TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at AND expires_at <= issued_at + 3600000)
);
CREATE INDEX standalone_admin_sessions_expiry ON standalone_admin_sessions(expires_at);
CREATE TABLE standalone_admin_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES standalone_admin_accounts(id),
  action TEXT NOT NULL CHECK (action IN ('provision', 'login', 'logout', 'switch')),
  created_at TEXT NOT NULL
);
