-- Reject new malformed root envelopes without rewriting any existing state.
CREATE TRIGGER IF NOT EXISTS portal_state_insert_envelope_guard
BEFORE INSERT ON portal_state
WHEN json_valid(NEW.payload) <> 1
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
  SELECT RAISE(ABORT, 'portal state insert envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS portal_state_update_envelope_guard
BEFORE UPDATE ON portal_state
WHEN NEW.id IS OLD.id
  AND (
    json_valid(NEW.payload) <> 1
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
  )
BEGIN
  SELECT RAISE(ABORT, 'portal state update envelope is invalid');
END;
