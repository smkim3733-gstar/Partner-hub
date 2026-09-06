CREATE TRIGGER IF NOT EXISTS consulting_flows_initial_command_insert_guard
BEFORE INSERT ON consulting_flows
WHEN json_valid(NEW.payload) = 1
  AND COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial commands must use a guarded update');
END;
