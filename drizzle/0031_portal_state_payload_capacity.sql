-- Match D1's storage boundary to the application-level UTF-8 byte limit.
CREATE TRIGGER IF NOT EXISTS portal_state_insert_capacity_guard
BEFORE INSERT ON portal_state
WHEN length(CAST(NEW.payload AS BLOB)) > 900000
BEGIN
  SELECT RAISE(ABORT, 'portal state payload exceeds capacity');
END;

CREATE TRIGGER IF NOT EXISTS portal_state_update_capacity_guard
BEFORE UPDATE ON portal_state
WHEN NEW.id IS OLD.id
  AND length(CAST(NEW.payload AS BLOB)) > 900000
BEGIN
  SELECT RAISE(ABORT, 'portal state payload exceeds capacity');
END;
