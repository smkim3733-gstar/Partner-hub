-- Company-file object facts are written once. Explicit deletion still removes
-- the parent row after integrity checks and cascades its immutable child ledgers.
CREATE TRIGGER IF NOT EXISTS company_file_objects_no_update
BEFORE UPDATE ON company_file_objects
BEGIN
  SELECT RAISE(ABORT, 'company file object is immutable');
END;
