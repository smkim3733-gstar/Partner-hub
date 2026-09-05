-- FLOW root identity is stable for its lifetime, and the operational record is durable.
CREATE TRIGGER IF NOT EXISTS consulting_flows_identity_immutable
BEFORE UPDATE ON consulting_flows
WHEN NEW.case_id IS NOT OLD.case_id OR NEW.partner_id IS NOT OLD.partner_id
BEGIN
  SELECT RAISE(ABORT, 'consulting flow identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_no_delete
BEFORE DELETE ON consulting_flows
BEGIN
  SELECT RAISE(ABORT, 'consulting flow root is durable');
END;
