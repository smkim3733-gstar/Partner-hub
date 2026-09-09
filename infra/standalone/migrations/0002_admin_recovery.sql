-- New standalone target only. Preserve 0001 and all original Sites migrations.
CREATE TABLE standalone_admin_recovery_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES standalone_admin_accounts(id),
  reason TEXT NOT NULL CHECK (reason IN ('lost-password', 'credential-compromise', 'rotation')),
  previous_version_hash TEXT NOT NULL CHECK (length(previous_version_hash) = 64 AND previous_version_hash NOT GLOB '*[^a-f0-9]*'),
  next_version_hash TEXT NOT NULL UNIQUE CHECK (length(next_version_hash) = 64 AND next_version_hash NOT GLOB '*[^a-f0-9]*'),
  created_at TEXT NOT NULL
);
CREATE TRIGGER standalone_admin_recovery_audit_no_update
BEFORE UPDATE ON standalone_admin_recovery_audit
BEGIN
  SELECT RAISE(ABORT, 'standalone_admin_recovery_audit_immutable');
END;
CREATE TRIGGER standalone_admin_recovery_audit_no_delete
BEFORE DELETE ON standalone_admin_recovery_audit
BEGIN
  SELECT RAISE(ABORT, 'standalone_admin_recovery_audit_immutable');
END;
