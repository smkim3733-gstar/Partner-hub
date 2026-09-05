-- Upload request rows are durable idempotency receipts. Permit only normalized
-- request-key migration and forward lifecycle transitions; never remove a row.
CREATE TRIGGER IF NOT EXISTS company_file_upload_requests_lifecycle_guard
BEFORE UPDATE ON company_file_upload_requests
WHEN NEW.owner_key <> OLD.owner_key
  OR NEW.file_id <> OLD.file_id
  OR NEW.created_at <> OLD.created_at
  OR (NEW.fingerprint <> OLD.fingerprint AND NEW.request_key = OLD.request_key)
  OR ((NEW.request_key <> OLD.request_key OR NEW.fingerprint <> OLD.fingerprint)
    AND NEW.status <> OLD.status)
  OR (OLD.status = 'deleted'
    AND (NEW.request_key <> OLD.request_key OR NEW.fingerprint <> OLD.fingerprint))
  OR NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'pending' AND NEW.status IN ('ready', 'deleted'))
    OR (OLD.status = 'ready' AND NEW.status = 'deleted')
  )
BEGIN
  SELECT RAISE(ABORT, 'company file upload request transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS company_file_upload_requests_no_delete
BEFORE DELETE ON company_file_upload_requests
BEGIN
  SELECT RAISE(ABORT, 'company file upload request is durable');
END;
