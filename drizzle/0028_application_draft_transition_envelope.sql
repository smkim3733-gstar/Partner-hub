-- Keep each private draft bound to its first owner and preserve cleared
-- revisions as tombstones. Existing rows are left unchanged.
CREATE TRIGGER IF NOT EXISTS application_drafts_identity_immutable
BEFORE UPDATE ON application_drafts
WHEN NEW.owner_key IS NOT OLD.owner_key
BEGIN
  SELECT RAISE(ABORT, 'application draft owner is immutable');
END;

CREATE TRIGGER IF NOT EXISTS application_drafts_insert_guard
BEFORE INSERT ON application_drafts
WHEN typeof(NEW.revision) <> 'integer'
  OR NEW.revision IS NOT 1
  OR length(NEW.draft_id) NOT BETWEEN 10 AND 80
  OR NEW.draft_id GLOB '*[^A-Za-z0-9-]*'
  OR json_valid(NEW.payload) <> 1
  OR COALESCE(json_type(NEW.payload), '') <> 'object'
  OR typeof(NEW.updated_at) <> 'text'
  OR length(NEW.updated_at) <> 24
  OR substr(NEW.updated_at, 5, 1) <> '-'
  OR substr(NEW.updated_at, 8, 1) <> '-'
  OR substr(NEW.updated_at, 11, 1) <> 'T'
  OR substr(NEW.updated_at, 14, 1) <> ':'
  OR substr(NEW.updated_at, 17, 1) <> ':'
  OR substr(NEW.updated_at, 20, 1) <> '.'
  OR substr(NEW.updated_at, 24, 1) <> 'Z'
  OR julianday(NEW.updated_at) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'application draft insert envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS application_drafts_transition_guard
BEFORE UPDATE ON application_drafts
WHEN NEW.owner_key IS OLD.owner_key
  AND (
    typeof(NEW.revision) <> 'integer'
    OR NEW.revision IS NOT OLD.revision + 1
    OR length(NEW.draft_id) NOT BETWEEN 10 AND 80
    OR NEW.draft_id GLOB '*[^A-Za-z0-9-]*'
    OR (
      NEW.payload IS NOT NULL
      AND (
        json_valid(NEW.payload) <> 1
        OR COALESCE(json_type(NEW.payload), '') <> 'object'
      )
    )
    OR NEW.payload IS OLD.payload
    OR typeof(NEW.updated_at) <> 'text'
    OR length(NEW.updated_at) <> 24
    OR substr(NEW.updated_at, 5, 1) <> '-'
    OR substr(NEW.updated_at, 8, 1) <> '-'
    OR substr(NEW.updated_at, 11, 1) <> 'T'
    OR substr(NEW.updated_at, 14, 1) <> ':'
    OR substr(NEW.updated_at, 17, 1) <> ':'
    OR substr(NEW.updated_at, 20, 1) <> '.'
    OR substr(NEW.updated_at, 24, 1) <> 'Z'
    OR julianday(NEW.updated_at) IS NULL
    OR NOT (
      (OLD.payload IS NOT NULL AND NEW.draft_id IS OLD.draft_id)
      OR (
        OLD.payload IS NULL
        AND NEW.payload IS NOT NULL
        AND NEW.draft_id IS NOT OLD.draft_id
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'application draft transition envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS application_drafts_no_delete
BEFORE DELETE ON application_drafts
BEGIN
  SELECT RAISE(ABORT, 'application draft tombstone is durable');
END;
