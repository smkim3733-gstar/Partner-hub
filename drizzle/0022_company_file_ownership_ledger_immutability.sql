-- Preserve the first account and case binding for each company original. Future
-- reassignment must use an audited versioned workflow instead of rewriting proof.
CREATE TRIGGER IF NOT EXISTS company_file_assignments_no_update
BEFORE UPDATE ON company_file_assignments
BEGIN
  SELECT RAISE(ABORT, 'company file assignment is immutable');
END;

CREATE TRIGGER IF NOT EXISTS company_file_assignments_no_direct_delete
BEFORE DELETE ON company_file_assignments
WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id)
BEGIN
  SELECT RAISE(ABORT, 'company file assignment requires parent deletion');
END;

CREATE TRIGGER IF NOT EXISTS company_file_case_links_no_update
BEFORE UPDATE ON company_file_case_links
BEGIN
  SELECT RAISE(ABORT, 'company file case link is immutable');
END;

CREATE TRIGGER IF NOT EXISTS company_file_case_links_no_direct_delete
BEFORE DELETE ON company_file_case_links
WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id)
BEGIN
  SELECT RAISE(ABORT, 'company file case link requires parent deletion');
END;
