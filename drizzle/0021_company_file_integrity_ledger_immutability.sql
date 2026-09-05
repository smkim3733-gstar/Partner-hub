-- Preserve additive object-integrity and storage-key evidence. Only a verified
-- parent-file deletion may cascade these rows away.
CREATE TRIGGER IF NOT EXISTS company_file_object_integrity_no_update
BEFORE UPDATE ON company_file_object_integrity
BEGIN
  SELECT RAISE(ABORT, 'company file object integrity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS company_file_object_integrity_no_direct_delete
BEFORE DELETE ON company_file_object_integrity
WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id)
BEGIN
  SELECT RAISE(ABORT, 'company file object integrity requires parent deletion');
END;

CREATE TRIGGER IF NOT EXISTS company_file_storage_keys_no_update
BEFORE UPDATE ON company_file_storage_keys
BEGIN
  SELECT RAISE(ABORT, 'company file storage key is immutable');
END;

CREATE TRIGGER IF NOT EXISTS company_file_storage_keys_no_direct_delete
BEFORE DELETE ON company_file_storage_keys
WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id)
BEGIN
  SELECT RAISE(ABORT, 'company file storage key requires parent deletion');
END;
