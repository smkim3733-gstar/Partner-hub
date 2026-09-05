-- The portal has one fixed state root. Existing content remains unchanged.
CREATE TRIGGER IF NOT EXISTS portal_state_fixed_identity_insert
BEFORE INSERT ON portal_state
WHEN NEW.id IS NOT 'keve-partner-hub'
BEGIN
  SELECT RAISE(ABORT, 'portal state identity is fixed');
END;

CREATE TRIGGER IF NOT EXISTS portal_state_identity_immutable
BEFORE UPDATE ON portal_state
WHEN NEW.id IS NOT OLD.id
BEGIN
  SELECT RAISE(ABORT, 'portal state identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS portal_state_no_delete
BEFORE DELETE ON portal_state
BEGIN
  SELECT RAISE(ABORT, 'portal state root is durable');
END;
