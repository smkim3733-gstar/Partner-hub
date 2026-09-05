-- Permit metadata creation and parent-file cascade cleanup, but no in-place
-- rewrite or direct ledger removal while the parent original still exists.
CREATE TRIGGER IF NOT EXISTS company_file_metadata_no_update
BEFORE UPDATE ON company_file_metadata
BEGIN
  SELECT RAISE(ABORT, 'company file metadata is immutable');
END;

CREATE TRIGGER IF NOT EXISTS company_file_metadata_no_direct_delete
BEFORE DELETE ON company_file_metadata
WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id)
BEGIN
  SELECT RAISE(ABORT, 'company file metadata requires parent deletion');
END;
