CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_cardinality_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 1
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command cardinality is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_command_cardinality_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) -
  COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0) > 1
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command cardinality is invalid');
END;
