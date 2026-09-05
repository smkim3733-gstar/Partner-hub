-- New and updated FLOW roots keep their authoritative row columns and JSON envelope atomic.
CREATE TRIGGER IF NOT EXISTS consulting_flows_insert_envelope_guard
BEFORE INSERT ON consulting_flows
WHEN typeof(NEW.revision) <> 'integer'
  OR NEW.revision < 0
  OR json_valid(NEW.payload) <> 1
  OR COALESCE(json_type(NEW.payload), '') <> 'object'
  OR COALESCE(json_type(NEW.payload, '$.caseId'), '') <> 'text'
  OR json_extract(NEW.payload, '$.caseId') IS NOT NEW.case_id
  OR COALESCE(json_type(NEW.payload, '$.partnerId'), '') <> 'text'
  OR json_extract(NEW.payload, '$.partnerId') IS NOT NEW.partner_id
  OR COALESCE(json_type(NEW.payload, '$.revision'), '') <> 'integer'
  OR json_extract(NEW.payload, '$.revision') IS NOT NEW.revision
  OR COALESCE(json_type(NEW.payload, '$.updatedAt'), '') <> 'text'
  OR json_extract(NEW.payload, '$.updatedAt') IS NOT NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'consulting flow insert envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN NEW.case_id IS OLD.case_id
  AND NEW.partner_id IS OLD.partner_id
  AND (
    NEW.revision IS NOT OLD.revision + 1
    OR json_valid(NEW.payload) <> 1
    OR COALESCE(json_type(NEW.payload), '') <> 'object'
    OR COALESCE(json_type(NEW.payload, '$.caseId'), '') <> 'text'
    OR json_extract(NEW.payload, '$.caseId') IS NOT NEW.case_id
    OR COALESCE(json_type(NEW.payload, '$.partnerId'), '') <> 'text'
    OR json_extract(NEW.payload, '$.partnerId') IS NOT NEW.partner_id
    OR COALESCE(json_type(NEW.payload, '$.revision'), '') <> 'integer'
    OR json_extract(NEW.payload, '$.revision') IS NOT NEW.revision
    OR COALESCE(json_type(NEW.payload, '$.updatedAt'), '') <> 'text'
    OR json_extract(NEW.payload, '$.updatedAt') IS NOT NEW.updated_at
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow transition envelope is invalid');
END;
